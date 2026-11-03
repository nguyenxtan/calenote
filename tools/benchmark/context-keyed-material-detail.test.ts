// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {type ContextInput,ConversationInterpretationV3Schema} from '../../src/modules/conversation/context-contract/contracts';
import {keyedSmallComparisonSchema,encodeKeyedSmallComparison,decodeKeyedSmallComparison} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
import {frozenContextProposal} from './context-contract-fixtures';
import {keyedMaterialDetailPrimary} from '../../src/modules/intelligence/infrastructure/openrouter/context-keyed-material-detail';
const sample=()=>JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/keyed137-r07-turn0-before.json','utf8')).input as ContextInput;
it('rejects the observed omitted task and invented year while keeping source-authored note content',()=>{
 const input=sample(),wire=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R07',0)),input) as {changes:{owners:Record<string,Array<{write:Array<{value:unknown}>}>>}};
 const schema=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);expect(schema.safeParse(wire).success).toBe(true);
 const noTitle=structuredClone(wire);noTitle.changes.owners.title=[];expect(schema.safeParse(noTitle).success).toBe(false);expect(decodeKeyedSmallComparison(noTitle,input).status).toBe('REFUSED');
 const wrongYear=structuredClone(wire);(wrongYear.changes.owners.eventDate[0].write[0].value as {year:number|null}).year=2026;expect(schema.safeParse(wrongYear).success).toBe(false);expect(decodeKeyedSmallComparison(wrongYear,input).status).toBe('REFUSED');
});
it('proves only complete isolated material details and keeps source data unchanged',()=>{
 let covered=0;
 for(const date of ['11/10','12/9','11/10/2027'])for(const venue of ['Quang Trung','Hà Nội'])for(const verb of ['mang','đem','chuẩn bị'])for(const material of ['giấy tờ','hộ chiếu','bút và thẻ dự thi']){
  const input=sample();input.turns[0].text=`Ngày ${date} đi thi ở ${venue}, nhớ ${verb} ${material}.`;const before=JSON.stringify(input);
  const primary=keyedMaterialDetailPrimary(input);expect(primary?.turns[0].text).toBe(`Ngày ${date} đi thi ở ${venue}`);expect(JSON.stringify(input)).toBe(before);covered++;
 }
 expect(covered).toBe(54);
});
it.each(['nhớ mang giấy tờ năm 2027.','nhớ mang giấy tờ nếu đi thi.','nhớ mang giấy tờ nhưng hủy đi thi.','nhớ mang giấy tờ rồi đổi lịch.','nhớ mang giấy tờ hay hộ chiếu.','nhớ mang giấy tờ; hủy đi thi.','nhớ mang giấy tờ giả sử có thi.','nhớ mang đồ khác.','"nhớ mang giấy tờ".'])('declines unproved detail: %s',detail=>{
 const input=sample();input.turns[0].text=`Ngày 11/10 đi thi ở Quang Trung, ${detail}`;expect(keyedMaterialDetailPrimary(input)).toBeUndefined();
});
it('preserves explicit year, notes eligibility and unchanged old strict policy',()=>{
 const input=sample();input.turns[0].text='Ngày 11/10/2027 đi thi ở Quang Trung, nhớ mang giấy tờ.';
 const proposal=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R07',0));const date=proposal.changes.find(c=>c.field==='eventDate')!;if(date.operation==='CLEAR')throw Error('date');date.value={kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:2027,leapMonth:null};
 const wire=encodeKeyedSmallComparison(proposal,input);expect(decodeKeyedSmallComparison(wire,input).status).toBe('PARSED');
 const schema=JSON.stringify(keyedSmallComparisonSchema(input));expect(schema).toContain('notes');
 const retained=sample();retained.currentTurn=1;retained.turns.push({role:'USER',text:'nhớ mang giấy tờ.'});expect(keyedMaterialDetailPrimary(retained)).toBeUndefined();
});
