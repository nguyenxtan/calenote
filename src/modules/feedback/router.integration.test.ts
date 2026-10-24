// @vitest-environment node
import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {createRouter} from '@/worker/router';
import {SqliteD1Database} from '@/testing/sqlite-d1.test-support';
import {createKeyring} from '@/modules/security/keyring';
import {prepareSession} from '@/modules/auth/session';
it('runs member→receipt→owner isolation→admin reply→member status through real router/session/keyring/D1',async()=>{
 const db=new SqliteD1Database({conversationV2:true});
 try{
  db.sqlite.exec(readFileSync('migrations/0019_feedback_intake.sql','utf8'));
  const master='A'.repeat(43),keyring=await createKeyring(master),cookies:Record<string,string>={};
  for(const owner of ['one','two','admin']){
   db.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(owner,owner+'@example.test',owner,'Asia/Ho_Chi_Minh',1,1);
   const session=await prepareSession(owner,{keyring});db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?,NULL,?)').run(session.record.id,owner,session.record.digest,session.record.expiresAt,1);cookies[owner]=session.cookie.split(';')[0];
  }
  const origin='https://calenote.iconiclogs.com',env={APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:'production',DB:db,CALENOTE_MASTER_KEY:master,CALENOTE_ADMIN_USER_IDS:'admin'} as unknown as Env,router=createRouter();
  async function call(path:string,owner:string|null,method='GET',body?:unknown,readerId?:string){return router(new Request(origin+path,{method,headers:{...(owner?{cookie:cookies[owner]}:{}),origin,'content-type':'application/json',...(readerId?{'x-calenote-feedback-reader':readerId}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{} as ExecutionContext);}
  for(const path of ['/api/feedback','/api/admin/feedback']){const r=await call(path,null);expect(r.status).toBe(401);expect(r.headers.get('vary')).toBe('Cookie');}
  expect((await call('/api/admin/feedback','one')).status).toBe(403);
  const reader=(await (await call('/api/feedback','one')).json() as {data:{readerId:string}}).data.readerId;
  const body={requestId:'00000000-0000-4000-8000-000000000001',kind:'FEATURE',title:'Bộ lọc lịch cá nhân',description:'Tôi muốn lọc các ngày đáng nhớ theo từng loại.',page:'/app/personal'};
  const created=await call('/api/feedback','one','POST',body,reader);expect(created.status).toBe(201);const ticket=(await created.json() as {data:{id:string}}).data;
  expect((await call('/api/feedback/'+ticket.id,'two')).status).toBe(404);
  const wrongOwner=await call('/api/feedback','two','POST',body,reader);expect(wrongOwner.status).toBe(409);
  const adminList=await (await call('/api/admin/feedback','admin')).json() as {data:{readerId:string;items:{id:string}[]}};expect(adminList.data.items[0].id).toBe(ticket.id);
  const patch={expectedRevision:1,status:'CLOSED',reply:'Đã bổ sung bộ lọc và kiểm tra lại.',disposition:'RESOLVED'};
  expect((await call('/api/admin/feedback/'+ticket.id,'admin','PATCH',patch,adminList.data.readerId)).status).toBe(200);
  const viewed=await call('/api/feedback/'+ticket.id,'one');expect(viewed.headers.get('cache-control')).toBe('no-store');expect(await viewed.json()).toMatchObject({data:{id:ticket.id,kind:'FEATURE',title:body.title,description:body.description,status:'CLOSED',revision:2,reply:patch.reply,disposition:'RESOLVED',updatedAt:expect.any(Number)}});
  expect(db.sqlite.prepare('SELECT count(*) AS n FROM feedback_audit').get()).toMatchObject({n:2});
 }finally{db.close();}
});
