// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../../conversation/context-contract/contracts';
import {harness,type Proposal} from '../../../conversation/context-contract/service-test-support';
import {createKeyedContextContractGateway} from './keyed-context-gateway';
import {decodeKeyedSmallComparison,encodeKeyedSmallComparison,keyedSmallComparisonSchema} from './context-provider-keyed-small-wire';
import {keyedRecurrenceEditPolicy} from './context-keyed-recurrence-edit';

const baseline=JSON.parse(readFileSync(new URL('./__fixtures__/keyed154-window-edit-before.json',import.meta.url),'utf8'));
const sample=(index=0)=>({input:ContextInputSchema.parse(structuredClone(baseline.cases[index].input)),proposal:ConversationInterpretationV3Schema.parse(structuredClone(baseline.cases[index].canonical))});
type Wire={changes:{owners:Record<string,Array<{write:Array<{operation:string;value:unknown}>;evidence:string[]}>>}};
type Schema={properties?:Record<string,Schema>;items?:Schema;anyOf?:Schema[];enum?:unknown[];required?:string[];minItems?:number;maxItems?:number;[key:string]:unknown};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const producer=(input:ContextInput)=>z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);
const encoded=(index=0)=>{const s=sample(index);return {...s,wire:encodeKeyedSmallComparison(s.proposal,s.input) as Wire};};
const source=(input:ContextInput)=>[{kind:'USER_QUOTE' as const,turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];

it.each(['SET','CLEAR'])('rejects the observed non-replacement week edit: %s',operation=>{
 const s=encoded();
 if(operation==='CLEAR')s.wire.changes.owners.leadOffsetWeeks[0].write=[];
 else s.wire.changes.owners.leadOffsetWeeks[0].write[0].operation=operation;
 const before=JSON.stringify(s.wire);
 expect(producer(s.input).safeParse(s.wire).success).toBe(false);
 expect(decodeKeyedSmallComparison(s.wire,s.input).status).toBe('REFUSED');
 expect(JSON.stringify(s.wire)).toBe(before);
});

it.each(['SET','REPLACE','CLEAR'])('does not turn a single notification into an authored count: %s',operation=>{
 const s=encoded(1);s.wire.changes.owners.occurrenceCount=[{write:operation==='CLEAR'?[]:[{operation,value:1}],evidence:['U2']}];
 expect(producer(s.input).safeParse(s.wire).success).toBe(false);
 expect(decodeKeyedSmallComparison(s.wire,s.input).status).toBe('REFUSED');
});

it('refuses an omitted frequency rather than offering the old seven-date preview for a single-notification edit',()=>{
 const s=encoded(1);s.wire.changes.owners.frequency=[];
 expect(producer(s.input).safeParse(s.wire).success).toBe(false);
 expect(decodeKeyedSmallComparison(s.wire,s.input).status).toBe('REFUSED');
});

it.each([0,1])('changes only the grammar-owned recurrence permissions for case %i',index=>{
 const s=sample(index),before=baseline.cases[index],tree=structuredClone(keyedSmallComparisonSchema(s.input)) as Schema;
 const owners=tree.properties!.changes.properties!.owners,fields=index===0?['leadOffsetWeeks']:['frequency','occurrenceCount'];
 const field=index===0?'leadOffsetWeeks':'frequency',owner=owners.properties![field];
 expect(owner.minItems??0).toBe(index===0?before.ownerInfo[field].minItems:1);
 const rows=owner.items!.anyOf??[owner.items!];
 expect(rows).toHaveLength(1);
 for(const row of rows){
  const write=row.properties!.write;
  expect(write.minItems).toBe(1);expect(write.items!.properties!.operation.enum).toEqual(['REPLACE']);
  expect(row.properties!.evidence.items!.enum).toEqual(['U2']);
  expect(hash(write.items!.properties!.value)).toBe(before.ownerInfo[field].valueSchemaSha256);
 }
 for(const key of fields)delete owners.properties![key];owners.required=owners.required!.filter(key=>!fields.includes(key));
 expect(hash(tree)).toBe(before.maskedSchemaSha256);
 const wire=encodeKeyedSmallComparison(s.proposal,s.input),decoded=decodeKeyedSmallComparison(wire,s.input);
 expect(decoded).toMatchObject({status:'PARSED',value:{semantic:{changes:s.proposal.changes}}});
 if(index===1)expect((wire as Wire).changes.owners).not.toHaveProperty('occurrenceCount');
});

it('keeps optional unchanged explicit SET representations for other fields',()=>{
 const s=sample(),fact=s.input.facts.find(f=>f.field==='frequency')!;
 s.proposal.changes.push({field:'frequency',operation:'SET',value:'DAILY',evidence:[{kind:'CONTEXT_FACT',ref:fact.alias}]});
 expect(decodeKeyedSmallComparison(encodeKeyedSmallComparison(s.proposal,s.input),s.input)).toMatchObject({status:'PARSED',value:{semantic:{changes:expect.arrayContaining(s.proposal.changes)}}});
});

const variants:Record<string,(x:ContextInput)=>void>={
 quoted:x=>{x.turns[2].text='"'+x.turns[2].text+'"';},
 hypothetical:x=>{x.turns[2].text='Nếu '+x.turns[2].text;},
 negation:x=>{x.turns[2].text=x.turns[2].text.replace('nhắc','không nhắc');},
 mixed:x=>{x.turns[2].text+=' Và nhắc gọi mẹ.';},
 noEdit:x=>{x.turns[2].text=x.turns[2].text.replace('Đổi thành ','');},
 newline:x=>{x.turns[2].text+='\n';},
 control:x=>{x.turns[2].text+=' [CONTROL]';},
 clarifying:x=>{x.activeRequest!.lifecycle='CLARIFYING';},
 pending:x=>{x.pendingQuestion={text:'Bao nhiêu lần?',scope:'REMINDER',field:'frequency',decisionKind:null,reason:'MISSING'};},
 ambiguity:x=>{x.ambiguities=[{field:'frequency',reason:'AMBIGUOUS',alternatives:[]}];},
 conflict:x=>{x.activeRequest!.slots.leadOffsetWeeks!.state='CONFLICT';},
 history:x=>{x.turns.splice(1,0,{role:'USER',text:'Để đó.'});x.currentTurn=3;},
 burst:x=>{x.currentBurstTurns=[2];},
 duplicateAlias:x=>{x.facts.push(structuredClone(x.facts[0]));},
 futureReceipt:x=>{x.facts.find(f=>f.field==='leadOffsetWeeks')!.sourceReferenceTime='2027-01-01T00:00:00Z';},
 countExplicit:x=>{const f=x.facts.find(f=>f.field==='occurrenceCount')!;f.provenance={kind:'EXPLICIT_USER'};f.dependencies=[];},
 frequencyDerived:x=>{const f=x.facts.find(f=>f.field==='frequency')!;f.provenance={kind:'DERIVED_POLICY',policyVersion:'context-resolution-1',dependencies:[],referenceTime:f.sourceReferenceTime};},
 missingDependency:x=>{const f=x.facts.find(f=>f.field==='occurrenceCount')!;f.dependencies=[];if(f.provenance.kind==='DERIVED_POLICY')f.provenance.dependencies=[];},
 mismatchedDependencies:x=>{const f=x.facts.find(f=>f.field==='occurrenceCount')!;if(f.provenance.kind==='DERIVED_POLICY')f.provenance.dependencies=[];},
 unknownDependency:x=>{const f=x.facts.find(f=>f.field==='occurrenceCount')!;f.dependencies=['f999'];if(f.provenance.kind==='DERIVED_POLICY')f.provenance.dependencies=['f999'];},
 aliasMismatch:x=>{x.activeRequest!.slots.leadOffsetWeeks!.fact='f999';},
 differentClock:x=>{x.turns[2].text=x.turns[2].text.replace('8h','9h');},
 combinedOnceNewWeek:x=>{x.turns[2].text='Đổi thành nhắc một lần trước 2 tuần lúc 8h sáng.';},
};
for(const index of [0,1])it.each(baseline.cases[index].declines as Array<{id:string;schemaSha256?:string;schemaError?:string}>)('preserves 154 outside the proven edit frame '+index+'/$id',row=>{
 const {input}=sample(index);variants[row.id](input);
 expect(keyedRecurrenceEditPolicy(input)).toBeUndefined();
 if(row.schemaError)expect(()=>keyedSmallComparisonSchema(input)).toThrow(row.schemaError);
 else expect(hash(keyedSmallComparisonSchema(input))).toBe(row.schemaSha256);
});

it.each([
 [0,'Đổi sang nhắc trước ba tuần, hằng ngày lúc 08:00.','leadOffsetWeeks',false],
 [1,'Đổi sang nhắc 1 lần trước một tuần vào 08:00.','frequency',true],
] as const)('returns only grammar-owned permissions without rewriting input: %i/%s',(index,text,field,onceCountHidden)=>{
 const s=sample(index).input;s.turns[2].text=text;const before=JSON.stringify(s),policy=keyedRecurrenceEditPolicy(s);
 expect(policy).toEqual({replaceOnly:[field],onceCountHidden});
 expect(JSON.stringify(policy)).not.toMatch(/\d/u);expect(JSON.stringify(s)).toBe(before);
});

it('supports another retained clock without extracting a new clock or lead value',()=>{
 const s=sample().input,time={hour:9,minute:0,qualifier:'H24' as const};
 s.activeRequest!.slots.reminderTime.value=time;s.facts.find(f=>f.field==='reminderTime')!.value=time;
 s.turns[0].text=s.turns[0].text.replace('8h sáng','9h sáng');
 s.turns[2].text='Đổi thành nhắc trước 3 tuần, mỗi ngày lúc 09:00.';
 expect(keyedRecurrenceEditPolicy(s)).toEqual({replaceOnly:['leadOffsetWeeks'],onceCountHidden:false});
});

async function actualEdit(index:number,{omitWeek=false,returnToDaily=false}={}){
 const s=sample(index),h=await harness([]),base=Date.parse('2026-11-07T02:00:00.000Z'),original=h.f.scope;
 h.f.scope=(i=0)=>({...original(i),now:base+i*60000});h.deps.channel='ZALO';
 for(let i=0;i<10;i++)await h.f.db.prepare('UPDATE inbound_updates SET received_at=? WHERE id=?').bind(h.f.scope(i).now,h.f.scope(i).sourceInboundId).run();
 const first=s.input.turns[0].text,initialFacts=s.input.facts.filter(f=>f.provenance.kind==='EXPLICIT_USER');
 const script:Proposal[]=[current=>({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence:source(current)},changes:initialFacts.map(f=>({field:f.field,operation:'SET',value:f.value,evidence:source(current)})),query:null,uncertainties:[],conversationDirective:null,replyProposal:null}),
  current=>({...s.proposal,requestTarget:{kind:'CURRENT',evidence:source(current)},changes:omitWeek?[]:s.proposal.changes.map(c=>({...c,evidence:source(current)}))})];
 if(returnToDaily)script.push(current=>({...s.proposal,requestTarget:{kind:'CURRENT',evidence:source(current)},changes:[{field:'frequency',operation:'REPLACE',value:'DAILY',evidence:source(current)}]}));
 h.deps.gateway={contextWire:'KEYED_COMPARISON_137',prepare(tier,current){
  h.inputs.push(structuredClone(current));const proposal=script.shift();if(!proposal)throw Error('Unexpected model request');
  const authored=ConversationInterpretationV3Schema.parse(proposal(current)),before=JSON.stringify(authored);
  const ready=createKeyedContextContractGateway(async()=>{
   const wire=encodeKeyedSmallComparison(authored,current),decoded=decodeKeyedSmallComparison(wire,current);
   expect(decoded).toMatchObject({status:'PARSED',value:{semantic:{changes:authored.changes}}});expect(JSON.stringify(authored)).toBe(before);
   return {status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:0,prompt_tokens:8000,completion_tokens:500},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})};
  },{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000}).prepare(tier,current);
  return ready.status==='READY'?{...ready,maximumCostMicrounits:1815}:ready;
 }};
 expect(await h.turn(0,first)).toEqual({status:'DRAFT_CREATED'});const initial=await h.read(1);
 const result=await h.turn(1,s.input.turns[2].text),edited=await h.read(2),publicInput=h.inputs[1];
 const count=publicInput.facts.find(f=>f.field==='occurrenceCount')!;
 expect(count.dependencies.map(alias=>publicInput.facts.find(f=>f.alias===alias)!.field).sort()).toEqual(['frequency','leadOffsetWeeks']);
 expect(initial!.slots.occurrenceCount.provenance).toMatchObject({kind:'DERIVED_POLICY',dependencies:['frequency','leadOffsetWeeks']});
 let restored;
 if(returnToDaily){expect(await h.turn(2,'Đổi lại thành nhắc hằng ngày trước 1 tuần lúc 8h sáng.')).toEqual({status:'DRAFT_CREATED'});restored=await h.read(3);}
 return {h,result,edited,restored,publicInput,approvalIndex:returnToDaily?3:2};
}

it.each([0,1])('recomputes the app-owned count and persists the exact edit once through the real service: %i',async index=>{
 const a=await actualEdit(index);expect(a.result).toEqual({status:'DRAFT_CREATED'});
 expect(a.edited!.slots.occurrenceCount).toMatchObject({value:index===0?14:1,provenance:{kind:'DERIVED_POLICY'}});
 expect(a.edited!.slots.eventDate.resolution!.referenceTime).toBe('2026-11-07T02:00:00.000Z');
 expect(await a.h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(0);
 expect(await a.h.turn(a.approvalIndex,'Co')).toEqual({status:'CONFIRMED'});
 const rows=await a.h.f.db.prepare('SELECT scheduled_at FROM reminders ORDER BY scheduled_at').all<{scheduled_at:number}>();
 const dates=index===0?['2027-02-21','2027-02-22','2027-02-23','2027-02-24','2027-02-25','2027-02-26','2027-02-27','2027-02-28','2027-03-01','2027-03-02','2027-03-03','2027-03-04','2027-03-05','2027-03-06']:['2027-02-28'];
 expect(rows.results.map(r=>r.scheduled_at)).toEqual(dates.map(d=>Date.parse(d+'T08:00:00+07:00')));
 await a.h.turn(a.approvalIndex+1,'Co');expect(await a.h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(dates.length);expect(a.h.inputs).toHaveLength(2);
});

it('keeps week presence under the backend omission guard instead of forcing an app-authored week',async()=>{
 const s=encoded();s.wire.changes.owners.leadOffsetWeeks=[];
 expect(producer(s.input).safeParse(s.wire).success).toBe(true);expect(decodeKeyedSmallComparison(s.wire,s.input).status).toBe('PARSED');
 const actual=await actualEdit(0,{omitWeek:true});expect(actual.result).toEqual({status:'REJECTED'});
 expect(await actual.h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(0);
});

it('can return from ONCE to DAILY without an accidental explicit count of one surviving',async()=>{
 const actual=await actualEdit(1,{returnToDaily:true});
 expect(actual.edited!.slots.occurrenceCount).toMatchObject({value:1,provenance:{kind:'DERIVED_POLICY'}});
 expect(actual.restored!.slots.occurrenceCount).toMatchObject({value:7,provenance:{kind:'DERIVED_POLICY'}});
 expect(actual.h.inputs).toHaveLength(3);
});
