import type { PublicConnection } from "./dashboard-service";
import { ConnectionNotFoundError, ConnectionStateError, RateLimitExceededError } from "@/modules/onboarding/service";
import { consumeRateLimit, type RateLimitStore } from "@/modules/rate-limit/service";
import { randomOpaqueId, cryptoRandomBytes, systemClock, d1Changes, type Clock, type RandomBytes } from "@/modules/platform/types";
import type { Keyring } from "@/modules/security/keyring";

type Selection = { connection_id: string; revision: number; generation: string; marker: string };
type Candidate = PublicConnection & { id: string; authRevision: number; hasIdentity: boolean };

export class D1PrimaryLoginStore {
  constructor(private readonly db: D1Database) {}
  async get(userId: string): Promise<PublicConnection | null> {
    const row=await this.db.prepare(`SELECT c.public_id,c.provider,c.display_name,c.handle,c.state
      FROM primary_login_channels p JOIN bot_connections c ON c.id=p.connection_id AND c.user_id=p.user_id
      WHERE p.user_id=?`).bind(userId).first<{public_id:string;provider:PublicConnection["provider"];display_name:string;handle:string|null;state:PublicConnection["state"]}>();
    return row?{publicId:row.public_id,provider:row.provider,displayName:row.display_name,handle:row.handle,state:row.state}:null;
  }
  async snapshot(userId: string): Promise<Selection | null> {
    return this.db.prepare("SELECT connection_id,revision,generation,marker FROM primary_login_channels WHERE user_id=?").bind(userId).first<Selection>();
  }
  async candidate(userId: string, publicId: string): Promise<Candidate | null> {
    const row=await this.db.prepare(`SELECT c.id,c.public_id,c.provider,c.display_name,c.handle,c.state,c.auth_revision,
      EXISTS(SELECT 1 FROM chat_identities ci WHERE ci.connection_id=c.id AND c.processing_paused=0 AND length(ci.private_chat_id)>0 AND length(ci.provider_user_id)>0) AS has_identity
      FROM bot_connections c WHERE c.user_id=? AND c.public_id=?`).bind(userId,publicId).first<{id:string;public_id:string;provider:PublicConnection["provider"];display_name:string;handle:string|null;state:PublicConnection["state"];auth_revision:number;has_identity:number}>();
    return row?{id:row.id,publicId:row.public_id,provider:row.provider,displayName:row.display_name,handle:row.handle,state:row.state,authRevision:row.auth_revision,hasIdentity:row.has_identity===1}:null;
  }
  async select(userId: string, candidate: Candidate, expected: Selection | null, marker: string, now: number): Promise<boolean> {
    const guard=expected
      ? "EXISTS(SELECT 1 FROM primary_login_channels WHERE user_id=? AND revision=? AND generation=? AND marker=?)"
      : "NOT EXISTS(SELECT 1 FROM primary_login_channels WHERE user_id=?)";
    const guardValues=expected?[userId,expected.revision,expected.generation,expected.marker]:[userId];
    try {
      const results=await this.db.batch([
        this.db.prepare(`INSERT INTO primary_login_channels(user_id,connection_id,revision,generation,marker,selected_at)
          SELECT ?,c.id,1,lower(hex(randomblob(16))),?,? FROM bot_connections c JOIN chat_identities ci ON ci.connection_id=c.id
          WHERE c.id=? AND c.user_id=? AND c.state='ACTIVE_BOUND' AND c.processing_paused=0 AND c.auth_revision=?
            AND length(ci.private_chat_id)>0 AND length(ci.provider_user_id)>0 AND ${guard}
          ON CONFLICT(user_id) DO UPDATE SET connection_id=excluded.connection_id,revision=primary_login_channels.revision+1,
            marker=excluded.marker,selected_at=excluded.selected_at`)
          .bind(userId,marker,now,candidate.id,userId,candidate.authRevision,...guardValues),
        this.db.prepare(`UPDATE login_codes SET consumed_at=?,updated_at=?,delivery_status=CASE WHEN delivery_status IN ('PENDING','RETRYABLE') THEN 'CANCELLED' ELSE delivery_status END
          WHERE user_id=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM primary_login_channels WHERE user_id=? AND marker=?)`)
          .bind(now,now,userId,userId,marker),
        this.db.prepare(`INSERT INTO audit_events(id,actor_user_id,action,target_user_id,target_connection_id,result,created_at)
          VALUES((SELECT marker FROM primary_login_channels WHERE user_id=? AND marker=?),?,'LOGIN_CHANNEL_SELECTED',?,?,'SUCCESS',?)`)
          .bind(userId,marker,userId,userId,candidate.id,now),
      ]);
      return results.length===3 && d1Changes(results[0])===1 && d1Changes(results[2])===1;
    } catch(error) {
      if(error instanceof Error && /NOT NULL constraint failed:\s*audit_events\.id/iu.test(error.message)) return false;
      throw error;
    }
  }
}

export async function selectPrimaryLoginChannel(input: {userId:string;publicId:string}, deps: {
  store:D1PrimaryLoginStore;keyring:Pick<Keyring,"digestCode">;rateLimitStore:RateLimitStore;now?:Clock;randomBytes?:RandomBytes;
}):Promise<PublicConnection> {
  const now=(deps.now??systemClock)();
  const subjectDigest=await deps.keyring.digestCode(`rate-limit:login-channel:${input.userId}`);
  const rate=await consumeRateLimit({subjectDigest,scope:"login-channel",limit:3,windowMs:600_000},{store:deps.rateLimitStore,now:()=>now});
  if(!rate.allowed) throw new RateLimitExceededError(Math.max(1,Math.ceil((rate.resetAt-now)/1000)));
  const candidate=await deps.store.candidate(input.userId,input.publicId);
  if(!candidate) throw new ConnectionNotFoundError();
  if(candidate.state!=="ACTIVE_BOUND" || !candidate.hasIdentity) throw new ConnectionStateError();
  const expected=await deps.store.snapshot(input.userId);
  if(!await deps.store.select(input.userId,candidate,expected,randomOpaqueId(deps.randomBytes??cryptoRandomBytes),now)) throw new ConnectionStateError();
  return {publicId:candidate.publicId,provider:candidate.provider,displayName:candidate.displayName,handle:candidate.handle,state:candidate.state};
}
