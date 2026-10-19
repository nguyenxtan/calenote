// @vitest-environment node
import {expect,it} from 'vitest';
import {z} from 'zod';
import {auditTypedNumericChoiceUnions} from './context-typed-grammar-audit';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executeObservableCampaign,verifyContextRequestSchema} from './context-contract-runner';
import {admitCanonicalCampaign,type ContextManifest} from './context-contract';
import {frozenContextProposal} from './context-contract-fixtures';
import {ContextInputSchema,ConversationInterpretationV3Schema} from '../../src/modules/conversation/context-contract/contracts';
import {encodeGoogleLiteEuTypedContextV3} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-typed-wire';
it.each([false,true])('typed105 frozen formal pilot uses typed application path (malformed=%s)',async malformed=>{
 const directory=mkdtempSync(join(tmpdir(),'typed105-qualification-'));let calls=0;
 const manifest:ContextManifest={version:'context-contract-corpus-1',cases:['regressions','development','heldout'].flatMap(name=>JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`,'utf8')).cases)};
 const healthy=admitCanonicalCampaign(manifest,'PILOT').flatMap(script=>script.turns.flatMap((turn,index)=>turn.model==='HEALTHY'?[{id:script.executionId,index}]:[]));
 try {
 const result=await executeObservableCampaign({directory,sourceSha:'a'.repeat(40),provenanceDigest:'b'.repeat(64),runId:'typed105',profile:'PILOT',wireProtocol:'TYPED_105',accountingPolicy:'CONFIRMED_COST_V1',boundedPilot:{manifestSha256:'c'.repeat(64),maxRequests:76,beforeDispatch(){},settled(){},outcome(){}},cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,now:()=>100,
 transport:async request=>{
  verifyContextRequestSchema(request,'TYPED_105');
  const numericChoices=auditTypedNumericChoiceUnions(request.response_format.json_schema.schema);
  expect(numericChoices).toEqual([]);
  if(calls===0)for(const mode of ['prompt','evidence','schema','name']){
   const altered=structuredClone(request);
   if(mode==='prompt')altered.messages[0].content+=' changed';
   if(mode==='schema')altered.response_format.json_schema.schema={} as never;
   if(mode==='name')altered.response_format.json_schema.name='calenote_context_3';
   if(mode==='evidence'){const payload=JSON.parse(altered.messages[1].content);payload.evidenceSources=[];altered.messages[1].content=JSON.stringify(payload);}
   expect(()=>verifyContextRequestSchema(altered,'TYPED_105')).toThrow('TYPED_PROVIDER_REQUEST_CHANGED');
  }
  const raw=JSON.parse(request.messages[1].content);for(const key of ['numericOwnership','fieldCapability','evidenceSources'])delete raw[key];
  const input=ContextInputSchema.parse(raw),item=healthy[calls++];
  const wire=encodeGoogleLiteEuTypedContextV3(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,item.id,item.index)),input) as Record<string,unknown>;
  const generation=z.fromJSONSchema(request.response_format.json_schema.schema as Parameters<typeof z.fromJSONSchema>[0]);
  expect(generation.safeParse(wire).success,JSON.stringify({fixture:item.id,turn:item.index})).toBe(true);
  if(malformed)wire.query=JSON.stringify(wire.query);
  return {status:200,body:JSON.stringify({model:request.model,provider:'Google',id:`gen-typed-${calls}`,choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}],usage:{cost:.001,prompt_tokens:100,completion_tokens:100}})};
 }});
 if(malformed){expect(result.status).toBe('STOP');expect(calls).toBe(1);expect(result.applicationEvidence[0].mutations).toBe(0);}
 else {expect(result.status,JSON.stringify(result.applicationEvidence.at(-1))).toBe('PASS');expect(result.score).toMatchObject({passedScripts:32,passedTurns:84,safetyFailures:0});expect(calls).toBe(76);expect(result.providerHttpRequests).toBe(76);expect(result.responses.every(row=>row.providerWireSchemaVersion.endsWith('105')&&row.providerWireSchemaDigest===row.requestWireSchemaDigest)).toBe(true);expect(new Set(result.responses.map(row=>row.providerWireSchemaDigest)).size).toBeGreaterThan(1);}
 expect(result.responses[0].canonicalSchemaDigest).toBe('43b6689ce9c4874c4d532652ea212b52aa7d7f222cddd55377e59d483f5c444b');
 }finally{rmSync(directory,{recursive:true,force:true});}
},30000);
it.each(['unbounded','full','single','prefix','replay'] as const)('typed105 rejects scope %s before any transport',async mode=>{
 const directory=mkdtempSync(join(tmpdir(),'typed105-scope-'));let calls=0;
 const input={directory,sourceSha:'a'.repeat(40),provenanceDigest:'b'.repeat(64),runId:'typed105-scope',profile:'PILOT' as const,wireProtocol:'TYPED_105' as const,accountingPolicy:'CONFIRMED_COST_V1' as const,boundedPilot:{manifestSha256:'c'.repeat(64),maxRequests:76,beforeDispatch(){},settled(){},outcome(){}},cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,now:()=>100,transport:async()=>{calls++;return {status:503,body:'{}'};}};
 try {
  if(mode==='unbounded')delete (input as Partial<typeof input>).boundedPilot;
  if(mode==='full')Object.assign(input,{profile:'FULL'});
  if(mode==='single')Object.assign(input,{singleTarget:{fixture:'R01',turn:0,manifestSha256:'c'.repeat(64)}});
  if(mode==='prefix')Object.assign(input,{pilotPrefix:{directory,ledgerHash:'c'.repeat(64),responseDigest:'c'.repeat(64),applicationDigest:'c'.repeat(64)}});
  const run=mode==='replay'?(await import('./context-contract-runner')).executeObservableR01Turn0Replay:executeObservableCampaign;
  await expect(run(input)).rejects.toThrow();expect(calls).toBe(0);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
