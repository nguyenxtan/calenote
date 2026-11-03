"use client";
import {useRef,useState,type FormEvent} from 'react';
import type {SessionUser} from '@/contracts/api/session';
import type {PublicSession} from '@/contracts/api/account';
import styles from './FinalScreenExperience.module.css';
import accountStyles from './AccountSettings.module.css';
export type AccountSettingsProps={user:SessionUser;saveProfile?:(name:string)=>Promise<boolean>;sessions?:PublicSession[];revokeOthers?:()=>Promise<boolean>};
const date=(timestamp:number)=>new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'}).format(timestamp);
export function AccountSettings({user,saveProfile,sessions,revokeOthers}:AccountSettingsProps){
 const [name,setName]=useState(user.displayName),[profileBusy,setProfileBusy]=useState(false),[profileNotice,setProfileNotice]=useState(''),[profileError,setProfileError]=useState('');
 const [confirm,setConfirm]=useState(false),[revokeBusy,setRevokeBusy]=useState(false),[sessionNotice,setSessionNotice]=useState(''),[sessionError,setSessionError]=useState('');
 const profileLock=useRef(false),revokeLock=useRef(false);
 async function submit(event:FormEvent){event.preventDefault();if(profileLock.current||!saveProfile)return;const trimmed=name.trim();setProfileNotice('');if(!trimmed||trimmed.length>80){setProfileError('Nhập tên tài khoản từ 1 đến 80 ký tự.');return;}profileLock.current=true;setProfileBusy(true);setProfileError('');try{if(await saveProfile(trimmed)){setName(trimmed);setProfileNotice('Đã lưu tên tài khoản.');}else setProfileError('Chưa xác nhận được việc lưu tên. Hãy tải lại để kiểm tra.');}catch{setProfileError('Chưa xác nhận được việc lưu tên. Hãy tải lại để kiểm tra.');}finally{profileLock.current=false;setProfileBusy(false);}}
 async function revoke(){if(revokeLock.current||!revokeOthers)return;revokeLock.current=true;setRevokeBusy(true);setSessionError('');setSessionNotice('');try{if(await revokeOthers()){setConfirm(false);setSessionNotice('Đã đăng xuất các phiên khác. Phiên hiện tại vẫn hoạt động.');}else{setConfirm(false);setSessionError('Chưa xác nhận được việc đăng xuất. Hãy tải lại danh sách trước khi thử lại.');}}catch{setConfirm(false);setSessionError('Chưa xác nhận được việc đăng xuất. Hãy tải lại danh sách trước khi thử lại.');}finally{revokeLock.current=false;setRevokeBusy(false);}}
 return <section className={styles.settingsCard} id="account"><h2>Tài khoản</h2><p>Thông tin và phiên đăng nhập áp dụng cho tài khoản của bạn.</p>
 <form onSubmit={event=>void submit(event)} className={accountStyles.profile}><label>Tên tài khoản<input maxLength={80} value={name} disabled={profileBusy||!saveProfile} onChange={event=>{setName(event.target.value);setProfileNotice('');setProfileError('');}}/></label><button className={styles.primary} disabled={profileBusy||!saveProfile} type="submit">{profileBusy?'Đang lưu tên…':'Lưu tên tài khoản'}</button></form>
 {profileNotice&&<p role="status">{profileNotice}</p>}{profileError&&<p role="alert">{profileError}</p>}
 <dl className={styles.details}><div><dt>Email đăng nhập</dt><dd>{user.email}</dd></div><div><dt>Múi giờ lời nhắc</dt><dd>Việt Nam · UTC+7</dd></div><div><dt>Đăng nhập</dt><dd>Mã một lần qua bot riêng</dd></div></dl>
 <p className={styles.help}>Email đăng nhập chỉ xem. Tên tài khoản khác với tên gọi riêng trong Cá nhân hoá.</p>
 <h3>Phiên đăng nhập đang hoạt động</h3><p className={styles.help}>Chỉ hiển thị thời gian tạo và hết hạn; không thu thập tên thiết bị hoặc vị trí từ danh sách này.</p>
 {sessions===undefined?<p role="status">Chưa tải được danh sách phiên đăng nhập.</p>:<ul className={accountStyles.sessions}>{sessions.map((session,index)=><li key={session.id}><strong>{session.current?'Phiên hiện tại':`Phiên khác ${index+1}`}</strong><span>Tạo lúc <time dateTime={new Date(session.createdAt).toISOString()}>{date(session.createdAt)}</time></span><span>Hết hạn <time dateTime={new Date(session.expiresAt).toISOString()}>{date(session.expiresAt)}</time></span></li>)}</ul>}
 {sessions?.length===100&&<p>Đang hiển thị tối đa 100 phiên. Đăng xuất các phiên khác áp dụng cho tất cả phiên còn hoạt động của tài khoản.</p>}
 {confirm?<div className={accountStyles.confirm} role="group" aria-label="Xác nhận đăng xuất"><p>Các phiên khác sẽ cần đăng nhập lại. Bạn vẫn ở lại phiên hiện tại.</p><button className={styles.action} type="button" disabled={revokeBusy} onClick={()=>void revoke()}>{revokeBusy?'Đang đăng xuất…':'Xác nhận đăng xuất phiên khác'}</button><button className={styles.action} type="button" disabled={revokeBusy} onClick={()=>setConfirm(false)}>Huỷ</button></div>:<button className={styles.action} type="button" disabled={!revokeOthers||!sessions?.some(session=>!session.current)||revokeBusy} onClick={()=>{setConfirm(true);setSessionError('');setSessionNotice('');}}>Đăng xuất các phiên khác</button>}
 {sessionNotice&&<p role="status">{sessionNotice}</p>}{sessionError&&<p role="alert">{sessionError}</p>}
 </section>;
}
