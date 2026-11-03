// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema} from '../../../conversation/context-contract/contracts';
import {serializeSmallContextRequest} from '../../../conversation/context-contract/small-wire';
import {frozenContextProposal} from '../../../../../tools/benchmark/context-contract-fixtures';
import {encodeSmallContextV3} from './context-provider-small-wire';

const input=ContextInputSchema.parse(JSON.parse(readFileSync(new URL('./__fixtures__/typed105-r01-before.json',import.meta.url),'utf8')).input);
const base=()=>encodeSmallContextV3(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0)),input);
const schema=()=>z.fromJSONSchema(serializeSmallContextRequest(input).response_format.json_schema.schema as Parameters<typeof z.fromJSONSchema>[0]);
it('rejects the observed owner alias and uncertainty alias in directive advice',()=>{
 const raw={...base(),g:[{k:'ASK_FOR_FIELD',f:['g'],r:['m'],i:[],t:[]}]};
 expect(schema().safeParse(raw).success).toBe(false);
});
it.each([
 {k:'ASK_FOR_FIELD',f:['reminderTime'],r:[],i:[],t:[]},
 {k:'ASK_FOR_DISAMBIGUATION',f:['eventDate'],r:['AMBIGUOUS'],i:[],t:[]},
 {k:'EXPLAIN_UNSUPPORTED',f:[],r:[],i:['DOMAIN_LIMIT'],t:[]},
 {k:'HELP',f:[],r:[],i:[],t:['GENERAL']},
])('admits the exact active operands of $k',advice=>{
 expect(schema().safeParse({...base(),g:[advice]}).success).toBe(true);
});
it.each([
 {k:'ASK_FOR_FIELD',f:['reminderTime'],r:['AMBIGUOUS'],i:[],t:[]},
 {k:'ASK_FOR_FIELD',f:[],r:[],i:[],t:[]},
 {k:'HELP',f:['reminderTime'],r:[],i:[],t:['GENERAL']},
 {k:'ASK_FOR_DISAMBIGUATION',f:['eventDate'],r:['MISSING'],i:[],t:[]},
 {k:'PRESENT_PREVIEW',f:[],r:[],i:[],t:[]},
])('rejects inactive, missing or unsupported operands: %j',advice=>{
 expect(schema().safeParse({...base(),g:[advice]}).success).toBe(false);
});
