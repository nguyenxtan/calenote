import { z } from "zod";
import { ProfileResponseSchema, UpdateProfileSchema, SessionsResponseSchema, RevokeSessionsResponseSchema, type PublicSession } from "@/contracts/api/account";
import type { SessionUser } from "@/contracts/api/session";
import { parseSessionCredentials, SessionAuthError, type SessionCredentials } from "@/modules/auth/session";
import { InvalidAccountInputError, type AccountPrincipal } from "@/modules/account/service";
import { readBoundedJson } from "@/modules/http/body";
import { jsonResponse, requireSameOrigin } from "@/modules/http/security";
export interface AccountOperations {
 requireUser(credentials:SessionCredentials):Promise<AccountPrincipal>;
 getProfile(userId:string):Promise<SessionUser>;
 updateProfile(userId:string,input:{displayName:string}):Promise<SessionUser>;
 listSessions(principal:AccountPrincipal):Promise<PublicSession[]>;
 revokeOtherSessions(principal:AccountPrincipal):Promise<{revoked:number}>;
}
type Factory=()=>Promise<AccountOperations>;
function credentials(request:Request){const value=parseSessionCredentials(request.headers.get('cookie'));if(!value)throw new SessionAuthError();return value;}
function response(body:unknown){return jsonResponse(body,{headers:{vary:'Cookie'}});}
export async function handleGetProfile(request:Request,create:Factory){const auth=credentials(request),ops=await create(),principal=await ops.requireUser(auth);return response(ProfileResponseSchema.parse({data:{user:await ops.getProfile(principal.userId)}}));}
export async function handleUpdateProfile(request:Request,origin:string,create:Factory){
 requireSameOrigin(request,origin);const auth=credentials(request);
 const parsed=UpdateProfileSchema.safeParse(await readBoundedJson(request,2048,{timeoutMs:5000}));if(!parsed.success)throw new InvalidAccountInputError();
 const ops=await create(),principal=await ops.requireUser(auth);return response(ProfileResponseSchema.parse({data:{user:await ops.updateProfile(principal.userId,parsed.data)}}));
}
export async function handleGetSessions(request:Request,create:Factory){const auth=credentials(request),ops=await create(),principal=await ops.requireUser(auth);return response(SessionsResponseSchema.parse({data:{sessions:await ops.listSessions(principal)}}));}
export async function handleRevokeOtherSessions(request:Request,origin:string,create:Factory){
 requireSameOrigin(request,origin);const auth=credentials(request);
 if(!z.object({}).strict().safeParse(await readBoundedJson(request,256,{timeoutMs:5000})).success)throw new InvalidAccountInputError();
 const ops=await create(),principal=await ops.requireUser(auth);return response(RevokeSessionsResponseSchema.parse({data:await ops.revokeOtherSessions(principal)}));
}
