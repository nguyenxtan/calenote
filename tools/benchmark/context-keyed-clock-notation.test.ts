// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {type ContextInput,ConversationInterpretationV3Schema} from '../../src/modules/conversation/context-contract/contracts';
import {keyedSmallComparisonSchema,encodeKeyedSmallComparison,decodeKeyedSmallComparison} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
import {frozenContextProposal} from './context-contract-fixtures';
import {keyedClockNotationField} from '../../src/modules/intelligence/infrastructure/openrouter/context-keyed-clock-correction';
const sample=()=>JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/keyed133-r02-turn2-before.json','utf8')).input as ContextInput;
it('rejects the observed UNKNOWN qualifier for a whole explicit H24 answer without filling hour or minute',()=>{
 const input=sample(),wire=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R02',2)),input) as {changes:{owners:{reminderTime:Array<{write:Array<{value:{qualifier:string}}>}>}}};
 const schema=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);expect(schema.safeParse(wire).success).toBe(true);expect(decodeKeyedSmallComparison(wire,input).status).toBe('PARSED');
 wire.changes.owners.reminderTime[0].write[0].value.qualifier='UNKNOWN';expect(schema.safeParse(wire).success).toBe(false);expect(decodeKeyedSmallComparison(wire,input).status).toBe('REFUSED');
});
it.each(['8 giờ.','8h tối.','"8h."','Nếu 8h.','8h hay 20h.','8h, rồi gọi mẹ.'])('declines other clock source forms: %s',text=>{
 const input=sample();input.turns[input.currentTurn].text=text;expect(keyedClockNotationField(input)).toBeUndefined();
});
it('does not assign a clock role without its bound pending question',()=>{
 const input=sample();input.pendingQuestion=null;expect(keyedClockNotationField(input)).toBeUndefined();
});
