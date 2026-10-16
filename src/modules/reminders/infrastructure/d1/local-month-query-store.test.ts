// @vitest-environment node
import {afterEach,beforeEach,expect,it} from 'vitest';
import {makeContextHarness} from '@/modules/conversation/infrastructure/d1/test-support';
import {D1LocalMonthQueryStore} from './local-month-query-store';
import {localCalendarMonth,localReadOnlyRange,type LocalMonthQuery} from '@/modules/conversation/local-read-only';
let h:Awaited<ReturnType<typeof makeContextHarness>>,input:LocalMonthQuery;
const receipt=Date.parse('2026-10-15T13:39:00+07:00');
beforeEach(async()=>{h=await makeContextHarness();for(const owner of ['one','two'])await h.db.batch([h.db.prepare("INSERT INTO workspaces(id,kind,owner_user_id,created_at,updated_at) VALUES(?,'PERSONAL',?,1,1)").bind(`space-${owner}`,owner),h.db.prepare("INSERT INTO memberships(workspace_id,user_id,role,created_at) VALUES(?,?,'OWNER',1)").bind(`space-${owner}`,owner)]);await h.db.prepare("UPDATE inbound_updates SET received_at=? WHERE id='one-0'").bind(receipt).run();const rowid=await h.db.prepare("SELECT rowid FROM inbound_updates WHERE id='one-0'").first<number>('rowid');const range=localCalendarMonth(receipt)!;input={message:{id:'one-0',connectionId:'connection-one',providerUserId:'provider-one',privateChatId:'private-one',claimMarker:'claim',text:'tháng này có lịch gì ko',receivedAt:receipt},context:{userId:'one',chatIdentityId:'chat-one',workspaceId:'space-one',timezone:'Asia/Ho_Chi_Minh',inboundRowId:rowid!},range:{start:range.start,end:range.end}}},20000);
afterEach(async()=>{await h?.dispose()});
async function insert(id:string,status='PENDING',at=input.range.start,chat='chat-one',owner='one'){await h.db.prepare("INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at) VALUES(?,?,?,?,x'01',zeroblob(12),1,?,'Asia/Ho_Chi_Minh',?,1,1)").bind(id,`public-${id}`,`space-${owner}`,chat,at,status).run()}
it('reads a31day month on legacy schema, fetch6/show5 with all statuses and excludes end boundary',async()=>{expect((await h.db.prepare("PRAGMA table_info(conversation_contexts)").all<{name:string}>()).results.some(r=>r.name==='contract_version')).toBe(false);for(const [i,status]of ['PENDING','CLAIMED','RETRYABLE','SENT','FAILED','UNCERTAIN'].entries())await insert(`r${i}`,status,input.range.start+i);await insert('end','PENDING',input.range.end);await insert('cancelled','CANCELLED');expect(await new D1LocalMonthQueryStore(h.db).list(input)).toMatchObject({status:'RESULTS',hasMore:true,rows:[{id:'r0'},{id:'r1'},{id:'r2'},{id:'r3'},{id:'r4'}]})});
it('empty, unauthorized, stale and query failure remain distinct',async()=>{const store=new D1LocalMonthQueryStore(h.db);expect(await store.list(input)).toEqual({status:'RESULTS',rows:[],hasMore:false});expect(await store.list({...input,context:{...input.context,userId:'two'}})).toEqual({status:'UNAUTHORIZED'});for(const message of [{...input.message,claimMarker:'wrong'},{...input.message,receivedAt:receipt+1}])expect(await store.list({...input,message})).toEqual({status:'STALE'});expect(await new D1LocalMonthQueryStore({prepare(){throw Error('mock failure')}} as unknown as D1Database).list(input)).toEqual({status:'UNAVAILABLE'});await h.db.prepare("UPDATE inbound_updates SET received_at=?,state='PROCESSED' WHERE id='one-1'").bind(receipt+1).run();expect(await store.list(input)).toEqual({status:'STALE'})});
it('cannot borrow another owner/chat/workspace or an invalid month/source and never writes',async()=>{await insert('mine');await insert('other-owner','SENT',input.range.start,'chat-two','two');await h.db.prepare("INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES('other-connection','one','telegram','other-public','other-bot','Test',x'01',zeroblob(12),'other-fingerprint',1,'ACTIVE_BOUND',1,1)").run();await h.db.prepare("INSERT INTO chat_identities(id,connection_id,provider_user_id,private_chat_id,linked_at) VALUES('other-chat','other-connection','other-user','other-private',1)").run();await insert('other-chat','SENT',input.range.start,'other-chat');const before=await h.db.prepare('SELECT * FROM inbound_updates').all();expect(await new D1LocalMonthQueryStore(h.db).list(input)).toMatchObject({status:'RESULTS',rows:[{id:'mine'}]});expect((await h.db.prepare('SELECT * FROM inbound_updates').all()).results).toEqual(before.results);for(const context of [{...input.context,chatIdentityId:'chat-two'},{...input.context,workspaceId:'space-two'}])expect(await new D1LocalMonthQueryStore(h.db).list({...input,context})).toEqual({status:'UNAUTHORIZED'});for(const range of [{start:input.range.start+1,end:input.range.end},{start:input.range.start,end:input.range.end-1}])expect(await new D1LocalMonthQueryStore(h.db).list({...input,range})).toEqual({status:'INVALID'});expect(await new D1LocalMonthQueryStore(h.db).list({...input,message:{...input.message,text:'nhắc gọi mẹ; tháng này có lịch gì ko'}})).toEqual({status:'INVALID'})});

it('includes UNCERTAIN in the visible results when it is within the first five',async()=>{
 await insert('uncertain','UNCERTAIN');
 expect(await new D1LocalMonthQueryStore(h.db).list(input)).toMatchObject({status:'RESULTS',hasMore:false,rows:[{id:'uncertain',status:'UNCERTAIN'}]});
});

import {readFileSync} from 'node:fs';
import {vi} from 'vitest';
import worker from '@/worker/index';
import * as telegram from '@/modules/connections/providers/telegram';
import {D1SemanticBudgetStore} from '@/modules/semantic/infrastructure/d1/budget-store';
const localInputs=[
 {text:'hôm nay có lời nhắc gì?',contains:'Lịch ngày 15/10/2026'},
 {text:'mai có lịch gì?',contains:'Lịch ngày 16/10/2026'},
 {text:'hôm nay là ngày mấy âm lịch ?',contains:'âm lịch'},
 {text:'hôm nay ngày mấy âm lịch',contains:'âm lịch'},
 {text:'tháng này có lịch gì ko',contains:'Lịch tháng 10/2026'},
 {text:'cú pháp như nào ?',contains:'Không cần cú pháp cố định'},
 {text:'HÔM NAY ÂM LỊCH LÀ NGÀY BAO NHIÊU?',contains:'âm lịch'},
 {text:'cho mình xem lịch trong tháng này nhé!',contains:'Lịch tháng 10/2026'},
 {text:'hướng dẫn sử dụng',contains:'Không cần cú pháp cố định'},
];
const pendingCases=['LEGACY_DRAFT','V2_DRAFT','CANCELLATION'] as const;
it.each(pendingCases.flatMap(pending=>localInputs.map(({text,contains})=>({pending,text,contains}))))('real Worker Queue answers $text with $pending intact and no provider dispatch',async({pending,text,contains})=>{
 for(const sql of readFileSync('migrations/0008_finite_reminder_series.sql','utf8').split(/;\s*(?=CREATE|--|$)/u).map(s=>s.trim()).filter(Boolean))await h.db.prepare(sql).run();
 if(pending!=='CANCELLATION')await h.db.prepare("INSERT INTO command_drafts(id,chat_identity_id,source_inbound_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,expires_at,created_at,updated_at) VALUES('pending','chat-one','one-1',zeroblob(16),zeroblob(12),1,?,'Asia/Ho_Chi_Minh','PENDING',?,?,?)").bind(receipt+3600000,receipt+600000,receipt-1,receipt-1).run();
 if(pending==='V2_DRAFT')await h.db.prepare("INSERT INTO conversation_contexts(id,owner_id,chat_identity_id,source_inbound_id,last_inbound_id,claim_marker,revision,status,created_at,updated_at,expires_at,payload_ciphertext,payload_iv,key_version) VALUES('context','one','chat-one','one-1','one-1','claim',1,'DRAFT_READY',?,?,?,zeroblob(16),zeroblob(12),1)").bind(receipt-1,receipt-1,receipt+600000).run();
 if(pending==='V2_DRAFT')await h.db.prepare("INSERT INTO command_draft_calendar_facts(draft_id,payload_ciphertext,payload_iv,key_version) VALUES('pending',zeroblob(16),zeroblob(12),1)").run();
 if(pending==='CANCELLATION')await h.db.prepare("INSERT INTO reminder_series_proposals(id,owner_id,chat_identity_id,revision,source_inbound_id,action,target_series_id,target_revision,status,payload_ciphertext,payload_iv,key_version,created_at,expires_at) VALUES('proposal','one','chat-one',1,'one-1','CANCEL','target',1,'PENDING',zeroblob(16),zeroblob(12),1,?,?)").bind(receipt-1,receipt+60000).run();
 const tables=['command_drafts','command_draft_calendar_facts','conversation_contexts','conversation_context_outcomes','reminder_series_proposals','reminder_series','reminders','audit_events','semantic_contexts','semantic_budget_windows','semantic_budget_reservations'];
 const snapshot=async()=>Promise.all(tables.map(async table=>(await h.db.prepare(`SELECT * FROM ${table}`).all()).results));
 const before=await snapshot(),id='AQEBAQEBAQEBAQEBAQEBAQ';
 const encrypted=await h.keyring.encryptSensitive('inbound-message',id,1,text);
 const token=await h.keyring.encryptCredential('connection-one','telegram',1,'123456789:synthetic-test-token');
 await h.db.prepare("UPDATE inbound_updates SET id=?,message_ciphertext=?,message_iv=?,state='PENDING',transition_marker=NULL WHERE id='one-0'").bind(id,encrypted.ciphertext,encrypted.iv).run();
 await h.db.prepare("UPDATE bot_connections SET encrypted_token=?,encrypted_token_iv=? WHERE id='connection-one'").bind(token.ciphertext,token.iv).run();
 const send=vi.spyOn(telegram,'sendTelegramText').mockResolvedValue({providerMessageId:'synthetic-reply'});
 const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('unexpected network'));
 const reserve=vi.spyOn(D1SemanticBudgetStore.prototype,'reservePaidCall');
 const ack=vi.fn(),retry=vi.fn();
 const env={APP_ORIGIN:'https://calenote.iconiclogs.com',CALENOTE_RUNTIME_ENVIRONMENT:'production',CALENOTE_MASTER_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',AI_MODE:'privacy',OPENROUTER_API_KEY:'synthetic-only',OPENROUTER_PRIVACY_MODEL:'google/gemini-2.5-flash-lite',OPENROUTER_PRIVACY_PROVIDER:'google-vertex/eu',AI_MAX_PRIVACY_PRICE:'0.4',DB:h.db,JOBS:{send:vi.fn()},ASSETS:{fetch:vi.fn()}} as unknown as Env;
 try{
  const batch={queue:'calenote-jobs',metadata:{metrics:{backlogCount:1,backlogBytes:64}},messages:[{id:'job',timestamp:new Date(),attempts:1,body:{type:'PROCESS_INBOUND',inboundId:id},ack,retry}],ackAll:vi.fn(),retryAll:vi.fn()};
  await worker.queue(batch,env,{waitUntil:vi.fn(),passThroughOnException:vi.fn()} as unknown as ExecutionContext);
  expect(send).toHaveBeenCalledOnce();const reply=send.mock.calls[0][2];
  expect(reply).not.toContain('đang chờ');expect(reply).not.toContain('chưa xử lý');
  expect(reply).toContain(contains);
  expect(await snapshot()).toEqual(before);expect(network).not.toHaveBeenCalled();expect(reserve).not.toHaveBeenCalled();
  expect(ack).toHaveBeenCalledOnce();expect(retry).not.toHaveBeenCalled();
  expect(await h.db.prepare('SELECT state FROM inbound_updates WHERE id=?').bind(id).first<string>('state')).toBe('PROCESSED');
 }finally{send.mockRestore();network.mockRestore();reserve.mockRestore()}
},20000);

it.each(['xem lịch hôm nay','mai có lịch gì?'])('reads only the exact owner day range for %s',async text=>{
 const range=localReadOnlyRange(text,receipt)!;
 const query={...input,message:{...input.message,text},range:{start:range.start,end:range.end}};
 await insert('before','PENDING',range.start-1);
 await insert('start','PENDING',range.start);
 await insert('last','SENT',range.end-1);
 await insert('end','PENDING',range.end);
 await insert('foreign','PENDING',range.start,'chat-two','two');
 const store=new D1LocalMonthQueryStore(h.db);
 expect(await store.list(query)).toMatchObject({status:'RESULTS',hasMore:false,rows:[{id:'start'},{id:'last'}]});
 expect(await store.list({...query,range:{start:range.start,end:range.end+1}})).toEqual({status:'INVALID'});
 expect(await store.list({...query,context:{...query.context,userId:'two'}})).toEqual({status:'UNAUTHORIZED'});
});
