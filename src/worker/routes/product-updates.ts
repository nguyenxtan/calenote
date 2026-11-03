import { parseSessionCredentials, SessionAuthError, type SessionCredentials } from '@/modules/auth/session';
import { jsonResponse } from '@/modules/http/security';
import { releaseCatalog } from '@/modules/releases/catalog';
import { servingRelease, type ReleaseRuntimeEnvironment } from '../release-runtime';
export async function handleProductUpdates(request:Request,create:()=>Promise<{requireUser(credentials:SessionCredentials):Promise<{userId:string}>}>,env:ReleaseRuntimeEnvironment={}) {
 const credentials=parseSessionCredentials(request.headers.get('cookie'));
 if(!credentials)throw new SessionAuthError();
 const principal=await (await create()).requireUser(credentials);
 // Opt-in keeps strict older clients and the member bell's existing wire contract compatible.
 const runtime=new URL(request.url).pathname==='/api/product-updates/runtime'?{runtime:servingRelease(request,env)}:{};
 return jsonResponse({data:{readerId:principal.userId,catalog:releaseCatalog,...runtime}},{headers:{vary:'Cookie'}});
}
