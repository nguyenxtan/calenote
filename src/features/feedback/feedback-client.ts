import {FeedbackFiltersSchema,FeedbackIdSchema,type FeedbackFilters} from '@/contracts/api/feedback';
import {ApiResponseError,readBoundedJson} from '@/lib/client-api';
/** No global401 event here: only the current identity generation may invalidate its UI. */
export async function feedbackRequest(admin:boolean,options:{readerId?:string;id?:string;filters?:FeedbackFilters;method?:'POST'|'PATCH';body?:unknown;signal:AbortSignal}):Promise<unknown>{
 const base=admin?'/api/admin/feedback':'/api/feedback';
 const id=options.id?FeedbackIdSchema.parse(options.id):null;
 const query=new URLSearchParams(Object.entries(FeedbackFiltersSchema.parse(options.filters??{})).filter((entry):entry is [string,string]=>typeof entry[1]==='string')).toString();
 const response=await fetch(base+(id?'/'+id:'')+(query?'?'+query:''),{method:options.method??'GET',credentials:'same-origin',cache:'no-store',signal:options.signal,headers:{accept:'application/json',...(options.readerId?{'x-calenote-feedback-reader':options.readerId}:{}),...(options.body?{'content-type':'application/json'}:{})},...(options.body?{body:JSON.stringify(options.body)}:{})});
 if(options.signal.aborted)throw new DOMException('Aborted','AbortError');
 if(response.status===401||response.status===403)throw new ApiResponseError(response.status,'AUTH_CHANGED','Phiên hoặc quyền truy cập đã thay đổi.');
 const payload=await readBoundedJson(response);
 if(options.signal.aborted)throw new DOMException('Aborted','AbortError');
 if(!response.ok)throw new ApiResponseError(response.status,typeof payload.error==='object'&&payload.error!==null&&'code' in payload.error&&payload.error.code==='IDENTITY_CHANGED'?'IDENTITY_CHANGED':response.status===409?'CONFLICT':'FAILED',response.status===429?'Bạn đã gửi nhiều yêu cầu. Hãy thử lại sau.':'Chưa thể hoàn tất yêu cầu.');
 if(!('data' in payload))throw new Error('Invalid receipt');return payload.data;
}
