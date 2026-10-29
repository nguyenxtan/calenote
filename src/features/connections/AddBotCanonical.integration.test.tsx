import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
import {AddBotPanel} from '@/features/final-screens/AddBotPanel';
import {SqliteD1Database} from '@/testing/sqlite-d1.test-support';
import {createKeyring} from '@/modules/security/keyring';
import {prepareSession} from '@/modules/auth/session';
import {createRouter} from '@/worker/router';
vi.mock('next/navigation',()=>({useRouter:()=>({replace:vi.fn()})}));
it('adds Telegram through the real canonical session/router/composition without real transport',async()=>{
 const db=new SqliteD1Database();const now=Date.now();const master='A'.repeat(43);const keyring=await createKeyring(master);const origin='https://calenote.iconiclogs.com';
 try{
  db.sqlite.prepare("INSERT INTO users VALUES ('owner','owner@example.invalid','Owner','Asia/Ho_Chi_Minh',?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO workspaces VALUES ('workspace','owner','PERSONAL',?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO memberships VALUES ('workspace','owner','OWNER',?)").run(now);
  const session=await prepareSession('owner',{keyring,now:()=>now});
  db.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?,NULL,?)').run(session.record.id,'owner',session.record.digest,session.record.expiresAt,now);
  const env={APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:'production',CALENOTE_MASTER_KEY:master,AI_MODE:'off',DB:db,JOBS:{send:vi.fn()},ASSETS:{fetch:vi.fn()}} as unknown as Env;
  const router=createRouter();const providerOps:string[]=[];const requests:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:unknown,init?:RequestInit)=>{
   if(typeof input==='string'&&input.startsWith('/api/')) {requests.push(input);return router(new Request(origin+input,{...init,headers:{origin,'content-type':'application/json',cookie:session.cookie.split(';')[0]}}),env,{} as ExecutionContext);}
   const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:(input as Request).url);
   if(url.hostname!=='api.telegram.org') throw new Error('Unexpected transport');
   const op=url.pathname.split('/').at(-1)!;providerOps.push(op);
   if(op==='getMe') return Response.json({ok:true,result:{id:12345,is_bot:true,first_name:'Synthetic Telegram',username:'synthetic_bot'}});
   if(op==='setWebhook') return Response.json({ok:true,result:true});
   throw new Error('Unexpected provider operation');
  }));
  const added=vi.fn();const user=userEvent.setup();render(<AddBotPanel onAdded={added}/>);
  await user.click(screen.getByRole('button',{name:'Thêm bot'}));expect(screen.getByLabelText('Nền tảng')).toHaveValue('telegram');
  await user.type(screen.getByLabelText('Bot token'),'12345678:synthetic-ui-telegram-token');await user.click(screen.getByRole('button',{name:'Kiểm tra và thêm bot'}));
  await waitFor(()=>expect(added).toHaveBeenCalledOnce());
  expect(screen.getByRole('status')).toHaveTextContent('chưa liên kết chat riêng');expect(screen.getByLabelText('Bot token')).toHaveValue('');
  expect(requests).toEqual(['/api/connections']);expect(providerOps).toEqual(['getMe','setWebhook']);
  expect(db.sqlite.prepare('SELECT user_id,state FROM bot_connections').get()).toEqual({user_id:'owner',state:'ACTIVE_UNBOUND'});
  expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({n:1});expect(db.sqlite.prepare('SELECT id,revoked_at FROM sessions').get()).toEqual({id:session.record.id,revoked_at:null});
 }finally{db.close();}
});
