import { d1Changes } from "@/modules/platform/types";
export class PrimaryLoginSelectionError extends Error {
 readonly code="PRIMARY_LOGIN_SELECTION_BLOCKED";readonly status=409;
 constructor(){super("Chọn một bot đã liên kết chat riêng và đợi mã đăng nhập đang gửi hoàn tất.");}
}
export class D1PrimaryLoginStore {
 constructor(private readonly db:D1Database){}
 async get(userId:string):Promise<{publicId:string|null}>{
  const row=await this.db.prepare(`SELECT c.public_id FROM primary_login_channels p JOIN bot_connections c ON c.id=p.connection_id AND c.user_id=p.user_id
    JOIN chat_identities ci ON ci.connection_id=c.id WHERE p.user_id=? AND c.state='ACTIVE_BOUND'`).bind(userId).first<{public_id:string}>();
  if(row)return {publicId:row.public_id};
  const fallback=await this.db.prepare(`SELECT MIN(c.public_id) AS public_id FROM bot_connections c JOIN chat_identities ci ON ci.connection_id=c.id
    WHERE c.user_id=? AND c.state='ACTIVE_BOUND' AND NOT EXISTS(SELECT 1 FROM primary_login_channels p WHERE p.user_id=c.user_id) GROUP BY c.user_id HAVING COUNT(*)=1`).bind(userId).first<{public_id:string}>();
  return {publicId:fallback?.public_id??null};
 }
 async select(userId:string,publicId:string,now:number,marker:string):Promise<boolean>{
  try {
   const results=await this.db.batch([
    this.db.prepare(`INSERT INTO primary_login_channels(user_id,connection_id,transition_marker,updated_at)
      SELECT c.user_id,c.id,?,? FROM bot_connections c JOIN chat_identities ci ON ci.connection_id=c.id
      WHERE c.user_id=? AND c.public_id=? AND c.state='ACTIVE_BOUND' AND length(ci.private_chat_id)>0 AND length(ci.provider_user_id)>0
        AND NOT EXISTS(SELECT 1 FROM login_codes l WHERE l.user_id=c.user_id AND l.delivery_status='SENDING')
      ON CONFLICT(user_id) DO UPDATE SET connection_id=excluded.connection_id,transition_marker=excluded.transition_marker,updated_at=excluded.updated_at RETURNING user_id`)
     .bind(marker,now,userId,publicId),
    this.db.prepare(`UPDATE login_codes SET consumed_at=COALESCE(consumed_at,?),updated_at=?,delivery_status=CASE WHEN delivery_status IN ('PENDING','RETRYABLE') THEN 'CANCELLED' ELSE delivery_status END
      WHERE user_id=? AND EXISTS(SELECT 1 FROM primary_login_channels p WHERE p.user_id=? AND p.transition_marker=?)`).bind(now,now,userId,userId,marker),
    this.db.prepare(`INSERT INTO audit_events(id,actor_user_id,action,target_user_id,target_connection_id,result,created_at)
      VALUES((SELECT transition_marker FROM primary_login_channels WHERE user_id=? AND transition_marker=?),?,'PRIMARY_LOGIN_SELECTED',?,
        (SELECT connection_id FROM primary_login_channels WHERE user_id=?),'SUCCESS',?)`).bind(userId,marker,userId,userId,userId,now),
   ]);return d1Changes(results[0])===1;
  }catch(error){if(error instanceof Error&&/NOT NULL constraint failed:\s*audit_events\.id/u.test(error.message))return false;throw error;}
 }
}
