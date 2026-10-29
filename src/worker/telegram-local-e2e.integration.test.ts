// @vitest-environment node
import {readFileSync,readdirSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {SqliteD1Database} from '@/testing/sqlite-d1.test-support';
import {createKeyring} from '@/modules/security/keyring';
import {persistedD1Blob} from '@/modules/db/persisted-blob';
import {createRouter} from './router';
import {createRuntimeOperations} from './composition-root';
import {handleQueueBatch} from './index';
import {D1InboundProcessorStore,processInbound} from '@/modules/inbound/processor';
import {D1ConnectionLifecycleStore} from '@/modules/connections/lifecycle';

const master='A'.repeat(43),token='123456789:AAExample_secret-token_123456789',publicId='A'.repeat(22);
const userId=55000001,chatId=44000001,start=Date.UTC(2026,9,24,3,15);
const due=Date.UTC(2026,9,25,1); // Independently authored: tomorrow08:00 Vietnam.
type Job={type:'PROCESS_INBOUND';inboundId:string}|{type:'DELIVER_REMINDER';reminderId:string};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it.each([
 {mode:'preview',outcome:'success',pipeline:'deterministic-fixture'},
 {mode:'preview',outcome:'uncertain',pipeline:'deterministic-fixture'},
 {mode:'auto',outcome:'success',pipeline:'deterministic-fixture'},
 {mode:'preview',outcome:'blocked',pipeline:'default-ai-off'},
] as const)('Telegram local $pipeline webhook→queue→$mode→scheduler→$outcome delivery fences replays without AI/network',async({mode,outcome,pipeline})=>{
 const db=new SqliteD1Database({skipInit:true});
 try{
  for(const file of readdirSync('migrations').filter(x=>x.endsWith('.sql')).sort())db.sqlite.exec(readFileSync('migrations/'+file,'utf8'));
  const keyring=await createKeyring(master),encrypted=await keyring.encryptCredential('connection','telegram',1,token);
  db.sqlite.prepare("INSERT INTO users(id,email,display_name,timezone,created_at,updated_at) VALUES('owner','fixture@example.test','Fixture','Asia/Ho_Chi_Minh',1,1)").run();
  db.sqlite.prepare("INSERT INTO workspaces(id,kind,owner_user_id,created_at,updated_at) VALUES('workspace','PERSONAL','owner',1,1)").run();
  db.sqlite.prepare("INSERT INTO memberships(workspace_id,user_id,role,created_at) VALUES('workspace','owner','OWNER',1)").run();
  db.sqlite.prepare("INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES('connection','owner','telegram',?,'synthetic-bot','Fixture',?,?,'fixture',1,'ACTIVE_BOUND',1,1)").run(publicId,new Uint8Array(encrypted.ciphertext),new Uint8Array(encrypted.iv));
  db.sqlite.prepare("INSERT INTO chat_identities(id,connection_id,provider_user_id,private_chat_id,linked_at) VALUES('identity','connection',?,?,1)").run(String(userId),String(chatId));
  db.sqlite.prepare("INSERT INTO user_preferences(user_id,address_style,tone,reminder_confirmation,updated_at) VALUES('owner','ban','concise',?,1)").run(mode);
  let clock=start,loseNextSend=false;vi.spyOn(Date,'now').mockImplementation(()=>clock);
  const jobs:Job[]=[],outbound:{chat_id:string;text:string}[]=[],transportViolations:string[]=[];
  // Real Telegram adapter; only its external fetch is replaced. Every other endpoint fails closed.
  vi.stubGlobal('fetch',vi.fn(async(raw:string|URL|Request,init?:RequestInit)=>{
   const url=new URL(typeof raw==='string'?raw:raw instanceof URL?raw.href:raw.url);
   if(url.origin!=='https://api.telegram.org'||url.pathname!=='/bot'+token+'/sendMessage')transportViolations.push(url.origin);
   expect(url.origin).toBe('https://api.telegram.org');expect(url.pathname).toBe('/bot'+token+'/sendMessage');
   expect(init?.method).toBe('POST');expect(init?.redirect).toBe('error');
   const body=JSON.parse(String(init?.body));expect(body.chat_id).toBe(String(chatId));expect(typeof body.text).toBe('string');outbound.push(body);
   if(loseNextSend){loseNextSend=false;throw new TypeError('synthetic response lost after dispatch');}
   return new Response(JSON.stringify({ok:true,result:{message_id:900+outbound.length}}),{headers:{'content-type':'application/json'}});
  }));
  const env={DB:db,CALENOTE_MASTER_KEY:master,AI_MODE:'off',APP_ORIGIN:'https://calenote.iconiclogs.com',CALENOTE_RUNTIME_ENVIRONMENT:'production',JOBS:{send:async(job:Job)=>{jobs.push(job);}},ASSETS:{fetch:async()=>new Response(null,{status:404})}} as unknown as Env;
  const defaultRuntime=await createRuntimeOperations(env);
  // Explicit dependency fixture: bypass the disabled semantic port, not its production gate.
  // Domain parser/store/encryption/queue and Telegram adapter stay real; no canned domain result.
  const runtime=pipeline==='default-ai-off'?defaultRuntime:{...defaultRuntime,processInbound:(id:string)=>processInbound(id,{store:new D1InboundProcessorStore(db as unknown as D1Database),keyring,connectionEgress:new D1ConnectionLifecycleStore(db as unknown as D1Database),getReminderConfirmation:async()=>mode})};
  const router=createRouter(),secrets=await keyring.webhookSecrets(publicId);
  const ctx={waitUntil:vi.fn(),passThroughOnException:vi.fn()} as unknown as ExecutionContext;
  async function webhook(update:number,text:string){
   return router(new Request(`https://calenote.iconiclogs.com/webhooks/telegram/${publicId}/${secrets.pathSecret}`,{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':secrets.headerSecret},body:JSON.stringify({update_id:update,message:{message_id:update+100,from:{id:userId,is_bot:false,first_name:'Fixture'},chat:{id:chatId,type:'private'},date:Math.floor(clock/1000),text}})}),env,ctx);
  }
  async function consume(job:Job){
   const ack=vi.fn(),retry=vi.fn();
   await handleQueueBatch({messages:[{body:job,id:'synthetic-queue-message',timestamp:new Date(clock),attempts:1,ack,retry}],queue:'local-synthetic',ackAll:vi.fn(),retryAll:vi.fn()} as unknown as MessageBatch<unknown>,runtime);
   expect(ack).toHaveBeenCalledTimes(1);expect(retry).not.toHaveBeenCalled();
  }
  const scalar=(sql:string)=>db.sqlite.prepare(sql).get() as Record<string,unknown>;
  expect((await webhook(101,'mai 8h nhắc tôi gửi báo cáo')).status).toBe(200);
  expect((await webhook(101,'mai 8h nhắc tôi gửi báo cáo')).status).toBe(200);
  expect(jobs).toHaveLength(1);expect(scalar('SELECT count(*) n FROM inbound_updates').n).toBe(1);
  expect(scalar('SELECT provider_message_id FROM inbound_updates').provider_message_id).toBe('101');
  const createJob=jobs.shift()!;expect(createJob.type).toBe('PROCESS_INBOUND');
  expect(JSON.stringify(scalar('SELECT * FROM inbound_updates'))).not.toContain('gửi báo cáo');
  await consume(createJob);
  if(pipeline==='default-ai-off'){
   expect(scalar('SELECT state FROM inbound_updates').state).toBe('REJECTED');
   expect(scalar('SELECT count(*) n FROM command_drafts').n).toBe(0);expect(scalar('SELECT count(*) n FROM reminders').n).toBe(0);
   expect(outbound).toHaveLength(1);await consume(createJob);expect(outbound).toHaveLength(1);
   expect(scalar('SELECT count(*) n FROM semantic_budget_reservations').n).toBe(0);expect(transportViolations).toEqual([]);return;
  }
  expect(scalar('SELECT state FROM inbound_updates').state).toBe('PROCESSED');
  expect(outbound).toHaveLength(1);await consume(createJob);expect(outbound).toHaveLength(1);
  if(mode==='preview'){
   expect(scalar('SELECT count(*) n FROM reminders').n).toBe(0);
   expect(scalar('SELECT status FROM command_drafts').status).toBe('PENDING');expect(outbound[0].text).toContain('có');
   expect(JSON.stringify(scalar('SELECT * FROM command_drafts'))).not.toContain('gửi báo cáo');
   clock++;
   expect((await webhook(102,'có')).status).toBe(200);expect((await webhook(102,'có')).status).toBe(200);expect(jobs).toHaveLength(1);
   const confirm=jobs.shift()!;await consume(confirm);expect(outbound).toHaveLength(2);await consume(confirm);expect(outbound).toHaveLength(2);
   expect(scalar('SELECT count(*) n FROM inbound_updates').n).toBe(2);expect(scalar('SELECT status FROM command_drafts').status).toBe('CONFIRMED');
  }
  expect(scalar('SELECT count(*) n FROM reminders').n).toBe(1);
  const reminder=db.sqlite.prepare('SELECT * FROM reminders').get()!;
  expect(reminder.scheduled_at).toBe(due);expect(reminder.status).toBe('PENDING');
  expect(await keyring.decryptSensitive('reminder-title',String(reminder.id),Number(reminder.title_key_version),{ciphertext:persistedD1Blob(reminder.title_ciphertext),iv:persistedD1Blob(reminder.title_iv)})).toBe('gửi báo cáo');
  expect(scalar('SELECT count(*) n FROM semantic_budget_reservations').n).toBe(0);
  clock=due+1;await runtime.claimDueReminders(clock,5);expect(jobs).toHaveLength(1);
  const delivery=jobs.shift()!;expect(delivery).toEqual({type:'DELIVER_REMINDER',reminderId:reminder.id});
  const before=outbound.length;loseNextSend=outcome==='uncertain';await consume(delivery);
  expect(outbound).toHaveLength(before+1);expect(outbound.at(-1)!.text).toContain('gửi báo cáo');
  expect(scalar('SELECT status FROM reminders').status).toBe(outcome==='success'?'SENT':'UNCERTAIN');
  expect(scalar('SELECT status FROM reminder_deliveries').status).toBe(outcome==='success'?'SENT':'UNCERTAIN');
  await consume(delivery);await runtime.claimDueReminders(clock+1000,5);expect(jobs).toHaveLength(0);expect(outbound).toHaveLength(before+1);
  expect((await webhook(101,'mai 8h nhắc tôi gửi báo cáo')).status).toBe(200);expect(jobs).toHaveLength(0);
  expect(scalar('SELECT count(*) n FROM reminders').n).toBe(1);expect(scalar('SELECT count(*) n FROM reminder_deliveries').n).toBe(1);
  expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);expect(transportViolations).toEqual([]);
 }finally{db.close();}
});
