// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../../conversation/context-contract/contracts';
import {frozenContextProposal} from '../../../../../tools/benchmark/context-contract-fixtures';
import {createContextContractProbe} from '../../../../../tools/benchmark/context-contract-probe';
import {decodeKeyedSmallComparison,encodeKeyedSmallComparison,keyedSmallComparisonSchema} from './context-provider-keyed-small-wire';
import {createKeyedContextContractGateway} from './keyed-context-gateway';
import {keyedInitialEventOperationRequired} from './context-keyed-initial-event-operation';

const text='Tôi thi ngày 11/10 lúc 8h.',receipt='2026-09-28T03:03:00Z';
function fresh():ContextInput {
 const source=JSON.parse(readFileSync(new URL('./__fixtures__/keyed146-r04-clock-omission-before.json',import.meta.url),'utf8')).input;
 return ContextInputSchema.parse({...source,reference:{...source.reference,instant:receipt,localDate:'2026-09-28'},turns:[{role:'USER',text}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[]});
}
function unknownAction(input:ContextInput){
 const good=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R04',3)),input) as Record<string,unknown>;
 return {...good,operation:{code:'UNKNOWN_ACTION_NEW_TARGET',targetEvidence:['U0'],operationUncertainties:[{reason:'AMBIGUOUS',alternatives:[{value:'CURRENT',evidence:['U0']},{value:'NEW',evidence:['U0']}]}],controlUncertainties:[]}};
}
const envelope=(wire:unknown)=>({status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:0,prompt_tokens:8000,completion_tokens:500},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})});
function requestInput(content:string):ContextInput {
 const raw=JSON.parse(content);delete raw.evidenceSources;delete raw.numericOwnership;delete raw.fieldCapability;
 return ContextInputSchema.parse(raw);
}

it('refuses invented operation ambiguity for the complete fresh first-person event announcement',async()=>{
 const input=fresh(),wire=unknownAction(input),before=JSON.stringify(wire);
 expect(z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(wire).success).toBe(false);
 expect(decodeKeyedSmallComparison(wire,input).status).toBe('REFUSED');
 const ready=createKeyedContextContractGateway(async()=>envelope(wire),{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000}).prepare('PRIMARY',input);
 if(ready.status!=='READY')throw Error('Expected selected gateway');
 expect(await ready.dispatch()).toMatchObject({status:'FAILURE',category:'SCHEMA_INVALID',usage:{costMicrounits:0}});
 expect(JSON.stringify(wire)).toBe(before);
});

it('preserves correct new-reminder values and asks for the notification clock through the actual service',async()=>{
 const factory=createKeyedContextContractGateway(async request=>{
  const input=requestInput(request.messages[1].content);
  return envelope(encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R04',3)),input));
 },{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000});
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse(receipt),liveBudgetProfile:'GPT5_MINI_AZURE_SWEDEN',liveGateway:{...factory,contextWire:'KEYED_COMPARISON_137'}},()=>{throw Error('Unexpected offline substitution');});
 try{
  const actual=await probe.turn(text,receipt);
  expect(actual).toMatchObject({status:'CLARIFICATION_REQUESTED',pendingField:'reminderTime',draftRevision:1,fields:{title:'đi thi',eventDate:{kind:'CIVIL_DATE',day:11,month:10,year:null},eventTime:{hour:8,minute:0,qualifier:'H24'}}});
  expect(actual.mutations).toBe(0);
 }finally{probe.dispose();}
});

it('rejects the ambiguous proposal before it can stage the observed operation question',async()=>{
 const factory=createKeyedContextContractGateway(async request=>envelope(unknownAction(requestInput(request.messages[1].content))),{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000});
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse(receipt),liveBudgetProfile:'GPT5_MINI_AZURE_SWEDEN',liveGateway:{...factory,contextWire:'KEYED_COMPARISON_137'}},()=>{throw Error('Unexpected offline substitution');});
 try{
  const actual=await probe.turn(text,receipt);
  expect(actual.status).toBe('REJECTED');
  expect(actual.pendingField).toBeNull();
  expect(actual.mutations).toBe(0);
 }finally{probe.dispose();}
});

it.each(['Tôi thi ngày 11/10 lúc 8h.','tôi thi ngày 11/10 lúc 9h.','Em thi ngày 03/04/2027 lúc 17:45!','em thi ngày 11/10 lúc 0h.'])('admits only a new reminder operation for the closed fresh source: %s',source=>{
 const input=fresh();input.turns[0].text=source;const before=JSON.stringify(input);
 expect(keyedInitialEventOperationRequired(input)).toBe(true);
 const schema=keyedSmallComparisonSchema(input) as {properties:{operation:{anyOf:Array<{properties:{code:{enum:string[]}}}>}}};
 expect([...new Set(schema.properties.operation.anyOf.flatMap(branch=>branch.properties.code.enum))]).toEqual(['START_NEW_REMINDER']);
 expect(JSON.stringify(input)).toBe(before);
});

it.each([
 '“Tôi thi ngày 11/10 lúc 8h.”','"Tôi thi ngày 11/10 lúc 8h."','Không, tôi thi ngày 11/10 lúc 8h.',
 'Nếu tôi thi ngày 11/10 lúc 8h.','Tôi thi ngày 11/10 lúc 8h?','Tôi thi ngày 11/10 lúc 8h hoặc 9h.',
 'Tôi thi ngày 11/10 lúc 8h. Nhắc gọi mẹ.','Ghi chú: Tôi thi ngày 11/10 lúc 8h.',
 'Tên việc là Tôi thi ngày 11/10 lúc 8h.','Tôi thi ngày 11/10 lúc 8h và xóa lịch cũ.',
 'tôi thi ngày 11-10 lúc 08:30 sáng.','Tôi thi ngày 11/10 lúc 25h.','Tôi thi ngày 11/10 lúc 8h60.','Tôi thi ngày 11/10.',
 'Bạn thi ngày 11/10 lúc 8h.','Tôi thi\nngày 11/10 lúc 8h.','Tôi thi ngày 11/10 lúc 8h.\n',
])('leaves unclear, quoted or out-of-grammar content to ordinary interpretation: %s',source=>{
 const input=fresh();input.turns[0].text=source;expect(keyedInitialEventOperationRequired(input)).toBe(false);
});

it('does not impose a fresh action on retained context, history, facts, pending questions or ambiguities',()=>{
 const retained=ContextInputSchema.parse(JSON.parse(readFileSync(new URL('./__fixtures__/keyed146-r04-clock-omission-before.json',import.meta.url),'utf8')).input);
 const candidates=[{...fresh(),activeRequest:retained.activeRequest},{...fresh(),facts:retained.facts},{...fresh(),pendingQuestion:retained.pendingQuestion},
  {...fresh(),turns:[{role:'USER' as const,text:'Tiếp tục.'},{role:'USER' as const,text}],currentTurn:1},
  {...fresh(),ambiguities:[{field:'operation' as const,reason:'AMBIGUOUS' as const,alternatives:[]}]}];
 expect(retained.facts.length).toBeGreaterThan(0);expect(retained.pendingQuestion).not.toBeNull();
 for(const input of candidates)expect(keyedInitialEventOperationRequired(input)).toBe(false);
});

it('retains backend source validation for a model-authored wrong event day',async()=>{
 const factory=createKeyedContextContractGateway(async request=>{
  const input=requestInput(request.messages[1].content),canonical=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R04',3));
  const date=canonical.changes.find(change=>change.field==='eventDate')!;date.value={kind:'CIVIL_DATE',calendar:'GREGORIAN',day:12,month:10,year:null,leapMonth:null};
  return envelope(encodeKeyedSmallComparison(canonical,input));
 },{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000});
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse(receipt),liveBudgetProfile:'GPT5_MINI_AZURE_SWEDEN',liveGateway:{...factory,contextWire:'KEYED_COMPARISON_137'}},()=>{throw Error('Unexpected offline substitution');});
 try{
  const actual=await probe.turn(text,receipt);
  expect(actual.status).toBe('REJECTED');expect(actual.mutations).toBe(0);
  expect(actual.downstreamDiagnostics).toContainEqual({stage:'EVIDENCE',result:'REJECTED',reason:'CIVIL_DATE_SOURCE_MISMATCH'});
 }finally{probe.dispose();}
});

it('does not offer replacement or CLEAR writes when the known new request has no prior values',()=>{
 const input=fresh(),good=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R04',3)),input) as {changes:{owners:Record<string,Array<{write:Array<{operation:string;value:unknown}>;evidence:string[]}>>}};
 const schema=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);
 const replacement=structuredClone(good);replacement.changes.owners.eventDate[0].write[0].operation='REPLACE';
 expect(schema.safeParse(replacement).success).toBe(false);
 expect(decodeKeyedSmallComparison(replacement,input).status).toBe('REFUSED');
 const clear=structuredClone(good);clear.changes.owners.location=[{write:[],evidence:['U0']}];
 expect(schema.safeParse(clear).success).toBe(false);
 expect(schema.safeParse(good).success).toBe(true);
});

it('limits the fresh-NEW schema delta to SET operations and nonempty authored writes',()=>{
 const baseline=JSON.parse(readFileSync(new URL('./__fixtures__/keyed152-initial-event-schema-before.json',import.meta.url),'utf8'));
 const schema=structuredClone(keyedSmallComparisonSchema(ContextInputSchema.parse(baseline.input))) as {properties:{changes:{properties:{owners:{properties:Record<string,{maxItems?:number;items?:{anyOf?:Array<{properties:{write:{minItems?:number;items:{properties:{operation:{enum?:string[]}}}}}}>};}>}}}}};
 for(const owner of Object.values(schema.properties.changes.properties.owners.properties)){
  if(owner.maxItems===0)continue;
  for(const row of owner.items!.anyOf??[owner.items!]){
   const write=(row as {properties:{write:{minItems?:number;items:{properties:{operation:{enum?:string[]}}}}}}).properties.write;
   expect(write.minItems).toBe(1);expect(write.items.properties.operation.enum).toEqual(['SET']);
   delete write.minItems;delete write.items.properties.operation.enum;
  }
 }
 expect(createHash('sha256').update(JSON.stringify(schema)).digest('hex')).toBe(baseline.normalizedSchemaSha256);
});
