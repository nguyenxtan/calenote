// @vitest-environment node
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import {createKeyedContextContractGateway} from '../../intelligence/infrastructure/openrouter/keyed-context-gateway';
import {type SemanticJsonRequest} from '../../intelligence/infrastructure/openrouter/semantic-gateway';
import {ContextInputSchema,ConversationInterpretationV3Schema,InterpretationJsonSchema,type ContextInput} from './contracts';
import {encodeKeyedSmallComparison} from '../../intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
import {frozenContextProposal} from '../../../../tools/benchmark/context-contract-fixtures';
import {serializeKeyedSmallComparison,CONTEXT_KEYED_COMPARISON_PROMPT} from './keyed-small-wire';
import {contextPromptForInput} from './burst-prompt';
import {CONTEXT_KEYED_COMPARISON_PROTOCOL} from './keyed-small-protocol';
import {CONTEXT_PROTOCOL_V3} from './protocol';
import {harness} from './service-test-support';
import {createContextContractService} from './service';
import {chat,message} from './context-test-fixtures';
import {digest} from './confirmation';

interface RequestVector {fixture:string;turn?:number;input:unknown;requestSha256:string}
const vectors=JSON.parse(readFileSync(new URL('../../intelligence/infrastructure/openrouter/__fixtures__/keyed160-request-hashes.json',import.meta.url),'utf8')) as RequestVector[];
const predecessor=JSON.parse(readFileSync(new URL('../../intelligence/infrastructure/openrouter/__fixtures__/keyed159-request-hashes.json',import.meta.url),'utf8')) as RequestVector[];
const preceding=JSON.parse(readFileSync(new URL('../../intelligence/infrastructure/openrouter/__fixtures__/keyed147-request-hashes.json',import.meta.url),'utf8')) as RequestVector[];
const historical=JSON.parse(readFileSync(new URL('../../intelligence/infrastructure/openrouter/__fixtures__/keyed146-request-hashes.json',import.meta.url),'utf8')) as RequestVector[];
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const admission={status:'OBSERVABLE_CANARY',advertisedContextTokens:400000} as const;

it.each(vectors)('emits the keyed160 $fixture/$turn golden request with preserved historical input',async vector=>{
 const input=ContextInputSchema.parse(vector.input),previous=predecessor.find(row=>row.fixture===vector.fixture&&(row.turn??0)===(vector.turn??0)),prior=preceding.find(row=>row.fixture===vector.fixture&&(row.turn??0)===(vector.turn??0)),original=historical.find(row=>row.fixture===vector.fixture&&(row.turn??0)===(vector.turn??0));
 expect(previous).toBeDefined();expect(prior).toBeDefined();expect(original).toBeDefined();expect(vector.input).toEqual(previous!.input);expect(vector.input).toEqual(prior!.input);expect(vector.input).toEqual(original!.input);
 let emitted:SemanticJsonRequest|undefined;
 const gateway=createKeyedContextContractGateway(async request=>{
  emitted=structuredClone(request);
  const canonical=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,vector.fixture,vector.turn??0));
  return {status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:.003,prompt_tokens:8000,completion_tokens:500},choices:[{finish_reason:'stop',message:{content:JSON.stringify(encodeKeyedSmallComparison(canonical,input))}}]})};
 },admission);
 const ready=gateway.prepare('PRIMARY',input);expect(ready.status).toBe('READY');if(ready.status!=='READY')throw Error('Prepared keyed attempt required');
 expect(await ready.dispatch()).toMatchObject({status:'SUCCESS'});expect(emitted).toBeDefined();
 expect(hash(emitted)).toBe(vector.requestSha256);
 // These historical requests are outside the new bounded-window certificates.
 expect(hash(emitted)).toBe(previous!.requestSha256);
});

it.each([
 ['keyed146-request-hashes.json','c7fb182c2acb169ef317f327e3f1bc1c8903a482fdb6364f354b01263c1438f0'],
 ['keyed147-request-hashes.json','8fc78f5e51fed88a11cbdc39067af0ba0ee8dff6c8ddbd0cd754e5c4a9bd428b'],
 ['keyed148-request-hashes.json','649b79740d3fe8dc68b0e001936751b371861050e2e454b450c64e4288e16dad'],
 ['keyed149-request-hashes.json','27cf311730f22eb2c50cf0d06fb90965ccf9fdd63f8011158faa72fe85bb0cdf'],
 ['keyed150-request-hashes.json','150143a3df950b783aa11650c37e5bdd673d93d94f7b665f3190ff9a324b8d24'],
 ['keyed151-request-hashes.json','9169e8cf4f005c0072c372a6190fc621f61fa7f34a4a3eeb6ab0166971f7cab2'],
 ['keyed152-request-hashes.json','9169e8cf4f005c0072c372a6190fc621f61fa7f34a4a3eeb6ab0166971f7cab2'],
 ['keyed153-request-hashes.json','9169e8cf4f005c0072c372a6190fc621f61fa7f34a4a3eeb6ab0166971f7cab2'],
 ['keyed154-request-hashes.json','9169e8cf4f005c0072c372a6190fc621f61fa7f34a4a3eeb6ab0166971f7cab2'],
 ['keyed155-request-hashes.json','9169e8cf4f005c0072c372a6190fc621f61fa7f34a4a3eeb6ab0166971f7cab2'],
 ['keyed156-request-hashes.json','e06974b3ae5badd665ba82104474ec93a3e660ee55fb532ecbfcf8b73842e324'],
 ['keyed157-request-hashes.json','e06974b3ae5badd665ba82104474ec93a3e660ee55fb532ecbfcf8b73842e324'],
 ['keyed158-request-hashes.json','e06974b3ae5badd665ba82104474ec93a3e660ee55fb532ecbfcf8b73842e324'],
 ['keyed159-request-hashes.json','e06974b3ae5badd665ba82104474ec93a3e660ee55fb532ecbfcf8b73842e324'],
])('preserves the immutable historical %s qualification vector', (name,expected)=>{
 const bytes=readFileSync(new URL('../../intelligence/infrastructure/openrouter/__fixtures__/'+name,import.meta.url));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected);
});

it('returns trusted READY bindingPrompt equal to the exact dispatched system message',async()=>{
 const input=ContextInputSchema.parse(vectors[0].input);let emittedSystem:string|undefined;
 const gateway=createKeyedContextContractGateway(async request=>{emittedSystem=request.messages[0].content;return {status:503,body:''};},admission);
 const ready=gateway.prepare('PRIMARY',input);expect(ready.status).toBe('READY');if(ready.status!=='READY')throw Error('Prepared keyed attempt required');
 const bindingPrompt=Reflect.get(ready,'bindingPrompt');expect(bindingPrompt).toBeTypeOf('string');expect(bindingPrompt).toBe(serializeKeyedSmallComparison(input).messages[0].content);
 await ready.dispatch();expect(bindingPrompt).toBe(emittedSystem);
});


type OwnerSchema={properties:{changes:{properties:{owners:{required:string[];properties:Record<string,unknown>}}}}};
it.each(vectors)('adds only the actual selected schema owner keys to the trusted $fixture/$turn serialization line',vector=>{
 const input=ContextInputSchema.parse(vector.input),request=serializeKeyedSmallComparison(input),schema=request.response_format.json_schema.schema as OwnerSchema;
 const owners=schema.properties.changes.properties.owners,keys=owners.required;
 expect(keys).toEqual(Object.keys(owners.properties));
 const oldPrompt=contextPromptForInput(CONTEXT_KEYED_COMPARISON_PROMPT,input,{keyedPeriodic:true});
 const line=`selectedOwnerKeysInEmissionOrder=${JSON.stringify(keys)}. After each nonfinal owner value, immediately emit a comma and the next listed key. Emit every unchanged listed owner as its actual field name followed by :[]. Close owners only after the last listed key. Emit no whitespace outside strings. This serialization order has no semantic authority.`;
 // The complete suffix is independently assembled from schema field names
 // alone. No user text, title, date, clock or other operand is interpolated.
 expect(request.messages[0].content).toBe(oldPrompt+'\n'+line+'\n');
 const selected=/^selectedOwnerKeysInEmissionOrder=(\[[^\n]*\])\. After /mu.exec(request.messages[0].content);
 expect(selected).not.toBeNull();expect(JSON.parse(selected![1])).toEqual(keys);
});

it('selects prompt160 and appended codebook3 while preserving wire137 and canonical protocol identities',()=>{
 expect(CONTEXT_KEYED_COMPARISON_PROTOCOL.promptVersion).toBe('calenote-context-readable-keyed-160-list-query-operation-bound');
 expect(CONTEXT_KEYED_COMPARISON_PROTOCOL.promptVersion).not.toBe('calenote-context-readable-keyed-146-hour-minute-lead');
 expect(CONTEXT_KEYED_COMPARISON_PROTOCOL.wireVersion).toBe('calenote-context-readable-keyed-137');
 expect(CONTEXT_KEYED_COMPARISON_PROTOCOL.codebookVersion).toBe('context-uncertainty-fields-3');
 const {promptVersion,wireVersion,codebookVersion,...canonical}=CONTEXT_KEYED_COMPARISON_PROTOCOL;void promptVersion;void wireVersion;void codebookVersion;
 const {promptVersion:basePrompt,wireVersion:baseWire,codebookVersion:baseBook,...base}=CONTEXT_PROTOCOL_V3;void basePrompt;void baseWire;void baseBook;
 expect(canonical).toEqual(base);
});

it.each(['trusted READY metadata','fake keyed fallback'] as const)('binds the exact %s system text before budget reservation or provider dispatch',async mode=>{
 const h=await harness([]),claim=vi.spyOn(h.deps.runtimeStore,'claimAttempt').mockResolvedValue(false),reserve=vi.spyOn(h.deps.budgetStore,'reservePaidCall');
 const dispatch=vi.fn(async()=>{throw Error('No provider dispatch is permitted in this claim-fence test');});
 let prepared:ContextInput|undefined,suppliedPrompt:string|undefined;
 h.deps.gateway={contextWire:'KEYED_OBJECTS_136',prepare(tier,value){
  expect(tier).toBe('PRIMARY');prepared=structuredClone(value);
  // This is application-owned READY data from preparation, never provider or
  // model output. Whitespace deliberately distinguishes it from reconstruction.
  suppliedPrompt=serializeKeyedSmallComparison(value).messages[0].content+(mode==='trusted READY metadata'?' \t\n  ':'');
  return {status:'READY',model:'openai/gpt-5-mini',provider:'azure/swedencentral',maximumCostMicrounits:116759,...(mode==='trusted READY metadata'?{bindingPrompt:suppliedPrompt}:{}),dispatch};
 }};
 const service=createContextContractService(h.deps),scope=h.f.scope(),text='Nhắc kiểm tra QA mỗi tuần lúc9h từ ngày09/11/2026 trong 4 tuần.';
 const rowid=await h.f.db.prepare('SELECT rowid FROM inbound_updates WHERE id=?').bind(scope.sourceInboundId).first<number>('rowid');
 expect(await service.handle({...message(text),id:scope.sourceInboundId,claimMarker:scope.claimMarker,receivedAt:scope.now},{...chat,inboundRowId:rowid!})).toEqual({status:'SUPERSEDED'});
 expect(claim).toHaveBeenCalledOnce();expect(reserve).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();expect(prepared).toBeDefined();expect(suppliedPrompt).toBeDefined();
 const expectedPrompt=mode==='trusted READY metadata'?suppliedPrompt!:serializeKeyedSmallComparison(prepared!).messages[0].content;
 const inputDigest=await digest(prepared!),contractDigest=await digest(InterpretationJsonSchema);
 const expected=await digest({observation:claim.mock.calls[0][1],inputDigest,promptDigest:await digest(expectedPrompt),contractDigest,protocol:CONTEXT_KEYED_COMPARISON_PROTOCOL});
 expect(claim.mock.calls[0][2]).toBe(expected);
 if(mode==='trusted READY metadata'){
  const trimmed=await digest({observation:claim.mock.calls[0][1],inputDigest,promptDigest:await digest(expectedPrompt.trimEnd()),contractDigest,protocol:CONTEXT_KEYED_COMPARISON_PROTOCOL});
  expect(expected).not.toBe(trimmed);expect(expectedPrompt.endsWith(' \t\n  ')).toBe(true);
 }
 expect(JSON.stringify(h.events)).not.toContain('selectedOwnerKeysInEmissionOrder=');
});
