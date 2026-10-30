import {vi} from 'vitest';
// @vitest-environment node
vi.mock('../../src/modules/intelligence/infrastructure/openrouter/context-literal-insertion-wire',async()=> (await import('./wire108-reference-codec.test-support')).wire108ReferenceCodec);
vi.mock('../../src/modules/conversation/context-contract/protocol',async()=>{const r=await import('./wire108-protocol.test-support');return {CONTEXT_PROTOCOL_V3:r.wire108ProtocolReference,isContextProtocolV3:r.isWire108ProtocolReference}});
import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,mkdirSync,realpathSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {SemanticJsonRequest} from '../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway';
import {executeObservableCampaign,verifyContextRequestSchema} from './context-contract-runner';
import {admitCanonicalCampaign,type ContextManifest} from './context-contract';
import {frozenContextProposal,encodeFixtureV3} from './context-pointer-fixtures';
import {appendCampaignEvent,reserveCampaignCall,markCampaignDispatched,finishCampaignCall,readCampaignLedger} from './context-contract-live';
import {serializeContextRequest} from '../../src/modules/conversation/context-contract/wire';
import {ContextInputSchema} from '../../src/modules/conversation/context-contract/contracts';
import {SELECTED_CONTEXT_SCHEMA_SHA256,SELECTED_CONTEXT_PROMPT_SHA256} from '../../src/modules/intelligence/infrastructure/openrouter/context-order-reference-wire';
const hash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
it('unmocked108 runner pins actual schema/prompt/context before one HTTP attempt',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'wire108-proof-'));let calls=0;
 try{const result=await executeObservableCampaign({directory,sourceSha:'a'.repeat(40),provenanceDigest:'b'.repeat(64),runId:'wire108-proof',profile:'PILOT',cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,now:()=>100,transport:async request=>{calls++;expect(hash(request.messages[0].content)).toBe(SELECTED_CONTEXT_PROMPT_SHA256);expect(verifyContextRequestSchema(request).requestWireSchemaDigest).toBe(hash(request.response_format.json_schema.schema));expect(request.response_format.json_schema.schema.properties).toHaveProperty('orderRefs');return {status:503,body:'{}'}}});expect(calls).toBe(1);expect(result.responses[0]).toMatchObject({providerWireSchemaDigest:SELECTED_CONTEXT_SCHEMA_SHA256,providerWireSchemaVersion:expect.stringContaining('-108')})}finally{rmSync(directory,{recursive:true,force:true})}
});
it.each(['schema','context','strict'] as const)('unmocked108 proof refuses changed %s',mode=>{
 const input=ContextInputSchema.parse({schemaVersion:'calenote-context-input-2',reference:{instant:'2026-10-08T03:00:00Z',localDate:'2026-10-08',timezone:'Asia/Ho_Chi_Minh'},turns:[{role:'USER',text:'Nhắc trước 2 ngày.'}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:'v1',supported:['ONCE'],unsupported:[],calendars:['GREGORIAN'],limits:{dailyCount:30,horizonDays:366}}});
 const request:SemanticJsonRequest={...serializeContextRequest(input),model:'google/gemini-2.5-flash-lite',provider:{only:['google-vertex/eu'],allow_fallbacks:false,require_parameters:true,data_collection:'deny',zdr:true,max_price:{prompt:.1,completion:.4}}};
 if(mode==='schema')request.response_format.json_schema.schema={} as never;else if(mode==='strict')request.response_format.json_schema.strict=false as never;else{const body=JSON.parse(request.messages[1].content);body.turns[0].text='Nhắc 2 ngày liên tiếp.';request.messages[1].content=JSON.stringify(body)}expect(()=>verifyContextRequestSchema(request)).toThrow();
});
it.each(['PILOT','FULL'] as const)('unmocked108 %s synthetic runner preserves every frozen oracle and stop policy',async profile=>{
 const directory=mkdtempSync(join(tmpdir(),'wire108-campaign-'));let calls=0;
 try{const manifest:ContextManifest={version:'context-contract-corpus-1',cases:['regressions','development','heldout'].flatMap(name=>(JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`,'utf8')) as ContextManifest).cases)},healthy=admitCanonicalCampaign(manifest,profile).flatMap(script=>script.turns.flatMap((turn,index)=>turn.model==='HEALTHY'?[{id:script.executionId,index}]:[]));const result=await executeObservableCampaign({directory,sourceSha:'a'.repeat(40),provenanceDigest:'b'.repeat(64),runId:'wire108-campaign',profile,cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,now:()=>100,transport:async request=>{const item=healthy[calls++],context=JSON.parse(request.messages[1].content);return {status:200,body:JSON.stringify({model:request.model,provider:'Google',id:`gen-wire108-${calls}`,choices:[{finish_reason:'stop',message:{content:JSON.stringify(encodeFixtureV3(frozenContextProposal(context,item.id,item.index)))}}],usage:{cost:.001,prompt_tokens:100,completion_tokens:100}})}}});expect(result.status).toBe('PASS');expect(result.score?.gate).toBe('PASS');expect(result.score?.plannedTurns).toBe(profile==='PILOT'?84:158);expect(calls).toBe(profile==='PILOT'?76:144);expect(result.providerHttpRequests).toBe(calls);expect(readCampaignLedger(directory).at(-1)).toMatchObject({event:'COMPLETE',retainedMicrounits:calls*1000});expect(result.responses.every(r=>r.providerWireSchemaVersion.endsWith('-108'))).toBe(true)}finally{rmSync(directory,{recursive:true,force:true})}
},30000);

// Actual selected codec and runner, no historical mocks or seeded state.
import {currentFixtureCandidate} from './current-candidate.test-support';
import {deriveBoundedPilotManifest} from './context-bounded-pilot';
import {createDebugLoopLoader,runDebugLoopExecution} from './context-debug-loop';
it.each(['healthy','first-error'] as const)('unmocked108 current-schema admission fences real R03 prefix (%s)',async variant=>{
 const root=process.cwd(),candidate=currentFixtureCandidate(),accountRoot=realpathSync(mkdtempSync(join(tmpdir(),'wire108-admission-'))),campaignRoot=join(accountRoot,'existing'),history=join(campaignRoot,'PILOT');mkdirSync(history,{recursive:true});
 try{
  appendCampaignEvent(history,{event:'BEGIN',runId:'old',sourceSha:'a'.repeat(40),profile:'PILOT',provenanceDigest:'b'.repeat(64),cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,startedAt:1,executionKind:'R01_REPLAY',accountingPolicy:'CONFIRMED_COST_V1',requestExposureBoundMicrounits:105472});
  reserveCampaignCall(history,{runId:'old',profile:'PILOT',provenanceDigest:'b'.repeat(64),reservationId:'old',maximumMicrounits:0,now:1,startedAt:1});markCampaignDispatched(history,{runId:'old',reservationId:'old',at:1});finishCampaignCall(history,{runId:'old',reservationId:'old',observedMicrounits:null,at:1});
  const historical=readFileSync(join(history,'campaign.jsonl'),'utf8'),ownerMessagePath=join(accountRoot,'owner.txt'),path=join(accountRoot,'grant.json');writeFileSync(ownerMessagePath,'Owner approved repeated debug under $5 including conservative UNKNOWN.');
  const manifest=deriveBoundedPilotManifest(root),ownerMessageSha256=hash(readFileSync(ownerMessagePath,'utf8')),record={version:'t11-debug-loop-authority-1',operation:'T11_SCHEMA_DEBUG_THROUGH_FORMAL_PILOT',accountRoot,campaignRoot,hardCapMicrounits:5000000,accountingPolicy:'CONSERVATIVE_DEBUG_V1',model:'google/gemini-2.5-flash-lite',provider:'google-vertex/eu',retry:0,fallback:'none',stream:false,manifestSha256:manifest.manifestSha256,ownerMessagePath,ownerMessageSha256},text=JSON.stringify(record);writeFileSync(path,text);
  const load=()=>createDebugLoopLoader({accountRoot,campaignRoot,reviewedRecordSha256:hash(text),reviewedOwnerMessageSha256:ownerMessageSha256})(path,root);let calls=0;
  const result=await runDebugLoopExecution(load(),candidate,'R03_TURN1_CURRENT_SCHEMA_ADMISSION',async request=>{
   const target=manifest.targets[calls++];expect(hash(request.messages[0].content)).toBe(SELECTED_CONTEXT_PROMPT_SHA256);expect(verifyContextRequestSchema(request).requestWireSchemaDigest).toBe(hash(request.response_format.json_schema.schema));
   if(variant==='first-error')return {status:429,body:'{}'};
   return {status:200,body:JSON.stringify({model:request.model,provider:'Google',id:`gen-wire108-prefix-${calls}`,choices:[{finish_reason:'stop',message:{content:JSON.stringify(encodeFixtureV3(frozenContextProposal(JSON.parse(request.messages[1].content),target.fixtureId,target.turnIndex)))}}],usage:{cost:.0001,prompt_tokens:100,completion_tokens:100}})};
  },{now:()=>100});
  expect(calls).toBe(variant==='healthy'?7:1);expect(result).toMatchObject({terminal:true,pilotCredit:false,providerHttpAttempts:calls});expect(existsSync(join(result.directory,`http-${calls}.json`))).toBe(false);expect(readFileSync(join(history,'campaign.jsonl'),'utf8')).toBe(historical);
  if(variant==='healthy'){expect(result.responses.every(r=>r.status==='SUCCESS')).toBe(true);expect(result.applicationEvidence).toHaveLength(7);expect(result.applicationEvidence.at(-1)).toMatchObject({fixtureId:'R03',turnIndex:1});expect(JSON.parse(readFileSync(join(result.directory,'terminal.json'),'utf8'))).toMatchObject({status:'STOP',attempts:7,pilotCredit:false});}
  await expect(runDebugLoopExecution(load(),candidate,'R03_TURN1_CURRENT_SCHEMA_ADMISSION',async()=>{throw Error('FORBIDDEN')})).rejects.toThrow('DEBUG_EXECUTION_CONSUMED');
 }finally{rmSync(accountRoot,{recursive:true,force:true})}
},120000);
