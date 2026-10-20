import { ContinueEmailRequestSchema } from "@/contracts/api/auth-continue";
import { prepareSession } from "./session";
import { cryptoRandomBytes, randomOpaqueId, type Clock, type RandomBytes } from "@/modules/platform/types";
import type { Keyring } from "@/modules/security/keyring";
import { consumeRateLimit, type RateLimitStore } from "@/modules/rate-limit/service";
import { RateLimitExceededError } from "@/modules/onboarding/service";

export const EMAIL_REGISTRATION_TTL_MS = 10 * 60_000;
export interface EmailRegistrationSender {
  /** One attempt only. A rejection (including an unknown outcome) disables this challenge. */
  send(input: { to: string; code: string; expiresAt: number }): Promise<void>;
  sendWelcome?(input: { to: string; displayName: string }): Promise<void>;
}
export interface EmailRegistrationDependencies {
  database: D1Database;
  keyring: Pick<Keyring, "digestCode" | "digestSession">;
  rateLimitStore: RateLimitStore;
  sender?: EmailRegistrationSender;
  now?: Clock;
  randomBytes?: RandomBytes;
}
export class EmailRegistrationError extends Error {
  constructor(readonly code: "INVALID_CODE" | "DELIVERY_UNAVAILABLE" | "INVALID_INPUT", readonly status = code === "DELIVERY_UNAVAILABLE" ? 503 : 400) {
    super(code === "DELIVERY_UNAVAILABLE" ? "Email delivery unavailable." : "Registration could not be verified.");
    this.name = "EmailRegistrationError";
  }
}
function bindingValid(value: string): boolean { return /^[A-Za-z0-9_-]{32,128}$/u.test(value); }
function generateCode(random: RandomBytes): string {
  let code = "";
  while (code.length < 6) {
    const bytes = random(16);
    if (bytes.length !== 16) throw new TypeError("Invalid random source");
    for (const value of bytes) if (value < 250 && code.length < 6) code += value % 10;
  }
  return code;
}
export async function requestEmailRegistration(input: {email: string; displayName: string; clientIp: string; browserBinding: string}, deps: EmailRegistrationDependencies): Promise<{challengeId: string; expiresAt: number}> {
  const parsed = ContinueEmailRequestSchema.safeParse({email: input.email});
  if (!parsed.success || !bindingValid(input.browserBinding) || !input.displayName.trim() || input.displayName.trim().length > 80) throw new EmailRegistrationError("INVALID_INPUT");
  if (!deps.sender) throw new EmailRegistrationError("DELIVERY_UNAVAILABLE");
  const email = parsed.data.email;
  const now = (deps.now ?? Date.now)();
  for (const [subject, limit] of [[`ip:${input.clientIp}`,10],[`email:${email}`,3],["global",100]] as const) {
    const rate = await consumeRateLimit({subjectDigest: await deps.keyring.digestCode(`email-registration:rate:${subject}`),scope:"email-registration",limit,windowMs:3_600_000},{store:deps.rateLimitStore,now:()=>now});
    if (!rate.allowed) throw new RateLimitExceededError(Math.max(1,Math.ceil((rate.resetAt-now)/1000)));
  }
  const random = deps.randomBytes ?? cryptoRandomBytes;
  const challengeId = randomOpaqueId(random);
  const expiresAt = now + EMAIL_REGISTRATION_TTL_MS;
  // Existing accounts receive the same public result, but never an ownership proof.
  if (await deps.database.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE AND NOT EXISTS(SELECT 1 FROM email_verified_accounts v WHERE v.user_id=users.id)").bind(email).first()) return {challengeId,expiresAt};
  const code = generateCode(random);
  const codeDigest = await deps.keyring.digestCode(`email-registration:code:${challengeId}:${code}`);
  const bindingDigest = await deps.keyring.digestCode(`email-registration:binding:${input.browserBinding}`);
  const reserved = await deps.database.prepare(`INSERT INTO email_registration_challenges(email,id,display_name,code_digest,binding_digest,expires_at,created_at,delivery_status)
    VALUES(?,?,?,?,?,?,?,'PENDING') ON CONFLICT(email) DO UPDATE SET id=excluded.id,display_name=excluded.display_name,code_digest=excluded.code_digest,binding_digest=excluded.binding_digest,expires_at=excluded.expires_at,created_at=excluded.created_at,attempts=0,delivery_status='PENDING',consumed_at=NULL,verification_marker=NULL
    WHERE email_registration_challenges.created_at<=? RETURNING id`).bind(email,challengeId,input.displayName.trim(),codeDigest,bindingDigest,expiresAt,now,now-60_000).first();
  if (!reserved) throw new RateLimitExceededError(60);
  try { await deps.sender.send({to:email,code,expiresAt}); }
  catch {
    await deps.database.prepare("UPDATE email_registration_challenges SET delivery_status='FAILED' WHERE id=?").bind(challengeId).run();
    throw new EmailRegistrationError("DELIVERY_UNAVAILABLE");
  }
  await deps.database.prepare("UPDATE email_registration_challenges SET delivery_status='SENT' WHERE id=? AND delivery_status='PENDING'").bind(challengeId).run();
  return {challengeId,expiresAt};
}
export async function verifyEmailRegistration(input: {challengeId: string;email: string;code: string;clientIp: string;browserBinding: string}, deps: EmailRegistrationDependencies) {
  if (!bindingValid(input.browserBinding) || !/^[A-Za-z0-9_-]{16,128}$/u.test(input.challengeId) || !/^\d{6}$/u.test(input.code)) throw new EmailRegistrationError("INVALID_CODE");
  const now = (deps.now ?? Date.now)();
  const random = deps.randomBytes ?? cryptoRandomBytes;
  const parsed = ContinueEmailRequestSchema.safeParse({email:input.email});
  if (!parsed.success) throw new EmailRegistrationError("INVALID_CODE");
  const rate = await consumeRateLimit({subjectDigest:await deps.keyring.digestCode(`email-registration:verify-ip:${input.clientIp}`),scope:"email-registration-verify",limit:30,windowMs:3_600_000},{store:deps.rateLimitStore,now:()=>now});
  if (!rate.allowed) throw new RateLimitExceededError(Math.max(1,Math.ceil((rate.resetAt-now)/1000)));
  const existing = await deps.database.prepare("SELECT u.id,w.id AS workspace_id FROM users u JOIN email_verified_accounts v ON v.user_id=u.id JOIN workspaces w ON w.owner_user_id=u.id WHERE u.email=? COLLATE NOCASE").bind(parsed.data.email).first<{id:string;workspace_id:string}>();
  const marker = randomOpaqueId(random), userId = existing?.id ?? randomOpaqueId(random), workspaceId = existing?.workspace_id ?? randomOpaqueId(random);
  const codeDigest = await deps.keyring.digestCode(`email-registration:code:${input.challengeId}:${input.code}`);
  const bindingDigest = await deps.keyring.digestCode(`email-registration:binding:${input.browserBinding}`);
  const session = await prepareSession(userId,{keyring:deps.keyring,now:()=>now,randomBytes:random});
  const db = deps.database;
  // D1 batches are transactions. Only the request that atomically installs its marker
  // can create the account graph. Wrong codes consume one durable attempt.
  await db.batch([
    db.prepare(`UPDATE email_registration_challenges SET attempts=attempts+1,
      consumed_at=CASE WHEN code_digest=? THEN ? ELSE NULL END,
      verification_marker=CASE WHEN code_digest=? THEN ? ELSE NULL END
      WHERE id=? AND email=? COLLATE NOCASE AND binding_digest=? AND consumed_at IS NULL AND delivery_status='SENT' AND expires_at>? AND attempts<5
      AND NOT EXISTS(SELECT 1 FROM users WHERE users.email=email_registration_challenges.email COLLATE NOCASE AND NOT EXISTS(SELECT 1 FROM email_verified_accounts v WHERE v.user_id=users.id))`)
      .bind(codeDigest,now,codeDigest,marker,input.challengeId,parsed.data.email,bindingDigest,now),
    db.prepare(`INSERT INTO users(id,email,display_name,timezone,created_at,updated_at)
      SELECT ?,email,display_name,'Asia/Ho_Chi_Minh',?,? FROM email_registration_challenges WHERE id=? AND verification_marker=? AND NOT EXISTS(SELECT 1 FROM users WHERE email=email_registration_challenges.email COLLATE NOCASE)`)
      .bind(userId,now,now,input.challengeId,marker),
    db.prepare("INSERT OR IGNORE INTO workspaces SELECT ?,id,'PERSONAL',?,? FROM users WHERE id=? AND EXISTS(SELECT 1 FROM email_registration_challenges WHERE id=? AND verification_marker=?)").bind(workspaceId,now,now,userId,input.challengeId,marker),
    db.prepare("INSERT OR IGNORE INTO memberships SELECT ?,id,'OWNER',? FROM users WHERE id=? AND EXISTS(SELECT 1 FROM email_registration_challenges WHERE id=? AND verification_marker=?)").bind(workspaceId,now,userId,input.challengeId,marker),
    db.prepare("INSERT OR IGNORE INTO email_verified_accounts SELECT id,? FROM users WHERE id=? AND EXISTS(SELECT 1 FROM email_registration_challenges WHERE id=? AND verification_marker=?)").bind(now,userId,input.challengeId,marker),
    db.prepare("INSERT INTO sessions SELECT ?,id,?,?,NULL,? FROM users WHERE id=? AND EXISTS(SELECT 1 FROM email_registration_challenges WHERE id=? AND verification_marker=?)").bind(session.record.id,session.record.digest,session.record.expiresAt,now,userId,input.challengeId,marker),
  ]);
  if (!await db.prepare("SELECT id FROM sessions WHERE id=? AND user_id=?").bind(session.record.id,userId).first()) throw new EmailRegistrationError("INVALID_CODE");
  // Successful first registration only. Reserve before sending: unknown outcomes
  // are never retried, and delivery failure must not invalidate a verified session.
  if (!existing && deps.sender?.sendWelcome) {
    try {
      const claimed = await db.prepare(`INSERT INTO email_welcome_deliveries(user_id,status,attempted_at)
        SELECT ?, 'ATTEMPTED', ? WHERE EXISTS(SELECT 1 FROM email_registration_challenges WHERE id=? AND verification_marker=?)
        ON CONFLICT(user_id) DO NOTHING RETURNING user_id`).bind(userId,now,input.challengeId,marker).first();
      if (claimed) {
        const user = await db.prepare('SELECT display_name FROM users WHERE id=?').bind(userId).first<{display_name:string}>();
        try {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              deps.sender.sendWelcome({to:parsed.data.email,displayName:user?.display_name ?? 'bạn'}),
              new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('WELCOME_TIMEOUT')), 5000); }),
            ]);
          } finally { if (timer !== undefined) clearTimeout(timer); }
          await db.prepare("UPDATE email_welcome_deliveries SET status='SENT' WHERE user_id=?").bind(userId).run();
        } catch { /* ATTEMPTED means failed or unknown, never automatic resend. */ }
      }
    } catch { /* Welcome mail must not turn a committed registration into an error. */ }
  }
  return {userId,workspaceId,session};
}
