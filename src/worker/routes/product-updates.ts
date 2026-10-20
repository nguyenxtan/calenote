import { parseSessionCredentials, SessionAuthError, type SessionCredentials } from '@/modules/auth/session';
import { jsonResponse } from '@/modules/http/security';
import { releaseCatalog } from '@/modules/releases/catalog';
export async function handleProductUpdates(request:Request,create:()=>Promise<{requireUser(credentials:SessionCredentials):Promise<{userId:string}>}>) {
 const credentials=parseSessionCredentials(request.headers.get('cookie'));
 if(!credentials)throw new SessionAuthError();
 const principal=await (await create()).requireUser(credentials);
 return jsonResponse({data:{readerId:principal.userId,catalog:releaseCatalog}},{headers:{vary:'Cookie'}});
}
