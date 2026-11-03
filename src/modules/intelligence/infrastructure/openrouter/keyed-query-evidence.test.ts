// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../../conversation/context-contract/contracts';
import {frozenContextProposal} from '../../../../../tools/benchmark/context-contract-fixtures';
import {decodeKeyedSmallComparison,encodeKeyedSmallComparison,keyedSmallComparisonSchema} from './context-provider-keyed-small-wire';
const observed=JSON.parse(readFileSync(new URL('./__fixtures__/keyed142-r01-query-evidence-before.json',import.meta.url),'utf8'));
const input=ContextInputSchema.parse(observed.input);
type Node={properties:Record<string,Node>;anyOf:Node[];items:Node;enum:string[]};
function evidence(source:ContextInput,code='LIST_REMINDERS'){
 const schema=keyedSmallComparisonSchema(source) as unknown as Node;
 const branch=schema.properties.operation.anyOf.find(branch=>branch.properties.code.enum.includes(code));
 if(!branch)throw Error('QUERY_BRANCH');
 return z.fromJSONSchema(branch.properties.query.items.properties.evidence as Parameters<typeof z.fromJSONSchema>[0]);
}
it('refuses the captured absent-query fact without changing it or substituting USER evidence',()=>{
 const before=JSON.stringify(observed);
 expect(z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(observed.providerWire).success).toBe(false);
 expect(decodeKeyedSmallComparison(observed.providerWire,input).status).toBe('REFUSED');
 expect(JSON.stringify(observed)).toBe(before);
 const value=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',1));
 expect(decodeKeyedSmallComparison(encodeKeyedSmallComparison(value,input),input).status).toBe('PARSED');
 const bad={...value,query:{...value.query!,evidence:[{kind:'CONTEXT_FACT' as const,ref:'f1'}]}};
 expect(()=>encodeKeyedSmallComparison(bad,input)).toThrow();
});
it('keeps current USER evidence and excludes past USER and unbound fact evidence',()=>{
 for(const code of ['LIST_REMINDERS','CALENDAR_QUERY','CAPABILITY_QUERY']){
  const schema=evidence(input,code);expect(schema.safeParse(['U2']).success).toBe(true);
  for(const refs of [['U0'],['Ff1'],['U2','Ff1']])expect(schema.safeParse(refs).success).toBe(false);
 }
});
it('keeps same-kind complete query facts available for exact reuse',()=>{
 const complete=structuredClone(input);const fact=complete.facts.find(fact=>fact.scope==='QUERY')!;
 if(fact.scope!=='QUERY'||fact.value.kind!=='LIST')throw Error('LIST_FACT');
 fact.value.period={kind:'MONTH',offset:0};
 expect(evidence(ContextInputSchema.parse(complete)).safeParse(['Ff1']).success).toBe(true);
 expect(evidence(complete,'CALENDAR_QUERY').safeParse(['Ff1']).success).toBe(false);
 expect(evidence(complete,'CAPABILITY_QUERY').safeParse(['Ff1']).success).toBe(false);
});
it.each([
 {kind:'LIST',period:{kind:'DAY',date:null},statusScope:'DEFAULT'},
 {kind:'LIST',period:{kind:'DATE_BOUNDS',from:null,through:null},statusScope:'DEFAULT'},
 {kind:'LIST',period:{kind:'DATE_BOUNDS',from:null,through:{kind:'RELATIVE_DAY',offsetDays:1}},statusScope:'DEFAULT'},
 {kind:'LIST',period:{kind:'DATE_BOUNDS',from:{kind:'RELATIVE_DAY',offsetDays:0},through:null},statusScope:'DEFAULT'},
 {kind:'CALENDAR_DATE',date:null,outputCalendar:'GREGORIAN'},
 {kind:'CALENDAR_DATE',date:{kind:'RELATIVE_DAY',offsetDays:0},outputCalendar:null},
 {kind:'CAPABILITY',topic:null},
])('excludes an incomplete $kind query fact from operand evidence',query=>{
 const raw=structuredClone(observed.input);raw.facts[0].value={...query,evidence:raw.facts[0].value.evidence};
 const source=ContextInputSchema.parse(raw);
 for(const code of ['LIST_REMINDERS','CALENDAR_QUERY','CAPABILITY_QUERY'])expect(evidence(source,code).safeParse(['Ff1']).success).toBe(false);
});

it('keeps an authored calendar date with an unstated year as a real query operand',()=>{
 const raw=structuredClone(observed.input);raw.facts[0].value={kind:'CALENDAR_DATE',date:{kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null},outputCalendar:'GREGORIAN',evidence:raw.facts[0].value.evidence};
 const source=ContextInputSchema.parse(raw);expect(evidence(source,'CALENDAR_QUERY').safeParse(['Ff1']).success).toBe(true);
});
