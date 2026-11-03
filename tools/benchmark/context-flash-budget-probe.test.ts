// @vitest-environment node
import {expect,it} from 'vitest';
import {createContextContractProbe} from './context-contract-probe';
import {frozenContextProposal} from './context-contract-fixtures';
import {ConversationInterpretationV3Schema} from '../../src/modules/conversation/context-contract/contracts';
import {encodeSmallContextV3,decodeSmallContextV3} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-small-wire';
import {CONTEXT_SMALL_PROTOCOL_V3} from '../../src/modules/conversation/context-contract/small-protocol';

it.each([
 {profile:undefined,model:'google/gemini-2.5-flash',provider:'google-ai-studio',maximum:318413},
 {profile:'GEMINI_FLASH_AI_STUDIO',model:'google/gemini-2.5-flash',provider:'google-ai-studio',maximum:318413},
 {profile:'GPT5_MINI_AZURE_SWEDEN',model:'openai/gpt-5-mini',provider:'azure/swedencentral',maximum:116759},
 {profile:'GPT5_MINI_MEDIUM_AZURE_SWEDEN',model:'openai/gpt-5-mini',provider:'azure/swedencentral',maximum:119012},
 {profile:'GPT41_MINI_AZURE_SWEDEN',model:'openai/gpt-4.1-mini',provider:'azure/swedencentral',maximum:463637},
 {profile:'NANO54_AZURE_ZDR_SYNTHETIC',model:'openai/gpt-5.4-nano',provider:'azure',maximum:83840},
 {profile:'MINI54_FLEX_SYNTHETIC',model:'openai/gpt-5.4-mini',provider:'openai/flex',maximum:153456},
 {profile:'MINI54_AZURE_ZDR_SYNTHETIC',model:'openai/gpt-5.4-mini',provider:'azure',maximum:306912},
] as const)('requires the explicit comparison budget profile before dispatch ($profile)',async({profile:liveBudgetProfile,model,provider,maximum})=>{
 let calls=0;
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106',liveBudgetProfile,
  liveGateway:{prepare(_tier,input){return {status:'READY',model,provider,maximumCostMicrounits:maximum,routeAdmission:'OBSERVABLE_CANARY',async dispatch(){calls++;const wire=encodeSmallContextV3(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0)),input),decoded=decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input);if(decoded.status!=='PARSED')throw Error('FIXTURE_DECODE');return {status:'SUCCESS',interpretation:decoded.value,usage:{costMicrounits:1000}};}};}}},input=>frozenContextProposal(input,'R01',0));
 try{
  const actual=await probe.turn('Cho tôi xem lịch.','2026-09-28T03:00:00Z');
  expect(calls).toBe(liveBudgetProfile?1:0);expect(actual.status).toBe(liveBudgetProfile?'CLARIFICATION_REQUESTED':'REJECTED');
  expect(probe.events.find(event=>event.event==='REQUEST_PREPARED')).toMatchObject({configuredModel:model,configuredProvider:provider});
 }finally{probe.dispose();}
});
it('keeps declarative fault-control budgets unchanged when no live gateway is selected',async()=>{
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106',liveBudgetProfile:'GEMINI_FLASH_AI_STUDIO'},input=>frozenContextProposal(input,'R01',0));
 try{expect((await probe.turn('Cho tôi xem lịch.','2026-09-28T03:00:00Z')).status).toBe('CLARIFICATION_REQUESTED');}finally{probe.dispose();}
});
