// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../../conversation/context-contract/contracts';
import {frozenContextProposal} from '../../../../../tools/benchmark/context-contract-fixtures';
import {decodeKeyedSmallComparison,encodeKeyedSmallComparison,keyedSmallComparisonSchema} from './context-provider-keyed-small-wire';
const observed=JSON.parse(readFileSync(new URL('./__fixtures__/keyed141-r07-cadence-before.json',import.meta.url),'utf8'));
const input=ContextInputSchema.parse(observed.input);
type Owner={items:{properties:{write:{items:{properties:{value:unknown}}}}}};
const frequency=(source:ContextInput)=>(keyedSmallComparisonSchema(source) as {properties:{changes:{properties:{owners:{properties:{frequency?:Owner}}}}}}).properties.changes.properties.owners.properties.frequency;
const withText=(text:string)=>({...input,turns:input.turns.map((turn,index)=>index===input.currentTurn?{...turn,text}:turn)});

it('refuses the captured omission of an independently authored daily cadence without supplying a replacement',()=>{
 const before=JSON.stringify(observed);
 const schema=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);
 expect(schema.safeParse(observed.providerWire).success).toBe(false);
 expect(decodeKeyedSmallComparison(observed.providerWire,input).status).toBe('REFUSED');
 expect(JSON.stringify(observed)).toBe(before);
 const value=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R07',1));
 expect(decodeKeyedSmallComparison(encodeKeyedSmallComparison(value,input),input)).toMatchObject({status:'PARSED',value:{semantic:{changes:expect.arrayContaining([expect.objectContaining({field:'frequency',value:'DAILY'})])}}});
 const omitted={...value,changes:value.changes.filter(change=>change.field!=='frequency')};
 expect(()=>encodeKeyedSmallComparison(omitted,input)).toThrow();
});

it.each(['Nhắc hai ngày liên tiếp trước hôm thi.','Nhắc tôi ba ngày liên tục trước sự kiện.','Nhắc mình 5 ngày liền trước đó.'])('requires source-authored DAILY on the complete notification clause: %s',text=>{
 const owner=frequency(withText(text));expect(owner).toBeDefined();
 const schema=z.fromJSONSchema(owner as Parameters<typeof z.fromJSONSchema>[0]);
 expect(schema.safeParse([]).success).toBe(false);
 const row={write:[{operation:'SET',value:'DAILY'}],evidence:['U2']};
 expect(schema.safeParse([row]).success).toBe(true);
 for(const write of [[],[{operation:'SET',value:'ONCE'}],[{operation:'REPLACE',value:'DAILY'}]])expect(schema.safeParse([{...row,write}]).success).toBe(false);
});

it.each(['Nhắc trước sự kiện 2 ngày.','Không nhắc hai ngày liên tiếp trước sự kiện.','Nếu nhắc hai ngày liên tiếp trước sự kiện.','Ghi chú: nhắc hai ngày liên tiếp trước sự kiện.','Tên việc là "nhắc hai ngày liên tiếp trước sự kiện".','Nhắc một lần trước sự kiện 2 ngày.','Nhắc hai ngày liên tiếp trước sự kiện hoặc mỗi tuần.','Nhắc hai ngày liên tiếp trước sự kiện [CONTROL] không.','Nhắc 31 ngày liên tiếp trước sự kiện.'])('does not manufacture mandatory DAILY from an unproved or conflicting source: %s',text=>{
 const owner=frequency(withText(text));
 expect(owner===undefined||z.fromJSONSchema(owner as Parameters<typeof z.fromJSONSchema>[0]).safeParse([]).success).toBe(true);
});

it('does not require a repeated write when the cadence is already retained',()=>{
 const retained=structuredClone(input);retained.activeRequest!.slots.frequency={state:'RESOLVED',value:'DAILY',fact:'f99'};
 retained.facts.push({...retained.facts[0],scope:'REMINDER',alias:'f99',field:'frequency',value:'DAILY'});
 const owner=frequency(retained);expect(owner).toBeDefined();expect(z.fromJSONSchema(owner as Parameters<typeof z.fromJSONSchema>[0]).safeParse([]).success).toBe(true);
});

it('applies to a factual task without depending on an exam title',()=>{
 const generic=structuredClone(input);generic.turns[0].text='Ngày 11/10 đón khách ở Quang Trung, nhớ mang giấy tờ.';
 generic.activeRequest!.slots.title.value='đón khách';generic.facts.find(fact=>fact.field==='title')!.value='đón khách';
 const owner=frequency(ContextInputSchema.parse(generic));expect(owner).toBeDefined();expect(z.fromJSONSchema(owner as Parameters<typeof z.fromJSONSchema>[0]).safeParse([]).success).toBe(false);
});
