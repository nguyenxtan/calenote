import { z } from 'zod';
import { PersonalAssistantDocumentSchema, PersonalAssistantEnvelopeSchema, initialPersonalAssistantDocument } from '@/contracts/api/personal-assistant';
import { persistedD1Blob } from '@/modules/db/persisted-blob';
import type { Keyring } from '@/modules/security/keyring';

type Document = z.infer<typeof PersonalAssistantDocumentSchema>;
export type PersonalAssistantEnvelope = z.infer<typeof PersonalAssistantEnvelopeSchema>;
export class PersonalAssistantError extends Error {
  readonly status: number;
  constructor(readonly code: 'NOT_FOUND' | 'CONFLICT' | 'BLOCKED') {
    super(code === 'CONFLICT' ? 'Dữ liệu đã thay đổi. Vui lòng tải lại.' : 'Chưa thể truy cập dữ liệu trợ lý.');
    this.name = 'PersonalAssistantError';
    this.status = code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 503;
  }
}
export class D1PersonalAssistantStore {
  constructor(private readonly database: D1Database, private readonly keyring: Keyring) {}
  private entity(ownerId: string) { return JSON.stringify(['personal-assistant', ownerId]); }
  private async requireOwner(ownerId: string) {
    if (!ownerId || !await this.database.prepare('SELECT id FROM users WHERE id = ?').bind(ownerId).first()) throw new PersonalAssistantError('NOT_FOUND');
  }
  async get(ownerId: string): Promise<PersonalAssistantEnvelope> {
    try {
      await this.requireOwner(ownerId);
      const row = await this.database.prepare('SELECT document_ciphertext, document_iv, document_key_version, revision FROM personal_assistant_documents WHERE owner_user_id = ?').bind(ownerId).first<{document_ciphertext: unknown; document_iv: unknown; document_key_version: number; revision: number}>();
      if (!row) return { revision: 0, document: initialPersonalAssistantDocument() };
      const plaintext = await this.keyring.decryptSensitive('semantic-context', this.entity(ownerId), row.document_key_version, {
        ciphertext: persistedD1Blob(row.document_ciphertext), iv: persistedD1Blob(row.document_iv),
      });
      return PersonalAssistantEnvelopeSchema.parse({revision: row.revision, document: JSON.parse(plaintext)});
    } catch (error) {
      if (error instanceof PersonalAssistantError) throw error;
      throw new PersonalAssistantError('BLOCKED');
    }
  }
  async put(ownerId: string, expectedRevision: number, input: Document, now = Date.now()): Promise<PersonalAssistantEnvelope> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER || !Number.isSafeInteger(now)) throw new PersonalAssistantError('BLOCKED');
    const document = PersonalAssistantDocumentSchema.parse(input);
    try {
      await this.requireOwner(ownerId);
      const encrypted = await this.keyring.encryptSensitive('semantic-context', this.entity(ownerId), 1, JSON.stringify(document));
      const scheduleFingerprint = await this.keyring.digestCode(JSON.stringify(['personal-assistant-schedule', ownerId, document.events, document.daily]));
      const result = expectedRevision === 0
        ? await this.database.prepare(`INSERT INTO personal_assistant_documents (owner_user_id, document_ciphertext, document_iv, document_key_version, schedule_fingerprint, revision, updated_at) VALUES (?, ?, ?, 1, ?, 1, ?) ON CONFLICT(owner_user_id) DO NOTHING RETURNING revision`).bind(ownerId, encrypted.ciphertext, encrypted.iv, scheduleFingerprint, now).first<{revision: number}>()
        : await this.database.prepare(`UPDATE personal_assistant_documents SET document_ciphertext = ?, document_iv = ?, document_key_version = 1, schedule_fingerprint = ?, revision = revision + 1, updated_at = ? WHERE owner_user_id = ? AND revision = ? RETURNING revision`).bind(encrypted.ciphertext, encrypted.iv, scheduleFingerprint, now, ownerId, expectedRevision).first<{revision: number}>();
      if (result?.revision !== expectedRevision + 1) throw new PersonalAssistantError('CONFLICT');
      return {revision: expectedRevision + 1, document};
    } catch (error) {
      if (error instanceof PersonalAssistantError) throw error;
      throw new PersonalAssistantError('BLOCKED');
    }
  }
}
