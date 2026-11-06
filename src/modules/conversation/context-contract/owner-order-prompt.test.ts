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
const vectors=JSON.parse(readFileSync(new URL('../../intelligence/infrastructure/openrouter/__fixtures__/keyed147-request-hashes.json',import.meta.url),'utf8')) as RequestVector[];
const historical=JSON.parse(readFileSync(new URL('../../intelligence/infrastructure/openrouter/__fixtures__/keyed146-request-hashes.json',import.meta.url),'utf8')) as RequestVector[];
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const admission={status:'OBSERVABLE_CANARY',advertisedContextTokens:400000} as const;

it.each(vectors)('emits the independent keyed147 $fixture/$turn request and exactly recovers its immutable keyed146 predecessor',async vector=>{
 const input=ContextInputSchema.parse(vector.input),previous=historical.find(row=>row.fixture===vector.fixture&&(row.turn??0)===(vector.turn??0));expect(previous).toBeDefined();expect(vector.input).toEqual(previous!.input);
 let emitted:SemanticJsonRequest|undefined;
 const gateway=createKeyedContextContractGateway(async request=>{
  emitted=structuredClone(request);
  const canonical=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,vector.fixture,vector.turn??0));
  return {status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:.003,prompt_tokens:8000,completion_tokens:500},choices:[{finish_reason:'stop',message:{content:JSON.stringify(encodeKeyedSmallComparison(canonical,input))}}]})};
 },admission);
 const ready=gateway.prepare('PRIMARY',input);expect(ready.status).toBe('READY');if(ready.status!=='READY')throw Error('Prepared keyed attempt required');
 expect(await ready.dispatch()).toMatchObject({status:'SUCCESS'});expect(emitted).toBeDefined();
 expect(hash(emitted)).toBe(vector.requestSha256);
 const restored=structuredClone(emitted!);restored.messages[0].content=contextPromptForInput(CONTEXT_KEYED_COMPARISON_PROMPT,input,{keyedPeriodic:true});
 expect(hash(restored)).toBe(previous!.requestSha256);expect(hash(emitted)).not.toBe(previous!.requestSha256);
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

it('selects prompt147 while preserving the wire137, codebook2 and canonical protocol identities',()=>{
 expect(CONTEXT_KEYED_COMPARISON_PROTOCOL.promptVersion).toMatch(/^calenote-context-readable-keyed-147-/u);
 expect(CONTEXT_KEYED_COMPARISON_PROTOCOL.promptVersion).not.toBe('calenote-context-readable-keyed-146-hour-minute-lead');
 expect(CONTEXT_KEYED_COMPARISON_PROTOCOL.wireVersion).toBe('calenote-context-readable-keyed-137');
 expect(CONTEXT_KEYED_COMPARISON_PROTOCOL.codebookVersion).toBe('context-uncertainty-fields-2');
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
