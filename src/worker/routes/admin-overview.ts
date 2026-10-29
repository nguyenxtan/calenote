import { AdminOverviewResponseSchema, type AdminOverview } from '@/contracts/api/admin-overview';
import { parseSessionCredentials, SessionAuthError, type SessionCredentials } from '@/modules/auth/session';
import { jsonResponse } from '@/modules/http/security';
export interface AdminOverviewOperations {
 allowlist?:string;
 requireUser(credentials:SessionCredentials):Promise<{userId:string}>;
 readOverview():Promise<AdminOverview>;
}
/** Server-only deployment configuration. Invalid or absent configuration denies everyone. */
export function adminAllowed(userId:string,raw?:string){
 if(!raw||raw.length>4096)return false;
 const ids=raw.split(',');
 return ids.length<=32 && ids.every(id=>/^[A-Za-z0-9_-]{1,128}$/.test(id)) && ids.includes(userId);
}
export async function handleAdminOverview(request:Request,ops:AdminOverviewOperations):Promise<Response>{
 const headers={'cache-control':'no-store',vary:'Cookie'};
 const error=(status:number,code:string)=>jsonResponse({error:{code,message:status===403?'Bạn không có quyền xem dashboard này.':'Chưa thể mở dashboard.'}},{status,headers});
 if(request.method!=='GET')return error(405,'METHOD_NOT_ALLOWED');
 if(new URL(request.url).search)return error(400,'INVALID_QUERY');
 const credentials=parseSessionCredentials(request.headers.get('cookie'));
 if(!credentials)return error(401,'UNAUTHENTICATED');
 try{
  const principal=await ops.requireUser(credentials);
  if(!adminAllowed(principal.userId,ops.allowlist))return error(403,'FORBIDDEN');
  return jsonResponse(AdminOverviewResponseSchema.parse({data:await ops.readOverview()}),{headers});
 }catch(reason){return error(reason instanceof SessionAuthError?401:503,reason instanceof SessionAuthError?'UNAUTHENTICATED':'ADMIN_UNAVAILABLE');}
}
