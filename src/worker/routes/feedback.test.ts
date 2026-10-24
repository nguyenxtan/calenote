import {it,expect,vi} from 'vitest';
import {SessionAuthError} from '@/modules/auth/session';
import {FeedbackError} from '@/modules/feedback/store';
import {handleFeedback,type FeedbackOperations} from './feedback';
const origin='https://calenote.example';
const id='fb_000000000001_00000000-0000-4000-8000-000000000001';
const input={requestId:'00000000-0000-4000-8000-000000000001',kind:'BUG',title:'Lịch không mở',description:'Bấm vào lịch và không thấy sự kiện.',page:null};
const ticket={id,kind:'BUG',title:input.title,description:input.description,page:null,status:'NEW',revision:1,reply:'',disposition:null,createdAt:1,updatedAt:1};
function request(path='/api/feedback',method='GET',body?:unknown,headers:Record<string,string>={}){return new Request(origin+path,{method,headers:{cookie:'__Host-calenote_session='+'A'.repeat(43),origin,'content-type':'application/json','x-calenote-feedback-reader':'A'.repeat(43),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
function fixture(){const store={create:vi.fn(async()=>ticket),get:vi.fn(async()=>ticket),list:vi.fn(async()=>({items:[{id,kind:'BUG',title:input.title,status:'NEW',revision:1,createdAt:1,updatedAt:1}],next:null})),update:vi.fn(async()=>ticket)};const ops={requireUser:vi.fn(async()=>({userId:'one',sessionId:'test-session'})),allowlist:'admin',readerId:vi.fn(async()=>'A'.repeat(43)),store} as unknown as FeedbackOperations;return{store,ops,create:vi.fn(async()=>ops)};}
it('missing auth and cross origin never initialize operations; privacy headers on every failure',async()=>{
 const {create}=fixture();
 for(const req of [request('/api/feedback','GET',undefined,{cookie:''}),request('/api/feedback','POST',input,{origin:'https://evil.test'})]){
 const res=await handleFeedback(req,origin,create);expect([401,403]).toContain(res.status);expect(res.headers.get('cache-control')).toBe('no-store');expect(res.headers.get('vary')).toBe('Cookie');}
 expect(create).not.toHaveBeenCalled();
});
it('authenticates owner, emits validated receipt and filters list without trusting client identity',async()=>{
 const {ops,create,store}=fixture();
 const res=await handleFeedback(request('/api/feedback','POST',input),origin,create);expect(res.status).toBe(201);expect(await res.json()).toEqual({data:ticket});expect(store.create.mock.calls[0]).toMatchObject(['one',input,expect.any(Number)]);
 const list=await handleFeedback(request('/api/feedback?kind=BUG&status=NEW'),origin,create);expect(list.status).toBe(200);expect(store.list).toHaveBeenCalledWith('one',{kind:'BUG',status:'NEW'});expect(ops.readerId).toHaveBeenCalledWith('one','test-session');
 await handleFeedback(request('/api/feedback/'+id),origin,create);expect(store.get).toHaveBeenCalledWith('one',id);
});
it('denies member triage/admin reads and permits only existing allowlisted admins',async()=>{
 const {ops,create,store}=fixture();
 expect((await handleFeedback(request('/api/admin/feedback'),origin,create)).status).toBe(403);expect(store.list).not.toHaveBeenCalled();
 ops.requireUser=vi.fn(async()=>({userId:'admin',sessionId:'test-session'}));
 expect((await handleFeedback(request('/api/admin/feedback'),origin,create)).status).toBe(200);expect(store.list).toHaveBeenCalledWith(null,{});
 const patch={expectedRevision:1,status:'REVIEWING',reply:'Đang xem xét yêu cầu.',disposition:null};
 expect((await handleFeedback(request('/api/admin/feedback/'+id,'PATCH',patch),origin,create)).status).toBe(200);expect(store.update.mock.calls[0]).toMatchObject(['admin',id,patch,expect.any(Number)]);
});
it.each([
 ['/api/feedback','DELETE',undefined,405],['/api/feedback','POST',{...input,owner:'other'},400],['/api/feedback','POST',{...input,description:'a'.repeat(17000)},413],['/api/feedback?owner=other','GET',undefined,400],['/api/feedback?kind=BUG&kind=FEATURE','GET',undefined,400],['/api/feedback/'+id+'?x=1','GET',undefined,400],['/api/feedback/bad','GET',undefined,404],
] as const)('rejects invalid boundary %s %s',async(path,method,body,status)=>{const {create,store}=fixture();expect((await handleFeedback(request(path,method,body),origin,create)).status).toBe(status);expect(store.create).not.toHaveBeenCalled();expect(store.list).not.toHaveBeenCalled();});
it('returns safe auth, foreign404, rate429 and unknown503 without leaking errors',async()=>{
 const {ops,create,store}=fixture();ops.requireUser=vi.fn(async()=>{throw new SessionAuthError();});expect((await handleFeedback(request(),origin,create)).status).toBe(401);expect(store.list).not.toHaveBeenCalled();
 ops.requireUser=vi.fn(async()=>({userId:'one',sessionId:'test-session'}));
 store.get.mockRejectedValueOnce(new FeedbackError('NOT_FOUND',404));expect((await handleFeedback(request('/api/feedback/'+id),origin,create)).status).toBe(404);
 store.create.mockRejectedValueOnce(new FeedbackError('RATE_LIMITED',429,59));const rate=await handleFeedback(request('/api/feedback','POST',input),origin,create);expect(rate.status).toBe(429);expect(rate.headers.get('retry-after')).toBe('59');
 store.list.mockRejectedValueOnce(new Error('private text secret cookie'));const error=await handleFeedback(request(),origin,create);expect(error.status).toBe(503);expect(await error.text()).not.toContain('secret');
});
it('rejects an old tab mutation when shared cookies authenticate a different reader before any write',async()=>{
 const {ops,create,store}=fixture();ops.requireUser=vi.fn(async()=>({userId:'two',sessionId:'test-session'}));ops.readerId=vi.fn(async()=>'B'.repeat(43));
 const req=request('/api/feedback','POST',input,{'x-calenote-feedback-reader':'A'.repeat(43)});
 const response=await handleFeedback(req,origin,create);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:'IDENTITY_CHANGED'}});expect(store.create).not.toHaveBeenCalled();
});
it('requires expected identity for all mutations, including administrative replies',async()=>{
 const {create,ops,store}=fixture();expect((await handleFeedback(request('/api/feedback','POST',input,{'x-calenote-feedback-reader':''}),origin,create)).status).toBe(400);expect(store.create).not.toHaveBeenCalled();
 ops.requireUser=vi.fn(async()=>({userId:'admin',sessionId:'test-session'}));ops.readerId=vi.fn(async()=>'B'.repeat(43));const reply={expectedRevision:1,status:'REVIEWING',reply:'Phản hồi riêng của A',disposition:null};const res=await handleFeedback(request('/api/admin/feedback/'+id,'PATCH',reply),origin,create);expect(res.status).toBe(409);expect(store.update).not.toHaveBeenCalled();
});
