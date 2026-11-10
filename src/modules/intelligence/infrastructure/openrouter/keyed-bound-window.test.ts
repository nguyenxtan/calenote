// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../../conversation/context-contract/contracts';
import {harness,type Proposal} from '../../../conversation/context-contract/service-test-support';
import {keyedRelativeMonthRoleTransitionClearRequired,keyedRelativeMonthRoleTransitionPolicy} from './context-keyed-month-role-transition';
import {keyedReadyOnceWindowPolicy} from './context-keyed-recurrence-edit';
import {createKeyedContextContractGateway} from './keyed-context-gateway';
import {decodeKeyedSmallComparison,encodeKeyedSmallComparison,keyedSmallComparisonSchema} from './context-provider-keyed-small-wire';
import {UNCERTAINTY_FIELD_WIRE_CODE_V3 as codes} from './context-provider-wire';

type Schema={properties?:Record<string,Schema>;items?:Schema;anyOf?:Schema[];enum?:unknown[];required?:string[];minItems?:number;maxItems?:number;[key:string]:unknown};
type Wire={changes:{owners:Record<string,Array<{write:Array<{operation:string;value:unknown}>;evidence:string[]}>>};uncertainties:unknown[]};
interface Variant {id:string;input:ContextInput;schemaSha256?:string;schemaError?:{name:string;messageSha256:string};roleClearBefore:boolean;clockOwnerSha256?:string}
interface BaselineCase {id:string;origin:string;input:ContextInput;canonical:Record<string,unknown>;normalizedSchemaSha256:string;valueSchemaHashes:Record<string,string>;variants:Variant[]}
const baseline=JSON.parse(readFileSync(new URL('./__fixtures__/keyed156-window-answer-before.json',import.meta.url),'utf8')) as {cases:BaselineCase[]};
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const sample=(i=0)=>{const row=baseline.cases[i],input=ContextInputSchema.parse(structuredClone(row.input)),proposal=ConversationInterpretationV3Schema.parse({...structuredClone(row.canonical),conversationDirective:null,replyProposal:null});return{row,input,proposal,wire:encodeKeyedSmallComparison(proposal,input) as Wire};};
const producer=(input:ContextInput)=>z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);

it.each(['reminderTime','frequency','eventRelation','leadOffsetWeeks'])('requires %s also when the pending month was already stored as an event',field=>{
 const s=sample();s.input.facts=s.input.facts.map(f=>f.field==='reminderDate'?{...f,field:'eventDate' as const}:f);s.input.activeRequest!.slots.eventDate=structuredClone(s.input.activeRequest!.slots.reminderDate);s.input.activeRequest!.slots.reminderDate={state:'MISSING',value:null,fact:null};
 s.proposal.changes=s.proposal.changes.filter(c=>c.field!=='eventDate'&&c.field!=='reminderDate');const wire=encodeKeyedSmallComparison(s.proposal,s.input) as Wire;wire.changes.owners[field]=[];
 expect(keyedRelativeMonthRoleTransitionClearRequired(s.input)).toBe(false);expect(decodeKeyedSmallComparison(wire,s.input).status).toBe('REFUSED');
});

it('returns only permissions and preserves the input in both proven frames',()=>{
 for(const i of [0,1]){
  const input=sample(i).input,before=JSON.stringify(input),policy=i===0?keyedRelativeMonthRoleTransitionPolicy(input):keyedReadyOnceWindowPolicy(input);
  expect(policy).toEqual(i===0?{leadField:'leadOffsetWeeks',clockRequired:true}:{replaceOnly:['frequency','eventRelation'],setOnly:'leadOffsetWeeks'});
  expect(JSON.stringify(policy)).not.toMatch(/\d/u);expect(JSON.stringify(input)).toBe(before);
 }
});

it('recognizes another retained clock without providing a newly parsed clock',()=>{
 const input=sample(1).input,time={hour:9,minute:0,qualifier:'H24' as const};input.activeRequest!.slots.reminderTime.value=time;input.facts.find(f=>f.field==='reminderTime')!.value=time;
 input.turns[0].text=input.turns[0].text.replace('8h','9h');input.turns[2].text=input.turns[2].text.replace('8h','9h');
 expect(keyedReadyOnceWindowPolicy(input)).toEqual({replaceOnly:['frequency','eventRelation'],setOnly:'leadOffsetWeeks'});
});

it.each(['reminderTime','frequency','eventRelation','leadOffsetWeeks'])('requires the explicit missing window owner %s in the date-role repair',field=>{
 const s=sample();expect(keyedRelativeMonthRoleTransitionClearRequired(s.input)).toBe(true);s.wire.changes.owners[field]=[];
 expect(producer(s.input).safeParse(s.wire).success).toBe(false);expect(decodeKeyedSmallComparison(s.wire,s.input).status).toBe('REFUSED');
});
it.each(['reminderTime','frequency','eventRelation','leadOffsetWeeks'])('allows SET only for the missing window owner %s',field=>{
 const s=sample();s.wire.changes.owners[field][0].write[0].operation='REPLACE';expect(producer(s.input).safeParse(s.wire).success).toBe(false);expect(decodeKeyedSmallComparison(s.wire,s.input).status).toBe('REFUSED');
});
it.each(['frequency','eventRelation'])('requires a replacement rather than the observed SET for occupied %s',field=>{
 const s=sample(1);s.wire.changes.owners[field][0].write[0].operation='SET';const before=JSON.stringify(s.wire);
 expect(producer(s.input).safeParse(s.wire).success).toBe(false);expect(decodeKeyedSmallComparison(s.wire,s.input).status).toBe('REFUSED');expect(JSON.stringify(s.wire)).toBe(before);
});
it.each(['frequency','eventRelation','leadOffsetWeeks'])('refuses an omitted required ready-preview window owner %s',field=>{
 const s=sample(1);s.wire.changes.owners[field]=[];expect(producer(s.input).safeParse(s.wire).success).toBe(false);expect(decodeKeyedSmallComparison(s.wire,s.input).status).toBe('REFUSED');
});
it('does not replace a missing lead or clear an occupied cadence/relation',()=>{
 const s=sample(1);s.wire.changes.owners.leadOffsetWeeks[0].write[0].operation='REPLACE';expect(decodeKeyedSmallComparison(s.wire,s.input).status).toBe('REFUSED');
 for(const field of ['frequency','eventRelation']){const t=sample(1);t.wire.changes.owners[field][0].write=[];expect(decodeKeyedSmallComparison(t.wire,t.input).status).toBe('REFUSED');}
});
it.each([0,1])('does not author an independent count in the proven window: %i',i=>{
 const s=sample(i);s.wire.changes.owners.occurrenceCount=[{write:[{operation:'SET',value:7}],evidence:['U2']}];expect(decodeKeyedSmallComparison(s.wire,s.input).status).toBe('REFUSED');
});
it.each(['H24','AM'])('retains the already-restated clock instead of receiving a redundant %s clock',qualifier=>{
 const s=sample(1);s.wire.changes.owners.reminderTime=[{write:[{operation:'SET',value:{hour:8,minute:0,qualifier}}],evidence:['U2']}];const before=JSON.stringify(s.wire);
 expect(producer(s.input).safeParse(s.wire).success).toBe(false);expect(decodeKeyedSmallComparison(s.wire,s.input).status).toBe('REFUSED');expect(JSON.stringify(s.wire)).toBe(before);
 const proposal=sample(1).proposal;proposal.changes.push({field:'reminderTime',operation:'SET',value:{hour:8,minute:0,qualifier:qualifier as 'H24'|'AM'},evidence:[{kind:'USER_QUOTE',turn:2,quote:s.input.turns[2].text,occurrence:1}]});expect(()=>encodeKeyedSmallComparison(proposal,s.input)).toThrow();
});
it.each([0,1])('changes only the window permissions, preserving authored values and other schema branches: %i',i=>{
 const s=sample(i),schema=structuredClone(keyedSmallComparisonSchema(s.input)) as Schema,owners=schema.properties!.changes.properties!.owners;
 expect(owners.properties).not.toHaveProperty('occurrenceCount');if(i===1)expect(owners.properties).not.toHaveProperty('reminderTime');
 const fields=i===0?['frequency','eventRelation','leadOffsetWeeks','reminderTime']:['frequency','eventRelation','leadOffsetWeeks'];
 for(const field of fields){const owner=owners.properties![field];expect(owner.minItems).toBe(1);expect(owner.maxItems).toBe(1);const rows=owner.items!.anyOf??[owner.items!];expect(rows).toHaveLength(1);
  for(const row of rows){expect(row.properties!.write.minItems).toBe(1);expect(row.properties!.write.items!.properties!.operation.enum).toEqual([i===1&&field!=='leadOffsetWeeks'?'REPLACE':'SET']);expect(row.properties!.evidence.items!.enum).toEqual(['U2']);expect(hash(row.properties!.write.items!.properties!.value)).toBe(s.row.valueSchemaHashes[field]);}
 }
 for(const field of ['frequency','eventRelation','reminderTime','leadOffsetDays','leadOffsetWeeks','occurrenceCount'])delete owners.properties![field];owners.required=owners.required!.filter(f=>!['frequency','eventRelation','reminderTime','leadOffsetDays','leadOffsetWeeks','occurrenceCount'].includes(f));
 const hidden:number[]=[codes.occurrenceCount,...(i===1?[codes.reminderTime]:[])],issues=schema.properties!.uncertainties;if(issues.items?.anyOf)issues.items.anyOf=issues.items.anyOf.filter(r=>!r.properties!.fieldCode.enum!.some(c=>hidden.includes(c as number)));
 expect(hash(schema)).toBe(s.row.normalizedSchemaSha256);expect(decodeKeyedSmallComparison(s.wire,s.input)).toMatchObject({status:'PARSED',value:{semantic:{changes:s.proposal.changes}}});
});

for(const i of [0,1])it.each(baseline.cases[i].variants)('preserves old proof truth and the non-applicable source156 schema '+i+'/$id',row=>{
 expect(keyedRelativeMonthRoleTransitionClearRequired(row.input)).toBe(row.roleClearBefore);
 const applies=i===0?row.roleClearBefore&&!['dayWindow','unsupportedWordFour','unpunctuatedContinuous'].includes(row.id):row.id==='explicitOnce';
 if(row.schemaError){let error:unknown;try{keyedSmallComparisonSchema(row.input);}catch(e){error=e;}expect(error).toBeInstanceOf(Error);expect((error as Error).name).toBe(row.schemaError.name);expect(createHash('sha256').update((error as Error).message).digest('hex')).toBe(row.schemaError.messageSha256);}
 else if(!applies)expect(hash(keyedSmallComparisonSchema(row.input))).toBe(row.schemaSha256);
 else {expect(hash(keyedSmallComparisonSchema(row.input))).not.toBe(row.schemaSha256);if(row.clockOwnerSha256){const tree=keyedSmallComparisonSchema(row.input) as Schema;expect(hash(tree.properties!.changes.properties!.owners.properties!.reminderTime)).toBe(row.clockOwnerSha256);}}
});

const quote=(input:ContextInput,turn=input.currentTurn)=>[{kind:'USER_QUOTE' as const,turn,quote:input.turns[turn].text,occurrence:1}];
async function actualWindow(i:number,eventRole=false){
 const s=sample(i),h=await harness([]),base=Date.parse('2026-11-07T02:00:00Z'),original=h.f.scope;h.f.scope=(n=0)=>({...original(n),now:base+n*60000});h.deps.channel='ZALO';
 for(let n=0;n<10;n++)await h.f.db.prepare('UPDATE inbound_updates SET received_at=? WHERE id=?').bind(h.f.scope(n).now,h.f.scope(n).sourceInboundId).run();
 const seed=s.input.facts.filter(f=>f.provenance.kind==='EXPLICIT_USER');const proposals:Proposal[]=[input=>({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence:quote(input)},changes:seed.map(f=>({field:eventRole&&f.field==='reminderDate'?'eventDate':f.field,operation:'SET',value:f.value,evidence:quote(input)})),query:null,uncertainties:[],conversationDirective:null,replyProposal:null}),input=>({...s.proposal,requestTarget:{kind:'CURRENT',evidence:quote(input)},changes:s.proposal.changes.filter(c=>!eventRole||c.field!=='eventDate'&&c.field!=='reminderDate').map(c=>({...c,evidence:quote(input,c.field==='eventDate'?0:input.currentTurn)}))})];
 h.deps.gateway={contextWire:'KEYED_COMPARISON_137',prepare(tier,input){h.inputs.push(structuredClone(input));const next=proposals.shift();if(!next)throw Error('Unexpected model call');const authored=ConversationInterpretationV3Schema.parse(next(input));
  const ready=createKeyedContextContractGateway(async()=>{const wire=encodeKeyedSmallComparison(authored,input);expect(decodeKeyedSmallComparison(wire,input)).toMatchObject({status:'PARSED',value:{semantic:{changes:authored.changes}}});return{status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:0,prompt_tokens:9000,completion_tokens:500},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})};},{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000}).prepare(tier,input);
  return ready.status==='READY'?{...ready,maximumCostMicrounits:1815}:ready;
 }};
 expect(await h.turn(0,s.input.turns[0].text)).toEqual({status:i===0?'CLARIFICATION_REQUESTED':'DRAFT_CREATED'});const before=await h.read(1);
 if(i===1)expect(before!.slots.frequency.provenance).toMatchObject({kind:'DERIVED_POLICY',dependencies:[]});
 expect(await h.turn(1,s.input.turns[2].text)).toEqual({status:'DRAFT_CREATED'});const after=await h.read(2);
 expect(keyedRelativeMonthRoleTransitionClearRequired(h.inputs[1])).toBe(i===0&&!eventRole);
 expect(after!.slots.occurrenceCount).toMatchObject({value:7,provenance:{kind:'DERIVED_POLICY'}});expect(after!.slots.eventDate.resolution!.referenceTime).toBe('2026-11-07T02:00:00.000Z');expect(after!.slots.reminderDate.value).toBeNull();
 expect(after!.slots.notes.value).toBe(before!.slots.notes.value);expect(after!.slots.reminderTime.value).toEqual({hour:8,minute:0,qualifier:'H24'});
 expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(0);expect(await h.turn(2,'Co')).toEqual({status:'CONFIRMED'});
 const dates=['2027-02-28','2027-03-01','2027-03-02','2027-03-03','2027-03-04','2027-03-05','2027-03-06'];const rows=await h.f.db.prepare('SELECT scheduled_at FROM reminders ORDER BY scheduled_at').all<{scheduled_at:number}>();expect(rows.results.map(r=>r.scheduled_at)).toEqual(dates.map(d=>Date.parse(d+'T08:00:00+07:00')));
 await h.turn(3,'Co');expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(dates.length);expect(h.inputs).toHaveLength(2);
}
it.each([0,1])('resolves the representative/exact window through the actual service and Co/duplicate: %i',async i=>actualWindow(i));
it('keeps a pending event-date predecessor executable and anchored through the same service',async()=>actualWindow(0,true));
it('leaves the different day-offset/count contract unchanged',()=>{
 for(const c of baseline.cases){const row=c.variants.find(v=>v.id==='dayWindow')!;expect(hash(keyedSmallComparisonSchema(row.input))).toBe(row.schemaSha256);}
});
