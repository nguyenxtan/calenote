// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../../conversation/context-contract/contracts';
import {createContextContractProbe} from '../../../../../tools/benchmark/context-contract-probe';
import {createKeyedContextContractGateway} from './keyed-context-gateway';
import {decodeKeyedSmallComparison,encodeKeyedSmallComparison,keyedSmallComparisonSchema} from './context-provider-keyed-small-wire';
import {isInitialRepeatedTaskTitleRequired} from '../../../conversation/context-contract/repeated-task-title-certificate';
import {buildContextInputV2} from '../../../conversation/context-contract/context';
import {validateEvidenceV3} from '../../../conversation/context-contract/evidence';
import {chat,message,observation} from '../../../conversation/context-contract/context-test-fixtures';
import {SemanticPatchProposalV3Schema} from '../../../conversation/context-contract/contracts';

interface Frame {id:string;eligible:boolean;input:ContextInput;schemaSha256?:string;expectedSchemaSha256?:string;schemaError?:{name:string;messageSha256:string}}
type Wire={changes:{owners:Record<string,Array<{write:Array<{operation:string;value:unknown}>;evidence:string[]}>>}};
const before=JSON.parse(readFileSync(new URL('./__fixtures__/keyed160-repeated-task-title-before.json',import.meta.url),'utf8')) as {input:ContextInput;proposal:unknown;badWire:Wire;cases:Frame[]};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fresh=()=>ContextInputSchema.parse(structuredClone(before.input));
const envelope=(wire:unknown)=>({status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:0,prompt_tokens:9000,completion_tokens:500},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})});
const admission={status:'OBSERVABLE_CANARY',advertisedContextTokens:400000} as const;

it('refuses the retained M02 title omission without repairing the received wire',()=>{
 const input=fresh(),wire=structuredClone(before.badWire),original=JSON.stringify(wire);
 expect(z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(wire).success).toBe(false);
 expect(decodeKeyedSmallComparison(wire,input).status).toBe('REFUSED');expect(JSON.stringify(wire)).toBe(original);
});

it.each(['OMIT','CLEAR','REPLACE','DUPLICATE'] as const)('refuses a named NEW task with title %s',variant=>{
 const input=fresh(),wire=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(before.proposal),input) as Wire;
 if(variant==='OMIT')wire.changes.owners.title=[];
 if(variant==='CLEAR')wire.changes.owners.title[0].write=[];
 if(variant==='REPLACE')wire.changes.owners.title[0].write[0].operation='REPLACE';
 if(variant==='DUPLICATE')wire.changes.owners.title.push(structuredClone(wire.changes.owners.title[0]));
 expect(decodeKeyedSmallComparison(wire,input).status).toBe('REFUSED');
});

it('stops a missing title at the selected gateway before staging an unnecessary question',async()=>{
 const ready=createKeyedContextContractGateway(async()=>envelope(before.badWire),admission).prepare('PRIMARY',fresh());
 expect(ready.status).toBe('READY');if(ready.status!=='READY')throw Error('Expected selected gateway');
 expect(await ready.dispatch()).toMatchObject({status:'FAILURE',category:'SCHEMA_INVALID',usage:{costMicrounits:0}});
});

it.each(before.cases)('restricts only title presence inside the whole-source certificate: $id',row=>{
 const original=JSON.stringify(row.input);
 if(row.schemaError){let caught:unknown;try{keyedSmallComparisonSchema(row.input);}catch(error){caught=error;}
  expect(caught).toBeInstanceOf(Error);expect((caught as Error).name).toBe(row.schemaError.name);expect(hash((caught as Error).message)).toBe(row.schemaError.messageSha256);
 }else expect(hash(keyedSmallComparisonSchema(row.input))).toBe(row.eligible?row.expectedSchemaSha256:row.schemaSha256);
 expect(JSON.stringify(row.input)).toBe(original);
});

it.each(before.cases)('requires fresh complete source eligibility before transport validation: $id',row=>{
 expect(isInitialRepeatedTaskTitleRequired(row.input)).toBe(row.eligible);
});

it('declines missing creation capability and pending questions without borrowing a title',()=>{
 const input=fresh();input.capabilities.supported=input.capabilities.supported.filter(value=>value!=='ONCE');expect(isInitialRepeatedTaskTitleRequired(input)).toBe(false);
 input.capabilities.supported.push('ONCE');input.pendingQuestion={scope:'REMINDER',field:'reminderTime',reason:'MISSING',decisionKind:null,text:'Mấy giờ?'};expect(isInitialRepeatedTaskTitleRequired(input)).toBe(false);
});

it('accepts ordinary case variation while still comparing the two authored actions',()=>{
 const input=fresh();input.turns[0].text='HÔM NAY SỬA XE ĐẠP. ĐẶT 3 THÁNG SAU SỬA LẠI';expect(isInitialRepeatedTaskTitleRequired(input)).toBe(true);
 input.turns[0].text='Hôm nay sửa xe đạp. Đặt 3 tháng sau kiểm tra lại';expect(isInitialRepeatedTaskTitleRequired(input)).toBe(false);
});

it.each(['\u0301','\u0301máy'])('declines an object token without an initial letter: %s',object=>{
 const input=fresh();input.turns[0].text=`Hôm nay sửa ${object}. Đặt 4 tháng sau sửa lại`;
 expect(input.turns[0].text.normalize('NFC')).toBe(input.turns[0].text);
 expect(isInitialRepeatedTaskTitleRequired(input)).toBe(false);
 const schema=keyedSmallComparisonSchema(input) as {properties:{changes:{properties:{owners:{properties:{title:{minItems:number}}}}}}};
 expect(schema.properties.changes.properties.owners.properties.title.minItems??0).toBe(0);
});

it('round-trips the authored task text, operands and evidence unchanged',()=>{
 const input=fresh(),value=ConversationInterpretationV3Schema.parse(before.proposal),original=JSON.stringify(value);
 expect(decodeKeyedSmallComparison(encodeKeyedSmallComparison(value,input),input)).toMatchObject({status:'PARSED',value:{semantic:{changes:value.changes}}});
 expect(JSON.stringify(value)).toBe(original);
});

async function service({wrongMonth=false,confirm=false}={}){
 let calls=0;
 const proposal=()=>{
  const value=ConversationInterpretationV3Schema.parse(before.proposal);
  if(wrongMonth)value.changes.find(c=>c.field==='eventDate')!.value={kind:'RELATIVE_MONTH',offsetMonths:3};
  return value;
 };
 const gateway=createKeyedContextContractGateway(async request=>{
  calls++;const raw=JSON.parse(request.messages[1].content);for(const key of ['fieldCapability','numericOwnership','evidenceSources'])delete raw[key];
  const input=ContextInputSchema.parse(raw);return envelope(encodeKeyedSmallComparison(proposal(),input));
 },admission);
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse(before.input.reference.instant),liveBudgetProfile:'GPT5_MINI_AZURE_SWEDEN',liveGateway:{...gateway,contextWire:'KEYED_COMPARISON_137'}},()=>{throw Error('No offline substitution');});
 try{
  const result=await probe.turn(before.input.turns[0].text,before.input.reference.instant);
  const confirmed=confirm?await probe.turn('Co','2026-11-07T02:01:00.000Z'):null;
  const duplicate=confirm?await probe.turn('Co','2026-11-07T02:02:00.000Z'):null;
  return {result,confirmed,duplicate,calls};
 }finally{probe.dispose();}
}

it('keeps the named task in a seven-date preview and natural confirmation without asking for its name',async()=>{
 const {result,confirmed,duplicate,calls}=await service({confirm:true});
 expect(result).toMatchObject({status:'DRAFT_CREATED',apiPreviews:1,mutations:0,fields:{title:'sửa máy lạnh',eventDate:{kind:'RELATIVE_MONTH',offsetMonths:4},frequency:'DAILY',eventRelation:'BEFORE_EVENT',leadOffsetWeeks:1}});
 expect(confirmed).toMatchObject({status:'CONFIRMED',dispatches:0,mutations:7,childCount:7});expect(duplicate!.childCount).toBe(7);expect(duplicate!.dispatches).toBe(0);expect(calls).toBe(1);
 expect(confirmed!.canonicalReminders).toEqual(['2027-02-28','2027-03-01','2027-03-02','2027-03-03','2027-03-04','2027-03-05','2027-03-06'].map(date=>({title:'sửa máy lạnh',scheduled:date+' 08:00',location:null,notes:null,eventDate:'2027-03-07',eventTime:null,calendar:'GREGORIAN'})));
});

it('rejects an unsupported month at the backend after the keyed schema accepts its representation',async()=>{
 const {result}=await service({wrongMonth:true});expect(result.status).toBe('REJECTED');expect(result.mutations).toBe(0);
 expect(result.downstreamDiagnostics).toContainEqual({stage:'EVIDENCE',result:'REJECTED',reason:'EVIDENCE_INVALID'});
});

it.each(['WRONG_MONTH','WRONG_SOURCE'] as const)('retains exact canonical backend evidence refusal for %s',variant=>{
 const msg={...message(before.input.turns[0].text),receivedAt:Date.parse(before.input.reference.instant)};
 const built=buildContextInputV2({snapshot:null,observation:observation(null,msg),message:msg,context:chat});
 if(built.status!=='READY')throw Error(built.reason);
 const value=ConversationInterpretationV3Schema.parse(before.proposal);
 if(variant==='WRONG_MONTH')value.changes.find(c=>c.field==='eventDate')!.value={kind:'RELATIVE_MONTH',offsetMonths:3};
 else value.changes.find(c=>c.field==='title')!.evidence=[{kind:'USER_QUOTE',turn:0,quote:'mua thuốc',occurrence:1}];
 const semantic=Object.fromEntries(Object.entries(value).filter(([key])=>!['conversationDirective','replyProposal'].includes(key)));
 expect(validateEvidenceV3(SemanticPatchProposalV3Schema.parse(semantic),built)).toEqual({status:'REFUSED',reason:variant==='WRONG_MONTH'?'RELATIVE_MONTH_NOT_SUPPORTED':'EVIDENCE_QUOTE_NOT_FOUND'});
});
