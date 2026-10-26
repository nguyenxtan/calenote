import {COMPACT_KEYS} from '../../src/modules/intelligence/infrastructure/openrouter/context-small-compact';
import {runContextFixtureCampaign} from './context-contract-probe';
// @vitest-environment node
import {expect,it} from 'vitest';
import {z} from 'zod';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executeObservableCampaign,verifyContextRequestSchema} from './context-contract-runner';
import {admitCanonicalCampaign,scoreContextCampaign,type ContextManifest} from './context-contract';
import {frozenContextProposal} from './context-contract-fixtures';
import {ContextInputSchema,ConversationInterpretationV3Schema} from '../../src/modules/conversation/context-contract/contracts';
import {CONTEXT_SMALL_PROTOCOL_V3} from '../../src/modules/conversation/context-contract/small-protocol';
import {encodeSmallContextV3,decodeSmallContextV3,smallContextSchemaV3} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-small-wire';
it.each([false,true])('small106 frozen formal pilot uses typed application path (malformed=%s)',async malformed=>{
 const directory=mkdtempSync(join(tmpdir(),'small106-qualification-'));let calls=0;
 const manifest:ContextManifest={version:'context-contract-corpus-1',cases:['regressions','development','heldout'].flatMap(name=>JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`,'utf8')).cases)};
 const healthy=admitCanonicalCampaign(manifest,'PILOT').flatMap(script=>script.turns.flatMap((turn,index)=>turn.model==='HEALTHY'?[{id:script.executionId,index}]:[]));
 try {
 const result=await executeObservableCampaign({directory,sourceSha:'a'.repeat(40),provenanceDigest:'b'.repeat(64),runId:'small106',profile:'PILOT',wireProtocol:'SMALL_106',accountingPolicy:'CONFIRMED_COST_V1',boundedPilot:{manifestSha256:'c'.repeat(64),maxRequests:76,beforeDispatch(){},settled(){},outcome(){}},cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,now:()=>100,
 transport:async request=>{
  verifyContextRequestSchema(request,'SMALL_106');
  // Numeric-choice inventories are diagnostic, not acceptance gates. Exact
  // field domains are tested separately; validate every typed fixture below.
  if(calls===0)for(const mode of ['prompt','evidence','schema','name']){
   const altered=structuredClone(request);
   if(mode==='prompt')altered.messages[0].content+=' changed';
   if(mode==='schema')altered.response_format.json_schema.schema={} as never;
   if(mode==='name')altered.response_format.json_schema.name='calenote_context_3';
   if(mode==='evidence'){const payload=JSON.parse(altered.messages[1].content);payload.evidenceSources=[];altered.messages[1].content=JSON.stringify(payload);}
   expect(()=>verifyContextRequestSchema(altered,'SMALL_106')).toThrow('TYPED_PROVIDER_REQUEST_CHANGED');
  }
  const raw=JSON.parse(request.messages[1].content);for(const key of ['numericOwnership','fieldCapability','evidenceSources'])delete raw[key];
  const input=ContextInputSchema.parse(raw),item=healthy[calls++];
  const wire=encodeSmallContextV3(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,item.id,item.index)),input) as unknown as Record<string,unknown>;
  const schema=request.response_format.json_schema.schema;
  expect((schema.properties!.o as unknown as {anyOf:unknown[]}).anyOf).toHaveLength(5);
  expect(JSON.stringify(schema)).not.toMatch(/"(?:oneOf|\$ref|\$defs)"/u);
  expect(JSON.stringify(schema)).toContain('"enum":["date","receipt","weekday"]');
  const generation=z.fromJSONSchema(request.response_format.json_schema.schema as Parameters<typeof z.fromJSONSchema>[0]);
  expect(generation.safeParse(wire).success,JSON.stringify({fixture:item.id,turn:item.index})).toBe(true);
  const fieldCapability=JSON.parse(request.messages[1].content).fieldCapability;
  if(fieldCapability.eventDateYearNullRequired){
   const bad=structuredClone(wire) as unknown as ReturnType<typeof encodeSmallContextV3>;
   const row=(bad.c as {v:Record<string,Array<{w:Array<{v:Record<string,unknown>}>}>>}).v[COMPACT_KEYS.fields.eventDate]?.[0];
   if(row?.w[0]){row.w[0].v.y=[2026];expect(generation.safeParse(bad).success).toBe(false);expect(decodeSmallContextV3(bad,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input).status).toBe('REFUSED');}
  }
  if(malformed)(wire.o as Record<string,unknown>).q=JSON.stringify((wire.o as Record<string,unknown>).q);
  return {status:200,body:JSON.stringify({model:request.model,provider:'Google',id:`gen-typed-${calls}`,choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}],usage:{cost:.001,prompt_tokens:100,completion_tokens:100}})};
 }});
 if(malformed){expect(result.status).toBe('STOP');expect(calls).toBe(1);expect(result.applicationEvidence[0].mutations).toBe(0);}
 else {expect(result.status,JSON.stringify(result.applicationEvidence.at(-1))).toBe('PASS');expect(result.score).toMatchObject({passedScripts:32,passedTurns:84,safetyFailures:0});expect(calls).toBe(76);expect(result.providerHttpRequests).toBe(76);expect(result.responses.every(row=>row.providerWireSchemaVersion===CONTEXT_SMALL_PROTOCOL_V3.wireVersion&&row.providerWireSchemaDigest===row.requestWireSchemaDigest)).toBe(true);expect(new Set(result.responses.map(row=>row.providerWireSchemaDigest)).size).toBeGreaterThan(1);}
 expect(result.responses[0].canonicalSchemaDigest).toBe('43b6689ce9c4874c4d532652ea212b52aa7d7f222cddd55377e59d483f5c444b');
 }finally{rmSync(directory,{recursive:true,force:true});}
},30000);
it.each(['unbounded','full','single','prefix','replay'] as const)('small106 rejects scope %s before any transport',async mode=>{
 const directory=mkdtempSync(join(tmpdir(),'small106-scope-'));let calls=0;
 const input={directory,sourceSha:'a'.repeat(40),provenanceDigest:'b'.repeat(64),runId:'small106-scope',profile:'PILOT' as const,wireProtocol:'SMALL_106' as const,accountingPolicy:'CONFIRMED_COST_V1' as const,boundedPilot:{manifestSha256:'c'.repeat(64),maxRequests:76,beforeDispatch(){},settled(){},outcome(){}},cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,now:()=>100,transport:async()=>{calls++;return {status:503,body:'{}'};}};
 try {
  if(mode==='unbounded')delete (input as Partial<typeof input>).boundedPilot;
  if(mode==='full')Object.assign(input,{profile:'FULL'});
  if(mode==='single')Object.assign(input,{singleTarget:{fixture:'R01',turn:0,manifestSha256:'c'.repeat(64)}});
  if(mode==='prefix')Object.assign(input,{pilotPrefix:{directory,ledgerHash:'c'.repeat(64),responseDigest:'c'.repeat(64),applicationDigest:'c'.repeat(64)}});
  const run=mode==='replay'?(await import('./context-contract-runner')).executeObservableR01Turn0Replay:executeObservableCampaign;
  await expect(run(input)).rejects.toThrow();expect(calls).toBe(0);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('preserves all frozen original/development/heldout oracles through offline small106 service',async()=>{
 const manifest:ContextManifest={version:'context-contract-corpus-1',cases:['regressions','development','heldout'].flatMap(name=>JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`,'utf8')).cases)};
 const planned=admitCanonicalCampaign(manifest,'FULL');
 // Pure declarative fixture transport. No observable gateway or paid authority.
 const observed=await runContextFixtureCampaign(planned,{sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106'},frozenContextProposal);
 expect(scoreContextCampaign(planned,observed)).toMatchObject({gate:'PASS',plannedScripts:80,passedScripts:80,plannedTurns:158,passedTurns:158,healthyPlanned:144,healthyFullSchemaValid:144,detailPlanned:3941,detailPassed:3941,safetyFailures:0,heldoutPassed:32,plannedActions:5,passedActions:5,failedScripts:[],failedMandatory:[]});
},30000);


it('excludes an ungrounded series-count offset at the small generation boundary before typed decoding',async()=>{
 const manifest:ContextManifest={version:'context-contract-corpus-1',cases:['regressions','development','heldout'].flatMap(name=>JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`,'utf8')).cases)};
 const planned=admitCanonicalCampaign(manifest,'FULL').filter(script=>script.executionId==='R02');expect(planned).toHaveLength(1);
 let captured:ReturnType<typeof ContextInputSchema.parse>|undefined;
 await runContextFixtureCampaign(planned,{sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106'},(input,id,index)=>{
  if(index===1)captured=structuredClone(input);
  return frozenContextProposal(input,id,index);
 });expect(captured).toBeDefined();const input=ContextInputSchema.parse(captured);
 const proposal=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R02',1));
 const wire=encodeSmallContextV3(proposal,input),generation=z.fromJSONSchema(smallContextSchemaV3(input).schema as Parameters<typeof z.fromJSONSchema>[0]);
 expect(generation.safeParse(wire).success).toBe(true);
 const bad=structuredClone(wire);(bad.c as {v:Record<string,unknown[]>;o:string[]}).v.l=[{w:[{o:'s',v:2}],e:['U2']}];(bad.c as {o:string[]}).o.push('l');
 expect(decodeSmallContextV3(bad,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input).status).toBe('REFUSED');
 expect(generation.safeParse(bad).success).toBe(false);
},30000);

it('does not admit date or cadence rewrites for a certified retained-series relation answer',async()=>{
 const manifest:ContextManifest={version:'context-contract-corpus-1',cases:['regressions','development','heldout'].flatMap(name=>JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`,'utf8')).cases)};
 const planned=admitCanonicalCampaign(manifest,'FULL').filter(script=>script.executionId==='R02');let captured:ReturnType<typeof ContextInputSchema.parse>|undefined;
 await runContextFixtureCampaign(planned,{sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106'},(input,id,index)=>{if(index===1)captured=structuredClone(input);return frozenContextProposal(input,id,index);});
 const input=ContextInputSchema.parse(captured),proposal=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R02',1));
 const {isBoundRelationUncertaintyAbsent}=await import('../../src/modules/conversation/context-contract/field-capability');expect(isBoundRelationUncertaintyAbsent(input)).toBe(true);
 const wire=encodeSmallContextV3(proposal,input),generation=z.fromJSONSchema(smallContextSchemaV3(input).schema as Parameters<typeof z.fromJSONSchema>[0]);expect(generation.safeParse(wire).success).toBe(true);
 const bad=structuredClone(wire);(bad.c as {v:Record<string,unknown[]>;o:string[]}).v.notify=[{w:[{o:'s',v:{k:'receipt',c:[],d:[],m:[],y:[],l:[],o:[-2],w:[],q:[]}}],e:['U2']}];(bad.c as {o:string[]}).o.push('notify');
 expect(generation.safeParse(bad).success).toBe(false);
 for(const field of ['frequency','occurrenceCount']){const cadence=structuredClone(wire);const key=COMPACT_KEYS.fields[field as 'frequency'|'occurrenceCount'];(cadence.c as {v:Record<string,unknown[]>}).v[key]=[{w:[{o:'r',v:field==='occurrenceCount'?2:'d'}],e:['U2']}];(cadence.c as {o:string[]}).o.push(key);expect(generation.safeParse(cadence).success).toBe(false);expect(decodeSmallContextV3(cadence,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input).status).toBe('REFUSED');}
 for(const text of ['Ngày mai nhắc tôi.','Nhắc trước 3 ngày.','Không nhắc trước 2 ngày.','Tôi chỉ trích câu “Nhắc trước 2 ngày”.','Nếu nhắc trước 2 ngày thì sao?']){
  const independent=structuredClone(input);independent.turns[independent.currentTurn].text=text;expect(isBoundRelationUncertaintyAbsent(independent)).toBe(false);
  const independentSchema=smallContextSchemaV3(independent).schema as unknown as {properties:{c:{properties:{v:{properties:Record<string,unknown>}}}}};const fields=Object.keys(independentSchema.properties.c.properties.v.properties);for(const field of ['reminderDate','frequency','occurrenceCount'])expect(fields).toContain(COMPACT_KEYS.fields[field as 'reminderDate'|'frequency'|'occurrenceCount']);
 }
},30000);
