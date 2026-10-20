// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema} from '../../../conversation/context-contract/contracts';
import {CONTEXT_SMALL_PROTOCOL_V3} from '../../../conversation/context-contract/small-protocol';
import {encodeSmallContextV3,decodeSmallContextV3,smallContextSchemaV3} from './context-provider-small-wire';
import {frozenContextProposal} from '../../../../../tools/benchmark/context-contract-fixtures';
import {encodeGoogleLiteEuTypedContextV3,decodeGoogleLiteEuTypedContextTransportV3} from './context-provider-typed-wire';
import {CONTEXT_TYPED_PROTOCOL_V3} from '../../../conversation/context-contract/typed-protocol';
const input=ContextInputSchema.parse(JSON.parse(readFileSync(new URL('./__fixtures__/typed105-r01-before.json',import.meta.url),'utf8')).input);
const proposal=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0));
const decode=(wire:unknown)=>decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input);
it('preserves canonical interpretation through typed tables without heterogeneous unions',()=>{
 const wire=encodeSmallContextV3(proposal,input),selected=smallContextSchemaV3(input);
 expect(z.fromJSONSchema(selected.schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(wire).success).toBe(true);
 expect(JSON.stringify(selected.schema)).not.toMatch(/"(?:anyOf|oneOf|\$ref|\$defs)"/u);
 expect(JSON.stringify(selected.schema).length).toBeLessThan(8000);
 expect(decode(wire)).toEqual(decodeGoogleLiteEuTypedContextTransportV3(encodeGoogleLiteEuTypedContextV3(proposal,input),CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input));
});
it('rejects unknown, fractional, negative or unused value references without coercion',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
 const creation=ConversationInterpretationV3Schema.parse({...proposal,intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'title',operation:'SET',value:'synthetic',evidence}],query:null,uncertainties:[]});
 const original=encodeSmallContextV3(creation,input);
 expect(decode(original).status).toBe('PARSED');
 for(const value of [-1,.5,999,'0']){const wire=structuredClone(original);wire.changes[0].value=value as number;expect(decode(wire).status).toBe('REFUSED');}
 const unused=structuredClone(original);unused.texts.push('unreferenced payload');expect(decode(unused).status).toBe('REFUSED');
 const duplicate=structuredClone(original);duplicate.changes.push(structuredClone(duplicate.changes[0]));expect(decode(duplicate).status).toBe('REFUSED');
 const source=structuredClone(original);source.changes[0].evidence=['U99'];expect(decode(source).status).toBe('REFUSED');
 expect(decodeSmallContextV3(original,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input).status).toBe('REFUSED');
});

it('keeps small prompt unambiguous and publishes the complete immutable field codebook',async()=>{
 const {CONTEXT_SMALL_PROMPT}=await import('../../../conversation/context-contract/small-wire');
 const {UNCERTAINTY_FIELD_WIRE_CODE_V1}=await import('./context-provider-wire');
 expect(CONTEXT_SMALL_PROMPT).toContain(JSON.stringify(UNCERTAINTY_FIELD_WIRE_CODE_V1));
 for(const phrase of ['Core roots:','Ten singleton roots required','extras use {','entries {field,operation,value,evidence}','Absent carriers:null'])expect(CONTEXT_SMALL_PROMPT).not.toContain(phrase);
 for(const phrase of ['Multiple actions:','NEW:no old facts','Side queries/corrections KEEP','Omission=KEEP'])expect(CONTEXT_SMALL_PROMPT).toContain(phrase);
});

it('rejects malformed dates/period references and ranks but quarantines optional guidance',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const base=ConversationInterpretationV3Schema.parse({...proposal,intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'title',operation:'SET',value:'synthetic',evidence},{field:'eventDate',operation:'SET',value:{kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null},evidence}],query:null,uncertainties:[]});
 const wire=encodeSmallContextV3(base,input);expect(decode(wire).status).toBe('PARSED');
 for(const change of [
  (w:typeof wire)=>{w.dates[0].offsetDays=1;},
  (w:typeof wire)=>{w.dates[0].year=10000;},
  (w:typeof wire)=>{w.changes[1].rank=w.changes[0].rank;},
  (w:typeof wire)=>{w.changes.reverse();},
  (w:typeof wire)=>{w.changes[0].rank=13;},
  (w:typeof wire)=>{w.changes[0].evidence=[];},
  (w:typeof wire)=>{w.changes[0].operation='CLEAR';},
  (w:typeof wire)=>{w.dates=Array.from({length:129},()=>structuredClone(w.dates[0]));},
 ]){const altered=structuredClone(wire);change(altered);expect(decode(altered).status,change.toString()).toBe('REFUSED');}
 const malformedAdvice={...wire,directive:[{kind:'APPROVE'}],reply:[{text:123}]};
 const parsed=decode(malformedAdvice);expect(parsed.status).toBe('PARSED');
 const list=encodeSmallContextV3(ConversationInterpretationV3Schema.parse({...proposal,query:{kind:'LIST',statusScope:'DEFAULT',period:{kind:'DAY',date:{kind:'RELATIVE_DAY',offsetDays:0}},evidence},uncertainties:[]}),input);
 expect(decode(list).status).toBe('PARSED');
 for(const index of [-1,.5,999]){const altered=structuredClone(list);altered.periods[0].date=index;expect(decode(altered).status).toBe('REFUSED');}
 const inactive=structuredClone(list);inactive.periods[0].offset=1;expect(decode(inactive).status).toBe('REFUSED');
 const unsupported=structuredClone(list);unsupported.periods[0].kind='UNSUPPORTED_PERIOD';expect(decode(unsupported).status).toBe('PARSED');
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
 wire.query=[{period:3,date:null,outputCalendar:null,topic:null,evidence:['U0']}];
 expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,d=>diagnostics.push(d),input).status).toBe('REFUSED');
 expect(diagnostics[0]).toMatchObject({issues:[{smallTables:{reason:'TABLE_REFERENCE_INVALID',table:'periods'}}]});
 diagnostics.length=0;
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
 expect(wire.changes[0]).toMatchObject({value:null,text:'synthetic inline title'});
 expect(decode(wire).status).toBe('PARSED');
 const generation=z.fromJSONSchema(smallContextSchemaV3(input).schema as Parameters<typeof z.fromJSONSchema>[0]);
 expect(generation.safeParse({...wire,texts:['unused text']}).success).toBe(false);
 expect(decode({...wire,texts:['unused text']}).status).toBe('REFUSED');
 expect(decode({...wire,changes:[{...wire.changes[0],value:0}]}).status).toBe('REFUSED');
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
