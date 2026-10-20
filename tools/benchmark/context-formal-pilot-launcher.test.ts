import {it,expect,vi} from 'vitest';
import {currentFixtureCandidate} from './current-candidate.test-support';
import {inspectConservativeDebugCost} from './context-confirmed-cost';
import {ContextInputSchema,ConversationInterpretationV3Schema} from '../../src/modules/conversation/context-contract/contracts';
import {encodeSmallContextV3} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-small-wire';
import {encodeGoogleLiteEuTypedContextV3} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-typed-wire';
import {mkdtempSync,mkdirSync,realpathSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {appendCampaignEvent,auditCampaignAccountRoot,reserveCampaignCall,markCampaignDispatched,finishCampaignCall} from './context-contract-live';
import {candidateValidationProof} from './context-contract-candidate-validation';
import {deriveBoundedPilotManifest} from './context-bounded-pilot';
import {loadFormalPilotLaunch,inspectFormalPilotLaunch,runFormalPilotLaunch,takeFormalPilotExecution} from './context-formal-pilot-launcher';
vi.mock('./register-conversation-loader.mjs',()=>({assertLoadedCandidateModules:vi.fn(()=>({loadedApplicationProof:'PASS'}))}));
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const candidate=currentFixtureCandidate();
function setup(typed:boolean|"SMALL_106"=false){
 const small=typed==="SMALL_106",wireProtocol=small?"SMALL_106" as const:"TYPED_105" as const;
 const root=process.cwd(),accountRoot=realpathSync(mkdtempSync(join(tmpdir(),'formal-launch-'))),campaignRoot=join(accountRoot,'campaign');mkdirSync(join(campaignRoot,'PILOT'),{recursive:true});
 appendCampaignEvent(join(campaignRoot,'PILOT'),{event:'BEGIN',runId:'history',sourceSha:'a'.repeat(40),profile:'PILOT',provenanceDigest:'b'.repeat(64),cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,startedAt:1});
 if(typed){const directory=join(campaignRoot,'PILOT');reserveCampaignCall(directory,{runId:'history',profile:'PILOT',provenanceDigest:'b'.repeat(64),reservationId:'unknown',maximumMicrounits:100000,now:1,startedAt:1});markCampaignDispatched(directory,{runId:'history',reservationId:'unknown',at:1});finishCampaignCall(directory,{runId:'history',reservationId:'unknown',at:1,observedMicrounits:null});appendCampaignEvent(directory,{event:'STOP',runId:'history',at:1,reason:'TERMINAL'});}
 const proof=candidateValidationProof(root,candidate),manifest=deriveBoundedPilotManifest(root),ownerMessagePath=join(accountRoot,'owner.txt'),proposalPath=join(accountRoot,'proposal.json');
 writeFileSync(ownerMessagePath,'SYNTHETIC fresh paid approval for one FORMAL_PILOT only.');writeFileSync(proposalPath,'SYNTHETIC frozen proposal');
 const ownerMessageSha256=hash(readFileSync(ownerMessagePath,'utf8')),proposalSha256=hash(readFileSync(proposalPath,'utf8'));
 const debugPath=join(accountRoot,'debug.json'),debug={version:small?'t11-debug-loop-authority-3':typed?'t11-debug-loop-authority-2':'t11-debug-loop-authority-1',...(typed?{wireProtocol}:{}),operation:'T11_SCHEMA_DEBUG_THROUGH_FORMAL_PILOT',accountRoot,campaignRoot,hardCapMicrounits:10000000,accountingPolicy:'CONSERVATIVE_DEBUG_V1',model:'google/gemini-2.5-flash-lite',provider:'google-vertex/eu',retry:0,fallback:'none',stream:false,manifestSha256:manifest.manifestSha256,ownerMessagePath,ownerMessageSha256};writeFileSync(debugPath,JSON.stringify(debug));
 const record={version:small?'formal-pilot-launch-authority-3':typed?'formal-pilot-launch-authority-2':'formal-pilot-launch-authority-1',...(typed?{wireProtocol}:{}),paid:'AUTHORIZED_ONE_FORMAL_PILOT',mode:'FORMAL_PILOT',executions:1,accountRoot,campaignRoot,...proof,manifestSha256:manifest.manifestSha256,inventoryDigest:auditCampaignAccountRoot(accountRoot).inventoryDigest,proposalPath,proposalSha256,ownerMessagePath,ownerMessageSha256,debugRecordPath:debugPath,debugRecordSha256:hash(readFileSync(debugPath,'utf8')),hardCapMicrounits:10000000,accountingPolicy:'CONSERVATIVE_DEBUG_V1',model:'google/gemini-2.5-flash-lite',provider:'google-vertex/eu',retry:0,fallback:'none',stream:false,maxProviderHttpRequests:76,totalFixtures:32,totalTurns:84,timeCeilingMinutes:20};
 const path=join(accountRoot,'launch.json');
 const load=(patch:Record<string,unknown>={})=>{const text=JSON.stringify({...record,...patch});writeFileSync(path,text);return loadFormalPilotLaunch(root,path,{accountRoot,campaignRoot,...(typed?{wireProtocol}:{}),...proof,manifestSha256:manifest.manifestSha256,inventoryDigest:record.inventoryDigest,reviewedRecordSha256:hash(text),reviewedOwnerMessageSha256:ownerMessageSha256,reviewedProposalSha256:proposalSha256});};
 return {root,accountRoot,campaignRoot,record,path,load,cleanup:()=>rmSync(accountRoot,{recursive:true,force:true})};
}
it('missing authority refuses before credential callback',async()=>{const key=vi.fn();await expect(runFormalPilotLaunch(undefined,key)).rejects.toThrow('FORMAL_AUTHORITY_REQUIRED');expect(key).not.toHaveBeenCalled();});
it.each([{mode:'R01_TURN0'},{freshRun:{}},{paid:'HOLD'},{executions:2},{hardCapMicrounits:10000001},{maxProviderHttpRequests:77},{fallback:'auto'}])('strict scope rejects %j before credentials',patch=>{const s=setup();try{expect(()=>s.load(patch)).toThrow();}finally{s.cleanup();}});
it.each(['evaluationCandidateSha','harnessRevisionSha','candidateProofSha256','harnessProofSha256','manifestSha256','inventoryDigest','proposalSha256'])('reviewed pin %s rejects drift',field=>{const s=setup();try{expect(()=>s.load({[field]:'0'.repeat(field.endsWith('Sha')?40:64)})).toThrow();}finally{s.cleanup();}});
it('proposal content drift and existing account lock stop before credentials',async()=>{const s=setup();try{const a=s.load(),key=vi.fn();writeFileSync(s.record.proposalPath,'changed');await expect(runFormalPilotLaunch(a,key)).rejects.toThrow();expect(key).not.toHaveBeenCalled();}finally{s.cleanup();}});
it('consumed proposal and base execution refuse without key or network',async()=>{const s=setup();try{const a=s.load(),preview=inspectFormalPilotLaunch(a),key=vi.fn();writeFileSync(preview.proposalMarker,'{}');await expect(runFormalPilotLaunch(a,key)).rejects.toThrow('FORMAL_CONSUMED');expect(key).not.toHaveBeenCalled();rmSync(preview.proposalMarker);mkdirSync(preview.executionDirectory,{recursive:true});await expect(runFormalPilotLaunch(a,key)).rejects.toThrow('FORMAL_CONSUMED');expect(key).not.toHaveBeenCalled();}finally{s.cleanup();}});
it('key is acquired under lock after both durable fences; credential failure cannot repeat',async()=>{const s=setup();try{const a=s.load(),preview=inspectFormalPilotLaunch(a);const key=vi.fn(async()=>{expect(existsSync(join(s.accountRoot,'account.lock'))).toBe(true);expect(existsSync(preview.proposalMarker)).toBe(true);expect(existsSync(preview.ownerMarker)).toBe(true);throw Error('SYNTHETIC_KEY_UNAVAILABLE');});await expect(runFormalPilotLaunch(a,key)).rejects.toThrow('SYNTHETIC_KEY_UNAVAILABLE');expect(key).toHaveBeenCalledTimes(1);await expect(runFormalPilotLaunch(a,key)).rejects.toThrow();expect(key).toHaveBeenCalledTimes(1);}finally{s.cleanup();}});
it('account changes between load and run refuse before key',async()=>{const s=setup();try{const a=s.load(),key=vi.fn();mkdirSync(join(s.accountRoot,'other','PILOT'),{recursive:true});appendCampaignEvent(join(s.accountRoot,'other','PILOT'),{event:'BEGIN',runId:'new',sourceSha:'a'.repeat(40),profile:'PILOT',provenanceDigest:'b'.repeat(64),cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,startedAt:1});await expect(runFormalPilotLaunch(a,key)).rejects.toThrow('FORMAL_INVENTORY_DRIFT');expect(key).not.toHaveBeenCalled();}finally{s.cleanup();}});
it('pre-existing account lock blocks key and proposal consumption',async()=>{const s=setup();try{const a=s.load(),p=inspectFormalPilotLaunch(a),key=vi.fn();writeFileSync(join(s.accountRoot,'account.lock'),'SYNTHETIC');await expect(runFormalPilotLaunch(a,key)).rejects.toThrow('ACCOUNT_LOCKED');expect(key).not.toHaveBeenCalled();expect(existsSync(p.proposalMarker)).toBe(false);}finally{s.cleanup();}});
it('concurrent launch cannot obtain a second key',async()=>{const s=setup();try{const a=s.load();let entered!:()=>void,release!:(v:string)=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});const pending=new Promise<string>(resolve=>{release=resolve;});const key=vi.fn(async()=>{entered();return pending;});const first=runFormalPilotLaunch(a,key);await ready;await expect(runFormalPilotLaunch(a,key)).rejects.toThrow();release('');await expect(first).rejects.toThrow('CREDENTIAL_INVALID');expect(key).toHaveBeenCalledTimes(1);}finally{s.cleanup();}});
it.each([false,true,"SMALL_106"] as const)('one frozen formal run uses 76 fake HTTP calls and cannot be repeated (typed105=%s)',async typed=>{
 const s=setup(typed);try{
  const {frozenContextProposal,encodeFixtureV3}=await import('./context-pointer-fixtures');const a=s.load(),targets=deriveBoundedPilotManifest(s.root).targets;let calls=0;
  vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init:RequestInit)=>{const request=JSON.parse(String(init.body)),target=targets[calls++];expect(request.model).toBe('google/gemini-2.5-flash-lite');expect(request.provider.only).toEqual(['google-vertex/eu']);const input=JSON.parse(request.messages[1].content);for(const key of ['numericOwnership','fieldCapability','evidenceSources'])delete input[key];const bound=ContextInputSchema.parse(input);const proposal=frozenContextProposal(bound,target.fixtureId,target.turnIndex);const content=typed==="SMALL_106"?encodeSmallContextV3(ConversationInterpretationV3Schema.parse(proposal),bound):typed?encodeGoogleLiteEuTypedContextV3(ConversationInterpretationV3Schema.parse(proposal),bound):encodeFixtureV3(proposal,bound);return new Response(JSON.stringify({model:request.model,provider:'Google',id:'gen-synthetic-formal',usage:{cost:.0001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]}),{status:200,headers:{'content-type':'application/json'}});}));
  const key=vi.fn(async()=> 'SYNTHETIC_ONLY');const result=await runFormalPilotLaunch(a,key);
  expect(result).toMatchObject({pilotCredit:true,providerHttpAttempts:76,physicalProviderHttpAttempts:76});expect(result.score).toMatchObject({passedScripts:32,passedTurns:84,safetyFailures:0});expect(key).toHaveBeenCalledTimes(1);expect(calls).toBe(76);
  if(typed)expect(inspectConservativeDebugCost(s.accountRoot,10000000,105472)).toMatchObject({unknownCount:1,conservativeRetainedMicrounits:107600});
  await expect(runFormalPilotLaunch(a,key)).rejects.toThrow();expect(key).toHaveBeenCalledTimes(1);expect(calls).toBe(76);
 }finally{vi.unstubAllGlobals();s.cleanup();}
},120000);
it('provider rejection is terminal with one fake HTTP call and no retry',async()=>{const s=setup();try{const a=s.load(),key=vi.fn(async()=> 'SYNTHETIC_ONLY'),network=vi.fn(async()=>new Response(JSON.stringify({error:{code:429,message:'SYNTHETIC_RATE_LIMIT'}}),{status:429,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',network);const result=await runFormalPilotLaunch(a,key);expect(result.pilotCredit).toBe(false);expect(network).toHaveBeenCalledTimes(1);await expect(runFormalPilotLaunch(a,key)).rejects.toThrow();expect(network).toHaveBeenCalledTimes(1);}finally{vi.unstubAllGlobals();s.cleanup();}},30000);
it('inventory drift during credential await stops before first HTTP',async()=>{const s=setup();try{const a=s.load(),network=vi.fn();vi.stubGlobal('fetch',network);const key=vi.fn(async()=>{mkdirSync(join(s.accountRoot,'late','PILOT'),{recursive:true});appendCampaignEvent(join(s.accountRoot,'late','PILOT'),{event:'BEGIN',runId:'late',sourceSha:'a'.repeat(40),profile:'PILOT',provenanceDigest:'b'.repeat(64),cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,startedAt:1});return 'SYNTHETIC_ONLY';});await expect(runFormalPilotLaunch(a,key)).rejects.toThrow('FORMAL_INVENTORY_DRIFT');expect(network).not.toHaveBeenCalled();expect(key).toHaveBeenCalledTimes(1);}finally{vi.unstubAllGlobals();s.cleanup();}});
it('loaded-source failure after credential await stops before first HTTP',async()=>{const s=setup();const loader=await import('./register-conversation-loader.mjs'),check=vi.mocked(loader.assertLoadedCandidateModules);try{const a=s.load(),network=vi.fn();vi.stubGlobal('fetch',network);await expect(runFormalPilotLaunch(a,async()=>{check.mockImplementation(()=>{throw Error('SYNTHETIC_LOADED_SOURCE_DRIFT');});return 'SYNTHETIC_ONLY';})).rejects.toThrow('SYNTHETIC_LOADED_SOURCE_DRIFT');expect(network).not.toHaveBeenCalled();}finally{check.mockReset();check.mockImplementation(()=>({loadedApplicationModules:71,loadedApplicationProof:'PASS'}));vi.unstubAllGlobals();s.cleanup();}});
it('owner marker alone blocks key acquisition',async()=>{const s=setup();try{const a=s.load(),p=inspectFormalPilotLaunch(a),key=vi.fn();writeFileSync(p.ownerMarker,'{}');await expect(runFormalPilotLaunch(a,key)).rejects.toThrow('FORMAL_CONSUMED');expect(key).not.toHaveBeenCalled();expect(existsSync(p.proposalMarker)).toBe(false);}finally{s.cleanup();}});
it('partial marker-write failure leaves proposal consumed without reading key',async()=>{const s=setup();const storage=await import('./context-contract-candidate-validation'),original=storage.appendCandidateValidationRecord;let spy:ReturnType<typeof vi.spyOn>|undefined;try{const a=s.load(),p=inspectFormalPilotLaunch(a),key=vi.fn();spy=vi.spyOn(storage,'appendCandidateValidationRecord').mockImplementation((root,path,value)=>{if(path===p.ownerMarker)throw Error('SYNTHETIC_STORAGE_FAILURE');return original(root,path,value);});await expect(runFormalPilotLaunch(a,key)).rejects.toThrow('SYNTHETIC_STORAGE_FAILURE');expect(existsSync(p.proposalMarker)).toBe(true);expect(key).not.toHaveBeenCalled();await expect(runFormalPilotLaunch(a,key)).rejects.toThrow('ACCOUNT_LOCKED');expect(key).not.toHaveBeenCalled();}finally{spy?.mockRestore();s.cleanup();}});

it('typed105 authority selects the typed request and stops on its first provider error without retry',async()=>{
 const s=setup(true),network=vi.fn(async(_url:unknown,init:RequestInit)=>{
  const request=JSON.parse(String(init.body));expect(request.response_format.json_schema.name).toBe('calenote_context_typed_105');
  expect(request.messages[0].content).toContain('Typed transport105:');
  return new Response(JSON.stringify({error:{code:429,message:'SYNTHETIC_RATE_LIMIT'}}),{status:429,headers:{'content-type':'application/json'}});
 });
 try{vi.stubGlobal('fetch',network);const key=vi.fn(async()=> 'SYNTHETIC_ONLY');const a=s.load();
  const result=await runFormalPilotLaunch(a,key);expect(result.pilotCredit).toBe(false);expect(network).toHaveBeenCalledTimes(1);
  await expect(runFormalPilotLaunch(a,key)).rejects.toThrow();expect(key).toHaveBeenCalledTimes(1);
 }finally{vi.unstubAllGlobals();s.cleanup();}
},30000);
it('typed105 authority cannot downgrade its debug protocol or claim HOLD as paid authorization',()=>{
 const s=setup(true);try{
  expect(()=>s.load({paid:'HOLD'})).toThrow();expect(()=>s.load({wireProtocol:'HISTORICAL_104'})).toThrow();
  expect(()=>s.load({version:'formal-pilot-launch-authority-1'})).toThrow();
  const debug=JSON.parse(readFileSync(s.record.debugRecordPath,'utf8'));delete debug.wireProtocol;debug.version='t11-debug-loop-authority-1';
  writeFileSync(s.record.debugRecordPath,JSON.stringify(debug));expect(()=>s.load({debugRecordSha256:hash(JSON.stringify(debug))})).toThrow('FORMAL_PROTOCOL_BINDING');
 }finally{s.cleanup();}
});
it('typed105 budget authority cannot bypass the Formal launcher through a public debug executor',async()=>{
 const s=setup(true),debug=await import('./context-debug-loop'),transport=vi.fn(async()=>({status:503,body:'{}'})),hook=vi.fn();
 try{const a=debug.createDebugLoopLoader({accountRoot:s.accountRoot,campaignRoot:s.campaignRoot,reviewedRecordSha256:s.record.debugRecordSha256,reviewedOwnerMessageSha256:s.record.ownerMessageSha256,wireProtocol:'TYPED_105'})(s.record.debugRecordPath,s.root);
  await expect(debug.runDebugLoopExecution(a,candidate,'FORMAL_PILOT',transport,{beforeExecution:hook})).rejects.toThrow('DEBUG_TYPED_FORMAL_LAUNCHER_REQUIRED');
  await expect(debug.runTrustedDebugLoopExecution(a,candidate,'FORMAL_PILOT','SYNTHETIC_ONLY')).rejects.toThrow('DEBUG_TYPED_FORMAL_LAUNCHER_REQUIRED');
  expect(transport).not.toHaveBeenCalled();expect(hook).not.toHaveBeenCalled();expect(existsSync(join(s.accountRoot,'account.lock'))).toBe(false);
 }finally{s.cleanup();}
});

it('typed105 bridge refuses an inactive token and forged bridge key',async()=>{
 const s=setup(true);try{const a=s.load(),debug=await import('./context-debug-loop');
  expect(()=>takeFormalPilotExecution(a,{})).toThrow('FORMAL_BRIDGE_REQUIRED');
  await expect(debug.runFormalPilotDebugExecution(a)).rejects.toThrow('FORMAL_EXECUTION_DELEGATION_REQUIRED');
  expect(existsSync(join(s.accountRoot,'account.lock'))).toBe(false);
 }finally{s.cleanup();}
});
it('typed105 concurrent entry before the lock cannot overwrite the owned execution',async()=>{
 const s=setup(true);let entered!:()=>void,release!:(value:string)=>void;const ready=new Promise<void>(resolve=>{entered=resolve;}),pending=new Promise<string>(resolve=>{release=resolve;});
 const key=vi.fn(async()=>{entered();return pending;});
 try{const a=s.load(),first=runFormalPilotLaunch(a,key);
  await expect(runFormalPilotLaunch(a,key)).rejects.toThrow('FORMAL_EXECUTION_IN_PROGRESS');
  await ready;release('');await expect(first).rejects.toThrow('CREDENTIAL_INVALID');expect(key).toHaveBeenCalledTimes(1);
 }finally{s.cleanup();}
});

it('small106 cannot use typed105 authority or downgrade debug protocol',()=>{
 const s=setup("SMALL_106");try{
  expect(()=>s.load({version:'formal-pilot-launch-authority-2'})).toThrow();
  expect(()=>s.load({wireProtocol:'TYPED_105'})).toThrow();
  const debug=JSON.parse(readFileSync(s.record.debugRecordPath,'utf8'));debug.version='t11-debug-loop-authority-2';debug.wireProtocol='TYPED_105';
  writeFileSync(s.record.debugRecordPath,JSON.stringify(debug));expect(()=>s.load({debugRecordSha256:hash(JSON.stringify(debug))})).toThrow('FORMAL_PROTOCOL_BINDING');
 }finally{s.cleanup();}
});
it('small106 stops at first provider rejection with no retry and no grant reuse',async()=>{
 const s=setup("SMALL_106"),network=vi.fn(async(_url:unknown,init:RequestInit)=>{
  const request=JSON.parse(String(init.body));expect(request.messages[0].content).toContain('106');
  return new Response(JSON.stringify({error:{code:429}}),{status:429,headers:{'content-type':'application/json'}});
 });try{vi.stubGlobal('fetch',network);const a=s.load(),key=vi.fn(async()=> 'SYNTHETIC_ONLY');
 const r=await runFormalPilotLaunch(a,key);expect(r.pilotCredit).toBe(false);expect(network).toHaveBeenCalledTimes(1);
 await expect(runFormalPilotLaunch(a,key)).rejects.toThrow();expect(key).toHaveBeenCalledTimes(1);
 }finally{vi.unstubAllGlobals();s.cleanup();}
},30000);
it('small106 cannot bypass Formal launcher through public debug entry points',async()=>{
 const s=setup("SMALL_106"),debug=await import('./context-debug-loop'),transport=vi.fn(),hook=vi.fn();try{
 const a=debug.createDebugLoopLoader({accountRoot:s.accountRoot,campaignRoot:s.campaignRoot,reviewedRecordSha256:s.record.debugRecordSha256,reviewedOwnerMessageSha256:s.record.ownerMessageSha256,wireProtocol:'SMALL_106'})(s.record.debugRecordPath,s.root);
 await expect(debug.runDebugLoopExecution(a,candidate,'FORMAL_PILOT',transport,{beforeExecution:hook})).rejects.toThrow('DEBUG_TYPED_FORMAL_LAUNCHER_REQUIRED');
 await expect(debug.runTrustedDebugLoopExecution(a,candidate,'FORMAL_PILOT','SYNTHETIC_ONLY')).rejects.toThrow('DEBUG_TYPED_FORMAL_LAUNCHER_REQUIRED');
 expect(transport).not.toHaveBeenCalled();expect(hook).not.toHaveBeenCalled();expect(existsSync(join(s.accountRoot,'account.lock'))).toBe(false);
 }finally{s.cleanup();}
});
