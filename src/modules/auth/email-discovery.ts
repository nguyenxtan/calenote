import { ContinueEmailRequestSchema, type AuthNextStep } from "@/contracts/api/auth-continue";
import { RateLimitExceededError } from "@/modules/onboarding/service";
import { consumeRateLimit, type RateLimitStore } from "@/modules/rate-limit/service";
import type { Keyring } from "@/modules/security/keyring";
import type { Clock } from "@/modules/platform/types";

export interface EmailDiscoveryStore { classify(email: string): Promise<AuthNextStep>; }

/** Classification grants no identity, session, or authority to change a bot. */
export class D1EmailDiscoveryStore implements EmailDiscoveryStore {
  constructor(private readonly database: D1Database) {}
  async classify(email: string): Promise<AuthNextStep> {
    // Match D1LoginCodeStore.issue: an explicit primary is authoritative;
    // before a primary is selected, only a sole bound private channel is usable.
    const row = await this.database.prepare(`SELECT CASE WHEN EXISTS (
      SELECT 1 FROM bot_connections c
      JOIN chat_identities ci ON ci.connection_id=c.id
      WHERE c.user_id=u.id AND c.state='ACTIVE_BOUND'
        AND (c.id=(SELECT p.connection_id FROM primary_login_channels p WHERE p.user_id=u.id)
          OR NOT EXISTS(SELECT 1 FROM primary_login_channels p WHERE p.user_id=u.id))
        AND length(trim(ci.private_chat_id))>0 AND length(trim(ci.provider_user_id))>0
      GROUP BY c.user_id HAVING COUNT(*)=1
    ) THEN 'LOGIN' ELSE 'RECOVERY' END AS next
    FROM users u WHERE u.email=? COLLATE NOCASE LIMIT 1`).bind(email).first<{next:AuthNextStep}>();
    return row?.next ?? "SETUP";
  }
}

export async function continueWithEmail(input: {email:string;clientIp:string}, dependencies: {
  store: EmailDiscoveryStore; keyring: Pick<Keyring,"digestCode">; rateLimitStore: RateLimitStore; now?:Clock;
}):Promise<{next:AuthNextStep}> {
  const {email} = ContinueEmailRequestSchema.parse({email:input.email});
  const now = dependencies.now ?? Date.now;
  for (const [subject,limit] of [[`rate-limit:auth-continue:ip:${input.clientIp}`,10],[`rate-limit:auth-continue:email:${email}`,3]] as const) {
    const subjectDigest = await dependencies.keyring.digestCode(subject);
    const rate = await consumeRateLimit({subjectDigest,scope:"auth-continue",limit,windowMs:10*60_000},{store:dependencies.rateLimitStore,now});
    if (!rate.allowed) throw new RateLimitExceededError(Math.max(1,Math.ceil((rate.resetAt-now())/1000)));
  }
  return {next:await dependencies.store.classify(email)};
}
