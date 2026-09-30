import type { SessionPrincipal } from "@/modules/auth/session";
import type { Keyring } from "@/modules/security/keyring";
import { persistedD1Blob } from "@/modules/db/persisted-blob";
import type { ContextContractStore } from "@/modules/conversation/context-contract/store";
import type { ContextScope } from "@/modules/conversation/context-contract/state";
import { ReminderListResponseV2Schema, type ReminderDetailsResponseV2 } from "@/contracts/api/reminders-v2";
import type { OwnedReminderRow } from "./api-service";

export interface DetailedReminderRow extends OwnedReminderRow {
  owner_id: string; chat_identity_id: string | null; workspace_id: string;
  connection_id: string | null; private_chat_id: string | null;
  has_context_details: number;
}
export interface DetailedReminderStore { listOwnedDetailed(userId: string, limit: number): Promise<DetailedReminderRow[]> }

const MAX_RESPONSE_BYTES = 128 * 1024;
const utf8Bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export async function listDetailedReminders(principal: SessionPrincipal, dependencies: {
  store: DetailedReminderStore;
  contextStore: Pick<ContextContractStore, "readReminderDetails">;
  keyring: Pick<Keyring, "decryptSensitive">;
}) {
  const rows = await dependencies.store.listOwnedDetailed(principal.userId, 101);
  const reminders: ReminderDetailsResponseV2[] = [];
  let hasMore = rows.length > 100;
  for (const row of rows.slice(0, 100)) {
    if (row.owner_id !== principal.userId || (row.chat_identity_id !== null && (row.connection_id === null || row.private_chat_id === null))) throw new Error("INVALID_REMINDER_SCOPE");
    const title = await dependencies.keyring.decryptSensitive("reminder-title", row.id, row.title_key_version, {
      ciphertext: persistedD1Blob(row.title_ciphertext), iv: persistedD1Blob(row.title_iv),
    });
    const details = row.chat_identity_id === null ? null : await dependencies.contextStore.readReminderDetails({ kind: "WEB", principal,
      chat: { ownerId: principal.userId, chatIdentityId: row.chat_identity_id, workspaceId: row.workspace_id,
        connectionId: row.connection_id!, chatId: row.private_chat_id! } satisfies ContextScope }, row.public_id);
    if ((row.has_context_details === 1 && details === null) || (row.has_context_details === 0 && details !== null)) throw new Error("INVALID_CONTEXT_DETAILS");
    const reminder: ReminderDetailsResponseV2 = { publicId: row.public_id, title, scheduledAt: row.scheduled_at,
      timezone: row.timezone, status: row.status, details };
    const candidate = { data: { schemaVersion: "reminders-2", reminders: [...reminders, reminder], hasMore: false, scope: "OWNER" } };
    ReminderListResponseV2Schema.parse(candidate);
    if (utf8Bytes(candidate) > MAX_RESPONSE_BYTES) { hasMore = true; break; }
    reminders.push(reminder);
  }
  return ReminderListResponseV2Schema.parse({ data: { schemaVersion: "reminders-2", reminders, hasMore, scope: "OWNER" } }).data;
}
