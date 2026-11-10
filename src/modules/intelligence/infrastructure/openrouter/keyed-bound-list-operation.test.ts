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
import {readListTransport} from '../../../conversation/context-contract/list-period-transport';
import {isCertifiedRetainedListQuestion} from '../../../conversation/context-contract/list-question-certificate';

interface Frame {id:string;eligible:boolean;input:ContextInput;schemaSha256?:string;expectedSchemaSha256?:string;schemaError?:{name:string;messageSha256:string}}
const before=JSON.parse(readFileSync(new URL('./__fixtures__/keyed159-bound-list-before.json',import.meta.url),'utf8')) as {
 input:ContextInput;proposal:unknown;badProposal:unknown;badWire:unknown;cases:Frame[];
};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fresh=()=>ContextInputSchema.parse(structuredClone(before.input));
const envelope=(wire:unknown)=>({status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:0,prompt_tokens:8000,completion_tokens:500},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})});

it('refuses the reconstructed CURRENT operation for a retained-draft list question without repairing it',()=>{
 const input=fresh(),wire=structuredClone(before.badWire),original=JSON.stringify(wire);
 expect(z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(wire).success).toBe(false);
 expect(decodeKeyedSmallComparison(wire,input).status).toBe('REFUSED');expect(JSON.stringify(wire)).toBe(original);
});

it('fails the wrong operation at the selected gateway before the application can stage a preview',async()=>{
 const ready=createKeyedContextContractGateway(async()=>envelope(before.badWire),{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000}).prepare('PRIMARY',fresh());
 expect(ready.status).toBe('READY');if(ready.status!=='READY')throw Error('Expected selected gateway');
 expect(await ready.dispatch()).toMatchObject({status:'FAILURE',category:'SCHEMA_INVALID',usage:{costMicrounits:0}});
});

it.each(before.cases)('changes only the operation domain in the certified scope: $id',row=>{
 const original=JSON.stringify(row.input);
 if(row.schemaError){let caught:unknown;try{keyedSmallComparisonSchema(row.input);}catch(error){caught=error;}
  expect(caught).toBeInstanceOf(Error);expect((caught as Error).name).toBe(row.schemaError.name);expect(hash((caught as Error).message)).toBe(row.schemaError.messageSha256);
 }else expect(hash(keyedSmallComparisonSchema(row.input))).toBe(row.eligible?row.expectedSchemaSha256:row.schemaSha256);
 expect(JSON.stringify(row.input)).toBe(original);
});

it.each(before.cases)('requires complete source eligibility even before transport validation: $id',row=>{
 expect(isCertifiedRetainedListQuestion(row.input)).toBe(row.eligible);
});

it('round-trips the actual frozen LIST proposal with its authored query and evidence intact',()=>{
 const input=fresh(),proposal=ConversationInterpretationV3Schema.parse(before.proposal);
 const decoded=decodeKeyedSmallComparison(encodeKeyedSmallComparison(proposal,input),input);expect(decoded.status).toBe('PARSED');if(decoded.status!=='PARSED')throw Error('Expected parsed LIST transport');
 const data=readListTransport(decoded.value);expect(data.core).toMatchObject({intent:'LIST_REMINDERS',requestTarget:null,changes:[],query:{kind:'LIST',statusScope:'DEFAULT',evidence:proposal.query!.evidence}});
 expect(data.period).toEqual({status:'KNOWN',value:{kind:'MONTH',offset:0}});
});

type Variant='LIST'|'CURRENT'|'NEW'|'HELP'|'WRONG_PERIOD'|'MISSING_RANGE';
async function service(variant:Variant,{keyed=false,resume=false,question=before.input.turns[before.input.currentTurn].text}={}){
 const firstReceipt='2026-09-28T03:00:00.000Z',queryReceipt='2026-09-28T03:01:00.000Z';
 const proposal=(input:ContextInput)=>{
  if(input.currentTurn===0)return ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R11',0));
  if(input.turns[input.currentTurn].text==='Tiếp tục')return ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R11',2));
  const value=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R11',variant==='CURRENT'||variant==='NEW'?2:1));
  if(variant==='NEW')value.requestTarget={kind:'NEW',evidence:value.requestTarget!.evidence};
  if(variant==='HELP'){value.intent='HELP';value.query=null;value.uncertainties=[];}
  if(variant==='WRONG_PERIOD'&&value.query?.kind==='LIST')value.query.period={kind:'MONTH',offset:1};
  if(variant==='MISSING_RANGE'&&value.query?.kind==='LIST'){value.query.period=null;value.uncertainties=[{field:'queryRange',reason:'MISSING',alternatives:[]}];}
  return value;
 };
 const gateway=createKeyedContextContractGateway(async request=>{
  const raw=JSON.parse(request.messages[1].content);for(const key of ['numericOwnership','fieldCapability','evidenceSources'])delete raw[key];const input=ContextInputSchema.parse(raw);
  return envelope(encodeKeyedSmallComparison(proposal(input),input));
 },{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000});
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse(firstReceipt),...(keyed?{liveBudgetProfile:'GPT5_MINI_AZURE_SWEDEN' as const,liveGateway:{...gateway,contextWire:'KEYED_COMPARISON_137' as const}}:{})},proposal);
 try{
  const first=await probe.turn(before.input.turns[0].text,firstReceipt);expect(first.status).toBe('DRAFT_CREATED');
  const result=await probe.turn(question,queryReceipt);
  const resumed=resume?await probe.turn('Tiếp tục','2026-09-28T03:02:00.000Z'):null;
  return {first,result,resumed};
 }finally{probe.dispose();}
}

it.each(['CURRENT','NEW'] as const)('vetoes a canonical %s mutation independently of the provider schema',async variant=>{
 const {result}=await service(variant);
 expect(result.status).toBe('REJECTED');expect(result.draftRevision).toBe(1);expect(result.mutations).toBe(0);
 expect(result.downstreamDiagnostics).toContainEqual({stage:'EVIDENCE',result:'REJECTED',reason:'SEMANTIC_LIST_QUESTION_MUTATION'});
});

it('lists through the actual keyed service without revising the retained draft, then resumes it',async()=>{
 const {first,result,resumed}=await service('LIST',{keyed:true,resume:true});
 expect(result).toMatchObject({status:'REMINDERS_LISTED',apiPreviews:0,draftRevision:1,mutations:0});
 expect(resumed).toMatchObject({status:'DRAFT_CREATED',apiPreviews:1,draftRevision:2,mutations:0});
 expect(resumed!.fields).toEqual(first.fields);
});

it.each(['WRONG_PERIOD','MISSING_RANGE'] as const)('retains deterministic explicit month authority for %s',async variant=>{
 const {result}=await service(variant,{keyed:true});
 expect(result).toMatchObject({status:'REMINDERS_LISTED',apiPreviews:0,draftRevision:1,mutations:0,queryRange:{start:Date.parse('2026-08-31T17:00:00.000Z'),end:Date.parse('2026-09-30T17:00:00.000Z')}});
});

it('keeps the backend veto scoped to mutating interpretations',async()=>{
 const {result}=await service('HELP');expect(result.mutations).toBe(0);
 expect(result.downstreamDiagnostics).toContainEqual({stage:'EVIDENCE',result:'PASS',reason:'NONE'});
});
