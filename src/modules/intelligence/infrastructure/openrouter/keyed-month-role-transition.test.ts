// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../../conversation/context-contract/contracts';
import {keyedRelativeMonthRoleTransitionClearRequired} from './context-keyed-month-role-transition';
import {keyedSameDayEventRelationRequired} from './context-keyed-same-day-relation';
import {decodeKeyedSmallComparison,encodeKeyedSmallComparison,keyedSmallComparisonSchema} from './context-provider-keyed-small-wire';
import {primaryEvidenceSourceCodebook} from './evidence-pointer';
import {createKeyedContextContractGateway} from './keyed-context-gateway';
import {createContextContractProbe} from '../../../../../tools/benchmark/context-contract-probe';
import * as evidenceValidation from '../../../conversation/context-contract/evidence';

const baseline=JSON.parse(readFileSync(new URL('./__fixtures__/keyed152-month-role-before.json',import.meta.url),'utf8'));
const input=()=>ContextInputSchema.parse(structuredClone(baseline.input));
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Wire={changes:{owners:Record<string,Array<{write:Array<{operation:string;value:unknown}>;evidence:string[]}>>}};
const wire=()=>structuredClone(baseline.wire) as Wire;
type Change=(value:ContextInput)=>void;
const variants:Record<string,Change>={
 notification:x=>{x.turns[0].text='Hôm nay sửa máy lạnh. Nhắc tôi 4 tháng sau sửa lại';},
 twoMonths:x=>{x.turns[0].text+=' Sau 4 tháng sửa tiếp.';},
 differentMonths:x=>{x.turns[0].text+=' Sau 5 tháng sửa tiếp.';},
 monthDay:x=>{x.turns[0].text='Hôm nay sửa máy lạnh. Ngày 4 tháng sau sửa lại';},
 ownDate:x=>{x.turns[2].text='Nhắc trước 1 tuần, từ ngày 5 tháng sau, 8h sáng.';},
 negated:x=>{x.turns[2].text='Đừng nhắc trước 1 tuần. Liên tục vào 8h sáng.';},
 quoted:x=>{x.turns[2].text='"Nhắc trước 1 tuần. Liên tục vào 8h sáng."';},
 history:x=>{x.turns.splice(1,0,{role:'USER',text:'Cứ để đó.'});x.currentTurn=3;},
 ambiguity:x=>{x.ambiguities=[{field:'operation',reason:'AMBIGUOUS',alternatives:[]}];},
 eventAlreadyPresent:x=>{
  const fact=x.facts.find(f=>f.field==='reminderDate')!;
  x.facts.push({...fact,alias:'f99',field:'eventDate'});
  x.activeRequest!.slots.eventDate={...x.activeRequest!.slots.reminderDate,fact:'f99'};
 },
 clockAlreadyPresent:x=>{
  const fact=x.facts.find(f=>f.field==='reminderDate')!,value={hour:8,minute:0,qualifier:'H24' as const};
  x.facts.push({...fact,alias:'f98',field:'reminderTime',value});
  x.activeRequest!.slots.reminderTime={state:'RESOLVED',fact:'f98',value};
 },
 oldDerivedDependency:x=>{x.facts.find(f=>f.field==='reminderDate')!.dependencies=[x.activeRequest!.slots.title.fact!];},
 badClock:x=>{x.turns[2].text='Nhắc trước 1 tuần. Liên tục vào 25h sáng.';},
};

it('requires the atomic role pair only for the first source-grounded before-event daily follow-up',()=>{
 const value=input(),before=JSON.stringify(value);
 expect(keyedRelativeMonthRoleTransitionClearRequired(value)).toBe(true);
 expect(keyedSameDayEventRelationRequired(value)).toBe(false);
 const decoded=decodeKeyedSmallComparison(wire(),value);
 expect(decoded.status).toBe('PARSED');
 if(decoded.status!=='PARSED')throw Error('Expected source-grounded role transition');
 expect(decoded.value).toMatchObject({semantic:{changes:expect.arrayContaining([
  {field:'eventDate',operation:'SET',value:{kind:'RELATIVE_MONTH',offsetMonths:4},evidence:[{kind:'USER_QUOTE',turn:0,quote:value.turns[0].text,occurrence:1}]},
  {field:'reminderDate',operation:'CLEAR',value:null,evidence:[{kind:'USER_QUOTE',turn:2,quote:value.turns[2].text,occurrence:1}]},
 ])}});
 expect(JSON.stringify(value)).toBe(before);
});

it.each(baseline.declines as Array<{id:string;schemaSha256:string}>)('preserves the previous schema on a declined transition: $id',({id,schemaSha256})=>{
 const value=input();variants[id](value);const parsed=ContextInputSchema.parse(value);
 expect(keyedRelativeMonthRoleTransitionClearRequired(parsed)).toBe(false);
 expect(hash(keyedSmallComparisonSchema(parsed))).toBe(schemaSha256);
});

const badWires:Record<string,(value:Wire)=>void>={
 missingClear:value=>{value.changes.owners.reminderDate=[];},
 setInsteadOfClear:value=>{value.changes.owners.reminderDate[0].write=structuredClone(value.changes.owners.eventDate[0].write);},
 replaceInsteadOfClear:value=>{value.changes.owners.reminderDate[0].write=[{...structuredClone(value.changes.owners.eventDate[0].write[0]),operation:'REPLACE'}];},
 oldUserClear:value=>{value.changes.owners.reminderDate[0].evidence=['U0'];},
 retainedFactClear:value=>{value.changes.owners.reminderDate[0].evidence=['Ff2'];},
 mixedClear:value=>{value.changes.owners.reminderDate[0].evidence=['U2','U0'];},
 duplicateClear:value=>{value.changes.owners.reminderDate.push(structuredClone(value.changes.owners.reminderDate[0]));},
 missingEvent:value=>{value.changes.owners.eventDate=[];},
 replaceEvent:value=>{value.changes.owners.eventDate[0].write[0].operation='REPLACE';},
 clearEvent:value=>{value.changes.owners.eventDate[0].write=[];},
 mixedEventCurrentLast:value=>{value.changes.owners.eventDate[0].evidence=['U0','U2'];},
 mixedEventCurrentFirst:value=>{value.changes.owners.eventDate[0].evidence=['U2','U0'];},
 eventFromNotificationFact:value=>{value.changes.owners.eventDate[0].evidence=['Ff2'];},
};
it.each(Object.keys(badWires))('refuses an incomplete or unauthorised transition without changing the response: %s',name=>{
 const value=input(),bad=wire();badWires[name](bad);const before=JSON.stringify(bad);
 expect(z.fromJSONSchema(keyedSmallComparisonSchema(value) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(bad).success).toBe(false);
 expect(decodeKeyedSmallComparison(bad,value).status).toBe('REFUSED');
 expect(JSON.stringify(bad)).toBe(before);
});

it('refuses the observed current USER citation that cannot author the required event date',()=>{
 const value=input(),authored=wire();
 authored.changes.owners.eventDate[0].evidence=['U2'];
 const before=JSON.stringify(authored);
 expect(z.fromJSONSchema(keyedSmallComparisonSchema(value) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(authored).success).toBe(false);
 expect(decodeKeyedSmallComparison(authored,value).status).toBe('REFUSED');
 expect(JSON.stringify(authored)).toBe(before);
});

type Schema={properties?:Record<string,Schema>;items?:Schema;anyOf?:Schema[];enum?:unknown[];[key:string]:unknown};
it('subtracts only event-date evidence options while preserving the 153 value and CLEAR domains',()=>{
 const previous=JSON.parse(readFileSync(new URL('./__fixtures__/keyed153-month-role-source-before.json',import.meta.url),'utf8'));
 const value=input(),schema=structuredClone(keyedSmallComparisonSchema(value)) as Schema;
 const historical=primaryEvidenceSourceCodebook(value).entries.filter(e=>e.kind!=='CONTEXT_FACT'&&typeof e.turn==='number'&&e.turn<value.currentTurn).map(e=>e.code);
 const owner=schema.properties!.changes.properties!.owners.properties!.eventDate;
 const rows=owner.items!.anyOf??[owner.items!];
 expect(rows).toHaveLength(1);
 for(const row of rows){expect(row.properties!.evidence.items!.enum).toEqual(historical);delete row.properties!.evidence.items!.enum;}
 owner.items=rows[0];
 expect(hash(schema)).toBe(previous.normalizedSchemaSha256);
 const good=wire();
 expect(good.changes.owners.eventDate[0]).toHaveProperty('evidence',['U0']);
 expect(decodeKeyedSmallComparison(good,value).status).toBe('PARSED');
 const absent=wire();delete (absent.changes.owners.eventDate[0] as {evidence?:string[]}).evidence;
 expect(decodeKeyedSmallComparison(absent,value).status).toBe('REFUSED');
});

async function throughBackend(months:number,evidence=['U0']){
 const fixture=input(),receipt='2026-11-07T02:00:00.000Z';
 const factory=createKeyedContextContractGateway(async request=>{
  const raw=JSON.parse(request.messages[1].content);
  for(const key of ['evidenceSources','numericOwnership','fieldCapability'])delete raw[key];
  const current=ContextInputSchema.parse(raw),quote=[{kind:'USER_QUOTE',turn:0,quote:fixture.turns[0].text,occurrence:1}];
  const authored=current.currentTurn===0?encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse({
   schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence:quote},
   changes:[{field:'title',operation:'SET',value:'sửa máy lạnh',evidence:quote},{field:'reminderDate',operation:'SET',value:{kind:'RELATIVE_MONTH',offsetMonths:4},evidence:quote}],
   query:null,uncertainties:[],conversationDirective:null,replyProposal:null,
  }),current):wire();
  if(current.currentTurn!==0){const event=(authored as Wire).changes.owners.eventDate[0];event.write[0].value={...(event.write[0].value as object),offsetMonths:months};event.evidence=evidence;}
  expect(z.fromJSONSchema(keyedSmallComparisonSchema(current) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(authored).success).toBe(true);
  expect(decodeKeyedSmallComparison(authored,current).status).toBe('PARSED');
  return {status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:0,prompt_tokens:8000,completion_tokens:500},choices:[{finish_reason:'stop',message:{content:JSON.stringify(authored)}}]})};
 },{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000});
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse(receipt),liveBudgetProfile:'GPT5_MINI_AZURE_SWEDEN',liveGateway:{...factory,contextWire:'KEYED_COMPARISON_137'}},()=>{throw Error('Unexpected offline substitution');});
 try{
  expect(await probe.turn(fixture.turns[0].text,receipt)).toMatchObject({status:'CLARIFICATION_REQUESTED',pendingField:'reminderTime'});
  return await probe.turn(fixture.turns[2].text,'2026-11-07T02:01:00.000Z');
 }finally{probe.dispose();}
}

it('keeps the original USER receipt and correct model-authored value executable through the backend',async()=>{
 expect(await throughBackend(4)).toMatchObject({status:'DRAFT_CREATED',mutations:0,apiPreviews:1,fields:{eventDate:{kind:'RELATIVE_MONTH',offsetMonths:4}}});
});

it('still rejects a wrong model-authored month with the allowed historical source in backend evidence validation',async()=>{
 // Observe the real entry point without replacing its implementation. The
 // public downstream diagnostic intentionally projects this reason generically.
 const validated=vi.spyOn(evidenceValidation,'validateEvidenceV3');
 try{
  const actual=await throughBackend(5);
  expect(actual).toMatchObject({status:'REJECTED',mutations:0,apiPreviews:0});
  expect(actual.downstreamDiagnostics).toContainEqual({stage:'EVIDENCE',result:'REJECTED',reason:'EVIDENCE_INVALID'});
  expect(validated.mock.results.at(-1)?.value).toMatchObject({status:'REFUSED',reason:'RELATIVE_MONTH_NOT_SUPPORTED'});
 }finally{validated.mockRestore();}
});

it('gains no additional authority from repeated copies of the same allowed historical source',async()=>{
 expect(await throughBackend(4,['U0','U0'])).toMatchObject({status:'DRAFT_CREATED',mutations:0,apiPreviews:1,fields:{eventDate:{kind:'RELATIVE_MONTH',offsetMonths:4}}});
});

it.each(['nhắc','nhac','nhớ','báo','thông báo','hẹn giờ','remind','notify'])('does not force removal of a genuinely authored notification date: %s',verb=>{
 const value=input();value.turns[0].text=`Hôm nay sửa máy lạnh. ${verb} tôi 4 tháng sau sửa lại`;
 expect(keyedRelativeMonthRoleTransitionClearRequired(value)).toBe(false);
 const unchanged=wire();unchanged.changes.owners.reminderDate=[];unchanged.changes.owners.eventDate=[];
 expect(z.fromJSONSchema(keyedSmallComparisonSchema(value) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(unchanged).success).toBe(true);
});

it.each([
 '2 tháng trước sửa tiếp.',
 '13 tháng sau kiểm tra lại.',
 'Ngày 5 tháng sau kiểm tra lại.',
 '2 thang truoc sua tiep.',
])('does not force CLEAR when another month meaning lies outside the positive verifier: %s',extra=>{
 const value=input();value.turns[0].text+=' '+extra;
 expect(keyedRelativeMonthRoleTransitionClearRequired(value)).toBe(false);
 const unchanged=wire();unchanged.changes.owners.reminderDate=[];unchanged.changes.owners.eventDate=[];
 expect(z.fromJSONSchema(keyedSmallComparisonSchema(value) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(unchanged).success).toBe(true);
});

it.each([
 'Nhắc trước 1 tuần. Liên tục vào 8h sáng.\n',
 'Nhắc trước 1 tuần. Liên tục vào 8h sáng.\u2028',
 'Nếu được thì nhắc trước 1 tuần. Liên tục vào 8h sáng.',
 'Nhắc trước 1 tuần. Liên tục vào 8h sáng và gọi mẹ.',
 'Nhắc trước 1 tuần. 2 tháng sau nhắc lại.',
 'Nhắc trước 0 tuần. Liên tục vào 8h sáng.',
 'Nhắc trước 5 tuần. Liên tục vào 8h sáng.',
 'Nhắc trước 31 ngày. Liên tục vào 8h sáng.',
 'Nhắc trước 1 tuần. Liên tục vào 8h60 sáng.',
 'Nhắc trước 1 tuần. Liên tiếp vào 8h sáng.',
 'Nhắc trước 1 tuần. Hằng ngày vào 17h30 chiều.',
])('leaves an unsupported or mixed follow-up optional: %s',text=>{
 const value=input();value.turns[2].text=text;expect(keyedRelativeMonthRoleTransitionClearRequired(value)).toBe(false);
});

it.each([
 'Nhắc trước hai ngày, mỗi ngày lúc 09:15.',
 'Nhắc tôi trước 2 tuần. Hằng ngày vào 17:30 chiều.',
 'Nhắc trước 7 ngày. Liên tục vào 8h sáng.',
])('uses source shape without fixing a model-authored lead amount or clock: %s',text=>{
 const value=input();value.turns[2].text=text;expect(keyedRelativeMonthRoleTransitionClearRequired(value)).toBe(true);
});

it.each([
 ['differentMonth',(x:ContextInput)=>{x.activeRequest!.slots.reminderDate.value={kind:'RELATIVE_MONTH',offsetMonths:5};x.facts.find(f=>f.field==='reminderDate')!.value={kind:'RELATIVE_MONTH',offsetMonths:5};}],
 ['futureReceipt',(x:ContextInput)=>{x.facts.find(f=>f.field==='reminderDate')!.sourceReferenceTime='2027-01-01T00:00:00Z';}],
 ['unmatchedReceipt',(x:ContextInput)=>{x.facts.find(f=>f.field==='title')!.sourceReferenceTime='2026-11-07T01:59:00Z';}],
 ['factAliasMismatch',(x:ContextInput)=>{x.activeRequest!.slots.reminderDate.fact='f99';}],
 ['existingRelation',(x:ContextInput)=>{x.activeRequest!.slots.eventRelation={state:'RESOLVED',value:'BEFORE_EVENT',fact:'f99'};}],
 ['conflict',(x:ContextInput)=>{x.activeRequest!.slots.location={state:'CONFLICT',value:null,fact:null};}],
 ['burst',(x:ContextInput)=>{x.currentBurstTurns=[2];}],
] as Array<[string,Change]>)('does not override unproven retained state: %s',(_name,change)=>{
 const value=input();change(value);expect(keyedRelativeMonthRoleTransitionClearRequired(value)).toBe(false);
});
