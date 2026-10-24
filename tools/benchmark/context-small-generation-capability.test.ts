// @vitest-environment node
import {beforeAll,expect,it} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {z} from 'zod';
import {runContextFixtureCampaign,createContextContractProbe} from './context-contract-probe';
import {admitCanonicalCampaign,type ContextManifest} from './context-contract';
import {frozenContextProposal} from './context-contract-fixtures';
import {SLOT_NAMES,ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../src/modules/conversation/context-contract/contracts';
import {deriveGenerationFieldCapability,isBoundRelationUncertaintyAbsent,isBoundReminderClockAnswer} from '../../src/modules/conversation/context-contract/field-capability';
import {encodeSmallContextV3,smallContextSchemaV3,decodeSmallContextV3} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-small-wire';
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
 return {field,rank:0,operation,value:operation==='CLEAR'||date||!numeric&&!clock?null:clock?0:2,text:operation==='CLEAR'||date||numeric||clock?null:text,date:operation==='CLEAR'||!date?[]:[{kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null}],evidence:[`U${input.currentTurn}`]};
}
it('keeps every frozen healthy output admitted by the producer schema',()=>{
 expect(captured).toHaveLength(144);
 for(const row of captured)expect(validator(row.input).safeParse(original(row)).success,`${row.id}/${row.index}`).toBe(true);
});
it('covers all thirteen fields and three operations in certified relation answers without repairing extra mutations',()=>{
 const bound=captured.filter(row=>isBoundRelationUncertaintyAbsent(row.input));expect(bound.length).toBeGreaterThan(0);
 for(const row of bound){const accept=validator(row.input),wire=original(row);
  for(const field of SLOT_NAMES)for(const operation of ['SET','REPLACE','CLEAR']){
   const changed=structuredClone(wire);changed.changes=[mutation(row.input,field,operation)];changed.clocks=['eventTime','reminderTime'].includes(field)&&operation!=='CLEAR'?[{hour:8,minute:0,qualifier:'H24'}]:[];
   const permitted=field==='eventRelation'&&operation==='SET';expect(accept.safeParse(changed).success,`${field}/${operation}`).toBe(permitted);
   if(!permitted)expect(decodeSmallContextV3(changed,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');
  }
 }
});
it('projects every existing deterministic field exclusion, title operation and year-null bound',()=>{
 const checked=new Set<string>();
 for(const row of captured){const input=row.input,cap=deriveGenerationFieldCapability(input),accept=validator(input),wire=original(row);
  const forbidden=[...(!cap.notesProposalAllowed?['notes']:[]),...(!cap.calendarProposalAllowed?['calendar']:[]),...(!cap.reminderDateProposalAllowed?['reminderDate']:[]),...(['eventTime','reminderTime'] as const).filter(field=>!cap.allowedClockFields.includes(field))] as (typeof SLOT_NAMES[number])[];
  for(const field of forbidden){const changed=structuredClone(wire);changed.changes=[mutation(input,field)];changed.clocks=['eventTime','reminderTime'].includes(field)?[{hour:8,minute:0,qualifier:'H24'}]:[];expect(accept.safeParse(changed).success,`${row.id}/${row.index}/${field}`).toBe(false);checked.add(field);}
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
 expect(metrics.every(row=>row.rowAlternatives<=10&&row.maxWidth<=10)).toBe(true);expect(metrics.every(row=>row.maxNumericBound<=59)).toBe(true);
 if(process.env.CALENOTE_CONTRACT_AUDIT_OUT)writeFileSync(process.env.CALENOTE_CONTRACT_AUDIT_OUT,JSON.stringify({version:'small-producer-contract-audit-1',protocol:CONTEXT_SMALL_PROTOCOL_V3,inputs:captured.length,slots:SLOT_NAMES,operations:['SET','REPLACE','CLEAR'],certifiedContexts:metrics.filter(row=>row.certified).length,certifiedMutationCases:metrics.filter(row=>row.certified).length*SLOT_NAMES.length*3,maxBytes:Math.max(...metrics.map(row=>row.bytes)),maxRowAlternatives:Math.max(...metrics.map(row=>row.rowAlternatives)),maxUnionWidth:Math.max(...metrics.map(row=>row.maxWidth)),compilerAdmission:'UNVERIFIED',metricsOnly:true,testResultsRecordedSeparately:true,metrics},null,2)+'\n');
});

it('mirrors the existing non-clock mutation restriction for bound clock answers',()=>{
 const rows=captured.filter(row=>isBoundReminderClockAnswer(row.input));expect(rows.length).toBeGreaterThan(0);
 for(const row of rows){const accept=validator(row.input),wire=original(row);for(const field of SLOT_NAMES.filter(field=>field!=='eventTime'&&field!=='reminderTime'))for(const operation of ['REPLACE','CLEAR']){const changed=structuredClone(wire);changed.changes=[mutation(row.input,field,operation)];changed.clocks=[];expect(accept.safeParse(changed).success,`${row.id}/${row.index}/${field}/${operation}`).toBe(false);}}
});
