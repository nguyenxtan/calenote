// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../../conversation/context-contract/contracts';
import {keyedSmallComparisonSchema,encodeKeyedSmallComparison,decodeKeyedSmallComparison} from './context-provider-keyed-small-wire';
import {harness,proposal,type Proposal} from '../../../conversation/context-contract/service-test-support';
import {createKeyedContextContractGateway} from './keyed-context-gateway';

const captured=JSON.parse(readFileSync(new URL('./__fixtures__/keyed141-r07-cadence-before.json',import.meta.url),'utf8'));
function source():ContextInput {
 const input=ContextInputSchema.parse(captured.input),template=input.facts.find(f=>f.scope==='REMINDER')!;
 input.facts.push({...template,alias:'f90',scope:'REMINDER',field:'reminderDate',value:{kind:'RELATIVE_MONTH',offsetMonths:4}});
 input.activeRequest!.slots.reminderDate={state:'RESOLVED',value:{kind:'RELATIVE_MONTH',offsetMonths:4},fact:'f90'};
 return ContextInputSchema.parse(input);
}
function owner(field:string,input=source()) {
 const schema=keyedSmallComparisonSchema(input) as {properties:{changes:{properties:{owners:{properties:Record<string,unknown>}}}}};
 return z.fromJSONSchema(schema.properties.changes.properties.owners.properties[field] as Parameters<typeof z.fromJSONSchema>[0]);
}
const month={kind:'RELATIVE_MONTH',calendar:null,day:null,month:null,year:null,leapMonth:null,offsetDays:null,weekday:null,qualifier:null,offsetMonths:4};
const row=(operation:string,value:unknown,evidence:string[])=>[{write:[{operation,value}],evidence}];

it('excludes a retained notification-date fact from an event-date write',()=>{
 expect(owner('eventDate').safeParse(row('SET',month,['Ff90'])).success).toBe(false);
 expect(owner('eventDate').safeParse(row('SET',month,['U0'])).success).toBe(true);
});
it('preserves exact same-field retained FACT SET eligibility',()=>{
 expect(owner('reminderDate').safeParse(row('SET',month,['Ff90'])).success).toBe(true);
});
it('does not expose QUERY facts as reminder-owner evidence',()=>{
 const input=source(),queryInput=JSON.parse(readFileSync(new URL('./__fixtures__/keyed142-r01-query-evidence-before.json',import.meta.url),'utf8')).input;
 input.facts.push({...queryInput.facts.find((fact:{scope:string})=>fact.scope==='QUERY'),alias:'f91'});
 const parsed=ContextInputSchema.parse(input);
 expect(owner('eventDate',parsed).safeParse(row('SET',month,['Ff91'])).success).toBe(false);
 expect(owner('reminderDate',parsed).safeParse(row('SET',month,['Ff91'])).success).toBe(false);
});
it.each([['Ff90'],['U0'],['U2','Ff90'],['U2','U0']].map(evidence=>({evidence})))('requires exclusively current USER evidence for notification-date CLEAR: $evidence',({evidence})=>{
 expect(owner('reminderDate').safeParse([{write:[],evidence}]).success).toBe(false);
 expect(owner('reminderDate').safeParse([{write:[],evidence:['U2']}]).success).toBe(true);
});
it.each([['Ff90'],['U0'],['U2','Ff90'],['U2','U0']].map(evidence=>({evidence})))('requires exclusively current USER evidence for REPLACE: $evidence',({evidence})=>{
 expect(owner('reminderDate').safeParse(row('REPLACE',month,evidence)).success).toBe(false);
 expect(owner('reminderDate').safeParse(row('REPLACE',month,['U2'])).success).toBe(true);
});
it('keeps unchanged owners empty without manufacturing a CLEAR',()=>{
 expect(owner('reminderDate').safeParse([]).success).toBe(true);
});

async function dateChain(factEcho=false){
 const first='Hôm nay sửa máy lạnh. Đặt 4 tháng sau sửa lại',second=factEcho?'Giữ nguyên ngày nhắc, nhắc lúc 8h sáng.':'Nhắc trước 1 tuần. Liên tục vào 8h sáng.';
 const scripts:Proposal[]=[proposal({title:'sửa máy lạnh',reminderDate:{kind:'RELATIVE_MONTH',offsetMonths:4}}),input=>{
  const current=[{kind:'USER_QUOTE',turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
  return {...proposal({},'CURRENT',null,null)(input) as object,changes:factEcho?[
   {field:'reminderDate',operation:'SET',value:{kind:'RELATIVE_MONTH',offsetMonths:4},evidence:[{kind:'CONTEXT_FACT',ref:input.activeRequest!.slots.reminderDate.fact}]},
   {field:'reminderTime',operation:'SET',value:{hour:8,minute:0,qualifier:'AM'},evidence:current},
  ]:[
   {field:'eventDate',operation:'SET',value:{kind:'RELATIVE_MONTH',offsetMonths:4},evidence:[{kind:'USER_QUOTE',turn:0,quote:first,occurrence:1}]},
   {field:'reminderDate',operation:'CLEAR',value:null,evidence:current},
   {field:'reminderTime',operation:'SET',value:{hour:8,minute:0,qualifier:'AM'},evidence:current},
   {field:'frequency',operation:'SET',value:'DAILY',evidence:current},
   {field:'eventRelation',operation:'SET',value:'BEFORE_EVENT',evidence:current},
   {field:'leadOffsetWeeks',operation:'SET',value:1,evidence:current},
  ]};
 }];
 const h=await harness([]),original=h.f.scope,base=Date.parse('2026-11-07T02:00:00.000Z');
 h.f.scope=(i=0)=>({...original(i),now:base+i*60000});h.deps.channel='ZALO';
 for(let i=0;i<10;i++)await h.f.db.prepare('UPDATE inbound_updates SET received_at=? WHERE id=?').bind(h.f.scope(i).now,h.f.scope(i).sourceInboundId).run();
 const captures:Array<{input:ContextInput;wire:unknown}>=[];
 h.deps.gateway={contextWire:'KEYED_COMPARISON_137',prepare(tier,input){
  h.inputs.push(structuredClone(input));const next=scripts.shift();if(!next)throw Error('Unexpected model request');
  const value=ConversationInterpretationV3Schema.parse(next(input));
  const ready=createKeyedContextContractGateway(async()=>{const wire=encodeKeyedSmallComparison(value,input);captures.push({input:structuredClone(input),wire:structuredClone(wire)});return{status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:0,prompt_tokens:1,completion_tokens:1},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})};},{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000}).prepare(tier,input);
  return ready.status==='READY'?{...ready,maximumCostMicrounits:1815}:ready;
 }};
 expect(await h.turn(0,first)).toEqual({status:'CLARIFICATION_REQUESTED'});
 expect(await h.turn(1,second)).toEqual({status:'DRAFT_CREATED'});
 return{h,captures,state:(await h.read(2))!};
}
it('round-trips original USER date plus current CLEAR and commits seven reminders exactly once',async()=>{
 const {h,state,captures}=await dateChain();
 expect(state.slots.eventDate.resolution?.referenceTime).toBe('2026-11-07T02:00:00.000Z');
 expect(state.slots.reminderDate.value).toBeNull();
 expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(0);
 expect(await h.turn(2,'Có')).toEqual({status:'CONFIRMED'});
 const rows=await h.f.db.prepare('SELECT scheduled_at FROM reminders ORDER BY scheduled_at').all<{scheduled_at:number}>();
 expect(rows.results.map(row=>row.scheduled_at)).toEqual(['2027-02-28','2027-03-01','2027-03-02','2027-03-03','2027-03-04','2027-03-05','2027-03-06'].map(date=>Date.parse(date+'T08:00:00+07:00')));
 await h.turn(3,'Có');expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(7);expect(h.inputs).toHaveLength(2);
 const captured=captures[1],fact=`F${captured.input.activeRequest!.slots.reminderDate.fact}`;
 for(const[field,evidence]of [['eventDate',[fact]],['reminderDate',['U0']],['reminderDate',[fact]]] as const){
  const bad=structuredClone(captured.wire) as {changes:{owners:Record<string,Array<{evidence:string[]}>>}};bad.changes.owners[field][0].evidence=[...evidence];
  expect(decodeKeyedSmallComparison(bad,captured.input).status).toBe('REFUSED');
 }
});
it('retains same-field FACT SET through the real service with its original source receipt',async()=>{
 const {h,state}=await dateChain(true);
 expect(state.slots.reminderDate.resolution?.referenceTime).toBe('2026-11-07T02:00:00.000Z');
 expect(state.slots.reminderDate.value).toEqual({kind:'RELATIVE_MONTH',offsetMonths:4});
 expect(await h.turn(2,'Có')).toEqual({status:'CONFIRMED'});
 expect(await h.f.db.prepare('SELECT scheduled_at FROM reminders').first('scheduled_at')).toBe(Date.parse('2027-03-07T08:00:00+07:00'));
 expect(h.inputs).toHaveLength(2);
});

it('requires an explicit notification-date CLEAR when switching the bound monthly date to relative event reminders',async()=>{
 const {captures}=await dateChain(),captured=captures[1];
 const missing=structuredClone(captured.wire) as {changes:{owners:Record<string,unknown[]>}};
 missing.changes.owners.reminderDate=[];
 const before=JSON.stringify(missing);
 expect(z.fromJSONSchema(keyedSmallComparisonSchema(captured.input) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(missing).success).toBe(false);
 expect(decodeKeyedSmallComparison(missing,captured.input).status).toBe('REFUSED');
 expect(JSON.stringify(missing)).toBe(before);
});

it('keeps the semantic CLEAR write explicit in the provider wire instead of reconstructing an omitted write',async()=>{
 const {captures}=await dateChain(),captured=captures[1];
 const wire=captured.wire as {changes:{owners:Record<string,Array<{write?:unknown[]}>>}};
 expect(wire.changes.owners.reminderDate[0]).toHaveProperty('write',[]);
 const omitted=structuredClone(wire);delete omitted.changes.owners.reminderDate[0].write;
 expect(decodeKeyedSmallComparison(omitted,captured.input).status).toBe('REFUSED');
});
