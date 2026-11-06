// @vitest-environment node
import {expect,it} from 'vitest';
import {harness,proposal} from './service-test-support';
import {date,time,now} from './resolution-test-support';
const values={title:'họp QA',eventDate:date(10,11,2026),eventTime:time(15),eventRelation:'BEFORE_EVENT'};
const text='Ngày10/11/2026 lúc15h họp QA, nhắc một lần trước3tiếng.';
it.each([
 {rule:'trước3tiếng',duration:{leadOffsetHours:3},at:'12:00'},
 {rule:'3giờ trước',duration:{leadOffsetHours:3},at:'12:00'},
 {rule:'trước90phút',duration:{leadOffsetMinutes:90},at:'13:30'},
 {rule:'trước1tiếng30phút',duration:{leadOffsetHours:1,leadOffsetMinutes:30},at:'13:30'},
])('confirms $rule exactly once and preserves explicit inputs without computed clock facts',async c=>{
 const h=await harness([proposal({...values,...c.duration})]);
 const input=`Ngày10/11/2026 lúc15h họp QA, nhắc một lần ${c.rule.replace(/(trước)(\d)/,'$1 $2').replace(/(\d)(tiếng|giờ|phút)/g,'$1 $2').replace(/tiếng(\d)/,'tiếng $1')}.`;
 expect(await h.turn(0,input),JSON.stringify({replies:h.replies,failures:h.events.filter(e=>e.event.includes("FAIL")||e.event.includes("REFUS"))})).toEqual({status:'DRAFT_CREATED'});
 const state=(await h.read(1))!;
 expect(state.slots.reminderTime.value).toBeNull();expect(state.slots.reminderDate.value).toBeNull();
 expect(await h.turn(1,`xác nhận ${state.pendingDecision!.tokenHandle}`)).toEqual({status:'CONFIRMED'});
 expect(await h.f.db.prepare('SELECT scheduled_at FROM reminders').first('scheduled_at')).toBe(Date.parse(`2026-11-10T${c.at}:00+07:00`));
 expect(await h.f.db.prepare('SELECT count(*) n FROM advance_notification_groups').first('n')).toBe(0);
 await h.turn(2,`xác nhận ${state.pendingDecision!.tokenHandle}`);expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(1);
});
it('asks about an ambiguous bare before-hour phrase without paying for or inventing a duration/clock',async()=>{
 const h=await harness([proposal({...values,leadOffsetHours:8})]);
 expect(await h.turn(0,'Khám 9 giờ mai, nhắc trước 8 giờ')).toEqual({status:'REJECTED'});
 expect(h.inputs).toHaveLength(0);expect(h.replies.at(-1)?.text).toContain('tiếng');
 expect(await h.f.db.prepare('SELECT count(*) n FROM command_drafts').first('n')).toBe(0);
});
it('refuses a model dropping the stated duration instead of using its invented reminder clock',async()=>{
 const h=await harness([proposal({title:'họp QA',eventDate:date(10,11,2026),eventTime:time(15),reminderTime:time(15)})]);
 await h.turn(0,text.replace('trước3tiếng','trước 3 tiếng'));
 expect(h.replies.some(r=>r.kind==='PREVIEW')).toBe(false);expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(0);
});
it('asks for event clock when a duration is known and keeps the duration through the answer',async()=>{
 const h=await harness([proposal({title:'họp QA',eventDate:date(10,11,2026),leadOffsetHours:3,eventRelation:'BEFORE_EVENT'}),proposal({eventTime:time(15)},'CURRENT')]);
 expect(await h.turn(0,'Ngày10/11/2026 họp QA, nhắc trước 3 tiếng.'),JSON.stringify(h.replies)).toEqual({status:'CLARIFICATION_REQUESTED'});
 expect(h.replies.at(-1)?.text.toLocaleLowerCase('vi')).toContain('sự kiện');
 expect(await h.turn(1,'Sự kiện lúc15h.'),JSON.stringify({replies:h.replies,failures:h.events.filter(e=>e.event.includes("FAIL")||e.event.includes("REFUS"))})).toEqual({status:'DRAFT_CREATED'});
 expect((await h.read(2))?.slots.leadOffsetHours?.value).toBe(3);
});
it('rechecks duration timestamp when confirmation arrives after it has passed',async()=>{
 const h=await harness([proposal({title:'họp QA',eventDate:date(28,9,2026),eventTime:{hour:13,minute:1,qualifier:'H24'},leadOffsetHours:3,eventRelation:'BEFORE_EVENT'})]);
 expect(await h.turn(0,'Ngày28/9/2026 lúc13:01 họp QA, nhắc trước 3 tiếng.'),JSON.stringify(h.replies)).toEqual({status:'DRAFT_CREATED'});
 const state=(await h.read(1))!;h.deps.now=()=>now+60000;
 expect(await h.turn(1,`xác nhận ${state.pendingDecision!.tokenHandle}`)).not.toEqual({status:'CONFIRMED'});
 expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(0);
});

it('passes the actual production keyed gateway and source-bound duration across a current event-time edit',async()=>{
 const {createKeyedContextContractGateway}=await import('../../intelligence/infrastructure/openrouter/keyed-context-gateway');
 const {encodeKeyedSmallComparison}=await import('../../intelligence/infrastructure/openrouter/context-provider-keyed-small-wire');
 const {ConversationInterpretationV3Schema}=await import('./contracts');
 const h=await harness([]),scripts=[proposal({...values,leadOffsetMinutes:90}),proposal({eventTime:time(16)},'CURRENT',null,null,['eventTime'])];
 let calls=0;
 h.deps.gateway={contextWire:"KEYED_COMPARISON_137",prepare(tier,input){
  const gateway=createKeyedContextContractGateway(async()=>{
   calls++;const canonical=ConversationInterpretationV3Schema.parse(scripts.shift()!(input));
   const wire=encodeKeyedSmallComparison(canonical,input);
   return {status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:0,prompt_tokens:1,completion_tokens:1},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})};
  },{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000});
  const prepared=gateway.prepare(tier,input);
  return prepared.status==='READY'?{...prepared,maximumCostMicrounits:1815}:prepared;
 }};
 expect(await h.turn(0,'Ngày10/11/2026 lúc15h họp QA, nhắc trước 90 phút.'),JSON.stringify(h.replies)).toEqual({status:'DRAFT_CREATED'});
 expect(h.replies.at(-1)?.text).toContain('90 phút');
 expect(await h.turn(1,'Dời giờ sự kiện sang16h.'),JSON.stringify(h.replies)).toEqual({status:'DRAFT_CREATED'});
 const state=(await h.read(2))!;expect(state.slots.leadOffsetMinutes?.value).toBe(90);expect(state.slots.reminderTime.value).toBeNull();
 expect(await h.turn(2,`xác nhận ${state.pendingDecision!.tokenHandle}`)).toEqual({status:'CONFIRMED'});
 expect(await h.f.db.prepare('SELECT scheduled_at FROM reminders').first('scheduled_at')).toBe(Date.parse('2026-11-10T14:30:00+07:00'));
 expect(calls).toBe(2);
});

it('clears a duration and its relation without retaining an obsolete fact or optional key',async()=>{
 const clear=proposal({leadOffsetMinutes:null,eventRelation:null,reminderDate:date(10,11,2026),reminderTime:time(9)},'CURRENT');
 const h=await harness([proposal({...values,leadOffsetMinutes:90}),input=>{
  const raw=clear(input) as {changes:Array<{value:unknown;operation:string}>};
  raw.changes.forEach(c=>{if(c.value===null)c.operation='CLEAR';});return raw;
 }]);
 expect(await h.turn(0,'Ngày10/11/2026 lúc15h họp QA, nhắc trước 90 phút.')).toEqual({status:'DRAFT_CREATED'});
 expect(await h.turn(1,'Bỏ mốc nhắc trước 90 phút; nhắc ngày10/11/2026 lúc9h.'),JSON.stringify(h.replies)).toEqual({status:'DRAFT_CREATED'});
 const state=(await h.read(2))!;expect(state.slots.leadOffsetMinutes).toBeUndefined();expect(state.facts.some(f=>f.field==='leadOffsetMinutes')).toBe(false);
 expect(await h.turn(2,`xác nhận ${state.pendingDecision!.tokenHandle}`)).toEqual({status:'CONFIRMED'});
 expect(await h.f.db.prepare('SELECT scheduled_at FROM reminders').first('scheduled_at')).toBe(Date.parse('2026-11-10T09:00:00+07:00'));
});
