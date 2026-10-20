// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {fixture} from '@/modules/conversation/context-contract/infrastructure/d1/test-support';
import {prepareSession} from '@/modules/auth/session';
import {createFollowThroughChatHandler} from '@/modules/follow-through/chat-adapter';
import {D1FollowThroughService} from '@/modules/follow-through/service';
import {createRouter} from './router';

const context={userId:'owner',chatIdentityId:'identity',workspaceId:'workspace',timezone:'Asia/Ho_Chi_Minh',inboundRowId:1};
it.each([
 {verb:'xong',progress:'DONE',spawn:false},
 {verb:'dừng theo dõi',progress:'STOPPED',spawn:false},
 {verb:'hoãn',progress:'OPEN',spawn:true},
 {verb:'đổi lịch',progress:'OPEN',spawn:true},
])('shares $verb chat actions with authenticated web reads without duplicate writes',async({verb,progress,spawn})=>{
 const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('NETWORK_FORBIDDEN_IN_OFFLINE_TEST'));
 const h=await fixture();try{
  h.sqlite!.sqlite.exec(readFileSync('migrations/0014_reminder_follow_through.sql','utf8'));
  const now=Date.now(),session=await prepareSession('owner',{keyring:h.keyring});
  await h.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,NULL,?)').bind(session.record.id,'owner',session.record.digest,session.record.expiresAt,now).run();
  const title=await h.keyring.encryptSensitive('reminder-title','chat-root',1,'Same task on web');
  await h.db.prepare("INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at) VALUES('chat-root','chat-root-public','workspace','identity',?,?,1,?,'Asia/Ho_Chi_Minh','PENDING',?,?)").bind(title.ciphertext,title.iv,now+60000,now,now).run();
  const service=new D1FollowThroughService(h.db,h.keyring,{now:()=>now});
  const handle=createFollowThroughChatHandler(service,()=>now);
  const message={id:'old',connectionId:'connection',providerUserId:'provider-user',privateChatId:'chat',text:`${verb} chat-root-public`,receivedAt:now,claimMarker:'old-claim'};
  const day=new Date(now+86400000+7*3600000).toISOString().slice(0,10),time=`${day} 09:00`;
  if(spawn){
   const preview=await handle({...message,text:`${verb} chat-root-public ${time}`},context);
   expect(preview).toMatchObject({handled:true});if(preview.handled)expect(preview.text).toContain('xác nhận');
   expect(await h.db.prepare('SELECT count(*) n FROM follow_through_action_receipts').first('n')).toBe(0);
   message.text=`xác nhận ${verb} chat-root-public ${time}`;
  }
  for(const scope of [{...context,userId:'foreign-owner'},{...context,chatIdentityId:'foreign-chat'}]){const denied=await handle(message,scope);if(denied.handled)expect(denied.text).not.toContain('Same task on web');}
  const stale=await handle({...message,claimMarker:'stale-claim'},context);if(stale.handled)expect(stale.text).toContain('Chọn lại mã việc');
  expect(await h.db.prepare('SELECT count(*) n FROM follow_through_action_receipts').first('n')).toBe(0);
  const first=await handle(message,context);expect(first).toMatchObject({handled:true});
  if(first.handled)expect(first.text).toContain(verb==='xong'?'Đã xong':verb==='dừng theo dõi'?'Dừng theo dõi':'Đã đổi lịch');
  expect(await handle(message,context)).toEqual(first);
  expect(await h.db.prepare('SELECT count(*) n FROM follow_through_action_receipts').first('n')).toBe(1);
  expect(await h.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(spawn?2:1);
  const send=vi.fn(),origin='https://calenote.iconiclogs.com',route=createRouter();
  const env={DB:h.db,CALENOTE_MASTER_KEY:'A'.repeat(43),APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:'production',JOBS:{send},ASSETS:{fetch:vi.fn()}} as unknown as Env;
  const response=await route(new Request(origin+'/api/v1/follow-through',{headers:{cookie:session.cookie.split(';')[0]}}),env,{waitUntil:vi.fn()} as unknown as ExecutionContext);
  expect(response.status).toBe(200);
  const body=await response.json() as {data:{items:Array<{publicId:string;title:string;progress:string;revision:number;currentReminderPublicId:string;scheduledAt:number;history:Array<{scheduledAt:number}>}>}};
  expect(body.data.items).toHaveLength(1);
  expect(body.data.items[0]).toMatchObject({publicId:'chat-root-public',title:'Same task on web',progress,revision:1});
  expect(body.data.items[0].history).toHaveLength(spawn?2:1);
  if(spawn){expect(body.data.items[0].currentReminderPublicId).not.toBe('chat-root-public');const expected=Date.parse(`${time.replace(' ','T')}:00+07:00`);expect(body.data.items[0].scheduledAt).toBe(expected);expect(body.data.items[0].history.some(row=>row.scheduledAt===expected)).toBe(true);}
  expect((await service.list({userId:'foreign-owner'})).items).toEqual([]);
  const wrong=await handle({...message,id:'in-1',claimMarker:'claim',connectionId:'foreign-bot'},context);
  if(wrong.handled)expect(wrong.text).not.toContain('Same task on web');
  expect(await h.db.prepare('SELECT count(*) n FROM follow_through_action_receipts').first('n')).toBe(1);
  expect(send).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();
 }finally{h.close();network.mockRestore();}
});
