// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../../conversation/context-contract/contracts';
import * as capabilities from '../../../conversation/context-contract/field-capability';
import {supportsEventRelation} from '../../../conversation/context-contract/event-relation-evidence';
import type {SourceEvidence} from '../../../conversation/context-contract/state';
import {createContextContractProbe} from '../../../../../tools/benchmark/context-contract-probe';
import {createKeyedContextContractGateway} from './keyed-context-gateway';
import {decodeKeyedSmallComparison,encodeKeyedSmallComparison,keyedSmallComparisonSchema} from './context-provider-keyed-small-wire';
import {isInitialRepeatedTaskTitleRequired} from '../../../conversation/context-contract/repeated-task-title-certificate';

type Schema={properties:Record<string,Schema>;required?:string[];[key:string]:unknown};
type Wire={changes:{owners:Record<string,unknown[]>};[key:string]:unknown};
interface BeforeCase {id:string;input:ContextInput;eligible:boolean;schemaSha256?:string;schemaError?:{name:string;messageSha256:string}}
const before=JSON.parse(readFileSync(new URL('./__fixtures__/keyed157-initial-relation-before.json',import.meta.url),'utf8')) as {
 baseInput:ContextInput;proposal:unknown;badWire:Wire;cases:BeforeCase[];positive:Array<{id:string;normalizedSchemaSha256:string;uncertaintiesSha256:string}>;
};
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const input=()=>ContextInputSchema.parse(structuredClone(before.baseInput));
const absent=(value:ContextInput)=>{const fn=Reflect.get(capabilities,'isInitialRelationOwnerAbsent');expect(fn).toBeTypeOf('function');return (fn as (i:ContextInput)=>boolean)(value);};
const envelope=(wire:unknown)=>({status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:0,prompt_tokens:8000,completion_tokens:500},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})});
const admission={status:'OBSERVABLE_CANARY',advertisedContextTokens:400000} as const;

// Source161 independently requires a supplied fresh repeated-task title. Keep
// the historical relation fixture unchanged and compare every other byte.
function historicalRelationSchema(value:ContextInput):Schema {
 const schema=structuredClone(keyedSmallComparisonSchema(value)) as Schema;
 if(isInitialRepeatedTaskTitleRequired(value)){
  const title=schema.properties.changes.properties.owners.properties.title;
  expect(title.minItems).toBe(1);delete title.minItems;
 }
 return schema;
}

it('refuses the extra unsupported relation instead of silently stripping the authored field',()=>{
 const value=input(),wire=structuredClone(before.badWire),original=JSON.stringify(wire);
 expect(z.fromJSONSchema(keyedSmallComparisonSchema(value) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(wire).success).toBe(false);
 expect(decodeKeyedSmallComparison(wire,value).status).toBe('REFUSED');
 expect(JSON.stringify(wire)).toBe(original);
});

it('rejects a received unsupported relation at the gateway before semantic application',async()=>{
 const ready=createKeyedContextContractGateway(async()=>envelope(before.badWire),admission).prepare('PRIMARY',input());
 expect(ready.status).toBe('READY');if(ready.status!=='READY')throw Error('Expected selected gateway');
 expect(await ready.dispatch()).toMatchObject({status:'FAILURE',category:'SCHEMA_INVALID',usage:{costMicrounits:0}});
});

it.each(['SET','REPLACE','CLEAR'])('does not expose an ungrounded fresh relation %s',operation=>{
 const value=input(),wire=structuredClone(before.badWire);
 wire.changes.owners.eventRelation=[{write:operation==='CLEAR'?[]:[{operation,value:'INCLUDING_EVENT'}],evidence:['U0']}];
 expect(decodeKeyedSmallComparison(wire,value).status).toBe('REFUSED');
});

it.each(before.cases.filter(row=>row.eligible))('excludes only the relation owner in the proven $id frame',row=>{
 const original=JSON.stringify(row.input);expect(absent(row.input)).toBe(true);expect(JSON.stringify(row.input)).toBe(original);
 const schema=historicalRelationSchema(row.input),owners=schema.properties.changes.properties.owners;
 expect(owners.properties).not.toHaveProperty('eventRelation');expect(owners.required).not.toContain('eventRelation');
 const expected=before.positive.find(p=>p.id===row.id)!;
 expect(hash(schema)).toBe(expected.normalizedSchemaSha256);
 expect(hash(schema.properties.uncertainties)).toBe(expected.uncertaintiesSha256);
});

it.each(before.cases.filter(row=>!row.eligible))('preserves source157 outside the absence certificate: $id',row=>{
 expect(absent(row.input)).toBe(false);
 if(row.schemaError){let error:unknown;try{keyedSmallComparisonSchema(row.input);}catch(e){error=e;}
  expect(error).toBeInstanceOf(Error);expect((error as Error).name).toBe(row.schemaError.name);
  expect(createHash('sha256').update((error as Error).message).digest('hex')).toBe(row.schemaError.messageSha256);
 }else expect(hash(historicalRelationSchema(row.input))).toBe(row.schemaSha256);
});

it('does not grant relation authority to a smaller source quote in the certified initial turn',()=>{
 const text=input().turns[0].text,points=[...text],turn={id:'initial',role:'USER' as const,semanticView:text};
 for(let start=0;start<points.length;start++)for(let end=start+1;end<=points.length;end++){
  const source:SourceEvidence={kind:'USER_QUOTE',sourceTurnId:turn.id,sourceMapTurnId:turn.id,quote:points.slice(start,end).join(''),occurrence:1,sourceSpan:{start,end},viewSpan:{start,end},normalizationVersion:'nfc-codepoint-v1'};
  for(const value of ['BEFORE_EVENT','INCLUDING_EVENT','STARTING_ON'] as const)expect(supportsEventRelation(value,[source],[turn])).toBe(false);
 }
});

it('preserves the model-authored title, history note and month without inserting a relation',()=>{
 const value=input(),proposal=ConversationInterpretationV3Schema.parse(before.proposal),wire=encodeKeyedSmallComparison(proposal,value) as Wire;
 expect(wire.changes.owners).not.toHaveProperty('eventRelation');
 expect(decodeKeyedSmallComparison(wire,value)).toMatchObject({status:'PARSED',value:{semantic:{changes:proposal.changes}}});
});

function requestInput(content:string):ContextInput {
 const raw=JSON.parse(content);for(const key of ['evidenceSources','numericOwnership','fieldCapability'])delete raw[key];return ContextInputSchema.parse(raw);
}
async function runService(wrongMonth=false){
 const gateway=createKeyedContextContractGateway(async request=>{
  const value=requestInput(request.messages[1].content),proposal=ConversationInterpretationV3Schema.parse(before.proposal);
  if(wrongMonth)proposal.changes.find(c=>c.field==='reminderDate')!.value={kind:'RELATIVE_MONTH',offsetMonths:3};
  return envelope(encodeKeyedSmallComparison(proposal,value));
 },admission);
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse(before.baseInput.reference.instant),liveBudgetProfile:'GPT5_MINI_AZURE_SWEDEN',liveGateway:{...gateway,contextWire:'KEYED_COMPARISON_137'}},()=>{throw Error('No offline substitution');});
 try{return await probe.turn(before.baseInput.turns[0].text,before.baseInput.reference.instant);}finally{probe.dispose();}
}

it('still asks for the missing clock through the real service without saving',async()=>{
 const result=await runService();
 expect(result).toMatchObject({status:'CLARIFICATION_REQUESTED',pendingField:'reminderTime',fields:{title:'sửa lại máy lạnh',notes:'Hôm nay sửa máy lạnh.',reminderDate:{kind:'RELATIVE_MONTH',offsetMonths:4},eventRelation:null},mutations:0});
});

it('keeps backend evidence validation for a wrong model-authored month',async()=>{
 const result=await runService(true);expect(result.status).toBe('REJECTED');expect(result.mutations).toBe(0);
});
