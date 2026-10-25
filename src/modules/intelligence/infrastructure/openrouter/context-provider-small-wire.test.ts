// Internal semantic-pipeline regression tests. Public compact boundary has separate all144 inverse and HTTP campaign coverage.
import {changeAt,changeEntries,paddedDate} from '../../../../../tools/benchmark/context-small-test-helpers';
// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema} from '../../../conversation/context-contract/contracts';
import {CONTEXT_SMALL_PROTOCOL_V3} from '../../../conversation/context-contract/small-protocol';
import {encodeInternalFlatV3 as encodeSmallContextV3,decodeInternalFlatV3 as decodeSmallContextV3,internalFlatSchemaV3 as smallContextSchemaV3} from './context-small-intermediate';
import {frozenContextProposal} from '../../../../../tools/benchmark/context-contract-fixtures';
import {encodeGoogleLiteEuTypedContextV3,decodeGoogleLiteEuTypedContextTransportV3} from './context-provider-typed-wire';
import {CONTEXT_TYPED_PROTOCOL_V3} from '../../../conversation/context-contract/typed-protocol';
const input=ContextInputSchema.parse(JSON.parse(readFileSync(new URL('./__fixtures__/typed105-r01-before.json',import.meta.url),'utf8')).input);
const proposal=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0));
const decode=(wire:unknown)=>decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input);
it('preserves canonical interpretation with disjoint operation and flat date controls',()=>{
 const wire=encodeSmallContextV3(proposal,input),selected=smallContextSchemaV3(input);
 expect(z.fromJSONSchema(selected.schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(wire).success).toBe(true);
 const operation=(selected.schema as unknown as {properties:{operation:unknown}}).properties.operation;
 expect((operation as {anyOf:unknown[]}).anyOf).toHaveLength(2);
 const visit=(node:unknown):void=>{if(!node||typeof node!=='object')return;const value=node as Record<string,unknown>;
  expect(value).not.toHaveProperty('oneOf');expect(value).not.toHaveProperty('$ref');expect(value).not.toHaveProperty('$defs');
  if(value.anyOf&&node!==operation){
   const branches=(value.anyOf as Array<{type:string;properties?:Record<string,{enum?:string[]}>;additionalProperties?:boolean}>).filter(branch=>branch.type!=='null');
   if(branches.every(branch=>branch.properties?.kind))expect(branches.map(b=>b.properties!.kind.enum)).toEqual([['CIVIL_DATE'],['RELATIVE_DAY'],['WEEKDAY']]);
   else {expect(branches.length).toBeLessThanOrEqual(3);const operations=branches.flatMap(branch=>branch.properties!.operation.enum!);expect(new Set(operations).size).toBe(operations.length);}
   for(const branch of branches)expect(branch.additionalProperties).toBe(false);
  }
  for(const child of Object.values(value))if(Array.isArray(child))child.forEach(visit);else visit(child);
 };visit(selected.schema);
 expect(JSON.stringify(operation).match(/"anyOf"/gu)).toHaveLength(1);
 // Reviewed test-only structure ceiling: initial measured18555, healthy max25267.
 // Runtime32768-byte response guard and1536-token output limit are unchanged.
 expect(JSON.stringify(selected.schema).length).toBeLessThan(19000);
 expect(decode(wire)).toEqual(decodeGoogleLiteEuTypedContextTransportV3(encodeGoogleLiteEuTypedContextV3(proposal,input),CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input));
});
it('rejects unknown, fractional, negative or unused value references without coercion',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
 const creation=ConversationInterpretationV3Schema.parse({...proposal,intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'title',operation:'SET',value:'synthetic',evidence}],query:null,uncertainties:[]});
 const original=encodeSmallContextV3(creation,input);
 expect(decode(original).status).toBe('PARSED');
 for(const value of [-1,.5,999,'0']){const wire=structuredClone(original);changeAt(wire,0).value=value as number;expect(decode(wire).status).toBe('REFUSED');}
 const unused=structuredClone(original);unused.texts.push('unreferenced payload');expect(decode(unused).status).toBe('REFUSED');
 const duplicate=structuredClone(original);Object.assign(duplicate,{changes:[{field:'title',...changeAt(duplicate,0)},{field:'title',...changeAt(duplicate,0)}]});expect(decode(duplicate).status).toBe('REFUSED');
 const source=structuredClone(original);changeAt(source,0).evidence=['U99'];expect(decode(source).status).toBe('REFUSED');
 expect(decodeSmallContextV3(original,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input).status).toBe('REFUSED');
});

it('keeps small prompt unambiguous and publishes the complete immutable field codebook',async()=>{
 const {CONTEXT_SMALL_PROMPT}=await import('../../../conversation/context-contract/small-wire');
 const {UNCERTAINTY_FIELD_WIRE_CODE_V1}=await import('./context-provider-wire');
 expect(CONTEXT_SMALL_PROMPT).toContain(JSON.stringify(UNCERTAINTY_FIELD_WIRE_CODE_V1));
 for(const phrase of ['Core roots:','Ten singleton roots required','extras use {','entries {field,operation,value,evidence}','Absent carriers:null'])expect(CONTEXT_SMALL_PROMPT).not.toContain(phrase);
 expect(CONTEXT_SMALL_PROMPT).not.toContain('WEEK,MONTH,WEEKEND(offset');expect(CONTEXT_SMALL_PROMPT).not.toContain('period=null');
 for(const phrase of ['MONTH_CURRENT','MONTH_PREVIOUS','MONTH_NEXT','There is NO offset field'])expect(CONTEXT_SMALL_PROMPT).toContain(phrase);
 for(const phrase of ['Multiple actions:','NEW:no old facts','Side queries/corrections KEEP','Empty field carrier means unchanged','Source meaning completeness:'])expect(CONTEXT_SMALL_PROMPT).toContain(phrase);
});

it('rejects malformed dates/period references and ranks but quarantines optional guidance',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const base=ConversationInterpretationV3Schema.parse({...proposal,intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'title',operation:'SET',value:'synthetic',evidence},{field:'eventDate',operation:'SET',value:{kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null},evidence}],query:null,uncertainties:[]});
 const wire=encodeSmallContextV3(base,input);expect(decode(wire).status).toBe('PARSED');
 for(const change of [
  (w:typeof wire)=>{changeAt(w,1).date[0].offsetDays=1;},
  (w:typeof wire)=>{changeAt(w,1).date[0].year=10000;},
  (w:typeof wire)=>{changeAt(w,1).rank=changeAt(w,0).rank;},
  (w:typeof wire)=>{Object.assign(w,{changes:changeEntries(w).reverse()});},
  (w:typeof wire)=>{changeAt(w,0).rank=13;},
  (w:typeof wire)=>{changeAt(w,0).evidence=[];},
  (w:typeof wire)=>{changeAt(w,0).operation='CLEAR';},
  (w:typeof wire)=>{w.dates=Array.from({length:129},()=>structuredClone(changeAt(w,1).date[0]));},
 ]){const altered=structuredClone(wire);change(altered);expect(decode(altered).status,change.toString()).toBe('REFUSED');}
 const malformedAdvice={...wire,directive:[{kind:'APPROVE'}],reply:[{text:123}]};
 const parsed=decode(malformedAdvice);expect(parsed.status).toBe('PARSED');
 const list=encodeSmallContextV3(ConversationInterpretationV3Schema.parse({...proposal,query:{kind:'LIST',statusScope:'DEFAULT',period:{kind:'DAY',date:{kind:'RELATIVE_DAY',offsetDays:0}},evidence},uncertainties:[]}),input);
 expect(decode(list).status).toBe('PARSED');
 for(const index of [-1,.5,999]){const altered=structuredClone(list);altered.query[0].period[0].date=index;expect(decode(altered).status).toBe('REFUSED');}
 const inactive=structuredClone(list);inactive.query[0].period[0].offset=1;expect(decode(inactive).status).toBe('REFUSED');
 const unsupported=structuredClone(list);unsupported.query[0].period[0].kind='UNSUPPORTED';unsupported.query[0].period[0].unsupportedKind='UNSUPPORTED_PERIOD';expect(decode(unsupported).status).toBe('REFUSED');unsupported.query[0].period[0].date=[];expect(decode(unsupported).status).toBe('PARSED');
});

it('reports exact finite small-table refusal controls without retaining authored content',()=>{
 const privateText='private synthetic sentinel never log';
 const wire=encodeSmallContextV3(proposal,input);wire.texts.push(privateText);
 const diagnostics:unknown[]=[];
 expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,d=>diagnostics.push(d),input).status).toBe('REFUSED');
 expect(diagnostics).toHaveLength(1);
 expect(diagnostics[0]).toMatchObject({issues:[{smallTables:{reason:'GENERATION_SHAPE_INVALID',table:'texts'}}]});
 expect(JSON.stringify(diagnostics)).not.toContain(privateText);
});
it('distinguishes malformed generation shape from invalid table references',()=>{
 const diagnostics:unknown[]=[];
 const wire=encodeSmallContextV3(proposal,input);
 wire.query=[{period:3 as unknown as Record<string,unknown>[],date:[],outputCalendar:null,topic:null,evidence:['U0']}];
 expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,d=>diagnostics.push(d),input).status).toBe('REFUSED');
 expect(diagnostics[0]).toMatchObject({issues:[{smallTables:{reason:'GENERATION_SHAPE_INVALID'}}]});
 diagnostics.length=0;
 wire.query=[];
 expect(decodeSmallContextV3({...wire,periods:'private malformed sentinel'},CONTEXT_SMALL_PROTOCOL_V3,undefined,d=>diagnostics.push(d),input).status).toBe('REFUSED');
 expect(diagnostics[0]).toMatchObject({issues:[{smallTables:{reason:'GENERATION_SHAPE_INVALID',table:'periods'}}]});
 expect(JSON.stringify(diagnostics)).not.toContain('private malformed sentinel');
});

it('a throwing diagnostics observer cannot alter refusal or cause output repair',()=>{
 const wire=encodeSmallContextV3(proposal,input);wire.texts.push('unreferenced');
 const before=JSON.stringify(wire);
 expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,()=>{throw Error('observer');},input).status).toBe('REFUSED');
 expect(JSON.stringify(wire)).toBe(before);
});

it('inlines owned text values and forbids every free-standing text table row in the generation schema',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
 const creation=ConversationInterpretationV3Schema.parse({...proposal,intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'title',operation:'SET',value:'synthetic inline title',evidence}],query:null,uncertainties:[]});
 const wire=encodeSmallContextV3(creation,input);
 expect(wire.texts).toEqual([]);
 expect(changeAt(wire,0)).toMatchObject({value:null,text:'synthetic inline title'});
 expect(decode(wire).status).toBe('PARSED');
 const generation=z.fromJSONSchema(smallContextSchemaV3(input).schema as Parameters<typeof z.fromJSONSchema>[0]);
 expect(generation.safeParse({...wire,texts:['unused text']}).success).toBe(false);
 expect(decode({...wire,texts:['unused text']}).status).toBe('REFUSED');
 expect(decode({...wire,changes:[{...changeAt(wire,0),value:0}]}).status).toBe('REFUSED');
});

it('R01 month-list response needs no text rows and cannot generate the observed orphan texts',()=>{
 const bound=ContextInputSchema.parse({...input,turns:[...input.turns,{role:'USER',text:'Tháng này có lịch gì ko?'}],currentTurn:1});
 const evidence=[{kind:'USER_QUOTE',turn:1,quote:bound.turns[1].text,occurrence:1}];
 const list=ConversationInterpretationV3Schema.parse({...proposal,intent:'LIST_REMINDERS',requestTarget:null,changes:[],query:{kind:'LIST',statusScope:'DEFAULT',period:{kind:'MONTH',offset:0},evidence},uncertainties:[]});
 const wire=encodeSmallContextV3(list,bound),generation=z.fromJSONSchema(smallContextSchemaV3(bound).schema as Parameters<typeof z.fromJSONSchema>[0]);
 expect(wire.texts).toEqual([]);expect(generation.safeParse(wire).success).toBe(true);
 expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,bound)).toEqual(decodeGoogleLiteEuTypedContextTransportV3(encodeGoogleLiteEuTypedContextV3(list,bound),CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,bound));
 for(const text of ['MONTH','DEFAULT','LUNAR_VN','orphan']){
  const invalid={...wire,texts:[text]};expect(generation.safeParse(invalid).success).toBe(false);
  expect(decodeSmallContextV3(invalid,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,bound).status).toBe('REFUSED');
 }
});

it('keeps inline uncertainty text canonical and rejects mixed or missing value ownership',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...proposal,uncertainties:[...proposal.uncertainties,{field:'intent',reason:'AMBIGUOUS',alternatives:[{value:'LIST_REMINDERS',evidence},{value:'CREATE_REMINDER',evidence}]}]});
 const wire=encodeSmallContextV3(canonical,input);
 expect(wire.texts).toEqual([]);expect(wire.uncertainties.at(-1)!.alternatives[0]).toMatchObject({value:null,text:'LIST_REMINDERS'});
 expect(decode(wire)).toEqual(decodeGoogleLiteEuTypedContextTransportV3(encodeGoogleLiteEuTypedContextV3(canonical,input),CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input));
 for(const patch of [{value:0},{text:null}]){const invalid=structuredClone(wire);Object.assign(invalid.uncertainties.at(-1)!.alternatives[0],patch);expect(decode(invalid).status).toBe('REFUSED');}
});

it('owns typed dates at their consumer and forbids root orphan dates in generation',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const civil={kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null};
 const canonical=ConversationInterpretationV3Schema.parse({...proposal,intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'eventDate',operation:'SET',value:civil,evidence}],query:null,uncertainties:[]});
 const wire=encodeSmallContextV3(canonical,input);
 expect(wire.dates).toEqual([]);
 expect(changeAt(wire,0)).toMatchObject({value:null,text:null,date:[civil]});
 const generation=z.fromJSONSchema(smallContextSchemaV3(input).schema as Parameters<typeof z.fromJSONSchema>[0]);
 expect(generation.safeParse({...wire,dates:[civil]}).success).toBe(false);
 expect(decode(wire)).toEqual(decodeGoogleLiteEuTypedContextTransportV3(encodeGoogleLiteEuTypedContextV3(canonical,input),CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input));
});

it('rejects dates in inactive owner cells and preserves inline date alternatives',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const civil={kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null};
 const canonical=ConversationInterpretationV3Schema.parse({...proposal,intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},query:null,changes:[{field:'title',operation:'SET',value:'synthetic',evidence}],uncertainties:[{field:'eventDate',reason:'AMBIGUOUS',alternatives:[{value:civil,evidence}]}]});
 const wire=encodeSmallContextV3(canonical,input);expect(decode(wire).status).toBe('PARSED');
 expect(wire.dates).toEqual([]);expect(wire.uncertainties[0].alternatives[0]).toMatchObject({value:null,text:null,date:[civil]});
 expect(decode(wire)).toEqual(decodeGoogleLiteEuTypedContextTransportV3(encodeGoogleLiteEuTypedContextV3(canonical,input),CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input));
 const cell=wire.uncertainties[0].alternatives[0].date;
 const wrongOwner=structuredClone(wire);changeAt(wrongOwner,0).date=structuredClone(cell);expect(decode(wrongOwner).status).toBe('REFUSED');
 for(const patch of [{date:[]},{date:[...cell,...cell]},{value:0},{text:'not a date'}]){const invalid=structuredClone(wire);Object.assign(invalid.uncertainties[0].alternatives[0],patch);expect(decode(invalid).status).toBe('REFUSED');}
 const cleared=structuredClone(wire);changeAt(cleared,0).operation='CLEAR';changeAt(cleared,0).text=null;changeAt(cleared,0).date=structuredClone(cell);expect(decode(cleared).status).toBe('REFUSED');
});
it('R01 month query forbids root dates and inactive month boundary dates',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...proposal,query:{kind:'LIST',statusScope:'DEFAULT',period:{kind:'MONTH',offset:0},evidence},uncertainties:[]});
 const wire=encodeSmallContextV3(canonical,input),generation=z.fromJSONSchema(smallContextSchemaV3(input).schema as Parameters<typeof z.fromJSONSchema>[0]);
 expect(wire.dates).toEqual([]);expect(wire.query[0].period[0]).toMatchObject({date:[],from:[],through:[]});expect(decode(wire).status).toBe('PARSED');
 const cell=[{kind:'RELATIVE_DAY',calendar:null,day:null,month:null,year:null,leapMonth:null,offsetDays:0,weekday:null,qualifier:null}];
 expect(generation.safeParse({...wire,dates:cell}).success).toBe(false);expect(decode({...wire,dates:cell}).status).toBe('REFUSED');
 for(const key of ['date','from','through']){const invalid=structuredClone(wire);invalid.query[0].period[0][key]=cell;expect(decode(invalid).status).toBe('REFUSED');}
 const bad=structuredClone(wire);bad.query[0].date=cell;expect(decode(bad).status).toBe('REFUSED');
});

it('owns periods inline and rejects legacy query indexes',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...proposal,query:{kind:'LIST',statusScope:'DEFAULT',period:{kind:'MONTH',offset:0},evidence},uncertainties:[]});
 const wire=encodeSmallContextV3(canonical,input);
 expect(wire.periods).toEqual([]);
 expect(Array.isArray(wire.query[0].period)).toBe(true);
 expect(wire.query[0].period).toHaveLength(1);
 expect(decode(wire).status).toBe('PARSED');
 const legacy=structuredClone(wire);Object.assign(legacy.query[0],{period:0});
 expect(decode(legacy).status).toBe('REFUSED');
});

it('preserves every owned period kind and rejects numeric, duplicate, inactive or orphan periods',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const relative={kind:'RELATIVE_DAY',offsetDays:0};
 for(const period of [{kind:'DAY',date:relative},...['WEEK','MONTH','WEEKEND'].map(kind=>({kind,offset:0})),...['REST_OF_MONTH','NEXT_7_DAYS','UPCOMING'].map(kind=>({kind})),{kind:'DATE_BOUNDS',from:relative,through:{kind:'RELATIVE_DAY',offsetDays:1}}]){
  const canonical=ConversationInterpretationV3Schema.parse({...proposal,query:{kind:'LIST',statusScope:'DEFAULT',period,evidence},uncertainties:[]});
  const wire=encodeSmallContextV3(canonical,input);
  expect(decode(wire)).toEqual(decodeGoogleLiteEuTypedContextTransportV3(encodeGoogleLiteEuTypedContextV3(canonical,input),CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input));
  for(const payload of [-1,0,.5,999,'0',null,[...wire.query[0].period,...wire.query[0].period]]){const invalid=structuredClone(wire);Object.assign(invalid.query[0],{period:payload});expect(decode(invalid).status).toBe('REFUSED');}
  const orphan=structuredClone(wire);orphan.periods=structuredClone(wire.query[0].period);expect(decode(orphan).status).toBe('REFUSED');
  const inactive=structuredClone(wire);inactive.operation.code='5';expect(decode(inactive).status).toBe('REFUSED');
 }
});

it('owns queryRange alternative periods and refuses mixed or wrong-owner alternatives',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...proposal,uncertainties:[{field:'queryRange',reason:'AMBIGUOUS',alternatives:[{value:{kind:'MONTH',offset:0},evidence},{value:{kind:'WEEK',offset:1},evidence}]}]});
 const wire=encodeSmallContextV3(canonical,input);
 expect(wire.periods).toEqual([]);
 expect(wire.uncertainties[0].alternatives[0]).toMatchObject({value:null,text:null,date:[],period:[{kind:'MONTH_CURRENT'}]});
 expect(decode(wire)).toEqual(decodeGoogleLiteEuTypedContextTransportV3(encodeGoogleLiteEuTypedContextV3(canonical,input),CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input));
 for(const patch of [{period:[]},{value:0},{text:'MONTH'},{period:[...wire.uncertainties[0].alternatives[0].period,...wire.uncertainties[0].alternatives[0].period]}]){const invalid=structuredClone(wire);Object.assign(invalid.uncertainties[0].alternatives[0],patch);expect(decode(invalid).status).toBe('REFUSED');}
 const mixedDate=structuredClone(wire);mixedDate.uncertainties[0].alternatives[0].date=[{kind:'RELATIVE_DAY',calendar:null,day:null,month:null,year:null,leapMonth:null,offsetDays:0,weekday:null,qualifier:null}];expect(decode(mixedDate).status).toBe('REFUSED');
 for(const period of [{kind:'DAY',date:{kind:'RELATIVE_DAY',offsetDays:0}},{kind:'DATE_BOUNDS',from:{kind:'RELATIVE_DAY',offsetDays:0},through:{kind:'RELATIVE_DAY',offsetDays:1}}]){const c=ConversationInterpretationV3Schema.parse({...canonical,uncertainties:[{field:'queryRange',reason:'AMBIGUOUS',alternatives:[{value:period,evidence}]}]});expect(decode(encodeSmallContextV3(c,input))).toEqual(decodeGoogleLiteEuTypedContextTransportV3(encodeGoogleLiteEuTypedContextV3(c,input),CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input));}
 const absent=ConversationInterpretationV3Schema.parse({...canonical,query:{kind:'LIST',statusScope:'DEFAULT',period:null,evidence}});expect(encodeSmallContextV3(absent,input).query[0].period).toEqual([]);expect(decode(encodeSmallContextV3(absent,input))).toEqual(decodeGoogleLiteEuTypedContextTransportV3(encodeGoogleLiteEuTypedContextV3(absent,input),CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input));
 const wrong=structuredClone(wire);wrong.uncertainties[0].fieldCode=0;expect(decode(wrong).status).toBe('REFUSED');
});

it('projects nested typed query failures without retaining authored query content',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...proposal,query:{kind:'LIST',statusScope:'DEFAULT',period:{kind:'MONTH',offset:0},evidence},uncertainties:[]});
 for(const field of ['topic','outputCalendar'] as const){
  const wire=encodeSmallContextV3(canonical,input);wire.query[0][field]='PRIVATE_QUERY_SENTINEL';
  const diagnostics:Array<{issues:Array<{path:Array<string|number>}>}>=[];
  expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,d=>diagnostics.push(d),input).status).toBe('REFUSED');
  expect(diagnostics[0]).toMatchObject({issues:[{smallTables:field==='outputCalendar'?{reason:'GENERATION_SHAPE_INVALID'}:{reason:'INACTIVE_VALUE_NON_NULL',location:'PADDED_OPERAND'}}]});
  expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE_QUERY_SENTINEL');
 }
});
it('rejects legacy authored offsets at generation instead of passing them to typed query validation',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...proposal,query:{kind:'LIST',statusScope:'DEFAULT',period:{kind:'MONTH',offset:0},evidence},uncertainties:[]});
 const wire=encodeSmallContextV3(canonical,input);wire.query[0].period[0].offset=2;
 const diagnostics:Array<{issues:Array<{path:Array<string|number>}>}>=[];
 expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,d=>diagnostics.push(d),input).status).toBe('REFUSED');
 expect(z.fromJSONSchema(smallContextSchemaV3(input).schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(wire).success).toBe(false);
 expect(diagnostics).toHaveLength(1);
});

it('encodes all nine relative periods as typed finite controls without nullable offsets',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const generation=z.fromJSONSchema(smallContextSchemaV3(input).schema as Parameters<typeof z.fromJSONSchema>[0]);
 for(const kind of ['WEEK','MONTH','WEEKEND'])for(const [offset,label] of [[-1,'PREVIOUS'],[0,'CURRENT'],[1,'NEXT']] as const){
  const canonical=ConversationInterpretationV3Schema.parse({...proposal,query:{kind:'LIST',statusScope:'DEFAULT',period:{kind,offset},evidence},uncertainties:[{field:'queryRange',reason:'AMBIGUOUS',alternatives:[{value:{kind,offset},evidence}]}]});
  const wire=encodeSmallContextV3(canonical,input);
  expect(wire.query[0].period[0].kind).toBe(`${kind}_${label}`);
  expect(wire.query[0].period[0]).not.toHaveProperty('offset');
  expect(wire.uncertainties[0].alternatives[0].period[0].kind).toBe(`${kind}_${label}`);
  expect(generation.safeParse(wire).success).toBe(true);
  expect(decode(wire)).toEqual(decodeGoogleLiteEuTypedContextTransportV3(encodeGoogleLiteEuTypedContextV3(canonical,input),CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input));
  for(const invalid of [{kind,offset:null},{offset:null},{kind:`${kind}_OTHER`},{unsupportedKind:'MONTH'}]){const bad=structuredClone(wire);Object.assign(bad.query[0].period[0],invalid);expect(generation.safeParse(bad).success&&decode(bad).status==='PARSED').toBe(false);expect(decode(bad).status).toBe('REFUSED');}
 }
});
it('preserves explicit unsupported periods without permitting recognized-kind null-offset bypasses',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...proposal,query:{kind:'LIST',statusScope:'DEFAULT',period:{kind:'MONTH',offset:0},evidence},uncertainties:[]});
 const wire=encodeSmallContextV3(canonical,input);
 for(const unsupportedKind of [null,'MONTH','WEEK','WEEKEND','DAY','UNSUPPORTED',...['WEEK','MONTH','WEEKEND'].flatMap(kind=>['PREVIOUS','CURRENT','NEXT'].map(label=>`${kind}_${label}`))]){const bad=structuredClone(wire);Object.assign(bad.query[0].period[0],{kind:'UNSUPPORTED',unsupportedKind});expect(decode(bad).status).toBe('REFUSED');}
 const unknown=structuredClone(wire);Object.assign(unknown.query[0].period[0],{kind:'UNSUPPORTED',unsupportedKind:'UNSUPPORTED_PERIOD'});expect(decode(unknown).status).toBe('PARSED');
 const old={...CONTEXT_SMALL_PROTOCOL_V3,promptVersion:'calenote-context-small-tables-106-inline-values-5',wireVersion:'google-gemini-2.5-flash-lite-vertex-eu-context-small-tables-106-inline-values-5'};expect(decodeSmallContextV3(wire,old,undefined,undefined,input).status).toBe('REFUSED');
});

it('correlates every operation with target ownership in one shallow two-branch schema',()=>{
 const wire=encodeSmallContextV3(proposal,input);
 const schema=smallContextSchemaV3(input).schema as unknown as {properties:Record<string,unknown>};
 const operation=schema.properties.operation as {anyOf:unknown[]};
 expect(operation?.anyOf).toHaveLength(2);
 expect(schema.properties).not.toHaveProperty('operationCode');
 expect(schema.properties).not.toHaveProperty('targetEvidence');
 const validator=z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
 for(const code of ['3','4','5','6','7','8']){
  expect(validator.safeParse({...wire,operation:{code,targetEvidence:[]}}).success).toBe(true);
  for(const targetEvidence of [['U0'],['U0','U0'],['U0','U0','U0']])expect(validator.safeParse({...wire,operation:{code,targetEvidence}}).success).toBe(false);
 }
 for(const code of ['0','1','2','9','10','11']){
  expect(validator.safeParse({...wire,operation:{code,targetEvidence:[]}}).success).toBe(false);
  for(const targetEvidence of [['U0'],['U0','U0'],['U0','U0','U0']])expect(validator.safeParse({...wire,operation:{code,targetEvidence}}).success).toBe(true);
  for(const targetEvidence of [['U99'],['U0','U0','U0','U0']])expect(validator.safeParse({...wire,operation:{code,targetEvidence}}).success).toBe(false);
 }
 const contradiction={...wire,operation:{code:'3',targetEvidence:['U0']}};
 const before=JSON.stringify(contradiction),diagnostics:unknown[]=[];
 expect(decodeSmallContextV3(contradiction,CONTEXT_SMALL_PROTOCOL_V3,undefined,d=>diagnostics.push(d),input).status).toBe('REFUSED');
 expect(diagnostics[0]).toMatchObject({issues:[{smallTables:{reason:'GENERATION_SHAPE_INVALID'}}]});
 expect(JSON.stringify(contradiction)).toBe(before);
});

it('round trips all twelve operation ownership tuples without rewriting targets',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const tuples=[['CREATE_REMINDER','CURRENT',null],['CREATE_REMINDER','NEW',null],['CREATE_REMINDER','UNRESOLVED',null],['LIST_REMINDERS',null,'LIST'],['CALENDAR_QUERY',null,'CALENDAR_DATE'],['CAPABILITY_QUERY',null,'CAPABILITY'],['HELP',null,null],['UNSUPPORTED',null,null],['AMBIGUOUS',null,null],['AMBIGUOUS','CURRENT',null],['AMBIGUOUS','NEW',null],['AMBIGUOUS','UNRESOLVED',null]];
 for(const [code,[intent,target,queryKind]] of tuples.entries()){
  const query=queryKind==='LIST'?{kind:'LIST',period:{kind:'MONTH',offset:0},statusScope:'DEFAULT',evidence}:queryKind==='CALENDAR_DATE'?{kind:queryKind,date:{kind:'RELATIVE_DAY',offsetDays:0},outputCalendar:'LUNAR_VN',evidence}:queryKind==='CAPABILITY'?{kind:queryKind,topic:'LUNAR',evidence}:null;
  const canonical=ConversationInterpretationV3Schema.parse({...proposal,intent,requestTarget:target?{kind:target,evidence}:null,changes:[],query,uncertainties:intent==='AMBIGUOUS'&&target?[{field:'operation',reason:'AMBIGUOUS',alternatives:[]}]:[],conversationDirective:null,replyProposal:null});
  const wire=encodeSmallContextV3(canonical,input);
  expect(wire.operation).toEqual({code:String(code),targetEvidence:target?['U0']:[]});
  expect(decode(wire).status,String(code)).toBe('PARSED');
  expect(z.fromJSONSchema(smallContextSchemaV3(input).schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(wire).success).toBe(true);
  expect(decode(wire)).toEqual(decodeGoogleLiteEuTypedContextTransportV3(encodeGoogleLiteEuTypedContextV3(canonical,input),CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input));
  for(const extra of [{operation:{...wire.operation,extra:'private'}},{operationCode:String(code)},{targetEvidence:[]}])expect(decode({...wire,...extra}).status).toBe('REFUSED');
 }
});

it('owns integer values inline in changes and alternatives with no integer-table references',()=>{
 const numericInput=ContextInputSchema.parse({...input,turns:input.turns.map((turn,index)=>index===input.currentTurn?{...turn,text:'nhắc mình họp 2 lần, trước sự kiện 3 ngày'}:turn)});
 const numericDecode=(wire:unknown)=>decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,numericInput);
 const evidence=[{kind:'USER_QUOTE',turn:numericInput.currentTurn,quote:numericInput.turns[numericInput.currentTurn].text,occurrence:1}];
 const numeric=ConversationInterpretationV3Schema.parse({...proposal,intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'occurrenceCount',operation:'SET',value:2,evidence},{field:'leadOffsetDays',operation:'SET',value:3,evidence}],query:null,uncertainties:[]});
 const wire=encodeSmallContextV3(numeric,numericInput);
 expect(wire.integers).toEqual([]);expect(changeEntries(wire).map(c=>c.value)).toEqual([2,3]);expect(numericDecode(wire).status).toBe('PARSED');
 for(const invalid of [0,-1,.5,Number.MAX_SAFE_INTEGER+1,'2',null]){const bad=structuredClone(wire);changeAt(bad,0).value=invalid as number;expect(numericDecode(bad).status).toBe('REFUSED');}
 const ambiguous=ConversationInterpretationV3Schema.parse({...numeric,changes:[],uncertainties:[{field:'occurrenceCount',reason:'AMBIGUOUS',alternatives:[{value:2,evidence},{value:3,evidence}]}]});const uncertain=encodeSmallContextV3(ambiguous,numericInput);expect(uncertain.integers).toEqual([]);expect(uncertain.uncertainties[0].alternatives.map(a=>a.value)).toEqual([2,3]);expect(numericDecode(uncertain).status).toBe('PARSED');
 expect(numericDecode(wire)).toEqual(decodeGoogleLiteEuTypedContextTransportV3(encodeGoogleLiteEuTypedContextV3(numeric,numericInput),CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,numericInput));
 const schema=smallContextSchemaV3(numericInput).schema as unknown as {properties:{integers:{maxItems:number}}};expect(schema.properties.integers.maxItems).toBe(0);
 const legacy=structuredClone(wire);legacy.integers=[2,3];changeAt(legacy,0).value=0;changeAt(legacy,1).value=1;expect(numericDecode(legacy).status).toBe('REFUSED');
 const old={...CONTEXT_SMALL_PROTOCOL_V3,promptVersion:'calenote-context-small-tables-106-operation-header-6',wireVersion:'google-gemini-2.5-flash-lite-vertex-eu-context-small-tables-106-operation-header-6'};expect(decodeSmallContextV3(wire,old,undefined,undefined,numericInput).status).toBe('REFUSED');
});
it('identifies the inactive operand boundary without persisting authored values',()=>{
 const wire=encodeSmallContextV3(proposal,input);expect(wire.query).toHaveLength(1);
 wire.query[0].date=[paddedDate({kind:'RELATIVE_DAY',offsetDays:0})];
 const diagnostics:unknown[]=[];
 expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,d=>diagnostics.push(d),input).status).toBe('REFUSED');
 expect(diagnostics[0]).toMatchObject({issues:[{smallTables:{reason:'INACTIVE_VALUE_NON_NULL',location:'QUERY_DATE'}}]});
 expect(JSON.stringify(diagnostics)).not.toContain(input.turns[input.currentTurn].text);
});
it('keeps flat DateOperand kind correlations as strict downstream ownership checks',()=>{
 const schema=smallContextSchemaV3(input).schema as unknown as {properties:{query:{items:{properties:{date:{items:unknown}}}}}};
 const selected=z.fromJSONSchema(schema.properties.query.items.properties.date.items as Parameters<typeof z.fromJSONSchema>[0]);
 for(const value of [{kind:'RELATIVE_DAY',offsetDays:-2},{kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null},{kind:'WEEKDAY',weekday:2,qualifier:'NEXT_WEEK'}]){
  expect(selected.safeParse(paddedDate(value)).success).toBe(true);expect(selected.safeParse(value).success).toBe(false);
 }
 const mixture=paddedDate({kind:'RELATIVE_DAY',calendar:'GREGORIAN',offsetDays:-2});expect(selected.safeParse(mixture).success).toBe(true);
 const wire=encodeSmallContextV3(proposal,input);wire.query[0].date=[mixture];expect(decode(wire).status).toBe('REFUSED');
 const old={...CONTEXT_SMALL_PROTOCOL_V3,promptVersion:'calenote-context-small-tables-106-field-controls-21',wireVersion:'google-gemini-2.5-flash-lite-vertex-eu-context-small-tables-106-field-controls-21'};expect(decodeSmallContextV3(encodeSmallContextV3(proposal,input),old,undefined,undefined,input).status).toBe('REFUSED');
});

it('owns each eligible field once in the required control dictionary',()=>{
 const wire=encodeSmallContextV3(proposal,input);
 expect(Array.isArray(wire.changes)).toBe(false);
 const schema=smallContextSchemaV3(input).schema as unknown as {properties:{changes:{properties:Record<string,unknown>;required:string[];additionalProperties:boolean}}};
 expect(schema.properties.changes.additionalProperties).toBe(false);
 expect(Object.keys(wire.changes).sort()).toEqual([...schema.properties.changes.required].sort());
 for(const carrier of Object.values(wire.changes))if(carrier!==null)expect(carrier).not.toHaveProperty('field');
 const reversed={...wire,changes:Object.fromEntries(Object.entries(wire.changes).reverse())};
 expect(decode(reversed)).toEqual(decode(wire));
 const omitted=structuredClone(wire);delete (omitted.changes as Record<string,unknown>)[Object.keys(wire.changes)[0]];
 expect(decode(omitted).status).toBe('REFUSED');
 expect(decode({...wire,changes:[]}).status).toBe('REFUSED');
});

it('uses a required flat control object for every eligible field with explicit inert KEEP',()=>{
 const wire=encodeSmallContextV3(proposal,input);
 for(const carrier of Object.values(wire.changes)){
  expect(carrier).not.toBeNull();
  expect(carrier).toEqual({rank:null,operation:'KEEP',value:null,text:null,date:[],evidence:[]});
 }
 const schema=smallContextSchemaV3(input).schema as unknown as {properties:{changes:{properties:Record<string,{type:string;anyOf?:unknown}>}}};
 for(const field of Object.values(schema.properties.changes.properties)){expect(field.type).toBe('object');expect(field).not.toHaveProperty('anyOf');}
});

it('authors the entire date family as required flat columns with exact inactive nulls',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
 const civil={kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null};
 const canonical=ConversationInterpretationV3Schema.parse({...proposal,intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'eventDate',operation:'SET',value:civil,evidence}],query:null,uncertainties:[]});
 const wire=encodeSmallContextV3(canonical,input),date=wire.changes.eventDate!.date[0];
 expect(Object.keys(date).sort()).toEqual(['kind','calendar','day','month','year','leapMonth','offsetDays','weekday','qualifier'].sort());
 expect(date).toEqual({...civil,offsetDays:null,weekday:null,qualifier:null});
 expect(decode(wire).status).toBe('PARSED');
 const legacy=structuredClone(wire);legacy.changes.eventDate!.date=[civil];expect(decode(legacy).status).toBe('REFUSED');
});

it('refuses nonnull inactive and missing active date operands at every consumer without changing authored data',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
 const variants=[{kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null},{kind:'RELATIVE_DAY',offsetDays:0},{kind:'WEEKDAY',weekday:2,qualifier:'NEXT_WEEK'}];
 const active:Record<string,string[]>={CIVIL_DATE:['calendar','day','month','year','leapMonth'],RELATIVE_DAY:['offsetDays'],WEEKDAY:['weekday','qualifier']};
 const required:Record<string,string[]>={CIVIL_DATE:['calendar','day','month'],RELATIVE_DAY:['offsetDays'],WEEKDAY:['weekday','qualifier']};
 const poison:Record<string,unknown>={calendar:'GREGORIAN',day:11,month:10,year:2026,leapMonth:false,offsetDays:1,weekday:2,qualifier:'NEXT_WEEK'};
 let checked=0;const consumers=new Set<string>();
 for(const date of variants){
  const creation={...proposal,intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'eventDate',operation:'SET',value:date,evidence}],query:null,uncertainties:[]};
  const list={...proposal,intent:'LIST_REMINDERS',requestTarget:null,changes:[],uncertainties:[],query:{kind:'LIST',statusScope:'DEFAULT',period:{kind:'MONTH',offset:0},evidence}};
  const fixtures=[creation,{...list,intent:'CALENDAR_QUERY',query:{kind:'CALENDAR_DATE',date,outputCalendar:'LUNAR_VN',evidence}},{...list,query:{kind:'LIST',statusScope:'DEFAULT',period:{kind:'DAY',date},evidence}},{...list,query:{kind:'LIST',statusScope:'DEFAULT',period:{kind:'DATE_BOUNDS',from:date,through:date},evidence}},{...list,uncertainties:[{field:'eventDate',reason:'AMBIGUOUS',alternatives:[{value:date,evidence}]}]},{...list,uncertainties:[{field:'queryRange',reason:'AMBIGUOUS',alternatives:[{value:{kind:'DAY',date},evidence}]}]},{...list,uncertainties:[{field:'queryRange',reason:'AMBIGUOUS',alternatives:[{value:{kind:'DATE_BOUNDS',from:date,through:date},evidence}]}]}];
  for(const fixture of fixtures){
   const wire=encodeSmallContextV3(ConversationInterpretationV3Schema.parse(fixture),input);expect(decode(wire).status).toBe('PARSED');
   const paths:string[][]=[];const walk=(node:unknown,path:string[])=>{if(!node||typeof node!=='object')return;const row=node as Record<string,unknown>;if(typeof row.kind==='string'&&Object.hasOwn(active,row.kind)){paths.push(path);return;}for(const [key,value]of Object.entries(node))walk(value,[...path,key]);};walk(wire,[]);
   for(const path of paths){consumers.add(path.filter(key=>!/^\d+$/u.test(key)).join('.'));
    const target=(value:typeof wire)=>path.reduce((node,key)=>(node as Record<string,unknown>)[key],value as unknown) as Record<string,unknown>;
    for(const key of Object.keys(poison).filter(key=>!active[date.kind].includes(key))){const bad=structuredClone(wire);target(bad)[key]=poison[key];const before=JSON.stringify(bad);expect(decode(bad).status,`${path.join('.')}/${key}`).toBe('REFUSED');expect(JSON.stringify(bad)).toBe(before);checked++;}
    for(const key of required[date.kind]){const bad=structuredClone(wire);target(bad)[key]=null;expect(decode(bad).status,`${path.join('.')}/${key}`).toBe('REFUSED');}
   }
  }
 }
 expect(checked).toBeGreaterThan(100);expect([...consumers].sort()).toEqual(['changes.eventDate.date','query.date','query.period.date','query.period.from','query.period.through','uncertainties.alternatives.date','uncertainties.alternatives.period.date','uncertainties.alternatives.period.from','uncertainties.alternatives.period.through'].sort());
});
