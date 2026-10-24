"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import type {z} from 'zod';
import {FeedbackCreateSchema,FeedbackListSchema,FeedbackPatchSchema,FeedbackTicketSchema,feedbackPages,type FeedbackCreate,type FeedbackFilters,type FeedbackPatch,type FeedbackTicket} from '@/contracts/api/feedback';
import {ApiResponseError} from '@/lib/client-api';
import {feedbackRequest} from './feedback-client';
import styles from './Feedback.module.css';
export const statusLabels={NEW:'Mới nhận',REVIEWING:'Đang xem xét',IN_PROGRESS:'Đang xử lý',CLOSED:'Đã đóng'};
const kindLabels={BUG:'Báo lỗi',FEATURE:'Đề xuất tính năng'};
const dispositionLabels={RESOLVED:'Đã sửa / đáp ứng',DUPLICATE:'Trùng yêu cầu',DECLINED:'Không triển khai',NEEDS_INFO:'Chưa đủ thông tin'};
type List=z.infer<typeof FeedbackListSchema>;
type Props={initial:List;admin?:boolean;onAuthLost:()=>void};
const emptyDraft=()=>({kind:'BUG' as 'BUG'|'FEATURE',title:'',description:'',page:''});
const date=(value:number)=>new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'}).format(value);
/** Keyed by opaque server identity, never by mutable email/display name. */
export function FeedbackPanel(props:Props){return <Panel key={`${props.admin?'admin':'member'}:${props.initial.readerId}`} {...props}/>;}
function Panel({initial,admin=false,onAuthLost}:Props){
 const [list,setList]=useState(initial),[draft,setDraft]=useState(emptyDraft),[filters,setFilters]=useState<FeedbackFilters>({});
 const [ticket,setTicket]=useState<FeedbackTicket|null>(null),[patch,setPatch]=useState<FeedbackPatch|null>(null);
 const [error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null),[blocked,setBlocked]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[uncertain,setUncertain]=useState(false);
 const lifetime=useRef({epoch:0,alive:true,pending:new Set<AbortController>()});
 const mutationLock=useRef(false),listSequence=useRef(0),detailSequence=useRef(0),draftId=useRef<string|null>(null),submitted=useRef<FeedbackCreate|null>(null);
 const authLost=useRef(onAuthLost);useEffect(()=>{authLost.current=onAuthLost;},[onAuthLost]);
 const invalidate=useCallback((notify=false)=>{lifetime.current.epoch++;for(const c of lifetime.current.pending)c.abort();lifetime.current.pending.clear();mutationLock.current=false;draftId.current=null;submitted.current=null;setDraft(emptyDraft());setFilters({});setList({readerId:initial.readerId,items:[],next:null});setTicket(null);setPatch(null);setNotice(null);setError('Phiên hoặc quyền truy cập đã thay đổi. Mở lại trang để kiểm tra phiên.');setBlocked(true);setBusy(false);setLoading(false);setUncertain(false);if(notify)authLost.current();},[initial.readerId]);
 useEffect(()=>{const state=lifetime.current;state.alive=true;const changed=()=>invalidate();window.addEventListener('calenote-session-changed',changed);return()=>{state.alive=false;state.epoch++;for(const c of state.pending)c.abort();state.pending.clear();window.removeEventListener('calenote-session-changed',changed);};},[invalidate]);
 async function run<T>(options:Omit<Parameters<typeof feedbackRequest>[1],'signal'>,parse:(value:unknown)=>T,apply:(value:T)=>void,onFailure?:(reason:unknown)=>void){
  const generation=lifetime.current.epoch,controller=new AbortController();lifetime.current.pending.add(controller);
  const current=()=>lifetime.current.alive&&generation===lifetime.current.epoch&&!controller.signal.aborted;
  try{const value=parse(await feedbackRequest(admin,{...options,readerId:initial.readerId,signal:controller.signal}));if(current())apply(value);}
  catch(reason){if(current()){if(reason instanceof ApiResponseError&&(reason.status===401||reason.status===403||reason.code==='IDENTITY_CHANGED'))invalidate(true);else if(onFailure)onFailure(reason);else setError('Chưa thể tải yêu cầu. Hãy thử lại.');}}
  finally{lifetime.current.pending.delete(controller);}
 }
 async function refresh(nextFilters=filters){
  if(blocked)return;const sequence=++listSequence.current;setLoading(true);setError(null);
  await run({filters:nextFilters},value=>FeedbackListSchema.parse(value),value=>{if(sequence!==listSequence.current)return;if(value.readerId!==initial.readerId){invalidate(true);return;}setList(value);setLoading(false);},()=>{if(sequence===listSequence.current){setLoading(false);setError('Chưa thể tải yêu cầu. Hãy thử lại.');}});
 }
 async function open(id:string){
  if(blocked)return;const sequence=++detailSequence.current;setTicket(null);setPatch(null);setError(null);
  await run({id},value=>FeedbackTicketSchema.parse(value),value=>{if(sequence!==detailSequence.current)return;setTicket(value);setPatch({expectedRevision:value.revision,status:value.status,reply:value.reply,disposition:value.disposition});});
 }
 async function submit(){
  if(blocked||mutationLock.current)return;
  if(!draftId.current)draftId.current=crypto.randomUUID();
  const parsed=FeedbackCreateSchema.safeParse(submitted.current??{...draft,page:draft.page||null,requestId:draftId.current});
  if(!parsed.success){setError('Tiêu đề cần 5–120 ký tự, mô tả cần 20–4.000 ký tự.');return;}
  submitted.current=parsed.data;mutationLock.current=true;setBusy(true);setError(null);setNotice(null);
  const generation=lifetime.current.epoch;
  await run({method:'POST',body:parsed.data},value=>{
   const receipt=FeedbackTicketSchema.parse(value);
   if(receipt.kind!==parsed.data.kind||receipt.title!==parsed.data.title||receipt.description!==parsed.data.description||receipt.page!==parsed.data.page)throw new Error('Receipt mismatch');return receipt;
  },value=>{setNotice(`Đã nhận yêu cầu ${value.id}. Bạn có thể theo dõi bên dưới.`);setDraft(emptyDraft());draftId.current=null;submitted.current=null;setUncertain(false);void refresh({...filters,after:undefined});},reason=>{
   if(reason instanceof ApiResponseError&&reason.status>=400&&reason.status<500){submitted.current=null;setUncertain(false);setError(reason.status===429?'Bạn đã gửi nhiều yêu cầu. Hãy thử lại sau.':reason.status===409?'Mã yêu cầu này đã có nội dung khác. Mở danh sách để kiểm tra trước khi gửi yêu cầu mới.':'Chưa thể gửi. Kiểm tra nội dung và thử lại.');}
   else{setUncertain(true);setError('Chưa xác nhận được kết quả gửi. Bản nháp được giữ; kiểm tra hoặc gửi lại cùng mã, không tạo yêu cầu mới.');}
  });
  if(lifetime.current.alive&&generation===lifetime.current.epoch){mutationLock.current=false;setBusy(false);}
 }
 async function save(){
  if(!ticket||!patch||blocked||mutationLock.current)return;
  const parsed=FeedbackPatchSchema.safeParse(patch);if(!parsed.success){setError('Khi đóng, hãy chọn kết quả và phản hồi ít nhất 5 ký tự.');return;}
  mutationLock.current=true;setBusy(true);setError(null);setNotice(null);const generation=lifetime.current.epoch,sequence=detailSequence.current;
  await run({id:ticket.id,method:'PATCH',body:parsed.data},value=>FeedbackTicketSchema.parse(value),value=>{if(sequence===detailSequence.current){setTicket(value);setPatch({expectedRevision:value.revision,status:value.status,reply:value.reply,disposition:value.disposition});setNotice('Đã lưu xử lý.');}void refresh();},reason=>{setError(reason instanceof ApiResponseError&&reason.status===409?'Yêu cầu đã thay đổi. Mở lại chi tiết để tải revision mới; chưa ghi đè phản hồi.':'Chưa rõ kết quả lưu. Mở lại chi tiết để kiểm tra trước khi thử lại.');});
  if(lifetime.current.alive&&generation===lifetime.current.epoch){mutationLock.current=false;setBusy(false);}
 }
 return <main className={styles.page}>
  <header><p className={styles.eyebrow}>CÙNG CẢI THIỆN CALENOTE</p><h1>{admin?'Góp ý & báo lỗi · Quản trị':'Góp ý & báo lỗi'}</h1><p>{admin?'Xem xét và phản hồi từng yêu cầu của người dùng.':'Chia sẻ lỗi gặp phải hoặc điều bạn muốn Calenote làm tốt hơn.'}</p></header>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{notice&&<p role="status" className={styles.notice}>{notice}</p>}
  {!blocked&&<>
   {!admin&&<section className={styles.card} aria-labelledby="feedback-form-title"><h2 id="feedback-form-title">Gửi yêu cầu</h2><p>Chỉ gửi nội dung cần thiết. Đừng gửi mật khẩu, mã OTP, token bot hoặc thông tin nhạy cảm. Đã nhận không có nghĩa cam kết triển khai.</p>
    <form onSubmit={e=>{e.preventDefault();void submit();}}><fieldset disabled={busy||uncertain}><label>Loại yêu cầu<select value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as 'BUG'|'FEATURE'})}><option value="BUG">Báo lỗi</option><option value="FEATURE">Đề xuất tính năng</option></select></label>
    <label>Tiêu đề<input required minLength={5} maxLength={120} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
    <label>Mô tả<textarea required minLength={20} maxLength={4000} rows={5} placeholder={draft.kind==='BUG'?'Bạn đã làm gì? Điều gì xảy ra, bạn mong đợi điều gì?':'Bạn cần làm gì? Tính năng này giúp ích trong tình huống nào?'} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
    <label>Trang liên quan (tùy chọn)<select value={draft.page} onChange={e=>setDraft({...draft,page:e.target.value})}><option value="">Không chọn</option>{feedbackPages.map(page=><option key={page} value={page}>{page}</option>)}</select></label></fieldset>
    <button className={styles.primary} disabled={busy} type="submit">{busy?'Đang gửi…':uncertain?'Kiểm tra / gửi lại cùng mã':'Gửi yêu cầu'}</button>
    </form></section>}
   <section className={styles.card} aria-labelledby="feedback-list-title"><div className={styles.row}><h2 id="feedback-list-title">{admin?'Hàng đợi yêu cầu':'Yêu cầu của tôi'}</h2><button type="button" disabled={loading} onClick={()=>void refresh({...filters,after:undefined})}>Làm mới</button></div><p>Trạng thái được cập nhật khi mở trang hoặc bấm Làm mới.</p>
    <div className={styles.filters}><label>Lọc loại<select value={filters.kind??''} onChange={e=>{const next={...filters,kind:(e.target.value||undefined) as FeedbackFilters['kind'],after:undefined};setFilters(next);void refresh(next);}}><option value="">Tất cả loại</option><option value="BUG">Báo lỗi</option><option value="FEATURE">Đề xuất tính năng</option></select></label><label>Lọc trạng thái<select value={filters.status??''} onChange={e=>{const next={...filters,status:(e.target.value||undefined) as FeedbackFilters['status'],after:undefined};setFilters(next);void refresh(next);}}><option value="">Tất cả trạng thái</option>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
    {loading&&<p role="status">Đang tải yêu cầu…</p>}{!list.items.length&&!loading&&<p>Chưa có yêu cầu phù hợp.</p>}
    <ul className={styles.list}>{list.items.map(item=><li key={item.id}><button onClick={()=>void open(item.id)}>{item.title}</button><span>{kindLabels[item.kind]} · {statusLabels[item.status]}</span><small>{date(item.createdAt)} · {item.id}</small></li>)}</ul>
    {list.next&&<button disabled={loading} onClick={()=>{const next={...filters,after:list.next!};setFilters(next);void refresh(next);}}>Trang tiếp</button>}
   </section>
   {ticket&&<section className={styles.card} aria-labelledby="feedback-detail-title"><div className={styles.row}><h2 id="feedback-detail-title">Chi tiết yêu cầu</h2><button onClick={()=>{detailSequence.current++;setTicket(null);setPatch(null);}}>Đóng chi tiết</button></div><h3>{ticket.title}</h3><p className={styles.code}>{ticket.id}</p><p>{kindLabels[ticket.kind]} · {statusLabels[ticket.status]} · {date(ticket.createdAt)}</p><p className={styles.prose}>{ticket.description}</p>{ticket.page&&<p>Trang: {ticket.page}</p>}
    <h3>Phản hồi từ quản trị</h3><p className={styles.prose}>{ticket.reply||'Chưa có phản hồi từ quản trị.'}</p>{ticket.disposition&&<p>Kết quả: {dispositionLabels[ticket.disposition]}</p>}
    {admin&&patch&&<form onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy}><label>Trạng thái xử lý<select value={patch.status} onChange={e=>setPatch({...patch,status:e.target.value as FeedbackPatch['status'],disposition:null})}>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>{patch.status==='CLOSED'&&<label>Kết quả<select required value={patch.disposition??''} onChange={e=>setPatch({...patch,disposition:e.target.value as FeedbackPatch['disposition']})}><option value="">Chọn kết quả</option>{Object.entries(dispositionLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}<label>Phản hồi cho người gửi<textarea maxLength={4000} rows={4} value={patch.reply} onChange={e=>setPatch({...patch,reply:e.target.value})}/></label><button className={styles.primary} type="submit">Lưu xử lý</button></fieldset></form>}
   </section>}
  </>}
 </main>;
}
