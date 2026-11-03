// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ConversationInterpretationV3Schema,type ContextInput} from './contracts';
import {isWholeSeriesOffsetUncertaintyAbsent} from './field-capability';
import {keyedSmallComparisonSchema,encodeKeyedSmallComparison,decodeKeyedSmallComparison} from '../../intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
import {frozenContextProposal} from '../../../../tools/benchmark/context-contract-fixtures';
const sample=()=>JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/small106-r03-turn1-before.json','utf8')).input as ContextInput;
it('excludes invented offset uncertainty for a whole relation-only continuation of a factual finite series with its clock already known',()=>{
 const input=sample();expect(input.pendingQuestion?.field).toBe('reminderDate');expect(isWholeSeriesOffsetUncertaintyAbsent(input)).toBe(true);
 const wire=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R03',1)),input);
 const bad={...wire,uncertainties:[{fieldCode:11,reason:'AMBIGUOUS',alternatives:[]}]};
 expect(z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(bad).success).toBe(false);
 expect(decodeKeyedSmallComparison(bad,input).status).toBe('REFUSED');expect(decodeKeyedSmallComparison(wire,input).status).toBe('PARSED');
});
it.each([
 'Nhắc trước sự kiện, khoảng cách tôi sẽ quyết định sau.',
 'Nhắc trước sự kiện, chưa rõ trước bao nhiêu ngày.',
 'Nhắc bắt đầu trước sự kiện 3 ngày.',
 'Nếu nhắc trước sự kiện.',
 '"Nhắc trước sự kiện."',
 'Nhắc trước sự kiện, rồi gọi mẹ.',
])('retains offset uncertainty representation for unfamiliar or independently meaningful source: %s',text=>{
 const input=sample();input.turns[input.currentTurn].text=text;expect(isWholeSeriesOffsetUncertaintyAbsent(input)).toBe(false);
});
it('declines absent, conflicting or mismatched retained facts',()=>{
 for(const mutate of [
  (input:ContextInput)=>{input.activeRequest=null;},
  (input:ContextInput)=>{input.activeRequest!.slots.frequency.state='CONFLICT';},
  (input:ContextInput)=>{input.facts=input.facts.filter(fact=>fact.field!=='occurrenceCount');},
  (input:ContextInput)=>{input.facts.find(fact=>fact.field==='occurrenceCount')!.value=3;},
  (input:ContextInput)=>{input.turns[0].text+=' Khoảng cách tôi sẽ quyết định sau.';},
 ]){const input=sample();mutate(input);expect(isWholeSeriesOffsetUncertaintyAbsent(input)).toBe(false);}
});
