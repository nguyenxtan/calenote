// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {type ContextInput,ConversationInterpretationV3Schema} from '../../src/modules/conversation/context-contract/contracts';
import {keyedSmallComparisonSchema,encodeKeyedSmallComparison,decodeKeyedSmallComparison} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
import {frozenContextProposal} from './context-contract-fixtures';
import {isRetainedClosedRelationFieldUncertaintyAbsent} from '../../src/modules/conversation/context-contract/field-capability';
const sample=()=>JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/small106-r03-turn1-before.json','utf8')).input as ContextInput;
const distanceSample=()=>JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/keyed129-r02-turn1-before.json','utf8')).input as ContextInput;
it('omits a fixed-empty root and refuses both authored rows and a legacy empty key',()=>{
 const input=sample(),proposal=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R03',1)),wire=encodeKeyedSmallComparison(proposal,input);
 expect(Object.hasOwn(wire,'uncertainties')).toBe(false);expect(decodeKeyedSmallComparison(wire,input).status).toBe('PARSED');expect(decodeKeyedSmallComparison({...wire,uncertainties:[]},input).status).toBe('REFUSED');
 proposal.uncertainties=[{field:'reminderTime',reason:'AMBIGUOUS',alternatives:[]}];expect(()=>encodeKeyedSmallComparison(proposal,input)).toThrow('FIXED_EMPTY_AUTHORED_ROW');
});
function admits(input:ContextInput,uncertainties:unknown[]){const wire=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R03',1)),input);return z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(uncertainties.length?{...wire,uncertainties}:wire).success;}
it.each([
 {fieldCode:13,reason:'MISSING',alternatives:[{value:'CREATE_REMINDER',evidence:['U2']}]},
 {fieldCode:14,reason:'MISSING',alternatives:[{value:{kind:'DAY',date:null},evidence:['U2']}]},
 {fieldCode:6,reason:'AMBIGUOUS',alternatives:[]},
 {fieldCode:7,reason:'AMBIGUOUS',alternatives:[{value:'GREGORIAN',evidence:['U2']}]},
])('rejects an invented issue in the fully bound closed relation-only source: %j',issue=>{
 const input=sample();expect(admits(input,[])).toBe(true);expect(admits(input,[issue])).toBe(false);
 const wire=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R03',1)),input);expect(decodeKeyedSmallComparison({...wire,uncertainties:[issue]},input).status).toBe('REFUSED');
});
it('excludes invented issues in a certified matched-count continuation with its clock still absent',()=>{
 const input=distanceSample(),wire=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R02',1)),input),schema=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);
 expect(schema.safeParse(wire).success).toBe(true);
 for(const issue of [{fieldCode:13,reason:'MISSING',alternatives:[{value:'CREATE_REMINDER',evidence:['U2']}]},{fieldCode:9,reason:'AMBIGUOUS',alternatives:[{value:2,evidence:['U2']}]}])expect(schema.safeParse({...wire,uncertainties:[issue]}).success).toBe(false);
});
it('declines a venue fact that matches its slot but not the original complete venue span',()=>{
 const input=distanceSample();input.activeRequest!.slots.location.value='Quang';input.facts.find(fact=>fact.field==='location')!.value='Quang';
 expect(isRetainedClosedRelationFieldUncertaintyAbsent(input)).toBe(false);
});
it('declines any retained ambiguity even in the matched-count source family',()=>{
 const input=distanceSample();input.ambiguities=[{field:'queryRange',reason:'MISSING',alternatives:[]}];expect(isRetainedClosedRelationFieldUncertaintyAbsent(input)).toBe(false);
});
it.each([
 (input:ContextInput)=>{input.turns[input.currentTurn].text='Nhắc trước sự kiện, lịch tôi chưa quyết định.';},
 (input:ContextInput)=>{input.turns[input.currentTurn].text='"Nhắc trước sự kiện."';},
 (input:ContextInput)=>{input.activeRequest!.slots.reminderTime.state='CONFLICT';},
 (input:ContextInput)=>{input.facts.find(fact=>fact.field==='reminderTime')!.value={hour:9,minute:0,qualifier:'H24'};},
 (input:ContextInput)=>{input.facts.find(fact=>fact.field==='reminderTime')!.sourceReferenceTime='2026-09-28T03:01:00.000Z';},
 (input:ContextInput)=>{input.activeRequest!.slots.location={state:'PROPOSED',value:'chưa quyết định',fact:null};},
 (input:ContextInput)=>{input.activeRequest!.slots.occurrenceCount.value=3;input.facts.find(fact=>fact.field==='occurrenceCount')!.value=3;},
 (input:ContextInput)=>{input.activeRequest!.slots.eventDate.value={kind:'CIVIL_DATE',calendar:'GREGORIAN',day:12,month:10,year:null,leapMonth:null};input.facts.find(fact=>fact.field==='eventDate')!.value=input.activeRequest!.slots.eventDate.value;},
])('declines the closed-source proof on mismatched or unrecognized input',mutate=>{
 const input=sample();mutate(input);expect(isRetainedClosedRelationFieldUncertaintyAbsent(input)).toBe(false);
});
