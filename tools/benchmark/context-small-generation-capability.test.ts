// @vitest-environment node
import {beforeAll,expect,it} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {z} from 'zod';
import {runContextFixtureCampaign,createContextContractProbe} from './context-contract-probe';
import {admitCanonicalCampaign,type ContextManifest} from './context-contract';
import {frozenContextProposal} from './context-contract-fixtures';
import {SLOT_NAMES,SlotValueSchemas,IntentSchema,ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../src/modules/conversation/context-contract/contracts';
import {deriveGenerationFieldCapability,isBoundRelationUncertaintyAbsent,isBoundReminderClockAnswer,isInitialFiniteSeriesWithoutRelationSource} from '../../src/modules/conversation/context-contract/field-capability';
import {encodeSmallContextV3,smallContextSchemaV3,decodeSmallContextV3} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-small-wire';
import {UNCERTAINTY_FIELD_WIRE_CODE_V1} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire';
import {CONTEXT_SMALL_PROTOCOL_V3} from '../../src/modules/conversation/context-contract/small-protocol';
const captured:Array<{input:ContextInput;id:string;index:number}>=[];
beforeAll(async()=>{
 const manifest:ContextManifest={version:'context-contract-corpus-1',cases:['regressions','development','heldout'].flatMap(name=>JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`,'utf8')).cases)};
 await runContextFixtureCampaign(admitCanonicalCampaign(manifest,'FULL'),{sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106'},(input,id,index)=>{captured.push({input:structuredClone(input),id,index});return frozenContextProposal(input,id,index);});
},30000);
const validator=(input:ContextInput)=>z.fromJSONSchema(smallContextSchemaV3(input).schema as Parameters<typeof z.fromJSONSchema>[0]);
const original=(row:typeof captured[number])=>encodeSmallContextV3(ConversationInterpretationV3Schema.parse(frozenContextProposal(row.input,row.id,row.index)),row.input);
function mutation(input:ContextInput,field:typeof SLOT_NAMES[number],operation='SET'){
 const date=['eventDate','reminderDate','endDate'].includes(field),clock=['eventTime','reminderTime'].includes(field),numeric=['occurrenceCount','leadOffsetDays'].includes(field);
 const text=field==='frequency'?'DAILY':field==='calendar'?'GREGORIAN':field==='eventRelation'?'BEFORE_EVENT':'synthetic';
 return {field,rank:0,operation,value:operation==='CLEAR'||date||clock||!numeric?null:2,text:operation==='CLEAR'||date||numeric||clock?null:text,date:operation==='CLEAR'||!date?[]:[{kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null}],clock:clock&&operation!=='CLEAR'?{hour:8,minute:0,qualifier:'H24'}:null,evidence:[`U${input.currentTurn}`]};
}
it('keeps every frozen healthy output admitted by the producer schema',()=>{
 expect(captured).toHaveLength(144);
 for(const row of captured)expect(validator(row.input).safeParse(original(row)).success,`${row.id}/${row.index}`).toBe(true);
});
it('covers all thirteen fields and three operations in certified relation answers without repairing extra mutations',()=>{
 const bound=captured.filter(row=>isBoundRelationUncertaintyAbsent(row.input));expect(bound.length).toBeGreaterThan(0);
 for(const row of bound){const accept=validator(row.input),wire=original(row);
  for(const field of SLOT_NAMES)for(const operation of ['SET','REPLACE','CLEAR']){
   const changed=structuredClone(wire);changed.changes=[mutation(row.input,field,operation)];changed.clocks=[];
   const permitted=field==='eventRelation'&&operation==='SET';expect(accept.safeParse(changed).success,`${field}/${operation}`).toBe(permitted);
   if(!permitted)expect(decodeSmallContextV3(changed,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');
  }
 }
});
it('projects every existing deterministic field exclusion, title operation and year-null bound',()=>{
 const checked=new Set<string>();
 for(const row of captured){const input=row.input,cap=deriveGenerationFieldCapability(input),accept=validator(input),wire=original(row);
  const forbidden=[...(!cap.notesProposalAllowed?['notes']:[]),...(!cap.calendarProposalAllowed?['calendar']:[]),...(!cap.reminderDateProposalAllowed?['reminderDate']:[]),...(['eventTime','reminderTime'] as const).filter(field=>!cap.allowedClockFields.includes(field))] as (typeof SLOT_NAMES[number])[];
  for(const field of forbidden){const changed=structuredClone(wire);changed.changes=[mutation(input,field)];changed.clocks=[];expect(accept.safeParse(changed).success,`${row.id}/${row.index}/${field}`).toBe(false);checked.add(field);}
  if(cap.titlePresenceRequired||!cap.titleCorrectionAllowed)for(const operation of ['REPLACE','CLEAR']){const changed=structuredClone(wire);changed.changes=[mutation(input,'title',operation)];expect(accept.safeParse(changed).success,`title/${operation}`).toBe(false);checked.add('title');}
  if(cap.eventDateYearNullRequired){const changed=structuredClone(wire);changed.changes=[mutation(input,'eventDate')];changed.changes[0].date[0].year=2026;expect(accept.safeParse(changed).success,'eventDate/year').toBe(false);for(const date of [{kind:'RELATIVE_DAY',offsetDays:1},{kind:'WEEKDAY',weekday:1,qualifier:'NEXT_WEEK'}]){const wrongKind=structuredClone(wire);wrongKind.changes=[{...mutation(input,'eventDate'),date:[date]}];expect(accept.safeParse(wrongKind).success,'eventDate/kind').toBe(false);}checked.add('eventDate');}
 }
 expect([...checked].sort()).toEqual(['calendar','eventDate','eventTime','notes','reminderDate','reminderTime','title']);
});
it('preserves independently grounded date, relation, cadence and count edits outside the whole-source certificate',()=>{
 const base=captured.find(row=>isBoundRelationUncertaintyAbsent(row.input));expect(base).toBeDefined();
 for(const [text,field] of [['Đổi ngày thi sang 12/10.','eventDate'],['Nhắc cả ngày thi.','eventRelation'],['Đổi số lần thành 3.','occurrenceCount'],['Đổi tần suất thành hằng ngày.','frequency']] as const){
  const input=ContextInputSchema.parse(structuredClone(base!.input));input.turns[input.currentTurn].text=text;expect(isBoundRelationUncertaintyAbsent(input)).toBe(false);
  const changed=original(base!);changed.changes=[mutation(input,field,field==='eventRelation'?'SET':'REPLACE')];if(field==='eventDate')changed.changes[0].date[0].day=12;if(field==='eventRelation')changed.changes[0].text='INCLUDING_EVENT';if(field==='occurrenceCount')changed.changes[0].value=3;if(field==='frequency')changed.changes[0].text='DAILY';
  expect(validator(input).safeParse(changed).success,field).toBe(true);
 }
});

it('rejects wrong value cells and enum strings before canonical materialization',()=>{
 let cells=0,enums=0;
 for(const row of captured){const wire=original(row),accept=validator(row.input);
  for(const [index,change] of wire.changes.entries()){
   const bad=structuredClone(wire);if(change.text!==null||change.date.length)bad.changes[index].value=9;else bad.changes[index].text='WRONG_VALUE_CELL';expect(accept.safeParse(bad).success).toBe(false);cells++;
   if(['frequency','calendar','eventRelation'].includes(change.field)&&change.operation!=='CLEAR'){const wrong=structuredClone(wire);wrong.changes[index].text='NOT_A_CANONICAL_ENUM';expect(accept.safeParse(wrong).success).toBe(false);enums++;}
  }
 }
 expect(cells).toBeGreaterThan(100);expect(enums).toBeGreaterThan(10);
});
it.each([
 ['Đổi ngày thi sang ngày 12/10.','eventDate','REPLACE',{kind:'CIVIL_DATE',calendar:'GREGORIAN',day:12,month:10,year:null,leapMonth:null}],
 ['Nhắc cả ngày thi.','eventRelation','SET','INCLUDING_EVENT'],
 ['Đổi số lần nhắc thành 3 lần.','occurrenceCount','REPLACE',3],
 ['Đổi thành nhắc 3 ngày liên tiếp.','frequency','REPLACE','DAILY'],
] as const)('keeps legitimate %s edits through gateway, evidence, draft persistence and API observation',async(text,field,operation,value)=>{
 let calls=0;const first=captured.find(row=>row.id==='R02'&&row.index===0)!;
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106'},input=>{
  if(calls++===0){const initial=frozenContextProposal(input,'R02',0) as {changes:Array<{field:string;value:unknown}>};return field==='frequency'?{...initial,changes:initial.changes.filter(change=>change.field!=='occurrenceCount').map(change=>change.field==='frequency'?{...change,value:'ONCE'}:change)}:initial;}
  const evidence=[{kind:'USER_QUOTE',turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
  return ConversationInterpretationV3Schema.parse({...ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R02',1)),changes:[{field,operation,value,evidence},...(field==='frequency'?[{field:'occurrenceCount',operation:'SET',value:3,evidence}]:[])],conversationDirective:null,replyProposal:null});
 });
 try{
  await probe.turn(field==='frequency'?'Ngày 11/10 đi thi ở Quang Trung, nhắc một lần giúp tôi.':first.input.turns[0].text,'2026-09-28T03:00:00Z');const result=await probe.turn(text,'2026-09-28T03:01:00Z');
  expect(result.status).toBe('CLARIFICATION_REQUESTED');expect(result.fullSchemaValid).toBe(true);expect(result.mutations).toBe(0);expect(result.draftRevision).toBe(2);
  expect(result.fields).toMatchObject({frequency:'DAILY',occurrenceCount:field==='occurrenceCount'||field==='frequency'?3:2,reminderDate:null,eventRelation:field==='eventRelation'?'INCLUDING_EVENT':null,eventDate:{kind:'CIVIL_DATE',day:field==='eventDate'?12:11,month:10,year:null}});
 }finally{probe.dispose();}
});
it('refuses the recorded mixed relation/cadence patch as a whole and preserves the previous draft',async()=>{
 let calls=0;const first=captured.find(row=>row.id==='R02'&&row.index===0)!;
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106'},input=>{
  if(calls++===0)return frozenContextProposal(input,'R02',0);
  const evidence=[{kind:'USER_QUOTE',turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
  return ConversationInterpretationV3Schema.parse({...ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R02',1)),changes:[{field:'occurrenceCount',operation:'REPLACE',value:2,evidence},{field:'frequency',operation:'REPLACE',value:'DAILY',evidence},{field:'eventRelation',operation:'SET',value:'BEFORE_EVENT',evidence}]});
 });
 try{
  await probe.turn(first.input.turns[0].text,'2026-09-28T03:00:00Z');const result=await probe.turn('Nhắc trước 2 ngày.','2026-09-28T03:01:00Z');
  expect(result.fullSchemaValid).toBe(false);expect(result.mutations).toBe(0);expect(result.draftRevision).toBe(1);expect(result.fields).toMatchObject({frequency:'DAILY',occurrenceCount:2,eventRelation:null,reminderDate:null});
 }finally{probe.dispose();}
});
it('measures schema structure across all healthy inputs without claiming compiler admission',()=>{
 const metrics=captured.map(row=>{
  const schema=smallContextSchemaV3(row.input).schema as unknown as Record<string,unknown>;let unions=0,maxWidth=0,maxDepth=0,maxNumericBound=0;
  const visit=(node:unknown,depth=0):void=>{if(!node||typeof node!=='object')return;maxDepth=Math.max(maxDepth,depth);const value=node as Record<string,unknown>;if(Array.isArray(value.anyOf)){unions++;maxWidth=Math.max(maxWidth,value.anyOf.length);}if(typeof value.maximum==='number')maxNumericBound=Math.max(maxNumericBound,value.maximum);for(const child of Object.values(value))if(Array.isArray(child))child.forEach(item=>visit(item,depth+1));else visit(child,depth+1);};visit(schema);
  const item=(schema as {properties:{changes:{items:{anyOf?:unknown[]}}}}).properties.changes.items;
  return {id:row.id,index:row.index,certified:isBoundRelationUncertaintyAbsent(row.input),bytes:Buffer.byteLength(JSON.stringify(schema)),unions,maxWidth,maxDepth,maxNumericBound,rowAlternatives:item.anyOf?.length??1};
 });
 expect(metrics.every(row=>row.rowAlternatives<=10&&row.maxWidth<=10)).toBe(true);expect(metrics.every(row=>row.bytes<30000)).toBe(true);expect(metrics.every(row=>row.maxNumericBound===0)).toBe(true);
 if(process.env.CALENOTE_CONTRACT_AUDIT_OUT)writeFileSync(process.env.CALENOTE_CONTRACT_AUDIT_OUT,JSON.stringify({version:'small-producer-contract-audit-1',protocol:CONTEXT_SMALL_PROTOCOL_V3,inputs:captured.length,slots:SLOT_NAMES,operations:['SET','REPLACE','CLEAR'],certifiedContexts:metrics.filter(row=>row.certified).length,certifiedMutationCases:metrics.filter(row=>row.certified).length*SLOT_NAMES.length*3,initialCertifiedContexts:captured.filter(row=>isInitialFiniteSeriesWithoutRelationSource(row.input)).length,initialMutationCases:captured.filter(row=>isInitialFiniteSeriesWithoutRelationSource(row.input)).length*SLOT_NAMES.length*3,maxBytes:Math.max(...metrics.map(row=>row.bytes)),maxRowAlternatives:Math.max(...metrics.map(row=>row.rowAlternatives)),maxUnionWidth:Math.max(...metrics.map(row=>row.maxWidth)),compilerAdmission:'UNVERIFIED',metricsOnly:true,testResultsRecordedSeparately:true,metrics},null,2)+'\n');
});

it('mirrors the existing non-clock mutation restriction for bound clock answers',()=>{
 const rows=captured.filter(row=>isBoundReminderClockAnswer(row.input));expect(rows.length).toBeGreaterThan(0);
 for(const row of rows){const accept=validator(row.input),wire=original(row);for(const field of SLOT_NAMES.filter(field=>field!=='eventTime'&&field!=='reminderTime'))for(const operation of ['REPLACE','CLEAR']){const changed=structuredClone(wire);changed.changes=[mutation(row.input,field,operation)];changed.clocks=[];expect(accept.safeParse(changed).success,`${row.id}/${row.index}/${field}/${operation}`).toBe(false);}}
});

it('keeps numeric comparisons out of provider grammar while retaining integer and structural constraints',()=>{
 const forbidden=new Set(['minimum','maximum','exclusiveMinimum','exclusiveMaximum']);let integers=0;
 for(const row of captured){const schema=smallContextSchemaV3(row.input).schema;const walk=(node:unknown):void=>{if(!node||typeof node!=='object')return;for(const [key,value]of Object.entries(node)){expect(forbidden.has(key),key).toBe(false);if(key==='type'&&(value==='integer'||Array.isArray(value)&&value.includes('integer')))integers++;if(Array.isArray(value))value.forEach(walk);else walk(value);}};walk(schema);}
 expect(integers).toBeGreaterThan(100);
});
it('retains strict downstream positivity, safe-integer, clock and reference rejection without repairing numeric ranges',()=>{
 const numeric=captured.find(row=>original(row).changes.some(change=>change.field==='occurrenceCount'))!;
 for(const value of [0,-1,Number.MAX_SAFE_INTEGER+1]){const wire=original(numeric);wire.changes.find(change=>change.field==='occurrenceCount')!.value=value;expect(validator(numeric.input).safeParse(wire).success).toBe(Number.isSafeInteger(value));expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,numeric.input).status).toBe('REFUSED');}
 const clock=captured.find(row=>original(row).changes.some(c=>c.clock!==null))!;
 for(const change of [(wire:ReturnType<typeof original>)=>{wire.changes.find(c=>c.clock!==null)!.clock!.hour=25;},(wire:ReturnType<typeof original>)=>{wire.changes.find(c=>c.clock!==null)!.clock!.minute=60;}]){const wire=original(clock);change(wire);expect(validator(clock.input).safeParse(wire).success).toBe(true);expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,clock.input).status).toBe('REFUSED');}
});
it('covers all initial fields and operations under the existing complete finite source certificate',()=>{
 const contexts=captured.filter(row=>isInitialFiniteSeriesWithoutRelationSource(row.input));expect(contexts.length).toBeGreaterThan(0);
 for(const row of contexts){const input=row.input,cap=deriveGenerationFieldCapability(input),wire=original(row),accept=validator(input);
  const allowed=new Set(['title','location','eventDate',...cap.allowedClockFields,...(cap.calendarProposalAllowed?['calendar']:[]),...cap.allowedNumericFields]);
  for(const field of SLOT_NAMES)for(const operation of ['SET','REPLACE','CLEAR']){const changed=structuredClone(wire);changed.changes=[mutation(input,field,operation)];changed.clocks=[];expect(accept.safeParse(changed).success,`${row.id}/${row.index}/${field}/${operation}`).toBe(operation==='SET'&&allowed.has(field));}
 }
});
it('does not apply initial-only restrictions to independent relation, date, cadence/count or end-date instructions',()=>{
 const base=captured.find(row=>isInitialFiniteSeriesWithoutRelationSource(row.input))!;
 for(const text of ['Nhắc trước ngày thi.','Đổi ngày thi sang 12/10.','Đổi số lần nhắc thành 3 lần.','Đổi thành nhắc 3 ngày liên tiếp.','Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp đến ngày 15/10.']){const input=structuredClone(base.input);input.turns[input.currentTurn].text=text;expect(isInitialFiniteSeriesWithoutRelationSource(input),text).toBe(false);}
});
it('keeps ordinary collection cardinality as strict downstream refusal or advice quarantine without provider unrolling',()=>{
 const row=captured.find(row=>!isBoundRelationUncertaintyAbsent(row.input)&&original(row).changes.length>0)!,wire=original(row),schema=smallContextSchemaV3(row.input).schema as unknown as {properties:Record<string,{maxItems?:number;items:unknown}>};
 for(const field of ['changes','uncertainties','directive','reply'])expect(schema.properties[field]).not.toHaveProperty('maxItems');
 const item=schema.properties.uncertainties.items as {anyOf:Array<{properties:Record<string,unknown>}>};for(const row of item.anyOf)expect(row.properties.alternatives).not.toHaveProperty('maxItems');
 const altered=()=>structuredClone(wire),accept=validator(row.input);
 const changes=altered();changes.changes=Array.from({length:14},()=>structuredClone(wire.changes[0]));expect(accept.safeParse(changes).success).toBe(true);expect(decodeSmallContextV3(changes,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');
 const issue={fieldCode:'0',reason:'MISSING',alternatives:[]};const uncertainties=altered();uncertainties.uncertainties=Array.from({length:5},()=>structuredClone(issue));expect(accept.safeParse(uncertainties).success).toBe(true);expect(decodeSmallContextV3(uncertainties,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');
 const alt={value:null,text:'synthetic',date:[],period:[],clock:null,evidence:[`U${row.input.currentTurn}`]};const alternatives=altered();alternatives.uncertainties=[{...issue,alternatives:[alt,alt,alt]}];expect(accept.safeParse(alternatives).success).toBe(true);expect(decodeSmallContextV3(alternatives,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');
 const clocks=altered();clocks.clocks=Array.from({length:11},()=>({hour:8,minute:0,qualifier:'H24'}));expect(accept.safeParse(clocks).success).toBe(false);expect(decodeSmallContextV3(clocks,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');
 const tooMuchAdvice={...wire,directive:Array.from({length:2},()=>({kind:'HELP',field:null,reason:null,issue:null,topic:null})),reply:[{text:'a'},{text:'b'}]};expect(decodeSmallContextV3(tooMuchAdvice,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('PARSED');
});
it('owns every authored clock directly in a typed consumer cell and never in a referenced root table',()=>{
 let checked=0;
 for(const row of captured){const wire=original(row) as unknown as {changes:Array<{field:string;value:unknown;clock:unknown}>;clocks:unknown[]};
  expect(wire.clocks).toEqual([]);
  for(const change of wire.changes){expect(Array.isArray(change.clock)).toBe(false);if(['eventTime','reminderTime'].includes(change.field)){expect(change.value).toBeNull();expect(change.clock).toHaveProperty('hour');checked++;}else expect(change.clock).toBeNull();}
 }
 expect(checked).toBeGreaterThan(0);
});
it('refuses legacy clock index123 and even valid index0 without repair or table lookup',()=>{
 const row=captured.find(row=>original(row).changes.some(c=>c.field==='reminderTime'))!,wire=original(row) as unknown as {changes:Array<Record<string,unknown>>;clocks:unknown[]};const index=wire.changes.findIndex(c=>c.field==='reminderTime'),cell=wire.changes[index].clock;expect(cell).toHaveProperty('hour');
 for(const value of [0,123]){const bad=structuredClone(wire);bad.clocks=[structuredClone(cell)];bad.changes[index].value=value;bad.changes[index].clock=null;expect(validator(row.input).safeParse(bad).success).toBe(false);expect(decodeSmallContextV3(bad,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');}
 const bad=structuredClone(wire);bad.changes[index].clock=null;expect(decodeSmallContextV3(bad,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');
 for(const oldClock of [[],[cell]]){const bad=structuredClone(wire);bad.changes[index].clock=oldClock;expect(decodeSmallContextV3(bad,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');}
 const legacy16={...CONTEXT_SMALL_PROTOCOL_V3,promptVersion:'calenote-context-small-tables-106-inline-clocks-16',wireVersion:'google-gemini-2.5-flash-lite-vertex-eu-context-small-tables-106-inline-clocks-16'};expect(decodeSmallContextV3(wire,legacy16,undefined,undefined,row.input).status).toBe('REFUSED');
 const legacy={...CONTEXT_SMALL_PROTOCOL_V3,promptVersion:'calenote-context-small-tables-106-compiler-compatible-15',wireVersion:'google-gemini-2.5-flash-lite-vertex-eu-context-small-tables-106-compiler-compatible-15'};expect(decodeSmallContextV3(wire,legacy,undefined,undefined,row.input).status).toBe('REFUSED');
});
it('keeps canonical clock range and qualifier rejection after provider numeric comparisons are omitted',()=>{
 const row=captured.find(row=>original(row).changes.some(c=>c.clock!==null))!;
 for(const clock of [{hour:24,minute:0,qualifier:'H24'},{hour:8,minute:60,qualifier:'H24'},{hour:0,minute:0,qualifier:'AM'},{hour:13,minute:0,qualifier:'PM'}]){const wire=original(row);wire.changes.find(c=>c.clock!==null)!.clock=clock;expect(validator(row.input).safeParse(wire).success).toBe(true);expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');}
 const wrong=original(row);wrong.changes.find(c=>c.clock!==null)!.clock={hour:8,minute:0,qualifier:'NOT_CANONICAL'};expect(validator(row.input).safeParse(wrong).success).toBe(false);expect(decodeSmallContextV3(wrong,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');
});
it('preserves typed clock SET REPLACE CLEAR and owned alternatives without a reference fallback',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===2)!,base=ConversationInterpretationV3Schema.parse(frozenContextProposal(row.input,row.id,row.index)),evidence=[{kind:'USER_QUOTE',turn:row.input.currentTurn,quote:row.input.turns[row.input.currentTurn].text,occurrence:1}];
 for(const operation of ['SET','REPLACE','CLEAR']){const canonical=ConversationInterpretationV3Schema.parse({...base,changes:[{field:'reminderTime',operation,value:operation==='CLEAR'?null:{hour:8,minute:0,qualifier:'H24'},evidence}]});const wire=encodeSmallContextV3(canonical,row.input);expect(wire.clocks).toEqual([]);expect(wire.changes[0].clock).toEqual(operation==='CLEAR'?null:{hour:8,minute:0,qualifier:'H24'});expect(validator(row.input).safeParse(wire).success).toBe(true);expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('PARSED');}
 const canonical=ConversationInterpretationV3Schema.parse({...base,changes:[],uncertainties:[{field:'reminderTime',reason:'AMBIGUOUS',alternatives:[{value:{hour:8,minute:0,qualifier:'H24'},evidence},{value:{hour:9,minute:0,qualifier:'H24'},evidence}]}]});const wire=encodeSmallContextV3(canonical,row.input);expect(wire.clocks).toEqual([]);expect(wire.uncertainties[0].alternatives.map(a=>a.clock)).toEqual([{hour:8,minute:0,qualifier:'H24'},{hour:9,minute:0,qualifier:'H24'}]);expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('PARSED');
 const nonClock=encodeSmallContextV3(ConversationInterpretationV3Schema.parse({...base,changes:[],uncertainties:[{field:'title',reason:'AMBIGUOUS',alternatives:[{value:'synthetic',evidence}]}]}),row.input);nonClock.uncertainties[0].alternatives[0].clock={hour:8,minute:0,qualifier:'H24'};expect(decodeSmallContextV3(nonClock,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');
});
it('refuses a mixed valid and invalid inline-clock patch as a whole without mutating authored cells',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===0)!,wire=original(row);expect(wire.changes.length).toBeGreaterThan(1);wire.changes.find(c=>c.clock!==null)!.clock!.minute=60;const before=JSON.stringify(wire);expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');expect(JSON.stringify(wire)).toBe(before);
});
it('owns a direct clock object or null without the bounded optional-clock array family',()=>{
 let clocks=0;for(const row of captured){const wire=original(row) as unknown as {changes:Array<{field:string;operation:string;clock:unknown}>};for(const c of wire.changes){if(['eventTime','reminderTime'].includes(c.field)&&c.operation!=='CLEAR'){expect(Array.isArray(c.clock)).toBe(false);expect(c.clock).toHaveProperty('hour');clocks++;}else expect(c.clock).toBeNull();}}expect(clocks).toBeGreaterThan(0);
});
it('uses equivalent nullable clock-object semantics with less grammar than object-null anyOf',()=>{
 const object={type:'object',properties:{hour:{type:'integer'},minute:{type:'integer'},qualifier:{type:'string',enum:['H24','AM','PM','UNKNOWN']}},required:['hour','minute','qualifier'],additionalProperties:false};const nullable={...object,type:['object','null']},branched={anyOf:[object,{type:'null'}]},a=z.fromJSONSchema(nullable as Parameters<typeof z.fromJSONSchema>[0]),b=z.fromJSONSchema(branched as Parameters<typeof z.fromJSONSchema>[0]);
 for(const value of [null,{hour:8,minute:0,qualifier:'H24'},{hour:25,minute:0,qualifier:'H24'},[],[{}],0,'clock',{hour:8,qualifier:'H24'},{hour:'8',minute:0,qualifier:'H24'},{hour:8,minute:0,qualifier:'BAD'},{hour:8,minute:0,qualifier:'H24',extra:1}])expect(a.safeParse(value).success).toBe(b.safeParse(value).success);
 expect(a.safeParse(null).success).toBe(true);expect(a.safeParse({hour:8,minute:0,qualifier:'H24'}).success).toBe(true);expect(a.safeParse([]).success).toBe(false);expect(JSON.stringify(nullable).length).toBeLessThan(JSON.stringify(branched).length);
});

it('correlates every finite uncertainty code with its owned alternative family without forcing alternatives',()=>{
 const row=captured[0],accept=validator(row.input),base=original(row),evidence=[`U${row.input.currentTurn}`],empty={value:null,text:null,date:[],period:[],clock:null,evidence};
 const cells={text:{...empty,text:'synthetic'},integer:{...empty,value:2},date:{...empty,date:[{kind:'RELATIVE_DAY',offsetDays:0}]},clock:{...empty,clock:{hour:8,minute:0,qualifier:'H24'}},period:{...empty,period:[{kind:'MONTH_CURRENT',date:[],from:[],through:[],unsupportedKind:null}]}};
 for(const [field,code]of Object.entries(UNCERTAINTY_FIELD_WIRE_CODE_V1)){
  const family=['eventDate','reminderDate','endDate'].includes(field)?'date':['eventTime','reminderTime'].includes(field)?'clock':['occurrenceCount','leadOffsetDays'].includes(field)?'integer':field==='queryRange'?'period':'text';
  const alt=structuredClone(cells[family]);if(field==='intent')alt.text=IntentSchema.options[0];if(field==='operation')alt.text='CURRENT';if(['calendar','frequency','eventRelation'].includes(field))alt.text=SlotValueSchemas[field as 'calendar'|'frequency'|'eventRelation'].options[0];
  const payload=(alternatives:unknown[])=>({...base,uncertainties:[{fieldCode:String(code),reason:'AMBIGUOUS',alternatives}]});expect(accept.safeParse(payload([])).success,field+'/empty').toBe(true);expect(accept.safeParse(payload([alt])).success,field+'/owned').toBe(true);
  for(const [wrong,cell]of Object.entries(cells))if(wrong!==family)expect(accept.safeParse(payload([cell])).success,field+'/'+wrong).toBe(false);
  if(['intent','operation','calendar','frequency','eventRelation'].includes(field))expect(accept.safeParse(payload([{...empty,text:'NOT_CANONICAL'}])).success,field+'/enum').toBe(false);
  expect(accept.safeParse({...payload([]),uncertainties:[{fieldCode:code,reason:'MISSING',alternatives:[]}]}).success,field+'/legacyInteger').toBe(false);
 }
 for(const code of ['16','-1','0.0','00','PRIVATE'])expect(accept.safeParse({...base,uncertainties:[{fieldCode:code,reason:'MISSING',alternatives:[]}]}).success).toBe(false);
});
it('factors period and query ownership without multiplying inactive sibling cells or forcing missing operands',()=>{
 const row=captured[0],wire=original(row),accept=validator(row.input),evidence=[`U${row.input.currentTurn}`],date={kind:'RELATIVE_DAY',offsetDays:0},base={period:[],date:[],outputCalendar:null,topic:null,evidence};
 const query=(cell:unknown)=>({...wire,query:[cell]});expect(accept.safeParse(query(base)).success).toBe(true);
 const period=(kind:string):Record<string,unknown>=>({kind,date:[],from:[],through:[],unsupportedKind:null});
 for(const kind of ['DAY','DATE_BOUNDS','MONTH_CURRENT','UNSUPPORTED']){
  const p=period(kind);if(kind==='UNSUPPORTED')p.unsupportedKind='UNKNOWN_PERIOD';expect(accept.safeParse(query({...base,period:[p]})).success,kind+'/missing').toBe(true);
  const wrong=structuredClone(p);if(kind==='DAY')wrong.from=[date];else wrong.date=[date];expect(accept.safeParse(query({...base,period:[wrong]})).success,kind+'/inactive').toBe(false);
 }
 expect(accept.safeParse(query({...base,period:[period('MONTH_CURRENT')],date:[date]})).success).toBe(false);
 expect(accept.safeParse(query({...base,date:[date],topic:'LUNAR'})).success).toBe(false);
 expect(accept.safeParse(query({...base,period:[period('MONTH_CURRENT')],outputCalendar:'GREGORIAN'})).success).toBe(false);
});
