// @vitest-environment node
import {expect,it} from 'vitest';
import {ContextInputSchema,ConversationInterpretationV3Schema} from '../../../conversation/context-contract/contracts';
import {serializeContextRequest} from '../../../conversation/context-contract/wire';
import {CONTEXT_PROTOCOL_V3} from '../../../conversation/context-contract/protocol';
const input=ContextInputSchema.parse({schemaVersion:'calenote-context-input-2',reference:{instant:'2026-09-28T03:00:00.000Z',localDate:'2026-09-28',timezone:'Asia/Ho_Chi_Minh'},turns:[{role:'USER',text:'synthetic'}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:'context-capabilities-1',supported:['ONCE','FINITE_DAILY'],unsupported:['YEARLY'],calendars:['GREGORIAN'],limits:{dailyCount:30,horizonDays:366}}});
const p=ConversationInterpretationV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence:[{kind:'USER_QUOTE',turn:0,quote:'synthetic',occurrence:1}]},changes:[{field:'title',operation:'SET',value:'synthetic',evidence:[{kind:'USER_QUOTE',turn:0,quote:'synthetic',occurrence:1}]}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
it('selected109 mandatory placement controls intrinsically cover every active payload',()=>{
 const schema=serializeContextRequest(input).response_format.json_schema.schema as unknown as {properties:Record<string,unknown>};
 expect(schema.properties).toHaveProperty('placements');expect(schema.properties).not.toHaveProperty('orderRefs');
 const wire=installed.encodeGoogleLiteEuContextV3(p) as Record<string,unknown>;
 expect(wire).toHaveProperty('placements');expect(wire).not.toHaveProperty('orderRefs');
 expect(installed.decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:'PARSED',value:{semantic:{changes:p.changes}}});
});
import {createHash} from 'node:crypto';
import * as installed from './context-literal-insertion-wire';
import * as reference108 from './context-order-reference-wire';
import {z} from 'zod';
import {deriveGenerationFieldCapability} from '../../../conversation/context-contract/field-capability';
import {createContextContractGateway} from './semantic-gateway';
import {createContextContractProbe} from '../../../../../tools/benchmark/context-contract-probe';
import {frozenContextProposal,encodeFixtureV3} from '../../../../../tools/benchmark/context-pointer-fixtures';
import regressions from '../../../conversation/context-contract/benchmark/regressions.json';
import {PreviewResponseV1Schema} from '../../../../contracts/api/conversation-previews';
import {ReminderListResponseV2Schema} from '../../../../contracts/api/reminders-v2';
const hash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const fields=['title','location','notes','eventDate','eventTime','reminderDate','reminderTime','calendar','frequency','occurrenceCount','eventRelation','leadOffsetDays','endDate'];
const values:Record<string,unknown>={title:'synthetic',location:'synthetic',notes:'synthetic',eventDate:{kind:'RELATIVE_DAY',offsetDays:2},eventTime:{hour:8,minute:0,qualifier:'H24'},reminderDate:{kind:'RELATIVE_DAY',offsetDays:3},reminderTime:{hour:9,minute:0,qualifier:'H24'},calendar:'GREGORIAN',frequency:'DAILY',occurrenceCount:2,eventRelation:'BEFORE_EVENT',leadOffsetDays:2,endDate:{kind:'RELATIVE_DAY',offsetDays:4}};
function proposal(order=fields,operation='SET',kind='NEW'){const evidence=[{kind:'USER_QUOTE',turn:0,quote:'synthetic',occurrence:1}];return ConversationInterpretationV3Schema.parse({...p,requestTarget:{kind,evidence},changes:order.map(field=>({field,operation,value:operation==='CLEAR'?null:values[field],evidence}))})}
const encode=(value=proposal())=>installed.encodeGoogleLiteEuContextV3(value) as Record<string,unknown>&{placements:Record<string,unknown>;changes:unknown[]};
const decode=(raw:unknown)=>installed.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3);
it('selected109 pins minimal prompt while historical108 and107 hashes remain exact',()=>{
 expect(hash(installed.CONTEXT_ORDER_REFERENCE_PROMPT)).toBe(installed.SELECTED_CONTEXT_PROMPT_SHA256);expect(hash(installed.googleLiteEuContextWireSchemaV3().schema)).toBe(installed.SELECTED_CONTEXT_SCHEMA_SHA256);
 expect(hash(reference108.CONTEXT_ORDER_REFERENCE_PROMPT)).toBe('e39d325baa8571f416d51788e4957f0361cd22209866eb50ffeeae8cbd09ecbc');expect(hash(reference108.googleLiteEuContextWireSchemaV3().schema)).toBe('7b7d433b2b12ee59157dedd8d497b3d1baa85a9d5e20a2ba9a07d211aae11ecf');
 expect(installed.googleLiteEuContextWireSchemaV3().version).toContain('-112');expect(hash(installed.CONTEXT_ORDER_REFERENCE_PROMPT_REFERENCE110)).toBe('c26c415a3da2f93ef89ec88f54bb4d3a828e31a69a28fbe170224b1b4aa9f6ff');expect(hash(installed.googleLiteEuContextWireSchemaReference110().schema)).toBe('c46b312032b1be152ed3aef6b26f88e14eae404fa923312db20ae1c708d161e4');
});
it('selected109 all13 changes preserve rotations operations and sparse ordinal identity',()=>{
 for(const kind of ['NEW','CURRENT'])for(const operation of ['SET','REPLACE','CLEAR'])for(let rotation=0;rotation<13;rotation++){const value=proposal([...fields.slice(rotation),...fields.slice(0,rotation)],operation,kind);expect(decode(encode(value))).toMatchObject({status:'PARSED',value:{semantic:{changes:value.changes}}})}
 for(const field of fields)for(let rank=0;rank<13;rank++){const value=proposal([field]),wire=encode(value),active=installed.literalInsertionOwnerOrder(wire.placements)[0],inactive=installed.LITERAL_INSERTION_OWNERS.filter(owner=>owner!==active),target=[...inactive.slice(0,rank),active,...inactive.slice(rank)];wire.placements=installed.literalInsertionControlsForOrder(target);const decoded=decode(wire);expect(decoded).toMatchObject({status:'PARSED',value:{semantic:{changes:value.changes}}});expect(installed.literalInsertionOwnerOrder(wire.placements).indexOf(active)).toBe(rank)}
 expect(decode(encode(proposal([]))).status).toBe('PARSED');
},30000);
it('selected109 refuses missing phantom illegal controls and legacy refs; never invokes getters',()=>{
 let reads=0;for(const mutate of [(w:ReturnType<typeof encode>)=>delete w.placements.title,(w:ReturnType<typeof encode>)=>w.placements.extra='END',(w:ReturnType<typeof encode>)=>w.placements.title='title',(w:ReturnType<typeof encode>)=>w.placements.title='ordinary2',(w:ReturnType<typeof encode>)=>w.placements.title=0,(w:ReturnType<typeof encode>)=>w.orderRefs=[],(w:ReturnType<typeof encode>)=>delete w.titleChange,(w:ReturnType<typeof encode>)=>delete w.changes[1],(w:ReturnType<typeof encode>)=>w.changes[1]=w.changes[0],(w:ReturnType<typeof encode>)=>w.phantomChange={change:{}},(w:ReturnType<typeof encode>)=>Object.defineProperty(w.placements,'title',{get(){reads++;return 'END'}}),(w:ReturnType<typeof encode>)=>Object.defineProperty(w,'placements',{get(){reads++;return {}}})]){const wire=encode();mutate(wire);expect(decode(wire).status).toBe('REFUSED')}expect(reads).toBe(0);
 const wire=encode();wire.placements.ordinary1='ordinary0';expect(decode(wire).status).toBe('REFUSED');
 expect(decode(reference108.encodeGoogleLiteEuContextV3(proposal())).status).toBe('REFUSED');
});
it('selected109 native raw guard detects escaped duplicate controls original-byte overflow and quarantines guidance',()=>{
 const wire=encode(p),raw=JSON.stringify(wire);expect(installed.validateTypedSingletonCarrierJsonV3(raw,input)).toBeUndefined();
 for(const key of ['placements','\\u0070lacements'])expect(installed.validateTypedSingletonCarrierJsonV3(raw.slice(0,-1)+`,"${key}":{}}`,input)).toMatchObject({issues:[{path:['placements']}]});
 const repeated=raw.replace('"title":"END"','"title":"END","\\u0074itle":"END"');expect(installed.validateTypedSingletonCarrierJsonV3(repeated,input)).toMatchObject({issues:[{path:['placements']}]});
 expect(installed.validateTypedSingletonCarrierJsonV3(raw+' '.repeat(32769-Buffer.byteLength(raw)),input)).toBeDefined();
 const guidance=JSON.stringify({...wire,replyProposal:{nested:{a:1}}}).replace('"a":1','"a":1,"\\u0061":2');expect(installed.validateTypedSingletonCarrierJsonV3(guidance,input)).toBeUndefined();
});
it('selected110 adds only certified operation MISSING bound and order transport; source roots remain strict',()=>{
 const bound=ContextInputSchema.parse({...input,turns:[{role:'USER',text:regressions.cases.find(c=>c.id==='R02')!.turns[0].text}]});
 const old=reference108.googleLiteEuContextWireSchemaV3(deriveGenerationFieldCapability(bound),bound).schema,newSchema=installed.googleLiteEuContextWireSchemaV3(deriveGenerationFieldCapability(bound),bound).schema;
 const strip=(schema:typeof old,key:string)=>{const result=structuredClone(schema);delete result.properties![key];result.required=result.required!.filter(k=>k!==key);return result};const normalized=strip(installed.googleLiteEuContextWireSchemaReference110(deriveGenerationFieldCapability(bound),bound).schema,'placements');const items=(normalized.properties!.uncertainties as {items:{anyOf:Array<{properties:{reason:{enum:string[]};fieldCode:{maximum:number}}}>}}).items;const missing=items.anyOf.find(branch=>branch.properties.reason.enum.join('|')==='MISSING')!;expect(missing.properties.fieldCode.maximum).toBe(14);missing.properties.fieldCode.maximum=15;expect(normalized).toEqual(strip(old,'orderRefs'));
 const inline=(v:unknown):unknown=>Array.isArray(v)?v.map(inline):!v||typeof v!=='object'?v:typeof (v as {$ref?:string}).$ref==='string'?inline((v as {$ref:string}).$ref.slice(2).split('/').reduce((n,k)=>(n as Record<string,unknown>)[k],newSchema as unknown)):Object.fromEntries(Object.entries(v).filter(([k])=>k!=='$defs').map(([k,c])=>[k,inline(c)]));const check=z.fromJSONSchema(inline(newSchema) as Parameters<typeof z.fromJSONSchema>[0]);
 const wire=encodeFixtureV3(frozenContextProposal(bound,'R02',0),bound) as Record<string,unknown>;expect(check.safeParse(wire).success).toBe(true);expect(check.safeParse({...wire,titleChange:null}).success).toBe(false);expect(check.safeParse({...wire,reminderTimeChange:{change:{}}}).success).toBe(false);
});
const config={protocol:CONTEXT_PROTOCOL_V3,maxInputChars:1800,maxInputTokens:12000,maxOutputTokens:1536,maxResponseBytes:32768,timeoutMs:30000,primary:{model:'google/gemini-2.5-flash-lite',provider:'google-vertex/eu',requireZdr:true,promptPriceMicrounitsPerMillionTokens:100000,completionPriceMicrounitsPerMillionTokens:400000}};
it.each(['valid','missing-control','raw-duplicate','raw-uncertainty-duplicate','usage-over-cap'] as const)('actual109 BE/shared-FE R02 flow %s has no reminder mutation',async mode=>{
 const script=regressions.cases.find(c=>c.id==='R02')!;let calls=0;
 const gateway=createContextContractGateway(config,async request=>{expect(request.response_format.json_schema.schema.properties).toHaveProperty('placements');expect(hash(request.messages[0].content)).toBe(installed.SELECTED_CONTEXT_PROMPT_SHA256);const index=calls++,bound=JSON.parse(request.messages[1].content),wire=encodeFixtureV3(frozenContextProposal(bound,'R02',index)) as Record<string,unknown>&{placements:Record<string,unknown>};let content=JSON.stringify(wire);if(index===2){if(mode==='missing-control')delete wire.placements.title;content=JSON.stringify(wire);if(mode==='raw-duplicate')content=content.slice(0,-1)+',"\\u0070lacements":{}}';if(mode==='raw-uncertainty-duplicate')content=content.slice(0,-1)+',"'+String.fromCharCode(92)+'u0075ncertainties":[]}'}return {status:200,body:JSON.stringify({model:request.model,provider:'Google',id:'gen-offline109',usage:{cost:0,prompt_tokens:mode==='usage-over-cap'&&index===2?12001:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content}}]})}}, {status:'OBSERVABLE_CANARY',advertisedContextTokens:1048576});
 const probe=await createContextContractProbe({sourceSha:'845513448d3bda98f089445efd40c9d8576d9c78',referenceNow:Date.parse(script.turns[0].receipt),liveGateway:gateway},()=>{throw Error('NO_REAL_PROVIDER')});
 try{const rows=[];for(const turn of script.turns.slice(0,3))rows.push(await probe.turn(turn.text,turn.receipt));expect(rows.every(r=>r.mutations===0)).toBe(true);expect(rows.slice(0,2).every(r=>r.fullSchemaValid)).toBe(true);expect(rows[2]).toMatchObject({status:mode==='valid'?'DRAFT_CREATED':'REJECTED',fullSchemaValid:mode==='valid'});expect(calls).toBe(3);const api=await probe.readBack();expect(PreviewResponseV1Schema.safeParse({data:{schemaVersion:'conversation-previews-1',...api.previews}}).success).toBe(true);expect(ReminderListResponseV2Schema.safeParse({data:api.reminders}).success).toBe(true)}finally{probe.dispose()}
});
it('selected109 native refusal diagnostics retain fixed reasons while private control values stay redacted',()=>{
 const wire=encode(p);wire.placements.title='PRIVATE_ANCHOR_VALUE';let diagnostic:unknown;
 expect(installed.decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,d=>{diagnostic=d}).status).toBe('REFUSED');expect(diagnostic).toMatchObject({issues:[{path:['placements','title'],expected:'LITERAL_INSERTION_CONTROL'}]});expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE_ANCHOR_VALUE');
 const raw=JSON.stringify(encode(p)),duplicate=raw.slice(0,-1)+',"\\u0070lacements":{}}';expect(installed.validateTypedSingletonCarrierJsonV3(duplicate,input)).toMatchObject({issues:[{path:['placements'],expected:'LITERAL_INSERTION_JSON'}]});
});
it('actual109 byte-safe long retained context refuses reported token overflow without mutating accepted draft',async()=>{
 const first=regressions.cases.find(c=>c.id==='R02')!.turns[0],start=Date.parse(first.receipt);let calls=0,captured:unknown;
 const gateway=createContextContractGateway(config,async request=>{const index=calls++,bound=JSON.parse(request.messages[1].content),value=index===0?frozenContextProposal(bound,'R02',0):ConversationInterpretationV3Schema.parse({schemaVersion:'calenote-context-3',intent:'HELP',requestTarget:null,changes:[],query:null,uncertainties:[],conversationDirective:{kind:'HELP',topic:'GENERAL'},replyProposal:null});if(index===2){expect(bound.turns.filter((t:{role:string})=>t.role==='USER')).toHaveLength(3);expect(bound.turns[bound.currentTurn].text).toHaveLength(1600)}return {status:200,body:JSON.stringify({model:request.model,provider:'Google',id:'gen-offline109-boundary',usage:{cost:0,prompt_tokens:index===2?12001:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:JSON.stringify(encodeFixtureV3(value))}}]})}}, {status:'OBSERVABLE_CANARY',advertisedContextTokens:1048576});
 const observed:typeof gateway={prepare(tier,bound){const prepared=gateway.prepare(tier,bound);return prepared.status!=='READY'?prepared:{...prepared,async dispatch(){const result=await prepared.dispatch();captured=result;return result}}}};
 const probe=await createContextContractProbe({sourceSha:'845513448d3bda98f089445efd40c9d8576d9c78',referenceNow:start,liveGateway:observed},()=>{throw Error('NO_REAL_PROVIDER')});
 const long='Xin hướng dẫn '+'xqz'.repeat(529).slice(0,1586);
 try{await probe.turn(first.text,first.receipt);const second=await probe.turn(long,new Date(start+60000).toISOString()),before=probe.snapshot();expect(second.snapshotEncodedBytes).toBeLessThanOrEqual(16384);expect(second.status).toBe('CLARIFICATION_REQUESTED');const failed=await probe.turn(long,new Date(start+120000).toISOString()),after=probe.snapshot();expect(captured).toMatchObject({status:'FAILURE',category:'SCHEMA_INVALID'});expect(failed).toMatchObject({status:'REJECTED',fullSchemaValid:false,mutations:0});expect(after?.slots).toEqual(before?.slots);expect(after?.facts).toEqual(before?.facts);expect(after?.draftRevision).toBe(before?.draftRevision);expect(after?.absoluteExpiresAt).toBe(before?.absoluteExpiresAt);expect(after?.pendingDecision).toBeNull();expect(calls).toBe(3);const api=await probe.readBack();expect(ReminderListResponseV2Schema.safeParse({data:api.reminders}).success).toBe(true);expect(api.reminders).toMatchObject({reminders:[]})}finally{probe.dispose()}
});
it('selected109 CURRENT syntax illustration parses as an object while nested carrier escaping stays intentional',()=>{
 const line=installed.CONTEXT_ORDER_REFERENCE_PROMPT.split('\n').find(l=>l.startsWith('Targets: CURRENT/NEW/UNRESOLVED'))!;
 const fragment=line.slice(line.indexOf('{'),line.indexOf('}. Select')+1);const template=JSON.parse(fragment);
 expect(template).toMatchObject({operationCode:'0',requestTarget:{evidence:{primaryEvidence:'U6',additionalEvidenceJson:'[]'}}});
 const example=installed.CONTEXT_ORDER_REFERENCE_PROMPT.split('\n').find(l=>l.startsWith('Serialization example (syntax only):'))!;
 const outer=JSON.parse(example.slice(example.indexOf('{')));expect(JSON.parse(outer.eventRelationChange.change)).toMatchObject({field:'eventRelation',value:'BEFORE_EVENT'});
});
