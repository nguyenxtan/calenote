// @vitest-environment node
import {beforeAll,expect,it} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {runContextFixtureCampaign,createContextContractProbe} from './context-contract-probe';
import {admitCanonicalCampaign,type ContextManifest} from './context-contract';
import {frozenContextProposal} from './context-contract-fixtures';
import {SLOT_NAMES,ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../src/modules/conversation/context-contract/contracts';
import {deriveGenerationFieldCapability,isBoundRelationUncertaintyAbsent,isBoundReminderClockAnswer,isInitialFiniteSeriesWithoutRelationSource} from '../../src/modules/conversation/context-contract/field-capability';
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
 return {field,rank:0,operation,value:operation==='CLEAR'||date||clock||!numeric?null:2,text:operation==='CLEAR'||date||numeric||clock?null:text,date:operation==='CLEAR'||!date?[]:[{kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null}],evidence:[`U${input.currentTurn}`]};
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
 expect(metrics.every(row=>row.rowAlternatives<=10&&row.maxWidth<=10)).toBe(true);expect(metrics.every(row=>row.maxNumericBound===0)).toBe(true);
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
 const clock=captured.find(row=>original(row).clocks.length>0)!;
 for(const change of [(wire:ReturnType<typeof original>)=>{wire.clocks[0].hour=25;},(wire:ReturnType<typeof original>)=>{wire.clocks[0].minute=60;}]){const wire=original(clock);change(wire);expect(validator(clock.input).safeParse(wire).success).toBe(true);expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,clock.input).status).toBe('REFUSED');}
});
it('covers all initial fields and operations under the existing complete finite source certificate',()=>{
 const contexts=captured.filter(row=>isInitialFiniteSeriesWithoutRelationSource(row.input));expect(contexts.length).toBeGreaterThan(0);
 for(const row of contexts){const input=row.input,cap=deriveGenerationFieldCapability(input),wire=original(row),accept=validator(input);
  const allowed=new Set(['title','location','eventDate',...cap.allowedClockFields,...(cap.calendarProposalAllowed?['calendar']:[]),...cap.allowedNumericFields]);
  for(const field of SLOT_NAMES)for(const operation of ['SET','REPLACE','CLEAR']){const changed=structuredClone(wire);changed.changes=[mutation(input,field,operation)];changed.clocks=['eventTime','reminderTime'].includes(field)&&operation!=='CLEAR'?[{hour:8,minute:0,qualifier:'H24'}]:[];expect(accept.safeParse(changed).success,`${row.id}/${row.index}/${field}/${operation}`).toBe(operation==='SET'&&allowed.has(field));}
 }
});
it('does not apply initial-only restrictions to independent relation, date, cadence/count or end-date instructions',()=>{
 const base=captured.find(row=>isInitialFiniteSeriesWithoutRelationSource(row.input))!;
 for(const text of ['Nhắc trước ngày thi.','Đổi ngày thi sang 12/10.','Đổi số lần nhắc thành 3 lần.','Đổi thành nhắc 3 ngày liên tiếp.','Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp đến ngày 15/10.']){const input=structuredClone(base.input);input.turns[input.currentTurn].text=text;expect(isInitialFiniteSeriesWithoutRelationSource(input),text).toBe(false);}
});
it('keeps ordinary collection cardinality as strict downstream refusal or advice quarantine without provider unrolling',()=>{
 const row=captured.find(row=>!isBoundRelationUncertaintyAbsent(row.input)&&original(row).changes.length>0)!,wire=original(row),schema=smallContextSchemaV3(row.input).schema as unknown as {properties:Record<string,{maxItems?:number;items:unknown}>};
 for(const field of ['changes','uncertainties','clocks','directive','reply'])expect(schema.properties[field]).not.toHaveProperty('maxItems');
 const item=schema.properties.uncertainties.items as {properties:Record<string,unknown>};expect(item.properties.alternatives).not.toHaveProperty('maxItems');
 const altered=()=>structuredClone(wire),accept=validator(row.input);
 const changes=altered();changes.changes=Array.from({length:14},()=>structuredClone(wire.changes[0]));expect(accept.safeParse(changes).success).toBe(true);expect(decodeSmallContextV3(changes,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');
 const issue={fieldCode:0,reason:'MISSING',alternatives:[]};const uncertainties=altered();uncertainties.uncertainties=Array.from({length:5},()=>structuredClone(issue));expect(accept.safeParse(uncertainties).success).toBe(true);expect(decodeSmallContextV3(uncertainties,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');
 const alt={value:null,text:'synthetic',date:[],period:[],evidence:[`U${row.input.currentTurn}`]};const alternatives=altered();alternatives.uncertainties=[{...issue,alternatives:[alt,alt,alt]}];expect(accept.safeParse(alternatives).success).toBe(true);expect(decodeSmallContextV3(alternatives,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');
 const clocks=altered();clocks.clocks=Array.from({length:11},()=>({hour:8,minute:0,qualifier:'H24'}));expect(accept.safeParse(clocks).success).toBe(true);expect(decodeSmallContextV3(clocks,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');
 const tooMuchAdvice={...wire,directive:Array.from({length:2},()=>({kind:'HELP',field:null,reason:null,issue:null,topic:null})),reply:[{text:'a'},{text:'b'}]};expect(decodeSmallContextV3(tooMuchAdvice,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('PARSED');
});
it('reproduces the previously admitted08 R01 schema without any of the six collection additions',()=>{
 const row=captured.find(row=>row.id==='R01'&&row.index===0)!;const schema=smallContextSchemaV3(row.input).schema;
 expect(createHash('sha256').update(JSON.stringify(schema)).digest('hex')).toBe('1bc22c766e3157729eeb987b0492c21891fdd2782d42aa19087b72c7cf14c844');
});

it('authors the clock stream after sorting singleton carriers by authored rank without deduplication',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===2)!,base=ConversationInterpretationV3Schema.parse(frozenContextProposal(row.input,row.id,row.index)),evidence=[{kind:'USER_QUOTE',turn:row.input.currentTurn,quote:row.input.turns[row.input.currentTurn].text,occurrence:1}],clock={hour:8,minute:0,qualifier:'H24'};
 const canonical=ConversationInterpretationV3Schema.parse({...base,changes:[{field:'reminderTime',operation:'SET',value:clock,evidence},{field:'eventTime',operation:'SET',value:{hour:9,minute:0,qualifier:'H24'},evidence}],uncertainties:[{field:'reminderTime',reason:'AMBIGUOUS',alternatives:[{value:clock,evidence},{value:clock,evidence}]}]});
 const wire=encodeSmallContextV3(canonical,row.input);expect(wire.changes.map(c=>c.field)).toEqual(['reminderTime','eventTime']);expect(wire.changes.map(c=>c.rank)).toEqual([0,1]);expect(wire.changes.map(c=>c.value)).toEqual([null,null]);expect(wire.clocks).toEqual([clock,{hour:9,minute:0,qualifier:'H24'},clock,clock]);expect(wire.changes.every(c=>!Object.hasOwn(c,'clock'))).toBe(true);
});
it('consumes the exact authored clock stream and refuses missing extra or indexed operands without repair',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===2)!,base=ConversationInterpretationV3Schema.parse(frozenContextProposal(row.input,row.id,row.index)),evidence=[{kind:'USER_QUOTE',turn:row.input.currentTurn,quote:row.input.turns[row.input.currentTurn].text,occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...base,changes:[{field:'reminderTime',operation:'SET',value:{hour:8,minute:0,qualifier:'H24'},evidence}],uncertainties:[]}),wire=encodeSmallContextV3(canonical,row.input);
 expect(wire.clocks).toEqual([{hour:8,minute:0,qualifier:'H24'}]);expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('PARSED');
 for(const mutate of [(w:typeof wire)=>{w.clocks=[];},(w:typeof wire)=>{w.clocks.push(structuredClone(w.clocks[0]));},(w:typeof wire)=>{w.changes[0].value=0;},(w:typeof wire)=>{w.changes[0].value=123;}]){const bad=structuredClone(wire);mutate(bad);const before=JSON.stringify(bad);expect(decodeSmallContextV3(bad,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');expect(JSON.stringify(bad)).toBe(before);}
});
it('binds every authored clock row once to the declared consumer traversal across all healthy outputs',()=>{
 let consumers=0;for(const row of captured){const w=original(row),changes=w.changes.filter(c=>['eventTime','reminderTime'].includes(c.field)&&c.operation!=='CLEAR'),alternatives=w.uncertainties.filter(u=>u.fieldCode===4||u.fieldCode===6).flatMap(u=>u.alternatives);expect(w.clocks).toHaveLength(changes.length+alternatives.length);for(const c of changes){expect(c.value).toBeNull();expect(c.text).toBeNull();expect(c.date).toEqual([]);expect(c).not.toHaveProperty('clock');}for(const a of alternatives){expect(a.value).toBeNull();expect(a.text).toBeNull();expect(a.date).toEqual([]);expect(a.period).toEqual([]);}consumers+=w.clocks.length;}expect(consumers).toBeGreaterThan(0);
});
it('refuses clock reference selections and obsolete wire identities instead of repairing them',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===2)!,w=original(row),index=w.changes.findIndex(c=>c.field==='reminderTime');expect(index).toBeGreaterThanOrEqual(0);for(const value of [0,123]){const bad=structuredClone(w);bad.changes[index].value=value;expect(validator(row.input).safeParse(bad).success).toBe(false);expect(decodeSmallContextV3(bad,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');}
 const cell=structuredClone(w);Object.assign(cell.changes[index],{clock:w.clocks[0]});expect(decodeSmallContextV3(cell,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');for(const id of ['compiler-compatible-15','inline-clocks-16','direct-clocks-17','correlated-families-18']){const legacy={...CONTEXT_SMALL_PROTOCOL_V3,promptVersion:'calenote-context-small-tables-106-'+id,wireVersion:'google-gemini-2.5-flash-lite-vertex-eu-context-small-tables-106-'+id};expect(decodeSmallContextV3(w,legacy,undefined,undefined,row.input).status).toBe('REFUSED');}
});
it('retains canonical clock ranges and qualifiers for stream operands without numeric repair',()=>{
 const row=captured.find(row=>original(row).clocks.length>0)!;for(const c of [{hour:24,minute:0,qualifier:'H24'},{hour:8,minute:60,qualifier:'H24'},{hour:0,minute:0,qualifier:'AM'},{hour:13,minute:0,qualifier:'PM'}]){const w=original(row);w.clocks[0]=c;expect(validator(row.input).safeParse(w).success).toBe(true);expect(decodeSmallContextV3(w,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');}const bad=original(row);bad.clocks[0].qualifier='NOT_CANONICAL';expect(validator(row.input).safeParse(bad).success).toBe(false);
});
it('preserves stream clock SET REPLACE CLEAR and duplicate uncertainty operands',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===2)!,base=ConversationInterpretationV3Schema.parse(frozenContextProposal(row.input,row.id,row.index)),evidence=[{kind:'USER_QUOTE',turn:row.input.currentTurn,quote:row.input.turns[row.input.currentTurn].text,occurrence:1}],clock={hour:8,minute:0,qualifier:'H24'};
 for(const operation of ['SET','REPLACE','CLEAR']){const c=ConversationInterpretationV3Schema.parse({...base,changes:[{field:'reminderTime',operation,value:operation==='CLEAR'?null:clock,evidence}]});const w=encodeSmallContextV3(c,row.input);expect(w.clocks).toEqual(operation==='CLEAR'?[]:[clock]);expect(w.changes[0].value).toBeNull();expect(decodeSmallContextV3(w,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('PARSED');}
 const c=ConversationInterpretationV3Schema.parse({...base,changes:[],uncertainties:[{field:'reminderTime',reason:'AMBIGUOUS',alternatives:[{value:clock,evidence},{value:clock,evidence}]}]});const w=encodeSmallContextV3(c,row.input);expect(w.clocks).toEqual([clock,clock]);expect(w.uncertainties[0].alternatives.map(a=>a.value)).toEqual([null,null]);expect(decodeSmallContextV3(w,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('PARSED');
 for(const index of [0,123]){const bad=structuredClone(w);bad.uncertainties[0].alternatives[0].value=index;expect(decodeSmallContextV3(bad,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');}
});
it('refuses a mixed valid and invalid stream patch as a whole without mutating any authored data',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===0)!,w=original(row);expect(w.changes.length).toBeGreaterThan(1);expect(w.clocks.length).toBeGreaterThan(0);w.clocks[0].minute=60;const before=JSON.stringify(w);expect(decodeSmallContextV3(w,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');expect(JSON.stringify(w)).toBe(before);
});
it('does not consume a clock for CLEAR or sort an untrusted reversed change list',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===2)!,base=ConversationInterpretationV3Schema.parse(frozenContextProposal(row.input,row.id,row.index)),evidence=[{kind:'USER_QUOTE',turn:row.input.currentTurn,quote:row.input.turns[row.input.currentTurn].text,occurrence:1}],clock={hour:8,minute:0,qualifier:'H24'},c=ConversationInterpretationV3Schema.parse({...base,changes:[{field:'eventTime',operation:'SET',value:clock,evidence},{field:'reminderTime',operation:'CLEAR',value:null,evidence}],uncertainties:[{field:'reminderTime',reason:'AMBIGUOUS',alternatives:[{value:clock,evidence}]}]});const w=encodeSmallContextV3(c,row.input);expect(w.clocks).toEqual([clock,clock]);expect(w.changes[1]).toMatchObject({field:'reminderTime',operation:'CLEAR',value:null});
 const initial=captured.find(row=>row.id==='R04'&&row.index===0)!,bad=original(initial);bad.changes.reverse();const before=JSON.stringify(bad);expect(validator(initial.input).safeParse(bad).success).toBe(true);expect(decodeSmallContextV3(bad,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,initial.input).status).toBe('REFUSED');expect(JSON.stringify(bad)).toBe(before);
});
it('keeps generic uncertainty controls and family contradictions as explicit strict downstream residuals',()=>{
 const row=captured[0],w=original(row),accept=validator(row.input),issue=(fieldCode:unknown,alternatives:unknown[]=[])=>({...w,uncertainties:[{fieldCode,reason:'MISSING',alternatives}]});for(let code=0;code<16;code++){expect(accept.safeParse(issue(code)).success).toBe(true);expect(accept.safeParse(issue(String(code))).success).toBe(false);}for(const code of [16,123]){const bad=issue(code);expect(accept.safeParse(bad).success).toBe(true);expect(decodeSmallContextV3(bad,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');}
 const empty={value:null,text:null,date:[],period:[],evidence:[`U${row.input.currentTurn}`]};for(const bad of [issue(0,[{...empty,value:2}]),issue(7,[{...empty,text:'NOT_CANONICAL'}]),issue(14,[{...empty,text:'MONTH'}]),issue(4,[{...empty,value:0}])]){expect(accept.safeParse(bad).success).toBe(true);expect(decodeSmallContextV3(bad,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');}
});
it('preserves missing operands but refuses generic period and query ownership contradictions downstream',()=>{
 const row=captured[0],w=original(row),accept=validator(row.input),evidence=[`U${row.input.currentTurn}`],date={kind:'RELATIVE_DAY',offsetDays:0},base={period:[],date:[],outputCalendar:null,topic:null,evidence},payload=(q:unknown)=>({...w,query:[q]});expect(accept.safeParse(payload(base)).success).toBe(true);
 for(const kind of ['DAY','DATE_BOUNDS','MONTH_CURRENT','UNSUPPORTED']){const p:Record<string,unknown>={kind,date:[],from:[],through:[],unsupportedKind:kind==='UNSUPPORTED'?'UNKNOWN_PERIOD':null};expect(accept.safeParse(payload({...base,period:[p]})).success).toBe(true);const bad=structuredClone(p);if(kind==='DAY')bad.from=[date];else bad.date=[date];const q=payload({...base,period:[bad]});expect(accept.safeParse(q).success).toBe(true);expect(decodeSmallContextV3(q,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');}
 for(const q of [{...base,period:[{kind:'MONTH_CURRENT',date:[],from:[],through:[],unsupportedKind:null}],date:[date]},{...base,date:[date],topic:'LUNAR'},{...base,period:[{kind:'MONTH_CURRENT',date:[],from:[],through:[],unsupportedKind:null}],outputCalendar:'GREGORIAN'}]){const bad=payload(q);expect(accept.safeParse(bad).success).toBe(true);expect(decodeSmallContextV3(bad,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input).status).toBe('REFUSED');}
});
