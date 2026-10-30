// @vitest-environment node
vi.mock('./context-literal-insertion-wire',async()=> (await import('../../../../../tools/benchmark/wire108-reference-codec.test-support')).wire108ReferenceCodec);
vi.mock('../../../conversation/context-contract/protocol',async()=>{const r=await import('../../../../../tools/benchmark/wire108-protocol.test-support');return {CONTEXT_PROTOCOL_V3:r.wire108ProtocolReference,isContextProtocolV3:r.isWire108ProtocolReference}});
import {expect,it,vi} from 'vitest';
import {ContextInputSchema} from '../../../conversation/context-contract/contracts';
import {serializeContextRequest} from '../../../conversation/context-contract/wire';
import {ConversationInterpretationV3Schema} from '../../../conversation/context-contract/contracts';
import {CONTEXT_PROTOCOL_V3} from '../../../conversation/context-contract/protocol';
import {deriveGenerationFieldCapability} from '../../../conversation/context-contract/field-capability';
import * as selected from './context-order-reference-wire';
import * as kernel from './context-provider-wire';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {createContextContractGateway} from './semantic-gateway';
import {createContextContractProbe} from '../../../../../tools/benchmark/context-contract-probe';
import {frozenContextProposal,encodeFixtureV3} from '../../../../../tools/benchmark/context-pointer-fixtures';
import regressions from '../../../conversation/context-contract/benchmark/regressions.json';
import {PreviewResponseV1Schema} from '../../../../contracts/api/conversation-previews';
import {ReminderListResponseV2Schema} from '../../../../contracts/api/reminders-v2';
const input=ContextInputSchema.parse({schemaVersion:'calenote-context-input-2',reference:{instant:'2026-09-28T03:00:00.000Z',localDate:'2026-09-28',timezone:'Asia/Ho_Chi_Minh'},turns:[{role:'USER',text:'synthetic'}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:'context-capabilities-1',supported:['ONCE','FINITE_DAILY'],unsupported:['YEARLY'],calendars:['GREGORIAN'],limits:{dailyCount:30,horizonDays:366}}});
const fields=['title','location','notes','eventDate','eventTime','reminderDate','reminderTime','calendar','frequency','occurrenceCount','eventRelation','leadOffsetDays','endDate'];
const values:Record<string,unknown>={title:'synthetic',location:'synthetic',notes:'synthetic',eventDate:{kind:'RELATIVE_DAY',offsetDays:2},eventTime:{hour:8,minute:0,qualifier:'H24'},reminderDate:{kind:'RELATIVE_DAY',offsetDays:3},reminderTime:{hour:9,minute:0,qualifier:'H24'},calendar:'GREGORIAN',frequency:'DAILY',occurrenceCount:2,eventRelation:'BEFORE_EVENT',leadOffsetDays:2,endDate:{kind:'RELATIVE_DAY',offsetDays:4}};
function proposal(order=fields,operation='SET',kind='NEW') {const evidence=[{kind:'USER_QUOTE',turn:0,quote:'synthetic',occurrence:1}];return ConversationInterpretationV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind,evidence},changes:order.map(field=>({field,operation,value:operation==='CLEAR'?null:values[field],evidence})),query:null,uncertainties:[],conversationDirective:null,replyProposal:null})}
type Wire=Record<string,unknown>&{orderRefs:Array<string|null>;changes:Array<{change:unknown}>};
const encode=(p=proposal())=>selected.encodeGoogleLiteEuContextV3(p) as Wire;
const decode=(wire:unknown,bound?:typeof input)=>selected.decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,undefined,bound);
function check(bound:typeof input) {const schema=selected.googleLiteEuContextWireSchemaV3(deriveGenerationFieldCapability(bound),bound).schema;const inline=(v:unknown):unknown=>{if(Array.isArray(v))return v.map(inline);if(!v||typeof v!=='object')return v;const n=v as Record<string,unknown>;if(typeof n.$ref==='string')return inline(n.$ref.slice(2).split('/').reduce((p,k)=>(p as Record<string,unknown>)[k],schema as unknown));return Object.fromEntries(Object.entries(n).filter(([k])=>k!=='$defs').map(([k,c])=>[k,inline(c)]))};return z.fromJSONSchema(inline(schema) as Parameters<typeof z.fromJSONSchema>[0])}
it('selected108 request has finite source-derived refs and preserves sparse capacity',()=>{
 const input=ContextInputSchema.parse({schemaVersion:'calenote-context-input-2',reference:{instant:'2026-09-28T03:00:00.000Z',localDate:'2026-09-28',timezone:'Asia/Ho_Chi_Minh'},turns:[{role:'USER',text:'synthetic'}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:'context-capabilities-1',supported:['ONCE'],unsupported:['YEARLY'],calendars:['GREGORIAN'],limits:{dailyCount:30,horizonDays:366}}});
 const schema=serializeContextRequest(input).response_format.json_schema.schema as unknown as {properties:Record<string,unknown>};
 expect(schema.properties.orderRefs).toMatchObject({type:'array',maxItems:13,items:{anyOf:[{type:'string',enum:expect.any(Array)},{type:'null'}]}});
});
it('selected108 pins coherent prompt and preserves exact107 kernel schema/hash',()=>{
 expect(createHash('sha256').update(selected.CONTEXT_ORDER_REFERENCE_PROMPT).digest('hex')).toBe(selected.SELECTED_CONTEXT_PROMPT_SHA256);
 expect(selected.CONTEXT_ORDER_REFERENCE_PROMPT).not.toMatch(/Rank assembly:|carriers=\{rank|ordinary=\{rank/);
 expect(kernel.googleLiteEuContextWireSchemaV3().version).toContain('-107');
 expect(createHash('sha256').update(JSON.stringify(kernel.googleLiteEuContextWireSchemaV3().schema)).digest('hex')).toBe('5aaf9dcab9cc54dad77a60da14f31f986547ba9e4b8ae484bd79b574ca867421');
 expect(selected.googleLiteEuContextWireSchemaV3().version).toContain('-108');
});
it('selected108 all13 fields and all operations retain dense rotations and sparse sole ordinals',()=>{
 for(const kind of ['NEW','CURRENT'])for(const operation of ['SET','REPLACE','CLEAR']){
  for(let rotation=0;rotation<13;rotation++){const p=proposal([...fields.slice(rotation),...fields.slice(0,rotation)],operation,kind);expect(decode(encode(p))).toMatchObject({status:'PARSED',value:{semantic:{changes:p.changes}}})}
  for(const field of fields)for(let rank=0;rank<13;rank++){const p=proposal([field],operation,kind),wire=encode(p);wire.orderRefs=[...Array(rank).fill(null),wire.orderRefs[0]];expect(decode(wire)).toMatchObject({status:'PARSED',value:{semantic:{changes:p.changes}}})}
 }
 const empty=encode(proposal([]));for(const refs of [[],[null],Array(13).fill(null)])expect(decode({...empty,orderRefs:refs}).status).toBe('PARSED');
 const one=encode(proposal(['eventRelation']));expect(decode({...one,orderRefs:[one.orderRefs[0],null,null]}).status).toBe('PARSED');
},30000);
it('selected108 refuses missing duplicate phantom arbitrary and ordinary contradictions without repair',()=>{
 const wire=encode(proposal(['notes','calendar','eventRelation']));
 const bad=[[],['/changes/0','/changes/0','/eventRelationChange'],['/changes/1','/changes/0','/eventRelationChange'],['/changes/0','/changes/1','/eventRelationChange','/titleChange'],['/changes/0','/changes/1','/eventRelationChange','/changes/2'],['/changes/00','/changes/1','/eventRelationChange'],['/query','/changes/1','/eventRelationChange'],['PRIVATE_REFERENCE','/changes/1','/eventRelationChange'],Array(14).fill(null),[0,'/changes/1','/eventRelationChange']];
 for(const orderRefs of bad){const raw={...wire,orderRefs},before=JSON.stringify(raw),diagnostics:unknown[]=[];expect(selected.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe('REFUSED');expect(JSON.stringify(raw)).toBe(before);expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE_REFERENCE')}
 expect(decode({...wire,eventRelationChange:{...(wire.eventRelationChange as object),rank:10}}).status).toBe('REFUSED');
 expect(decode({...wire,changeOrder:['eventRelation','notes','calendar']}).status).toBe('REFUSED');
 const {orderRefs,...missing}=wire;expect(decode(missing).status).toBe('REFUSED');
 const duplicate=structuredClone(wire);duplicate.changes[1]=structuredClone(duplicate.changes[0]);expect(decode(duplicate).status).toBe('REFUSED');
});
it('selected108 guards own-data arrays wrappers payloads and never invokes hostile getters',()=>{
 const wire=encode(proposal(['eventRelation','notes']));let calls=0;
 const cases:unknown[]=[];
 for(const key of ['orderRefs','changes','eventRelationChange']){const raw={...wire};Object.defineProperty(raw,key,{enumerable:true,get(){calls++;throw Error('PRIVATE_GETTER')}});cases.push(raw)}
 const hole=[...wire.orderRefs];delete hole[0];cases.push({...wire,orderRefs:hole});
 const accessor=[...wire.orderRefs];Object.defineProperty(accessor,'0',{enumerable:true,get(){calls++;throw Error('PRIVATE_GETTER')}});cases.push({...wire,orderRefs:accessor});
 const extra=Object.assign([...wire.orderRefs],{extra:1});cases.push({...wire,orderRefs:extra});
 const change=structuredClone(wire.changes[0]) as {change:Record<string,unknown>};Object.defineProperty(change.change,'field',{enumerable:true,get(){calls++;throw Error('PRIVATE_GETTER')}});cases.push({...wire,changes:[change]});
 for(const raw of cases)expect(decode(raw).status).toBe('REFUSED');expect(calls).toBe(0);
});
it('selected108 raw decoded duplicate references refuse and unselected advisory cannot veto valid core',()=>{
 const wire=encode(proposal(['eventRelation'])),json=JSON.stringify(wire);
 for(const key of ['orderRefs','\\u006frderRefs']){const raw=json.slice(0,-1)+`,"${key}":[]}`;expect(selected.validateTypedSingletonCarrierJsonV3(raw,input)).toMatchObject({issues:[{path:['orderRefs'],expected:'ORDER_REFERENCE_JSON',singletonJson:{reason:'DUPLICATE_KEY'}}]})}
 let deep:unknown={bad:true};for(let i=0;i<20;i++)deep={deep};
 for(const guidance of [deep,Array(300).fill('bad')]){const raw={...wire,conversationDirective:guidance,replyProposal:guidance};expect(selected.validateTypedSingletonCarrierJsonV3(JSON.stringify(raw),input)).toBeUndefined();expect(decode(raw).status).toBe('PARSED')}
});
it('selected108 retains required typed date frequency and all forbidden source guards',()=>{
 const text='Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi.',bound=ContextInputSchema.parse({...input,turns:[{role:'USER',text}]}),evidence=[{kind:'USER_QUOTE',turn:0,quote:text,occurrence:1}],p=ConversationInterpretationV3Schema.parse({...proposal([]),requestTarget:{kind:'NEW',evidence},changes:[{field:'title',operation:'SET',value:'đi thi',evidence},{field:'eventDate',operation:'SET',value:{kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null},evidence},{field:'frequency',operation:'SET',value:'DAILY',evidence},{field:'occurrenceCount',operation:'SET',value:2,evidence}]});
 const raw=encodeFixtureV3(p,bound) as Wire,validator=check(bound);expect(validator.safeParse(raw).success).toBe(true);expect(decode(raw,bound).status).toBe('PARSED');
 for(const root of ['titleChange','frequencyChange','occurrenceCountChange']){const bad={...raw,[root]:null};expect(validator.safeParse(bad).success).toBe(false);expect(decode(bad,bound).status).toBe('REFUSED')}
 for(const root of ['eventDateChange','frequencyChange']){const entry=raw[root] as {change:unknown};expect(typeof entry.change).toBe('object');const bad={...raw,[root]:{change:JSON.stringify(entry.change)}};expect(validator.safeParse(bad).success).toBe(false);expect(decode(bad,bound).status).toBe('REFUSED')}
 const schema=selected.googleLiteEuContextWireSchemaV3(deriveGenerationFieldCapability(bound),bound).schema as unknown as {properties:Record<string,{type?:string}>};for(const root of selected.ORDER_REFERENCE_ROOTS_V1)if(schema.properties[root].type==='null'){expect(validator.safeParse({...raw,[root]:{change:'{}'}}).success).toBe(false)}
});
it.each(['valid','phantom','duplicate','missing','ordinary','rawduplicate'] as const)('selected108 HTTP decoder → BE/shared FE API: %s',async mode=>{
 const script=regressions.cases.find(c=>c.id==='R03')!;let calls=0,captured:unknown;
 const config={protocol:CONTEXT_PROTOCOL_V3,maxInputChars:1800,maxInputTokens:12000,maxOutputTokens:1536,maxResponseBytes:32768,timeoutMs:30000,primary:{model:'google/gemini-2.5-flash-lite',provider:'google-vertex/eu',requireZdr:true,promptPriceMicrounitsPerMillionTokens:100000,completionPriceMicrounitsPerMillionTokens:400000}};
 const gateway=createContextContractGateway(config,async request=>{const projected=JSON.parse(request.messages[1].content);for(const key of ['fieldCapability','evidenceSources','numericOwnership'])delete projected[key];const bound=ContextInputSchema.parse(projected),p=ConversationInterpretationV3Schema.parse(frozenContextProposal(bound,'R03',calls++));if(calls===2){const fact=bound.facts.find(f=>f.scope==='REMINDER'&&f.field==='reminderTime')!;p.changes.push({field:'notes',operation:'SET',value:'synthetic',evidence:p.requestTarget!.evidence},{field:'reminderTime',operation:'SET',value:fact.value,evidence:[{kind:'CONTEXT_FACT',ref:fact.alias}]})}const wire=encodeFixtureV3(p,bound) as Wire;let content=JSON.stringify(wire);if(calls===2){if(mode==='phantom')wire.orderRefs.push('/titleChange');if(mode==='duplicate')wire.orderRefs.push(wire.orderRefs[0]);if(mode==='missing')wire.orderRefs.pop();if(mode==='ordinary'){wire.changes.push(structuredClone(wire.changes[0]));wire.orderRefs=['/changes/1','/changes/0',...wire.orderRefs.filter(ref=>ref!=='/changes/0')]}content=JSON.stringify(wire);if(mode==='rawduplicate')content=content.slice(0,-1)+',"\\u006frderRefs":[]}'}return {status:200,body:JSON.stringify({model:request.model,provider:'Google',usage:{cost:0,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content}}]})}}, {status:'OBSERVABLE_CANARY',advertisedContextTokens:1048576});
 const observed:typeof gateway={prepare(tier,bound){const attempt=gateway.prepare(tier,bound);return attempt.status!=='READY'?attempt:{...attempt,dispatch:async()=>{const result=await attempt.dispatch();captured=result;return result}}}};
 const probe=await createContextContractProbe({sourceSha:'997859d689394b4f8ef8c6b7c21f1a4cd9b16e47',referenceNow:Date.parse(script.turns[0].receipt),liveGateway:observed},()=>{throw Error('NO_EXTERNAL_PROVIDER')});
 try{await probe.turn(script.turns[0].text,script.turns[0].receipt);const result=await probe.turn(script.turns[1].text,script.turns[1].receipt);expect(result).toMatchObject({status:mode==='valid'?'DRAFT_CREATED':'REJECTED',fullSchemaValid:mode==='valid',draftRevision:mode==='valid'?2:1,listStoreReads:0,mutations:0});expect(captured).toMatchObject(mode==='valid'?{status:'SUCCESS'}:{status:'FAILURE',category:'SCHEMA_INVALID',canonicalValidationDiagnostics:{state:'WIRE_DECODE_FAILED'}});const readback=await probe.readBack();expect(PreviewResponseV1Schema.safeParse({data:{schemaVersion:'conversation-previews-1',...readback.previews}}).success).toBe(true);expect(ReminderListResponseV2Schema.safeParse({data:readback.reminders}).success).toBe(true)}finally{probe.dispose()}
});
