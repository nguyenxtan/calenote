// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema} from '../../../conversation/context-contract/contracts';
import {frozenContextProposal} from '../../../../../tools/benchmark/context-contract-fixtures';
import {decodeKeyedSmallComparison,encodeKeyedSmallComparison,keyedSmallComparisonSchema} from './context-provider-keyed-small-wire';

const observed=JSON.parse(readFileSync(new URL('./__fixtures__/keyed140-r03-operation-uncertainty-before.json',import.meta.url),'utf8'));
const current=ContextInputSchema.parse(observed.input);
const initial=ContextInputSchema.parse(JSON.parse(readFileSync(new URL('./__fixtures__/keyed140-request-hashes.json',import.meta.url),'utf8')).find((row:{fixture:string})=>row.fixture==='R07').input);

it('refuses the observed resolved-current plus unresolved-operation contradiction without modifying the received payload',()=>{
 const before=JSON.stringify(observed);
 const producer=z.fromJSONSchema(keyedSmallComparisonSchema(current) as Parameters<typeof z.fromJSONSchema>[0]);
 expect(producer.safeParse(observed.providerWire).success).toBe(false);
 expect(decodeKeyedSmallComparison(observed.providerWire,current).status).toBe('REFUSED');
 expect(JSON.stringify(observed)).toBe(before);
});

it.each([
 {kind:'CURRENT',input:current,fixture:'R03',turn:1},
 {kind:'NEW',input:initial,fixture:'R07',turn:0},
])('keeps $kind reminder changes while refusing every received operation-uncertainty carrier',row=>{
 const value=ConversationInterpretationV3Schema.parse(frozenContextProposal(row.input,row.fixture,row.turn));
 const wire=encodeKeyedSmallComparison(value,row.input) as {operation:Record<string,unknown>};
 expect(wire.operation).not.toHaveProperty('operationUncertainties');
 expect(decodeKeyedSmallComparison(wire,row.input)).toMatchObject({status:'PARSED',value:{semantic:{intent:'CREATE_REMINDER',requestTarget:{kind:row.kind},uncertainties:[],changes:expect.arrayContaining([expect.objectContaining({operation:'SET'})])}}});
 for(const carrier of [[],[{reason:'AMBIGUOUS',alternatives:[]}]]){
  const received={...wire,operation:{...wire.operation,operationUncertainties:carrier}};
  expect(decodeKeyedSmallComparison(received,row.input).status).toBe('REFUSED');
 }
});

it('refuses to encode a contradictory canonical proposal instead of deleting its authored uncertainty',()=>{
 const value=ConversationInterpretationV3Schema.parse({...frozenContextProposal(current,'R03',1) as object,uncertainties:[{field:'operation',reason:'AMBIGUOUS',alternatives:[]}]});
 const before=JSON.stringify(value);
 expect(()=>encodeKeyedSmallComparison(value,current)).toThrow();
 expect(JSON.stringify(value)).toBe(before);
});
