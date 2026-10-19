import type { D1FollowThroughService } from '@/modules/follow-through/service';
import { FollowThroughActionSchema, FollowThroughItemSchema, FollowThroughListSchema } from '@/contracts/api/follow-through';
import { parseSessionCredentials, SessionAuthError, type SessionCredentials } from '@/modules/auth/session';
import { readBoundedJson } from '@/modules/http/body';
import { jsonResponse, requireSameOrigin } from '@/modules/http/security';

export interface FollowThroughOperations {
  requireUser(credentials: SessionCredentials): Promise<{userId:string}>;
  service: Pick<D1FollowThroughService, 'list'|'act'>;
  consume(userId:string): Promise<void>;
}
type Factory=()=>Promise<FollowThroughOperations>;
function credentials(request:Request) {
  const auth=parseSessionCredentials(request.headers.get('cookie'));
  if(!auth) throw new SessionAuthError();
  return auth;
}
export async function handleListFollowThrough(request:Request,create:Factory) {
  const auth=credentials(request),ops=await create(),principal=await ops.requireUser(auth);
  const cursor=new URL(request.url).searchParams.get('cursor');
  if(cursor && cursor.length>256) return jsonResponse({error:{code:'INVALID',message:'Trang dữ liệu không hợp lệ.'}},{status:400,headers:{vary:'Cookie'}});
  const data=FollowThroughListSchema.parse(await ops.service.list({userId:principal.userId,...(cursor?{cursor}:{})}));
  return jsonResponse({data},{headers:{vary:'Cookie'}});
}
export async function handleFollowThroughAction(request:Request,origin:string,create:Factory) {
  requireSameOrigin(request,origin);
  const auth=credentials(request);
  const parsed=FollowThroughActionSchema.safeParse(await readBoundedJson(request,2048,{timeoutMs:5000}));
  if(!parsed.success) return jsonResponse({error:{code:'INVALID',message:'Thao tác chưa hợp lệ.'}},{status:400,headers:{vary:'Cookie'}});
  const ops=await create(),principal=await ops.requireUser(auth);
  await ops.consume(principal.userId);
  return jsonResponse({data:{item:FollowThroughItemSchema.parse(await ops.service.act({userId:principal.userId},parsed.data))}},{headers:{vary:'Cookie'}});
}
