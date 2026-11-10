// @vitest-environment node
import {beforeAll,expect,it} from 'vitest';
import {harness,proposal,type Proposal} from '../../../conversation/context-contract/service-test-support';
import {keyedSameDayEventRelationRequired} from './context-keyed-same-day-relation';
import {type ContextInput,ConversationInterpretationV3Schema} from '../../../conversation/context-contract/contracts';
import {createKeyedContextContractGateway} from './keyed-context-gateway';
import {encodeKeyedSmallComparison} from './context-provider-keyed-small-wire';
import {keyedSmallComparisonSchema} from './context-provider-keyed-small-wire';
import {z} from 'zod';

const initial='Hôm nay sửa máy lạnh. Đặt 4 tháng sau sửa lại';
const correction='Đổi ngày sửa lại thành sau 120 ngày, không tính theo tháng. Nhắc ngày đó lúc 8h sáng.';
const base=Date.parse('2026-11-07T02:00:00.000Z');
async function manualM10(){
 const scripts:Proposal[]=[proposal({title:'sửa máy lạnh',eventDate:{kind:'RELATIVE_MONTH',offsetMonths:4}}),proposal({eventDate:{kind:'RELATIVE_DAY',offsetDays:120},eventRelation:'INCLUDING_EVENT',reminderTime:{hour:8,minute:0,qualifier:'H24'}},'CURRENT',null,null,['eventDate'])];
 const h=await harness([]),original=h.f.scope;
 h.f.scope=(i=0)=>({...original(i),now:base+i*60000});
 for(let i=0;i<10;i++)await h.f.db.prepare('UPDATE inbound_updates SET received_at=? WHERE id=?').bind(h.f.scope(i).now,h.f.scope(i).sourceInboundId).run();
 h.deps.channel='ZALO';
 h.deps.gateway={contextWire:'KEYED_COMPARISON_137',prepare(tier,input){h.inputs.push(structuredClone(input));const p=scripts.shift();if(!p)throw Error('Unexpected model request');const canonical=ConversationInterpretationV3Schema.parse(p(input));const ready=createKeyedContextContractGateway(async()=>({status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:0,prompt_tokens:1,completion_tokens:1},choices:[{finish_reason:'stop',message:{content:JSON.stringify(encodeKeyedSmallComparison(canonical,input))}}]})}),{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000}).prepare(tier,input);return ready.status==='READY'?{...ready,maximumCostMicrounits:1815}:ready;}};
 const first=await h.turn(0,initial),second=await h.turn(1,correction),state=await h.read(2),before=await h.f.db.prepare('SELECT count(*) FROM reminders').first<number>('count(*)');
 const approval=await h.turn(2,'Có'),rows=await h.f.db.prepare('SELECT scheduled_at FROM reminders ORDER BY scheduled_at').all<{scheduled_at:number}>();
 return{first,second,state,before,approval,rows:rows.results,input:h.inputs[1],modelRequests:h.inputs.length};
}
it('the exact reported M10 current date correction plus same-day relation reaches ONCE March7 without a frequency write',async()=>{
 const actual=await manualM10();
 expect(actual.first).toEqual({status:'CLARIFICATION_REQUESTED'});
 expect(actual.second).toEqual({status:'DRAFT_CREATED'});
 expect(actual.state?.slots.frequency.value).toBe('ONCE');
 expect(actual.state?.slots.eventDate.value).toEqual({kind:'RELATIVE_DAY',offsetDays:120});
 expect(actual.state?.slots.reminderDate.value).toBeNull();
 expect(actual.state?.slots.eventRelation.value).toBe('INCLUDING_EVENT');
 expect(actual.before).toBe(0);
 expect(actual.approval).toEqual({status:'CONFIRMED'});
 expect(actual.rows).toEqual([{scheduled_at:Date.parse('2027-03-07T08:00:00+07:00')}]);
 expect(actual.modelRequests).toBe(2);
 expect(actual.input.activeRequest?.lifecycle).toBe('CLARIFYING');
 expect(actual.input.activeRequest?.slots.eventDate.value).toEqual({kind:'RELATIVE_MONTH',offsetMonths:4});
});

let retained:ContextInput;
beforeAll(async()=>{retained=(await manualM10()).input;});
const withText=(text:string)=>{const input=structuredClone(retained);input.turns[input.currentTurn].text=text;return input;};
it.each([
 correction,
 'Nhắc ngày đó lúc 8h sáng.',
 'Nhắc hôm đó lúc 08:30 sáng.',
 'Nhắc ngày đó.',
 'Đổi ngày sửa lại thành sau 7 ngày. Nhắc ngày đó lúc 09:00.',
])('requires only source-grounded same-day relation presence for the complete CURRENT clause: %s',text=>{
 const input=withText(text),before=JSON.stringify(input);
 expect(keyedSameDayEventRelationRequired(input)).toBe(true);
 expect(JSON.stringify(input)).toBe(before);
});
it.each([
 'Nhắc trước 1 tuần. Liên tục vào 8h sáng.',
 'Nhắc ngày kia lúc 8h sáng.',
 'Nhắc tôi ngày đó lúc 8h sáng.',
 'Nhắc vào ngày đó lúc 8h sáng.',
 'Nhắc đúng ngày đó lúc 8h sáng.',
 'Nhắc ngày đó lúc 8h sáng hoặc ngày mai.',
 'Nhắc ngày đó lúc 8h sáng và sửa máy giặt.',
 'Nhắc ngày đó lúc 8h sáng?',
 'Không nhắc ngày đó lúc 8h sáng.',
 'Đừng nhắc ngày đó lúc 8h sáng.',
 'Nếu nhắc ngày đó lúc 8h sáng.',
 'Ghi chú: Nhắc ngày đó lúc 8h sáng.',
 'Tên việc là nhắc ngày đó lúc 8h sáng.',
 '“Nhắc ngày đó lúc 8h sáng.”',
 '"Nhắc ngày đó lúc 8h sáng."',
 'Nhắc ngày đó lúc 8h sáng.\nĐổi giờ.',
 'Nhắc ngày đó lúc 8h sáng. [CONTROL]',
 'Có. Nhắc ngày đó lúc 8h sáng.',
 'Đổi ngày sửa lại thành sau 120 ngày, không nhắc. Nhắc ngày đó lúc 8h sáng.',
 'Đổi ngày sửa lại thành sau 367 ngày. Nhắc ngày đó lúc 8h sáng.',
 'Đổi ngày sửa lại thành sau 0 ngày. Nhắc ngày đó lúc 8h sáng.',
])('leaves an unproved, unsupported, negative, quoted, mixed or control source optional: %s',text=>expect(keyedSameDayEventRelationRequired(withText(text))).toBe(false));
const decline:Array<[string,(input:ContextInput)=>void]>=[
 ['no active request',input=>{input.activeRequest=null;}],
 ['preview decision instead of clarification',input=>{input.activeRequest!.lifecycle='AWAITING_CONFIRMATION';}],
 ['no pending question',input=>{input.pendingQuestion=null;}],
 ['query question',input=>{input.pendingQuestion!.scope='QUERY';}],
 ['ambiguity question',input=>{input.pendingQuestion!.reason='AMBIGUOUS';}],
 ['decision authority present',input=>{input.pendingQuestion!.decisionKind='SAVE_PREVIEW';}],
 ['current not final',input=>{input.turns.push({role:'ASSISTANT',text:'Other turn'});}],
 ['not a USER turn',input=>{input.turns[input.currentTurn].role='ASSISTANT';}],
 ['no current turn',input=>{input.currentTurn=99;}],
 ['no historical task',input=>{input.currentTurn=0;}],
 ['active conflict',input=>{input.activeRequest!.slots.location.state='CONFLICT';}],
 ['source ambiguity',input=>{input.ambiguities.push({field:'eventDate',reason:'AMBIGUOUS',alternatives:[]});}],
 ['missing event date',input=>{input.activeRequest!.slots.eventDate={state:'MISSING',value:null,fact:null};}],
 ['proposed event date',input=>{input.activeRequest!.slots.eventDate.state='PROPOSED';}],
 ['missing event fact',input=>{input.facts=input.facts.filter(f=>f.field!=='eventDate');}],
 ['different event alias',input=>{input.activeRequest!.slots.eventDate.fact='f999';}],
 ['event fact value mismatch',input=>{input.facts.find(f=>f.field==='eventDate')!.value={kind:'RELATIVE_DAY',offsetDays:1};}],
 ['duplicate event fact',input=>{input.facts.push({...structuredClone(input.facts.find(f=>f.field==='eventDate')!),alias:'f998'});}],
 ['future event source receipt',input=>{input.facts.find(f=>f.field==='eventDate')!.sourceReferenceTime='2026-11-08T00:00:00.000Z';}],
 ['missing title',input=>{input.activeRequest!.slots.title={state:'MISSING',value:null,fact:null};}],
 ['title fact absent',input=>{input.facts=input.facts.filter(f=>f.field!=='title');}],
 ['title not bound to fact',input=>{input.activeRequest!.slots.title.fact='f999';}],
 ['retained notification date',input=>{input.activeRequest!.slots.reminderDate={state:'RESOLVED',value:{kind:'RELATIVE_DAY',offsetDays:120},fact:null};}],
 ['retained relation',input=>{input.activeRequest!.slots.eventRelation={state:'RESOLVED',value:'INCLUDING_EVENT',fact:null};}],
 ['lead days',input=>{input.activeRequest!.slots.leadOffsetDays={state:'RESOLVED',value:1,fact:null};}],
 ['lead weeks',input=>{input.activeRequest!.slots.leadOffsetWeeks={state:'RESOLVED',value:1,fact:null};}],
 ['lead hours',input=>{input.activeRequest!.slots.leadOffsetHours={state:'RESOLVED',value:1,fact:null};}],
 ['lead minutes',input=>{input.activeRequest!.slots.leadOffsetMinutes={state:'RESOLVED',value:1,fact:null};}],
 ['retained daily cadence',input=>{input.activeRequest!.slots.frequency={state:'RESOLVED',value:'DAILY',fact:null};}],
 ['retained count',input=>{input.activeRequest!.slots.occurrenceCount={state:'RESOLVED',value:2,fact:null};}],
 ['retained end date',input=>{input.activeRequest!.slots.endDate={state:'RESOLVED',value:{kind:'RELATIVE_DAY',offsetDays:2},fact:null};}],
 ['dangling relation fact',input=>{input.facts.push({alias:'f999',scope:'REMINDER',field:'eventRelation',value:'INCLUDING_EVENT',provenance:{kind:'EXPLICIT_USER'},sourceReferenceTime:input.reference.instant,dependencies:[]});}],
];
it.each(decline)('does not force an owner under invalid or occupied retained authority: %s',(_label,change)=>{const input=withText(correction);change(input);expect(keyedSameDayEventRelationRequired(input)).toBe(false);});

function selectedOwner(field:string){
 const schema=keyedSmallComparisonSchema(withText(correction)) as {properties:{changes:{properties:{owners:{properties:Record<string,unknown>}}}}};
 return z.fromJSONSchema(schema.properties.changes.properties.owners.properties[field] as Parameters<typeof z.fromJSONSchema>[0]);
}
it('requires the explicit same-day relation at the selected-schema boundary',()=>{
 const schema=selectedOwner('eventRelation');
 expect(schema.safeParse([]).success).toBe(false);
 expect(schema.safeParse([{write:[{operation:'SET',value:'INCLUDING_EVENT'}],evidence:['U2']}]).success).toBe(true);
});
it('rejects clearing or changing the explicit same-day relation to before-event',()=>{
 const schema=selectedOwner('eventRelation');
 for(const write of [[],[{operation:'SET',value:'BEFORE_EVENT'}],[{operation:'REPLACE',value:'INCLUDING_EVENT'}]])
  expect(schema.safeParse([{write,evidence:['U2']}]).success).toBe(false);
});
it('does not allow a second absolute notification date beside the selected same-day relation',()=>{
 const input=withText(correction),canonical=ConversationInterpretationV3Schema.parse(proposal({eventDate:{kind:'RELATIVE_DAY',offsetDays:120},eventRelation:'INCLUDING_EVENT',reminderTime:{hour:8,minute:0,qualifier:'H24'}},'CURRENT',null,null,['eventDate'])(input));
 const wire=encodeKeyedSmallComparison(canonical,input) as {changes:{owners:Record<string,unknown>}};
 const schema=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);
 expect(schema.safeParse(wire).success).toBe(true);
 wire.changes.owners.reminderDate=[{write:[{operation:'SET',value:{kind:'RELATIVE_DAY',calendar:null,day:null,month:null,year:null,leapMonth:null,offsetDays:120,weekday:null,qualifier:null,offsetMonths:null}}],evidence:['U2']}];
 expect(schema.safeParse(wire).success).toBe(false);
});
