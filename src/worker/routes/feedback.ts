import {z} from 'zod';
import {parseSessionCredentials,SessionAuthError,type SessionCredentials} from '@/modules/auth/session';
import {FeedbackCreateSchema,FeedbackFiltersSchema,FeedbackIdSchema,FeedbackListSchema,FeedbackPatchSchema,FeedbackTicketSchema} from '@/contracts/api/feedback';
import {FeedbackError,type D1FeedbackStore} from '@/modules/feedback/store';
import {readBoundedJson,RequestBodyError} from '@/modules/http/body';
import {jsonResponse,requireSameOrigin,SameOriginError} from '@/modules/http/security';
import {adminAllowed} from './admin-overview';
export interface FeedbackOperations {requireUser(credentials:SessionCredentials):Promise<{userId:string;sessionId:string}>;allowlist?:string;readerId(owner:string,sessionId:string):Promise<string>;store:Pick<D1FeedbackStore,'get'|'list'|'create'|'update'>;}
const headers={vary:'Cookie'};
function fail(status:number,code:string,retryAfter?:number){return jsonResponse({error:{code,message:status===401?'Bạn cần đăng nhập để tiếp tục.':status===403?'Bạn không có quyền thực hiện yêu cầu này.':status===429?'Bạn đã gửi nhiều yêu cầu. Hãy thử lại sau.':status===409?'Yêu cầu đã thay đổi. Hãy tải lại trước khi xử lý.':'Chưa thể hoàn tất yêu cầu. Hãy kiểm tra và thử lại.'}},{status,headers:{...headers,...(retryAfter?{'retry-after':String(retryAfter)}:{})}});}
export async function handleFeedback(request:Request,origin:string,create:()=>Promise<FeedbackOperations>):Promise<Response>{
 try{
  const url=new URL(request.url),admin=url.pathname.startsWith('/api/admin/feedback'),base=admin?'/api/admin/feedback':'/api/feedback';
  const suffix=url.pathname.slice(base.length),id=suffix.startsWith('/')?suffix.slice(1):null;
  if(suffix&&!FeedbackIdSchema.safeParse(id).success)return fail(404,'NOT_FOUND');
  const method=request.method;
  if(!((method==='GET')||(method==='POST'&&!admin&&!suffix)||(method==='PATCH'&&admin&&id)))return fail(405,'METHOD_NOT_ALLOWED');
  const credentials=parseSessionCredentials(request.headers.get('cookie'));if(!credentials)return fail(401,'UNAUTHENTICATED');
  if(method!=='GET')requireSameOrigin(request,origin);
  const entries=[...url.searchParams.entries()];
  if(entries.length!==new Set(entries.map(([key])=>key)).size||(id||method!=='GET')&&url.search)return fail(400,'INVALID_QUERY');
  const filters=FeedbackFiltersSchema.safeParse(Object.fromEntries(entries));if(!filters.success)return fail(400,'INVALID_QUERY');
  const body=method==='POST'?FeedbackCreateSchema.parse(await readBoundedJson(request,16384,{timeoutMs:5000})):method==='PATCH'?FeedbackPatchSchema.parse(await readBoundedJson(request,16384,{timeoutMs:5000})):null;
  const ops=await create(),principal=await ops.requireUser(credentials);
  if(admin&&!adminAllowed(principal.userId,ops.allowlist))return fail(403,'FORBIDDEN');
  const readerId=await ops.readerId(principal.userId,principal.sessionId),expectedReader=request.headers.get('x-calenote-feedback-reader');
  if(method!=='GET'&&!expectedReader)return fail(400,'EXPECTED_IDENTITY_REQUIRED');
  if(expectedReader&&expectedReader!==readerId)return fail(409,'IDENTITY_CHANGED');
  if(method==='POST')return jsonResponse({data:FeedbackTicketSchema.parse(await ops.store.create(principal.userId,FeedbackCreateSchema.parse(body),Date.now()))},{status:201,headers});
  if(method==='PATCH')return jsonResponse({data:FeedbackTicketSchema.parse(await ops.store.update(principal.userId,id!,FeedbackPatchSchema.parse(body),Date.now()))},{headers});
  if(id)return jsonResponse({data:FeedbackTicketSchema.parse(await ops.store.get(admin?null:principal.userId,id))},{headers});
  return jsonResponse({data:FeedbackListSchema.parse({...await ops.store.list(admin?null:principal.userId,filters.data),readerId})},{headers});
 }catch(error){
  if(error instanceof SessionAuthError)return fail(401,'UNAUTHENTICATED');
  if(error instanceof SameOriginError||error instanceof RequestBodyError)return fail(error.status,error.code);
  if(error instanceof z.ZodError)return fail(400,'INVALID');
  if(error instanceof FeedbackError)return fail(error.status,error.code,error.retryAfter);
  return fail(503,'FEEDBACK_UNAVAILABLE');
 }
}
