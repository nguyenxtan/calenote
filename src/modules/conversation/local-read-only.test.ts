// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {createConversationService,type ConversationServiceDependencies} from './service';
import {lunarCalendar} from './lunar-calendar';
const receivedAt=Date.parse('2026-10-15T13:39:00+07:00');
function harness(){
 const month=vi.fn(async()=>({status:'RESULTS' as const,rows:[],hasMore:false}));
 const deps:ConversationServiceDependencies={
  contextStore:{load:vi.fn(async()=>{throw Error('read-only must not load pending state')}),save:vi.fn(async()=> 'SAVED' as const),finish:vi.fn(async()=>true),purgeExpired:async()=>0},
  seriesStore:{findPending:vi.fn(async()=>null),discard:vi.fn(async()=>false),propose:vi.fn(async()=>null),confirm:vi.fn(async()=>({status:'STALE' as const})),proposeCancellation:vi.fn(async()=>null),cancelRemaining:vi.fn(async()=> 'STALE' as const)},
  commandStore:{findBoundContext:async()=>null,findPendingDraft:async()=>null,createDraft:vi.fn(async()=> 'CONFLICT' as const),confirmDraft:vi.fn(async()=> 'CONFLICT' as const),cancelDraft:async()=> 'CONFLICT',expireDraft:async()=> 'CONFLICT',rejectMessage:async()=>true},
  runtimeStore:{ownsPendingDraft:async()=>false,claimAttempt:vi.fn(async()=>true),complete:vi.fn(async()=>true)},
  gateway:{prepare:vi.fn(()=>({status:'FAILURE' as const,category:'UNAVAILABLE' as const}))},
  budgetStore:{reservePaidCall:vi.fn(async()=>({status:'BUDGET_EXHAUSTED' as const})),markDispatched:vi.fn(async()=>false),finalizeUsage:vi.fn(async()=>true),releaseOrExpireReservation:vi.fn(async()=>true),reapExpiredReservations:async()=>0},
  keyring:{encryptSensitive:vi.fn(async()=>{throw Error('no encryption writes')}),decryptSensitive:async()=> 'Lời nhắc thử'},calendar:lunarCalendar,now:()=>receivedAt+60000,reply:vi.fn(async()=>{}),list:vi.fn(async()=>[]),
 };
 Object.assign(deps,{listMonth:month});
 const handle=(text:string,at=receivedAt)=>createConversationService(deps).handle({id:'inbound',connectionId:'connection',providerUserId:'provider-user',privateChatId:'chat',claimMarker:'claim',text,receivedAt:at},{userId:'owner',chatIdentityId:'chat-identity',workspaceId:'workspace',timezone:'Asia/Ho_Chi_Minh',inboundRowId:1});
 return {deps,month,handle};
}
it.each(['hôm nay là ngày mấy âm lịch ?','tháng này có lịch gì ko','cú pháp như nào ?'])('answers %s locally without model, budget or pending-state writes',async text=>{
 const h=harness();await h.handle(text);expect(h.deps.gateway.prepare).not.toHaveBeenCalled();expect(h.deps.budgetStore.reservePaidCall).not.toHaveBeenCalled();expect(h.deps.contextStore.load).not.toHaveBeenCalled();expect(h.deps.contextStore.save).not.toHaveBeenCalled();expect(h.deps.seriesStore.findPending).not.toHaveBeenCalled();expect(h.deps.commandStore.createDraft).not.toHaveBeenCalled();expect(h.deps.seriesStore.discard).not.toHaveBeenCalled();expect(h.deps.reply).toHaveBeenCalledOnce();
 const reply=vi.mocked(h.deps.reply).mock.calls[0][0];expect(reply).not.toContain('chưa xử lý');if(text.startsWith('hôm nay'))expect(reply).toContain('âm lịch');if(text.startsWith('tháng')){expect(h.month).toHaveBeenCalledWith(expect.objectContaining({range:{start:Date.parse('2026-10-01T00:00:00+07:00'),end:Date.parse('2026-11-01T00:00:00+07:00')}}));expect(reply).toContain('10/2026')}if(text.startsWith('cú pháp'))expect(reply).toContain('nhắc');
});
it('uses receipt day in Vietnam rather than processing day for lunar conversion',async()=>{const h=harness(),calendar={...lunarCalendar,toLunar:vi.fn(()=>({year:2026,month:9,day:6,leap:false}))};h.deps.calendar=calendar;h.deps.now=()=>Date.parse('2026-10-20T00:00:00+07:00');await h.handle('hôm nay là ngày mấy âm lịch ?',Date.parse('2026-10-14T18:00:00Z'));expect(calendar.toLunar).toHaveBeenCalledWith('2026-10-15');expect(h.deps.reply).toHaveBeenCalledWith(expect.stringContaining('6/9/2026'))});
it('suppresses the reply when the inbound fence is no longer owned',async()=>{const h=harness();h.deps.runtimeStore.complete=vi.fn(async()=>false);expect((await h.handle('cú pháp như nào ?')).status).toBe('SUPERSEDED');expect(h.deps.reply).not.toHaveBeenCalled();expect(h.deps.gateway.prepare).not.toHaveBeenCalled()});
import {localReadOnlyCommand,localCalendarMonth} from './local-read-only';
it.each(['“hôm nay là ngày mấy âm lịch ?”','đừng xem tháng này có lịch gì ko','cú pháp như nào ? rồi nhắc gọi mẹ','nhắc tôi hỏi cú pháp như nào ?','nếu tháng này có lịch gì ko','hôm nay là ngày mấy âm lịch ? [CONTROL]'])('does not borrow read-only authority from compound/quoted source %s',text=>expect(localReadOnlyCommand(text)).toBeNull());
it.each([['2026-02-15',28],['2028-02-15',29],['2026-04-15',30],['2026-10-15',31],['2026-12-15',31]] as const)('owns full calendar month boundaries for %s', (day,length)=>{const range=localCalendarMonth(Date.parse(`${day}T12:00:00+07:00`))!;expect(range.end-range.start).toBe(length*86400000);expect(new Date(range.start+7*3600000).toISOString().slice(8,10)).toBe('01');expect(new Date(range.end+7*3600000).toISOString().slice(8,10)).toBe('01');if(day.startsWith('2026-12'))expect(new Date(range.end).toISOString()).toBe('2026-12-31T17:00:00.000Z')});
it.each(['UNAVAILABLE','UNAUTHORIZED','STALE'] as const)('does not disguise month query %s as empty results and never falls back to AI',async status=>{const h=harness();Object.assign(h.deps,{listMonth:vi.fn(async()=>({status}))});await h.handle('tháng này có lịch gì ko');expect(h.deps.reply).toHaveBeenCalledWith(expect.stringContaining('chưa thể đọc'));expect(h.deps.gateway.prepare).not.toHaveBeenCalled()});

it('fails locally when month wiring is absent', async () => {
 const h=harness();delete h.deps.listMonth;
 await h.handle('tháng này có lịch gì ko');
 expect(h.deps.reply).toHaveBeenCalledWith(expect.stringContaining('chưa thể đọc'));
 expect(h.deps.gateway.prepare).not.toHaveBeenCalled();
});
it('reports unavailable lunar data without guessing or calling AI', async () => {
 const h=harness();h.deps.calendar={...lunarCalendar,toLunar:()=>null};
 await h.handle('hôm nay là ngày mấy âm lịch ?');
 expect(h.deps.reply).toHaveBeenCalledWith(expect.stringContaining('chưa có dữ liệu âm lịch'));
 expect(h.deps.gateway.prepare).not.toHaveBeenCalled();
});
it('shows decrypted titles, delivery status and a bounded-results notice', async () => {
 const h=harness();h.deps.listMonth=vi.fn<NonNullable<ConversationServiceDependencies['listMonth']>>(async()=>({status:'RESULTS',hasMore:true,rows:[{
  id:'reminder',scheduledAt:receivedAt,status:'UNCERTAIN',titleKeyVersion:1,
  encryptedTitle:{ciphertext:new Uint8Array([1]).buffer,iv:new Uint8Array(12).buffer},
 }]}));
 await h.handle('tháng này có lịch gì ko');
 expect(h.deps.reply).toHaveBeenCalledWith(expect.stringContaining('Lời nhắc thử (Chưa rõ kết quả)'));
 expect(h.deps.reply).toHaveBeenCalledWith(expect.stringContaining('còn kết quả khác'));
 expect(h.deps.gateway.prepare).not.toHaveBeenCalled();
});
it('never exposes a partial list or claims empty when title decryption fails', async () => {
 const h=harness();h.deps.listMonth=vi.fn<NonNullable<ConversationServiceDependencies['listMonth']>>(async()=>({status:'RESULTS',hasMore:false,rows:[{
  id:'reminder',scheduledAt:receivedAt,status:'PENDING',titleKeyVersion:1,
  encryptedTitle:{ciphertext:new Uint8Array([1]).buffer,iv:new Uint8Array(12).buffer},
 }]}));h.deps.keyring.decryptSensitive=async()=>{throw Error('unreadable')};
 await h.handle('tháng này có lịch gì ko');
 expect(h.deps.reply).toHaveBeenCalledWith(expect.stringContaining('chưa xử lý'));
 expect(h.deps.gateway.prepare).not.toHaveBeenCalled();
});
