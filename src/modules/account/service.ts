import { UpdateProfileSchema, type PublicSession } from "@/contracts/api/account";
import { SessionUserSchema, type SessionUser } from "@/contracts/api/session";
import { SessionAuthError } from "@/modules/auth/session";
import { d1Changes } from "@/modules/platform/types";
export class InvalidAccountInputError extends Error { readonly code="INVALID_ACCOUNT_INPUT"; readonly status=400; constructor(){super("Account input is invalid.");} }
export type AccountPrincipal={userId:string;sessionId:string};
export class D1AccountService {
 constructor(private readonly db:D1Database,private readonly now:()=>number=Date.now){}
 async getProfile(userId:string):Promise<SessionUser>{
 const row=await this.db.prepare("SELECT display_name AS displayName,email,timezone FROM users WHERE id=? LIMIT 1").bind(userId).first();
 if(!row)throw new SessionAuthError();return SessionUserSchema.parse(row);
 }
 async updateProfile(userId:string,input:unknown):Promise<SessionUser>{
 const parsed=UpdateProfileSchema.safeParse(input);if(!parsed.success)throw new InvalidAccountInputError();
 const result=await this.db.prepare("UPDATE users SET display_name=?,updated_at=? WHERE id=?").bind(parsed.data.displayName,this.now(),userId).run();
 if(d1Changes(result)!==1)throw new SessionAuthError();return this.getProfile(userId);
 }
 async listSessions(principal:AccountPrincipal):Promise<PublicSession[]>{
 const result=await this.db.prepare("SELECT id,created_at AS createdAt,expires_at AS expiresAt FROM sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,created_at DESC,id LIMIT 100").bind(principal.userId,this.now(),principal.sessionId).all<{id:string;createdAt:number;expiresAt:number}>();
 return result.results.map(row=>({...row,current:row.id===principal.sessionId}));
 }
 async revokeOtherSessions(principal:AccountPrincipal):Promise<{revoked:number}>{
 const now=this.now();
 // One D1 transaction prevents a current-session revocation racing this update.
 const result=await this.db.batch([
 this.db.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND id<>? AND revoked_at IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM sessions current WHERE current.id=? AND current.user_id=? AND current.revoked_at IS NULL AND current.expires_at>?)").bind(now,principal.userId,principal.sessionId,now,principal.sessionId,principal.userId,now),
 this.db.prepare("UPDATE sessions SET id=id WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>? RETURNING id").bind(principal.sessionId,principal.userId,now),
 ]);
 if(!result[1].results.length)throw new SessionAuthError();return {revoked:d1Changes(result[0])};
 }
}
