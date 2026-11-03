// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {type ContextInput,ConversationInterpretationV3Schema} from '../../src/modules/conversation/context-contract/contracts';
import {isRetainedClosedRelationFieldUncertaintyAbsent} from '../../src/modules/conversation/context-contract/field-capability';
import {encodeKeyedSmallComparison,decodeKeyedSmallComparison} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
import {frozenContextProposal} from './context-contract-fixtures';
const sample=()=>JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/keyed136-r04-turn4-before.json','utf8')).input as ContextInput;
it('excludes invented field issues for a complete finite-count instruction bound to a factual event assertion',()=>{
 const input=sample();expect(isRetainedClosedRelationFieldUncertaintyAbsent(input)).toBe(true);const wire=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R04',4)),input);expect(Object.hasOwn(wire,'uncertainties')).toBe(false);expect(decodeKeyedSmallComparison(wire,input).status).toBe('PARSED');expect(decodeKeyedSmallComparison({...wire,uncertainties:[{fieldCode:11,reason:'AMBIGUOUS',alternatives:[]}]},input).status).toBe('REFUSED');
});
it('covers supported counts, cadence words, event references and reminder pronouns',()=>{
 let covered=0;for(const prefix of ['','trong ','suốt '])for(const count of ['1','2','30','một','hai','ba'])for(const cadence of ['liên tiếp','liên tục','liền'])for(const event of ['ngày thi','hôm thi','sự kiện','đó'])for(const pronoun of ['',' tôi',' mình',' tui']){const input=sample();input.turns[input.currentTurn].text=`Nhắc${pronoun} ${prefix}${count} ngày ${cadence} trước ${event}.`;expect(isRetainedClosedRelationFieldUncertaintyAbsent(input),input.turns[input.currentTurn].text).toBe(true);covered++;}expect(covered).toBe(864);
});
it.each(['Nhắc 2 ngày liên tiếp trước ngày thi, khoảng cách tôi quyết định sau.','Nhắc bắt đầu trước ngày thi 3 ngày và nhắc 2 ngày liên tiếp.','Nếu nhắc 2 ngày liên tiếp trước ngày thi.','"Nhắc 2 ngày liên tiếp trước ngày thi."','Nhắc 31 ngày liên tiếp trước ngày thi.'])('declines independently meaningful or unproved source: %s',text=>{const input=sample();input.turns[input.currentTurn].text=text;expect(isRetainedClosedRelationFieldUncertaintyAbsent(input)).toBe(false);});
it('retains the explicit undecided-distance issue instead of inventing a default',()=>{
 const input=sample();input.turns[input.currentTurn].text='Nhắc 2 ngày liên tiếp trước ngày thi, khoảng cách tôi quyết định sau.';const proposal=ConversationInterpretationV3Schema.parse({...frozenContextProposal(input,'R04',4) as object,uncertainties:[{field:'leadOffsetDays',reason:'AMBIGUOUS',alternatives:[]}]});expect(decodeKeyedSmallComparison(encodeKeyedSmallComparison(proposal,input),input).status).toBe('PARSED');
});
it('declines mismatched facts, prior uncertainty and additional retained details',()=>{
 for(const mutate of [(input:ContextInput)=>{input.facts.find(f=>f.field==='eventDate')!.value={kind:'CIVIL_DATE',calendar:'GREGORIAN',day:12,month:10,year:null,leapMonth:null};input.activeRequest!.slots.eventDate.value={kind:'CIVIL_DATE',calendar:'GREGORIAN',day:12,month:10,year:null,leapMonth:null};},(input:ContextInput)=>{input.facts.find(f=>f.field==='eventTime')!.value={hour:9,minute:0,qualifier:'H24'};input.activeRequest!.slots.eventTime.value={hour:9,minute:0,qualifier:'H24'};},(input:ContextInput)=>{input.ambiguities=[{field:'leadOffsetDays',reason:'AMBIGUOUS',alternatives:[]}];},(input:ContextInput)=>{input.activeRequest!.slots.notes={state:'PROPOSED',value:'chưa quyết định khoảng cách',fact:null};}]){const input=sample();mutate(input);expect(isRetainedClosedRelationFieldUncertaintyAbsent(input)).toBe(false);}
});
