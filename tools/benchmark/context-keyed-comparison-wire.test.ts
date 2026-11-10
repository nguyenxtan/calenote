// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ConversationInterpretationV3Schema,V3_SLOT_NAMES,type ContextInput} from '../../src/modules/conversation/context-contract/contracts';
import {decodeSmallContextV3,encodeSmallContextV3} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-small-wire';
import {CONTEXT_SMALL_PROTOCOL_V3} from '../../src/modules/conversation/context-contract/small-protocol';
import {keyedSmallComparisonSchema,encodeKeyedSmallComparison,decodeKeyedSmallComparison,KEYED_OPERATION_NAMES} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
import {CONTEXT_KEYED_COMPARISON_PROMPT,serializeKeyedSmallComparison} from '../../src/modules/conversation/context-contract/keyed-small-wire';
import {serializeSmallContextRequest} from '../../src/modules/conversation/context-contract/small-wire';
import {googleLiteEuTypedOrderedContextValidationSchemaV3} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-typed-wire';
import {admitCanonicalCampaign,type ContextManifest} from './context-contract';
import {runContextFixtureCampaign,createContextContractProbe} from './context-contract-probe';
import {frozenContextProposal} from './context-contract-fixtures';
import {factorContextSchema} from './context-schema-factor';
import {openAiComparisonAdmissionSchema} from './context-openai-admission-schema';
import {constrainComparisonDateSchema} from './context-comparison-date-schema';
import {isRetainedClosedRelationFieldUncertaintyAbsent,isInitialClocklessSeriesUncertaintyAbsent} from '../../src/modules/conversation/context-contract/field-capability';
import {isUnreconciledListInterpretation,readListTransport} from '../../src/modules/conversation/context-contract/list-period-transport';
import {keyedInitialEventOperationRequired} from '../../src/modules/intelligence/infrastructure/openrouter/context-keyed-initial-event-operation';
type AuditShape={properties?:Record<string,AuditShape>;anyOf?:AuditShape[];items?:AuditShape;$defs?:unknown;[key:string]:unknown};
function noForcedEmpty(value:unknown):void {if(Array.isArray(value)){value.forEach(noForcedEmpty);return;}if(!value||typeof value!=='object')return;const node=value as Record<string,unknown>;expect(node.maxItems).not.toBe(0);for(const key of ['anyOf','oneOf'])if(Array.isArray(node[key]))expect(node[key].length).toBeGreaterThan(0);Object.values(node).forEach(noForcedEmpty);}
const compileAuditShape=(schema:AuditShape)=>z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
it('preserves all 144 healthy canonical outcomes using typed keyed writes in the declared canonical field order',async()=>{
 const manifest:ContextManifest={version:'context-contract-corpus-1',cases:['regressions','development','heldout'].flatMap(n=>JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${n}.json`,'utf8')).cases)};
 let count=0,pairs=0;const failures:unknown[]=[];
 await runContextFixtureCampaign(admitCanonicalCampaign(manifest,'FULL'),{sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106'},(input,id,index)=>{
  try{
  const raw=frozenContextProposal(input,id,index),canonical=ConversationInterpretationV3Schema.safeParse(raw);if(!canonical.success)return raw;
  count++;const sorted={...canonical.data,changes:[...canonical.data.changes].sort((a,b)=>V3_SLOT_NAMES.indexOf(a.field)-V3_SLOT_NAMES.indexOf(b.field))};
  expect(serializeKeyedSmallComparison(input).messages[1]).toEqual(serializeSmallContextRequest(input).messages[1]);
  const wire=encodeKeyedSmallComparison(canonical.data,input) as {changes:{owners:Record<string,unknown[]>}};
  expect(Object.keys(wire.changes)).toEqual(['owners']);
  const selected=keyedSmallComparisonSchema(input) as unknown as AuditShape;noForcedEmpty(selected);const policy=googleLiteEuTypedOrderedContextValidationSchemaV3(input);
  const schema=factorContextSchema(openAiComparisonAdmissionSchema(constrainComparisonDateSchema(selected))).schema;
  const producer=z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);expect(producer.safeParse(wire).success).toBe(true);
  for(const required of policy.requiredChangeFields){
   const absent=structuredClone(wire);absent.changes.owners[required]=[];expect(producer.safeParse(absent).success,`${id}/${index}/${required}: absent`).toBe(false);
   const cleared=structuredClone(wire) as {changes:{owners:Record<string,Array<{write:Array<{operation:string}>}>>}};
   cleared.changes.owners[required][0].write[0].operation='REPLACE';expect(producer.safeParse(cleared).success,`${id}/${index}/${required}: replace`).toBe(false);
   cleared.changes.owners[required][0].write=[];expect(producer.safeParse(cleared).success,`${id}/${index}/${required}: clear`).toBe(false);
  }
  const strict=policy.schema as AuditShape,strictIssues=compileAuditShape({$defs:strict.$defs,...strict.properties!.uncertainties.items!}),fieldIssues=selected.properties!.uncertainties?compileAuditShape(selected.properties!.uncertainties.items!):null;
  const controlSchemaRaw=selected.properties!.operation.anyOf!.find(branch=>branch.properties!.controlUncertainties)?.properties!.controlUncertainties.items,controlIssues=controlSchemaRaw?compileAuditShape(controlSchemaRaw):null,strictOperation=compileAuditShape({$defs:strict.$defs,...strict.properties!.operationCode}),controlsAllowed=Object.keys(KEYED_OPERATION_NAMES).some(code=>!['0','1','2'].includes(code)&&strictOperation.safeParse(code).success);
  const operationIssuesSchema=selected.properties!.operation.anyOf!.find(branch=>branch.properties!.operationUncertainties)?.properties!.operationUncertainties.items,operationIssues=operationIssuesSchema?compileAuditShape(operationIssuesSchema):null;
  for(let fieldCode=0;fieldCode<=15;fieldCode++)for(const reason of ['MISSING','AMBIGUOUS','CONFLICT','UNSUPPORTED_COMBINATION']){
   pairs++;const row={fieldCode,reason,alternatives:[]},actual=fieldCode===15?(operationIssues?.safeParse({reason,alternatives:[]}).success??false):[13,14].includes(fieldCode)?(controlIssues?.safeParse(row).success??false)||(controlIssues?.safeParse({fieldCode,reason}).success??false):(fieldIssues?.safeParse(row).success??false)||(fieldIssues?.safeParse({fieldCode,reason}).success??false);
   expect(actual,`${id}/${index}/${fieldCode}/${reason}: selected uncertainty intersection`).toBe(strictIssues.safeParse(row).success&&!(fieldCode<13&&reason==='MISSING')&&(![13,14].includes(fieldCode)||controlsAllowed)&&(fieldCode>=13||!(isRetainedClosedRelationFieldUncertaintyAbsent(input)||isInitialClocklessSeriesUncertaintyAbsent(input)))&&(!keyedInitialEventOperationRequired(input)||fieldCode<13));
  }
  const actual=decodeKeyedSmallComparison(wire,input),expected=decodeSmallContextV3(encodeSmallContextV3(sorted,input),CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input);
  if(actual.status==='PARSED'&&expected.status==='PARSED'&&isUnreconciledListInterpretation(actual.value)&&isUnreconciledListInterpretation(expected.value))expect(readListTransport(actual.value)).toEqual(readListTransport(expected.value));else expect(actual).toEqual(expected);
  const field=Object.keys(wire.changes.owners).find(key=>wire.changes.owners[key].length===1);if(field){const bad=structuredClone(wire);bad.changes.owners[field].push(bad.changes.owners[field][0]);const before=JSON.stringify(bad);expect(decodeKeyedSmallComparison(bad,input).status).toBe('REFUSED');expect(JSON.stringify(bad)).toBe(before);}
  return raw;
  }catch(error){failures.push(error);return frozenContextProposal(input,id,index);}
 });
 expect(failures).toEqual([]);
 expect(count).toBe(144);expect(pairs).toBe(9216);expect(CONTEXT_KEYED_COMPARISON_PROMPT).toContain('changes is exactly {owners:{...}}');
},process.env.CI?240000:90000);
it('refuses both observed owner/order failure shapes without reconstructing a missing write',()=>{
 const input=(JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/small106-r02-turn2-before.json','utf8')) as {input:ContextInput}).input;
 for(const c of [{v:{g:[]},o:['g']},{v:{},o:['event','event']},[]])expect(decodeKeyedSmallComparison({c},input).status).toBe('REFUSED');
});
it('does not instruct the comparison model to emit the replaced owner dictionary',()=>{
 for(const obsolete of ['changes is exactly {owners,order}','owners empty and order=[]','Empty field owner','Each c[] row','There is no changes array','Omit unchanged fields','A LIST query with c=[]'])expect(CONTEXT_KEYED_COMPARISON_PROMPT).not.toContain(obsolete);
});
it('ignores JSON member order and refuses old numeric operations and future evidence aliases',()=>{
 const input=(JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/small106-r02-turn2-before.json','utf8')) as {input:ContextInput}).input;
 const proposal=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R02',2));
 const wire=encodeKeyedSmallComparison(proposal,input) as {operation:{code:string};changes:{owners:Record<string,Array<{evidence:string[]}>>}};
 const reversed={...wire,changes:{owners:Object.fromEntries(Object.entries(wire.changes.owners).reverse())}};
 expect(decodeKeyedSmallComparison(reversed,input)).toEqual(decodeKeyedSmallComparison(wire,input));
 const old=structuredClone(wire);old.operation.code='0';expect(decodeKeyedSmallComparison(old,input).status).toBe('REFUSED');
 const future=structuredClone(wire),owner=Object.values(future.changes.owners).find(value=>value.length)!;owner[0].evidence=['Ff999999'];expect(decodeKeyedSmallComparison(future,input).status).toBe('REFUSED');
});
it('retains existing strict mandatory owner requirements in the generation grammar',()=>{
 const input=(JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/small106-r02-turn2-before.json','utf8')) as {input:ContextInput}).input;
 const initial={...input,turns:input.turns.slice(0,1),currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[]};
 const value=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(initial,'R02',0)),initial) as {changes:{owners:Record<string,unknown[]>}};
 const fields=googleLiteEuTypedOrderedContextValidationSchemaV3(initial).requiredChangeFields;expect(fields).toContain('title');
 const schema=z.fromJSONSchema(keyedSmallComparisonSchema(initial) as Parameters<typeof z.fromJSONSchema>[0]);expect(schema.safeParse(value).success).toBe(true);
 for(const field of fields){const bad=structuredClone(value);bad.changes.owners[field]=[];expect(schema.safeParse(bad).success,field).toBe(false);expect(decodeKeyedSmallComparison(bad,initial).status).toBe('REFUSED');}
 for(const field of fields){
  const bad=structuredClone(value) as {changes:{owners:Record<string,Array<{write:Array<{operation:string}>}>>}};
  bad.changes.owners[field][0].write[0].operation='REPLACE';expect(schema.safeParse(bad).success,field).toBe(false);
  bad.changes.owners[field][0].write=[];expect(schema.safeParse(bad).success,field).toBe(false);
 }
 for(const code of ['HELP','CLARIFY_INTENT','LIST_REMINDERS'])expect(schema.safeParse({...value,operation:{code,targetEvidence:[]}}).success,code).toBe(false);
});
it('omits zero-capacity tables and untargeted evidence instead of forcing the provider to generate closed empty arrays',()=>{
 const input=(JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/typed105-r01-before.json','utf8')) as {input:ContextInput}).input;
 const value=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0)),input) as {operation:Record<string,unknown>};
 for(const key of ['texts','integers','dates','clocks','periods'])expect(value).not.toHaveProperty(key);
 expect(value.operation).not.toHaveProperty('targetEvidence');
 const producer=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);expect(producer.safeParse(value).success).toBe(true);
 expect(producer.safeParse({...value,texts:[]}).success).toBe(false);
 expect(producer.safeParse({...value,operation:{...value.operation,targetEvidence:[]}}).success).toBe(false);
 expect(decodeKeyedSmallComparison(value,input).status).toBe('PARSED');
 const missingQuery={...value,operation:{...value.operation,query:[]}};expect(decodeKeyedSmallComparison(missingQuery,input).status).toBe('REFUSED');expect(producer.safeParse(missingQuery).success).toBe(false);
});
it('makes targeted unknown-action operations require their own typed operation uncertainty',()=>{
 const input=(JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/small106-r02-turn2-before.json','utf8')) as {input:ContextInput}).input;
 const initial={...input,turns:input.turns.slice(0,1),currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[]};
 const value=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(initial,'R02',0)),initial) as {operation:Record<string,unknown>;uncertainties:unknown[]};
 const schema=z.fromJSONSchema(keyedSmallComparisonSchema(initial) as Parameters<typeof z.fromJSONSchema>[0]);
 const unknown={...value,operation:{...value.operation,code:'UNKNOWN_ACTION_NEW_TARGET',operationUncertainties:[],controlUncertainties:[]}};
 expect(schema.safeParse(unknown).success).toBe(false);
 unknown.operation.operationUncertainties=[{reason:'AMBIGUOUS',alternatives:[{value:'NEW',evidence:['U0']}]}] as never[];
 expect(schema.safeParse(unknown).success).toBe(true);expect(decodeKeyedSmallComparison(unknown,initial).status).toBe('PARSED');
 const wrong=structuredClone(unknown);(wrong.operation.operationUncertainties as unknown as Array<{alternatives:Array<{value:string}>}>)[0].alternatives[0].value='BEFORE_EVENT';expect(schema.safeParse(wrong).success).toBe(false);
 const duplicate={...value,uncertainties:[{fieldCode:15,reason:'MISSING',alternatives:[]}]};expect(schema.safeParse(duplicate).success).toBe(false);
 const overLimit={...unknown,operation:{...unknown.operation,operationUncertainties:Array.from({length:4},()=>({reason:'MISSING',alternatives:[]}))},uncertainties:[{fieldCode:6,reason:'MISSING',alternatives:[]}]};
 expect(decodeKeyedSmallComparison(overLimit,initial).status).toBe('REFUSED');
 const continuation=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R02',2)),input) as {operation:Record<string,unknown>};
 const continuedSchema=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);
 for(const evidence of [['U0'],[`F${input.facts[0].alias}`]]){
  const stale={...continuation,operation:{...continuation.operation,operationUncertainties:[{reason:'AMBIGUOUS',alternatives:[{value:'CURRENT',evidence}]}]}};
  expect(continuedSchema.safeParse(stale).success).toBe(false);expect(decodeKeyedSmallComparison(stale,input).status).toBe('REFUSED');
 }
});
it('preserves selected strict uncertainty field/reason exclusions before generation',()=>{
 const input=(JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/small106-r02-turn2-before.json','utf8')) as {input:ContextInput}).input;
 const initial={...input,turns:input.turns.slice(0,1),currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[]};
 const value=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(initial,'R02',0)),initial);
 const schema=z.fromJSONSchema(keyedSmallComparisonSchema(initial) as Parameters<typeof z.fromJSONSchema>[0]);
 for(const issue of [{fieldCode:10,reason:'AMBIGUOUS',alternatives:[]},{fieldCode:5,reason:'MISSING',alternatives:[]}]){
  const bad={...value,uncertainties:[issue]};expect(decodeKeyedSmallComparison(bad,initial).status).toBe('REFUSED');expect(schema.safeParse(bad).success).toBe(false);
 }
});
it('excludes model-authored reminder completeness claims rather than letting optional absence or retained facts block readiness',()=>{
 const input=(JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/keyed121-r02-turn2-before.json','utf8')) as {input:ContextInput}).input;
 const value=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R02',2)),input),producer=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);
 for(const fieldCode of [1,12]){const missing={...value,uncertainties:[{fieldCode,reason:'MISSING',alternatives:[]}]};expect(producer.safeParse(missing).success).toBe(false);expect(decodeKeyedSmallComparison(missing,input).status).toBe('REFUSED');}
 const canonical=ConversationInterpretationV3Schema.parse({...frozenContextProposal(input,'R02',2) as object,uncertainties:[{field:'endDate',reason:'MISSING',alternatives:[]}]});expect(()=>encodeKeyedSmallComparison(canonical,input)).toThrow('KEYED_REMINDER_COMPLETENESS_OWNER');
});
it('still asks for an explicitly unresolved optional location and previews after the grounded answer',async()=>{
 let calls=0;
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106',liveBudgetProfile:'GPT5_MINI_AZURE_SWEDEN',liveGateway:{contextWire:'KEYED_COMPARISON_137',prepare(_tier,input){
  const evidence=[{kind:'USER_QUOTE',turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
  const value=ConversationInterpretationV3Schema.parse(calls===0?{...frozenContextProposal(input,'R12',0) as object,uncertainties:[{field:'location',reason:'AMBIGUOUS',alternatives:[]}],conversationDirective:null}:{schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'CURRENT',evidence},changes:[{field:'location',operation:'SET',value:'ở nhà',evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
  const decoded=decodeKeyedSmallComparison(encodeKeyedSmallComparison(value,input),input);if(decoded.status!=='PARSED')throw Error('DECODE_UNRESOLVED_LOCATION');
  return {status:'READY',model:'openai/gpt-5-mini',provider:'azure/swedencentral',maximumCostMicrounits:116759,routeAdmission:'OBSERVABLE_CANARY',async dispatch(){calls++;return {status:'SUCCESS',interpretation:decoded.value,usage:{costMicrounits:1000}};}};
 }}},()=>{throw Error('NO_OFFLINE_SEED');});
 try{expect(await probe.turn('Mai 8h nhắc gọi mẹ, địa điểm chưa biết.','2026-09-28T03:00:00Z')).toMatchObject({status:'CLARIFICATION_REQUESTED',pendingField:'location',apiPreviews:0,mutations:0});expect(await probe.turn('ở nhà','2026-09-28T03:01:00Z')).toMatchObject({status:'DRAFT_CREATED',pendingField:null,apiPreviews:1,mutations:0});expect(calls).toBe(2);}finally{probe.dispose();}
});
