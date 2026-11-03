"use client";
import { useEffect,useRef,useState } from "react";
import styles from "./FinalScreenExperience.module.css";
export function DisconnectBotButton({name,pending,disconnect}:{name:string;pending:boolean;disconnect:()=>Promise<void>}) {
  const [confirming,setConfirming]=useState(false);
  const trigger=useRef<HTMLButtonElement>(null);
  const cancel=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(confirming)cancel.current?.focus();},[confirming]);
  function close(){setConfirming(false);trigger.current?.focus();}
  return <div className={styles.disconnect}>
    <button ref={trigger} type="button" className={styles.action} disabled={pending} onClick={()=>setConfirming(true)}>Ngắt kết nối</button>
    {confirming&&<section role="dialog" aria-label={`Ngắt kết nối ${name}`} onKeyDown={event=>{if(event.key==='Escape'&&!pending)close();}}>
      <h3>Ngắt {name} khỏi Calenote?</h3>
      <p>Calenote sẽ ngừng nhận và gửi tin qua bot này. Lịch sử và lời nhắc được giữ lại; lời nhắc trên kênh này sẽ không được gửi.</p>
      <p>Token mã hoá vẫn được giữ trong Calenote. Bot và webhook trên nền tảng không thay đổi. Kết nối này không tự mở lại hay phát lại tin đang chờ.</p>
      <p>Hãy thêm và liên kết một bot khác trước khi ngắt kênh đăng nhập cuối cùng. Nếu đang xử lý tin, hãy chờ hoàn tất rồi thử lại.</p>
      <button ref={cancel} type="button" disabled={pending} onClick={close}>Giữ kết nối</button>
      <button type="button" className={styles.action} disabled={pending} onClick={()=>{close();void disconnect();}}>Xác nhận ngắt kết nối</button>
    </section>}
  </div>;
}
