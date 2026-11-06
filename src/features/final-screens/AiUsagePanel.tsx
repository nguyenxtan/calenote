'use client';
import {useEffect,useState} from 'react';
import {AiUsageResponseSchema,type AiUsage} from '@/contracts/api/ai-usage';
import styles from './AiUsagePanel.module.css';
const money=(microunits:number)=>`${(microunits/1e6).toFixed(6)} USD`;
type Result={ownerKey:string;revision:number;data:AiUsage|null;error:string|null};
export function AiUsagePanel({ownerKey}:{ownerKey:string}){
 const [revision,setRevision]=useState(0),[result,setResult]=useState<Result|null>(null);
 const visible=result?.ownerKey===ownerKey&&result.revision===revision?result:null;
 useEffect(()=>{
  const controller=new AbortController();let active=true;
  void(async()=>{
   try{
    const response=await fetch('/api/ai-usage',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error(response.status===401||response.status===403?'Đăng nhập lại để xem mức sử dụng AI.':'Chưa tải được mức sử dụng AI.');
    const data=AiUsageResponseSchema.parse(await response.json()).data;
    if(active)setResult({ownerKey,revision,data,error:null});
   }catch(error){
    if(active)setResult({ownerKey,revision,data:null,error:error instanceof Error&&error.message.startsWith('Đăng nhập lại')?error.message:'Chưa tải được mức sử dụng AI.'});
   }
  })();
  return()=>{active=false;controller.abort();};
 },[ownerKey,revision]);
 const data=visible?.data;
 return <section className={styles.panel} aria-labelledby="ai-usage-heading">
  <header><h2 id="ai-usage-heading">Mức sử dụng AI</h2><button type="button" disabled={!visible} onClick={()=>setRevision(r=>r+1)} aria-label="Làm mới mức sử dụng AI">{visible?'Làm mới':'Đang tải…'}</button></header>
  {!visible&&<p role="status">Đang tải mức sử dụng AI…</p>}
  {visible?.error&&<p role="alert">{visible.error}</p>}
  {data&&<>
   <div className={styles.tableWrap}><table><caption>Mức sử dụng AI theo kỳ UTC</caption><thead><tr><th scope="col">Kỳ</th><th scope="col">Chi phí đã biết</th><th scope="col">Trung bình mỗi lượt đã biết</th><th scope="col">Chi phí chưa rõ</th><th scope="col">Yêu cầu chờ gửi</th></tr></thead><tbody>
    {([['Ngày hiện tại',data.day],['Tháng hiện tại',data.month]] as const).map(([label,period])=><tr key={period.key}><th scope="row">{label}<span>{period.key}</span></th><td>{money(period.knownCostMicrounits)}<span>{period.knownCalls} lượt có chi phí được báo</span></td><td>{period.knownCalls?money(period.knownCostMicrounits/period.knownCalls):'Chưa có lượt biết chi phí'}</td><td>Chưa rõ: {period.unknownCalls} lượt<span>Tối đa {money(period.unknownMaximumMicrounits)}</span></td><td>{period.pendingCalls} yêu cầu<span>Dự phòng {money(period.pendingMaximumMicrounits)}</span></td></tr>)}
   </tbody></table></div>
   {data.limits?<p>Hạn mức ứng dụng: ngày {data.day.budgetedCalls}/{data.limits.dailyCalls} lượt; tháng {money(data.month.budgetedCostMicrounits)}/{money(data.limits.monthlyCostMicrounits)}.</p>:<p>{data.runtime==='OFF'?'AI đang tắt.':'Chưa xác định được cấu hình AI.'} Số liệu đã ghi nhận vẫn được hiển thị.</p>}
   <p>Khoản dự phòng là mức tối đa chưa rõ hoặc chưa gửi, không phải hóa đơn nhà cung cấp. Trung bình chỉ tính các lượt đã có chi phí được báo.</p>
   <small>Kỳ hạn tính theo UTC. Cập nhật: {data.asOf}</small>
  </>}
 </section>;
}
