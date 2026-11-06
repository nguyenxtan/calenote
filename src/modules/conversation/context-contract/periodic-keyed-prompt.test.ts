// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {buildContextInputV2} from './context';
import {chat,message,observation} from './context-test-fixtures';
import {serializeKeyedSmallComparison,CONTEXT_KEYED_COMPARISON_PROMPT} from './keyed-small-wire';
import {contextPromptForInput} from './burst-prompt';
import {serializeTypedContextRequest} from './typed-wire';
import {CONTEXT_TYPED_PROMPT} from './typed-prompt';
import {harness} from './service-test-support';
import {createContextContractService} from './service';
import {digest} from './confirmation';
import {InterpretationJsonSchema,type ContextInput} from './contracts';
import {CONTEXT_KEYED_COMPARISON_PROTOCOL} from './keyed-small-protocol';
function input(text:string){const msg=message(text),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg,chat)});if(built.status!=='READY')throw Error(built.reason);return built.input;}
function expectSelectedOwnerSuffix(request:ReturnType<typeof serializeKeyedSmallComparison>,prefix:string){
 const schema=request.response_format.json_schema.schema as {properties:{changes?:{properties:{owners:{properties:Record<string,unknown>}}}}};
 const owners=schema.properties.changes?.properties.owners.properties,keys=owners?Object.keys(owners):[];
 const suffix=keys.length?`\nselectedOwnerKeysInEmissionOrder=${JSON.stringify(keys)}. After each nonfinal owner value, immediately emit a comma and the next listed key. Emit every unchanged listed owner as its actual field name followed by :[]. Close owners only after the last listed key. Emit no whitespace outside strings. This serialization order has no semantic authority.\n`:'';
 expect(request.messages[0].content.slice(0,prefix.length)).toBe(prefix);
 expect(request.messages[0].content.slice(prefix.length)).toBe(suffix);
}
it.each(['tuần','tháng'])('asks the keyed model to preserve an authored %s notification start without supplying a date/count',cadence=>{
 const value=input(`Nhắc kiểm tra QA mỗi ${cadence} lúc9h từ ngày09/11/2026 trong 4 ${cadence}.`),request=serializeKeyedSmallComparison(value);
 expect(JSON.stringify(request.response_format.json_schema.schema)).toContain('STARTING_ON');
 expect(request.messages[0].content).toContain('WEEKLY/MONTHLY notification starts');
 expect(request.messages[0].content).toContain('Never invent a start');
 expectSelectedOwnerSuffix(request,contextPromptForInput(CONTEXT_KEYED_COMPARISON_PROMPT,value,{keyedPeriodic:true}));
 expect(serializeTypedContextRequest(value).messages[0].content).toBe(CONTEXT_TYPED_PROMPT);
});
it('preserves the exact keyed base prefix before selected-owner guidance on single once/date and unrelated list inputs',()=>{
 for(const text of ['Mai 8h nhắc họp QA.','Xem lịch tuần này.'])expectSelectedOwnerSuffix(serializeKeyedSmallComparison(input(text)),CONTEXT_KEYED_COMPARISON_PROMPT);
});
it('binds the actual keyed periodic system prompt before any budget or provider dispatch',async()=>{
 const h=await harness([]),claim=vi.spyOn(h.deps.runtimeStore,'claimAttempt').mockResolvedValue(false),dispatch=vi.fn(async()=>{throw Error('Provider must stay dormant');});
 let prepared:ContextInput|undefined;
 h.deps.gateway={contextWire:'KEYED_COMPARISON_137',prepare(tier,value){expect(tier).toBe('PRIMARY');prepared=value;return {status:'READY',model:'openai/gpt-5-mini',provider:'azure/swedencentral',maximumCostMicrounits:116759,dispatch};}};
 const service=createContextContractService(h.deps),scope=h.f.scope(),text='Nhắc kiểm tra QA mỗi tuần lúc9h từ ngày09/11/2026 trong 4 tuần.';
 const rowid=await h.f.db.prepare('SELECT rowid FROM inbound_updates WHERE id=?').bind(scope.sourceInboundId).first<number>('rowid');
 expect(await service.handle({...message(text),id:scope.sourceInboundId,claimMarker:scope.claimMarker,receivedAt:scope.now},{...chat,inboundRowId:rowid!})).toEqual({status:'SUPERSEDED'});
 expect(claim).toHaveBeenCalledOnce();expect(dispatch).not.toHaveBeenCalled();
 const expected=await digest({observation:claim.mock.calls[0][1],inputDigest:await digest(prepared),promptDigest:await digest(serializeKeyedSmallComparison(prepared!).messages[0].content),contractDigest:await digest(InterpretationJsonSchema),protocol:CONTEXT_KEYED_COMPARISON_PROTOCOL});
 expect(claim.mock.calls[0][2]).toBe(expected);
});
