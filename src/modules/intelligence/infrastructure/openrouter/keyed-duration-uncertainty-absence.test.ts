// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../../conversation/context-contract/contracts';
import {isWholeSeriesOffsetUncertaintyAbsent,isWholeSeriesLeadDurationUncertaintyAbsent,isInitialClocklessSeriesUncertaintyAbsent} from '../../../conversation/context-contract/field-capability';
import {frozenContextProposal} from '../../../../../tools/benchmark/context-contract-fixtures';
import {decodeKeyedSmallComparison,encodeKeyedSmallComparison,keyedSmallComparisonSchema} from './context-provider-keyed-small-wire';
const observed=JSON.parse(readFileSync(new URL('./__fixtures__/keyed146-r02-duration-uncertainty-before.json',import.meta.url),'utf8'));
const input=ContextInputSchema.parse(observed.input);
it('excludes invented hour/minute issues on the independently certified whole daily source without repairing its captured proposal',()=>{
 const before=JSON.stringify(observed);
 expect(isWholeSeriesOffsetUncertaintyAbsent(input)).toBe(true);
 expect(isWholeSeriesLeadDurationUncertaintyAbsent(input)).toBe(true);
 expect(isInitialClocklessSeriesUncertaintyAbsent(input)).toBe(true);
 const schema=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);
 expect(schema.safeParse(observed.providerWire).success).toBe(false);
 const expected=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R02',0));
 const authored=encodeKeyedSmallComparison(expected,input);
 expect(schema.safeParse(authored).success).toBe(true);
 expect(decodeKeyedSmallComparison(authored,input)).toMatchObject({status:'PARSED',value:{semantic:{changes:expected.changes,uncertainties:[]}}});
 expect(JSON.stringify(observed)).toBe(before);
});
it('rejects the captured empty date ambiguity even when duration issues are omitted in a diagnostic copy',()=>{
 const before=JSON.stringify(observed),diagnostic=structuredClone(observed.providerWire);
 diagnostic.uncertainties=diagnostic.uncertainties.filter((issue:{fieldCode:number})=>!durationCodes.includes(issue.fieldCode as 16|17));
 expect(diagnostic.uncertainties).toEqual([{fieldCode:3,reason:'AMBIGUOUS',alternatives:[]}]);
 expect(z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(diagnostic).success).toBe(false);
 expect(decodeKeyedSmallComparison(diagnostic,input).status).toBe('REFUSED');
 expect(JSON.stringify(observed)).toBe(before);
});
it.each(['nhắc trước 2 tiếng','nhắc 1 tiếng 30 phút trước','nhắc trước mấy tiếng','nhắc trước 0 tiếng','nhắc trước 1,5 tiếng','nhắc trước 500 phút','nếu muốn đổi giờ thì sao'])('does not certify duration absence for an unclosed or duration-bearing source: %s',tail=>{
 const source={...input,turns:[{...input.turns[0],text:`Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, ${tail}.`}]};
 expect(isWholeSeriesOffsetUncertaintyAbsent(source)).toBe(false);
 expect(isWholeSeriesLeadDurationUncertaintyAbsent(source)).toBe(false);
 expect(isInitialClocklessSeriesUncertaintyAbsent(source)).toBe(false);
});

const retained=()=>ContextInputSchema.parse(JSON.parse(readFileSync(new URL('./__fixtures__/small106-r03-turn1-before.json',import.meta.url),'utf8')).input);
const durationCodes=[16,17] as const;
function acceptsDurationIssue(source:ContextInput,fieldCode:number){
 const authored=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(source,'R03',1)),source);
 return z.fromJSONSchema(keyedSmallComparisonSchema(source) as Parameters<typeof z.fromJSONSchema>[0])
  .safeParse({...authored,uncertainties:[{fieldCode,reason:'AMBIGUOUS',alternatives:[]}]}).success;
}
it('certifies the captured retained relation-only source while excluding both duration issue channels',()=>{
 const source=retained(),before=JSON.stringify(source);
 expect(source.turns[source.currentTurn].text).toBe('Nhắc trước sự kiện.');
 expect(isWholeSeriesOffsetUncertaintyAbsent(source)).toBe(true);
 expect(isWholeSeriesLeadDurationUncertaintyAbsent(source)).toBe(true);
 for(const code of durationCodes)expect(acceptsDurationIssue(source,code),String(code)).toBe(false);
 expect(JSON.stringify(source)).toBe(before);
});

const durationFields=['leadOffsetHours','leadOffsetMinutes'] as const;
const occupiedStates=['PROPOSED','RESOLVED','CONFLICT','PROPOSED_NULL','CONFLICT_NULL','FACT_ONLY'] as const;
it.each(durationFields.flatMap(field=>occupiedStates.map(state=>({field,state}))))('retains both duration issue channels when retained $field has $state occupancy',({field,state})=>{
 const source=retained();
 if(state==='FACT_ONLY'||state==='RESOLVED')source.facts.push({alias:'f999',scope:'REMINDER',field,value:2,provenance:{kind:'EXPLICIT_USER'},sourceReferenceTime:source.facts[0].sourceReferenceTime,dependencies:[]});
 if(state!=='FACT_ONLY')source.activeRequest!.slots[field]={state:state==='PROPOSED_NULL'?'PROPOSED':state==='CONFLICT_NULL'?'CONFLICT':state,value:state.endsWith('_NULL')?null:2,fact:state==='RESOLVED'?'f999':null};
 // These states are valid contract inputs, even when their retained duration
 // cannot arise from this closed source. The negative proof must decline them.
 expect(ContextInputSchema.safeParse(source).success).toBe(true);
 expect(isWholeSeriesLeadDurationUncertaintyAbsent(source)).toBe(false);
 for(const code of durationCodes)expect(acceptsDurationIssue(source,code),String(code)).toBe(true);
});

it.each(['Hai Giờ','Nhắc Hai Phút','Một Tiếng'])('unit words in venue %s do not become independent duration evidence',venue=>{
 const source=ContextInputSchema.parse({...input,turns:[{role:'USER',text:`Ngày 11/10 đi thi ở ${venue}, nhắc 2 ngày liên tiếp giúp tôi.`}]});
 expect(isWholeSeriesOffsetUncertaintyAbsent(source)).toBe(true);
 expect(isWholeSeriesLeadDurationUncertaintyAbsent(source)).toBe(true);
});
it('declines a venue containing the before cue instead of inferring silence from a unit name',()=>{
 const source=ContextInputSchema.parse({...input,turns:[{role:'USER',text:'Ngày 11/10 đi thi ở Trước Giờ, nhắc 2 ngày liên tiếp giúp tôi.'}]});
 expect(isWholeSeriesOffsetUncertaintyAbsent(source)).toBe(false);
 expect(isWholeSeriesLeadDurationUncertaintyAbsent(source)).toBe(false);
});

it.each([
 'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.',
 'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 25h.',
 'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h, lúc 9h.',
 'Ngày 11/10 đi thi ở Quang Trung Hoặc Lê Lợi, nhắc 2 ngày liên tiếp.',
 'Ngày 11/10 đi thi ở Quang Trung Hay Lê Lợi, nhắc 2 ngày liên tiếp.',
 'Ngày 11/10 đi thi ở Quang Trung Và Lê Lợi, nhắc 2 ngày liên tiếp.',
 'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp. [CONTROL]',
 'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, ngày 12/10.',
 'Ngày 11/10 âm lịch đi thi, nhắc 2 ngày liên tiếp.',
 'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, ghi chú: mang giấy.',
 'Không đi thi ngày 11/10, nhắc 2 ngày liên tiếp.',
 'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, chưa rõ năm.',
 'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp?',
])('retains uncertainty capacity outside the complete initial clockless source: %s',text=>{
 const source=ContextInputSchema.parse({...input,turns:[{role:'USER',text}]});
 expect(isInitialClocklessSeriesUncertaintyAbsent(source)).toBe(false);
 const schema=keyedSmallComparisonSchema(source) as {properties:{uncertainties:Record<string,unknown>};$defs?:Record<string,unknown>};
 const uncertainties=z.fromJSONSchema({...schema.properties.uncertainties,...(schema.$defs?{$defs:schema.$defs}:{})} as Parameters<typeof z.fromJSONSchema>[0]);
 expect(uncertainties.safeParse([{fieldCode:3,reason:'AMBIGUOUS',alternatives:[]}]).success).toBe(true);
});
it.each(['Hayden','Vàng'])('does not mistake letters inside the venue %s for a whole uncertainty cue',venue=>{
 const source=ContextInputSchema.parse({...input,turns:[{role:'USER',text:`Ngày 11/10 đi thi ở ${venue}, nhắc 2 ngày liên tiếp.`}]});
 expect(isInitialClocklessSeriesUncertaintyAbsent(source)).toBe(true);
});
