// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../../conversation/context-contract/contracts';
import {createContextContractProbe} from '../../../../../tools/benchmark/context-contract-probe';
import {frozenContextProposal} from '../../../../../tools/benchmark/context-contract-fixtures';
import {createKeyedContextContractGateway} from './keyed-context-gateway';
import {decodeKeyedSmallComparison,encodeKeyedSmallComparison,keyedSmallComparisonSchema} from './context-provider-keyed-small-wire';
import {UNCERTAINTY_FIELD_WIRE_CODE_V3} from './context-provider-wire';

const sample=()=>ContextInputSchema.parse(JSON.parse(readFileSync(new URL('./__fixtures__/keyed137-r07-turn0-before.json',import.meta.url),'utf8')).input);
type Wire={changes:{owners:Record<string,Array<{write:Array<{operation:string;value:unknown}>;evidence:string[]}>>};uncertainties:unknown[]};
type Schema={properties?:Record<string,Schema>;items?:Schema;anyOf?:Schema[];enum?:unknown[];required?:string[];minItems?:number;maxItems?:number;[key:string]:unknown};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface BaselineCase {id:string;group:string;input:ContextInput;inputSchemaValid:boolean;schemaSha256?:string;schemaError?:{name:string;messageSha256:string};normalizedRoleSchemaSha256?:string;eventValueSchemaSha256?:string}
const baseline=JSON.parse(readFileSync(new URL('./__fixtures__/keyed155-material-role-before.json',import.meta.url),'utf8')) as {cases:BaselineCase[];outsideFamilyFour:Array<{fixture:string;turn:number;input:ContextInput;requestSha256:string}>};
const authored=(input:ContextInput)=>ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R07',0));
const encoded=()=>{const input=sample();return {input,wire:encodeKeyedSmallComparison(authored(input),input) as Wire};};
const producer=(input:ContextInput)=>z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);

it('refuses the observed date-owner swap without repairing a received proposal',()=>{
 const {input,wire}=encoded();wire.changes.owners.reminderDate=structuredClone(wire.changes.owners.eventDate);wire.changes.owners.eventDate=[];
 const before=JSON.stringify(wire);expect(producer(input).safeParse(wire).success).toBe(false);
 expect(decodeKeyedSmallComparison(wire,input).status).toBe('REFUSED');expect(JSON.stringify(wire)).toBe(before);
 const wrong=authored(input);wrong.changes=wrong.changes.map(change=>change.field==='eventDate'?{...change,field:'reminderDate'}:change);
 expect(()=>encodeKeyedSmallComparison(wrong,input)).toThrow();
});

it.each(['OMIT','CLEAR','REPLACE'])('requires an authored event date SET rather than %s',variant=>{
 const {input,wire}=encoded();
 if(variant==='OMIT')wire.changes.owners.eventDate=[];
 else if(variant==='CLEAR')wire.changes.owners.eventDate[0].write=[];
 else wire.changes.owners.eventDate[0].write[0].operation='REPLACE';
 expect(producer(input).safeParse(wire).success).toBe(false);expect(decodeKeyedSmallComparison(wire,input).status).toBe('REFUSED');
});

it('excludes reminder-date alternatives while keeping notes and other owner languages',()=>{
 const {input,wire}=encoded(),schema=keyedSmallComparisonSchema(input) as Schema;
 const owners=schema.properties!.changes.properties!.owners.properties!,event=owners.eventDate;
 expect(owners).not.toHaveProperty('reminderDate');expect(owners).toHaveProperty('notes');expect(owners).toHaveProperty('location');
 expect(event.minItems).toBe(1);expect(event.maxItems).toBe(1);
 for(const row of event.items!.anyOf??[event.items!]){expect(row.properties!.write.minItems).toBe(1);expect(row.properties!.write.items!.properties!.operation.enum).toEqual(['SET']);expect(row.properties!.evidence.items!.enum).toEqual(['U0']);}
 const issue={fieldCode:UNCERTAINTY_FIELD_WIRE_CODE_V3.reminderDate,reason:'AMBIGUOUS',alternatives:[{value:structuredClone(wire.changes.owners.eventDate[0].write[0].value),evidence:['U0']}]};
 wire.uncertainties=[issue];expect(producer(input).safeParse(wire).success).toBe(false);expect(decodeKeyedSmallComparison(wire,input).status).toBe('REFUSED');
});

it('preserves every model-authored date, location and note and the full evidence source',()=>{
 const input=sample(),proposal=authored(input),before=JSON.stringify(proposal),wire=encodeKeyedSmallComparison(proposal,input);
 expect(decodeKeyedSmallComparison(wire,input)).toMatchObject({status:'PARSED',value:{semantic:{changes:proposal.changes}}});expect(JSON.stringify(proposal)).toBe(before);
 expect(proposal.changes).toEqual(expect.arrayContaining([expect.objectContaining({field:'notes',value:'nhớ mang giấy tờ'}),expect.objectContaining({field:'location',value:'Quang Trung'})]));
});

it.each(baseline.cases.filter((c:{group:string})=>c.group==='EXISTING_MATERIAL_PRIMARY_POSITIVE'))('changes only the proven date-role permissions for $id',row=>{
 const input=ContextInputSchema.parse(row.input),schema=structuredClone(keyedSmallComparisonSchema(input)) as Schema,owners=schema.properties!.changes.properties!.owners;
 const event=owners.properties!.eventDate;
 for(const branch of event.items!.anyOf??[event.items!]){
  expect(branch.properties!.write.minItems).toBe(1);expect(branch.properties!.write.items!.properties!.operation.enum).toEqual(['SET']);
  expect(hash(branch.properties!.write.items!.properties!.value)).toBe(row.eventValueSchemaSha256);
 }
 expect(event.minItems).toBe(1);expect(event.maxItems).toBe(1);expect(owners.properties).not.toHaveProperty('reminderDate');
 for(const field of ['eventDate','reminderDate'])delete owners.properties![field];owners.required=owners.required!.filter(f=>!['eventDate','reminderDate'].includes(f));
 const issues=schema.properties!.uncertainties;if(issues.items?.anyOf)issues.items.anyOf=issues.items.anyOf.filter(r=>!r.properties!.fieldCode.enum!.includes(UNCERTAINTY_FIELD_WIRE_CODE_V3.reminderDate));
 expect(hash(schema)).toBe(row.normalizedRoleSchemaSha256);
});

it.each(baseline.cases.filter((c:{group:string})=>c.group==='DECLINE_PROPOSED_156_OBLIGATION'))('retains the source155 schema outside the proven role frame: $id',row=>{
 if(row.schemaError){
  let failure:unknown;try{keyedSmallComparisonSchema(row.input);}catch(error){failure=error;}
  expect(failure).toBeInstanceOf(Error);expect((failure as Error).name).toBe(row.schemaError.name);
  expect(createHash('sha256').update((failure as Error).message).digest('hex')).toBe(row.schemaError.messageSha256);
 }else expect(hash(keyedSmallComparisonSchema(row.input))).toBe(row.schemaSha256);
});

it.each(baseline.outsideFamilyFour)('preserves the outside-family request bytes for $fixture/$turn',async row=>{
 let emitted:unknown;const gateway=createKeyedContextContractGateway(async request=>{emitted=request;return{status:503,body:'{}'};},{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000});
 const ready=gateway.prepare('PRIMARY',ContextInputSchema.parse(row.input));if(ready.status!=='READY')throw Error('Expected READY');await ready.dispatch();expect(hash(emitted)).toBe(row.requestSha256);
});

function requestInput(content:string):ContextInput {const raw=JSON.parse(content);delete raw.evidenceSources;delete raw.numericOwnership;delete raw.fieldCapability;return ContextInputSchema.parse(raw);}
const envelope=(wire:unknown)=>({status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:0,prompt_tokens:9000,completion_tokens:500},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})});

it('retains the event, notes and venue through the real R07 follow-ups and natural confirmation',async()=>{
 const script=JSON.parse(readFileSync(new URL('../../../conversation/context-contract/benchmark/regressions.json',import.meta.url),'utf8')).cases.find((c:{id:string})=>c.id==='R07');let step=0,calls=0;
 const gateway=createKeyedContextContractGateway(async request=>{calls++;const input=requestInput(request.messages[1].content),proposal=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R07',step));return envelope(encodeKeyedSmallComparison(proposal,input));},{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000});
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse(script.turns[0].receipt),liveBudgetProfile:'GPT5_MINI_AZURE_SWEDEN',liveGateway:{...gateway,contextWire:'KEYED_COMPARISON_137'}},()=>{throw Error('Unexpected offline substitution');});
 try{
  for(;step<script.turns.length;step++){
   const actual=await probe.turn(script.turns[step].text,script.turns[step].receipt);
   expect(actual.fields).toMatchObject({eventDate:{kind:'CIVIL_DATE',day:11,month:10,year:null},reminderDate:null,notes:'nhớ mang giấy tờ',location:'Quang Trung'});
  }
  const confirmed=await probe.turn('Co','2026-09-28T03:04:00Z');
  expect(confirmed).toMatchObject({status:'CONFIRMED',dispatches:0,mutations:2,childCount:2});expect(calls).toBe(4);
  expect(confirmed.canonicalReminders).toEqual(['2026-10-09 09:00','2026-10-10 09:00'].map(scheduled=>({title:'đi thi',scheduled,location:'Quang Trung',notes:'nhớ mang giấy tờ',eventDate:'2026-10-11',eventTime:null,calendar:'GREGORIAN'})));
  const duplicate=await probe.turn('Co','2026-09-28T03:05:00Z');expect(duplicate.childCount).toBe(2);expect(duplicate.dispatches).toBe(0);expect(calls).toBe(4);
 }finally{probe.dispose();}
});

it('leaves a model-authored unsupported event day to the unchanged backend evidence check',async()=>{
 const input=sample(),wrong=authored(input),date=wrong.changes.find(c=>c.field==='eventDate')!;if(date.operation==='CLEAR')throw Error('date');date.value={kind:'CIVIL_DATE',calendar:'GREGORIAN',day:12,month:10,year:null,leapMonth:null};
 const wire=encodeKeyedSmallComparison(wrong,input);expect(decodeKeyedSmallComparison(wire,input).status).toBe('PARSED');
 const gateway=createKeyedContextContractGateway(async()=>envelope(wire),{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000});
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse(input.reference.instant),liveBudgetProfile:'GPT5_MINI_AZURE_SWEDEN',liveGateway:{...gateway,contextWire:'KEYED_COMPARISON_137'}},()=>{throw Error('Unexpected offline substitution');});
 try{const actual=await probe.turn(input.turns[0].text,input.reference.instant);expect(actual.status).toBe('REJECTED');expect(actual.mutations).toBe(0);expect(actual.downstreamDiagnostics).toContainEqual({stage:'EVIDENCE',result:'REJECTED',reason:'CIVIL_DATE_SOURCE_MISMATCH'});}finally{probe.dispose();}
});
