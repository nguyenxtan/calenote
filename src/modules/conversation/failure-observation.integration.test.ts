// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {makeContextHarness,NOW} from './infrastructure/d1/test-support';
import {D1ConversationRuntimeStore} from './infrastructure/d1/runtime-store';
import {createConversationService,type ConversationServiceDependencies} from './service';
import {lunarCalendar} from './lunar-calendar';
it.each(['normal','throw','reject'] as const)('existing completion authority bounds %s observer events to one per inbound and preserves pending/budget rows',async mode=>{
 const h=await makeContextHarness();
 try{
  expect(await h.store.save(h.scope(),null,h.initial)).toBe('SAVED');
  const tables=['conversation_contexts','conversation_context_outcomes','command_drafts','semantic_contexts','semantic_budget_windows','semantic_budget_reservations','semantic_budget_dispatches'];
  const snapshot=()=>Promise.all(tables.map(async table=>(await h.db.prepare(`SELECT * FROM ${table}`).all()).results));const before=await snapshot();
  const observer=vi.fn(()=>{if(mode==='throw')throw Error('observer failure');if(mode==='reject')return Promise.reject(Error('observer failure'))}),reply=vi.fn(),reserve=vi.fn(async()=>({status:'BUDGET_EXHAUSTED' as const}));
  const deps:ConversationServiceDependencies={contextStore:h.store,seriesStore:{findPending:async()=>null,discard:async()=>false,propose:async()=>null,confirm:async()=>({status:'STALE'}),proposeCancellation:async()=>null,cancelRemaining:async()=> 'STALE'},commandStore:{findBoundContext:async()=>null,findPendingDraft:async()=>null,createDraft:vi.fn(async()=> 'CONFLICT' as const),confirmDraft:async()=> 'CONFLICT',cancelDraft:async()=> 'CONFLICT',expireDraft:async()=> 'CONFLICT',rejectMessage:async()=>true},runtimeStore:new D1ConversationRuntimeStore(h.db),gateway:{prepare:()=>({status:'FAILURE',category:'UNAVAILABLE'})},budgetStore:{reservePaidCall:reserve,markDispatched:async()=>false,finalizeUsage:async()=>true,releaseOrExpireReservation:async()=>true,reapExpiredReservations:async()=>0},calendar:lunarCalendar,keyring:h.keyring,now:()=>NOW,reply,list:async()=>[],observeFailure:observer};
  const service=createConversationService(deps),message={id:'one-0',connectionId:'connection-one',providerUserId:'provider-one',privateChatId:'private-one',claimMarker:'claim',receivedAt:NOW,text:'mai 8h nhắc gọi khách'};
  const rowid=await h.db.prepare("SELECT rowid FROM inbound_updates WHERE id='one-0'").first<number>('rowid');const context={userId:'one',chatIdentityId:'chat-one',workspaceId:'space-one',timezone:'Asia/Ho_Chi_Minh',inboundRowId:rowid!};
  expect(await service.handle(message,{...context,userId:'two'})).toEqual({status:'SUPERSEDED'});expect(observer).not.toHaveBeenCalled();expect(reply).not.toHaveBeenCalled();
  expect(await service.handle(message,context)).toEqual({status:'REJECTED'});expect(await service.handle(message,context)).toEqual({status:'SUPERSEDED'});
  expect(observer).toHaveBeenCalledExactlyOnceWith({sourceInboundId:'one-0',stage:'GATEWAY_PREPARE',category:'UNAVAILABLE'});expect(reply).toHaveBeenCalledOnce();expect(reserve).not.toHaveBeenCalled();expect(await snapshot()).toEqual(before);
  expect(await h.db.prepare("SELECT count(*) n FROM audit_events WHERE id='semantic-attempt:one-0'").first<number>('n')).toBe(1);
 }finally{await h.dispose()}
},20000);

import { D1LocalMonthQueryStore } from '@/modules/reminders/infrastructure/d1/local-month-query-store';
it.each(['hôm nay ngày mấy âm lịch', 'cho mình xem lịch trong tháng này nhé!', 'hướng dẫn sử dụng'])(
  'keeps real D1 pending/budget state and emits no false failure for local %s', async text => {
    const h = await makeContextHarness();
    try {
      await h.db.batch([
        h.db.prepare("INSERT INTO workspaces(id,owner_user_id,kind,created_at,updated_at) VALUES('space-one','one','PERSONAL',1,1)"),
        h.db.prepare("INSERT INTO memberships(workspace_id,user_id,role,created_at) VALUES('space-one','one','OWNER',1)"),
      ]);
      expect(await h.store.save(h.scope(), null, h.initial)).toBe('SAVED');
      const tables = ['conversation_contexts', 'conversation_context_outcomes', 'command_drafts', 'semantic_contexts', 'semantic_budget_windows', 'semantic_budget_reservations', 'semantic_budget_dispatches', 'audit_events'];
      const snapshot = () => Promise.all(tables.map(async table => (await h.db.prepare(`SELECT * FROM ${table}`).all()).results));
      const before = await snapshot(), observer = vi.fn(() => { throw Error('must never observe successful local replies'); });
      const prepare = vi.fn(() => { throw Error('must never prepare AI for local replies'); });
      const reply = vi.fn(), runtime = new D1ConversationRuntimeStore(h.db);
      const deps: ConversationServiceDependencies = {
        contextStore: h.store, seriesStore: {findPending: async () => null, discard: async () => false, propose: async () => null, confirm: async () => ({status: 'STALE'}), proposeCancellation: async () => null, cancelRemaining: async () => 'STALE'},
        commandStore: {findBoundContext: async () => null, findPendingDraft: async () => null, createDraft: async () => 'CONFLICT', confirmDraft: async () => 'CONFLICT', cancelDraft: async () => 'CONFLICT', expireDraft: async () => 'CONFLICT', rejectMessage: async () => true},
        runtimeStore: runtime, gateway: {prepare}, budgetStore: {reservePaidCall: async () => { throw Error('must not reserve'); }, markDispatched: async () => false, finalizeUsage: async () => false, releaseOrExpireReservation: async () => false, reapExpiredReservations: async () => 0},
        calendar: lunarCalendar, keyring: h.keyring, now: () => NOW, reply, list: async () => [],
        listMonth: input => new D1LocalMonthQueryStore(h.db).list(input), observeFailure: observer,
      };
      const message = {id: 'one-0', connectionId: 'connection-one', providerUserId: 'provider-one', privateChatId: 'private-one', claimMarker: 'claim', receivedAt: NOW, text};
      const rowid = await h.db.prepare("SELECT rowid FROM inbound_updates WHERE id='one-0'").first<number>('rowid');
      const result = await createConversationService(deps).handle(message, {userId: 'one', chatIdentityId: 'chat-one', workspaceId: 'space-one', timezone: 'Asia/Ho_Chi_Minh', inboundRowId: rowid!});
      expect(result.status).toBe(text.includes('tháng') ? 'REMINDERS_LISTED' : 'REJECTED');
      expect(reply).toHaveBeenCalledOnce(); expect(prepare).not.toHaveBeenCalled(); expect(observer).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
    } finally { await h.dispose(); }
  }, 20000,
);
