// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {type ContextInput,ConversationInterpretationV3Schema} from '../../src/modules/conversation/context-contract/contracts';
import {keyedSmallComparisonSchema,encodeKeyedSmallComparison,decodeKeyedSmallComparison} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
import {frozenContextProposal} from './context-contract-fixtures';
import {keyedSingleNotificationCountAbsent} from '../../src/modules/intelligence/infrastructure/openrouter/context-keyed-single-notification';
const sample=()=>JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/keyed130-r04-turn1-before.json','utf8')).input as ContextInput;
function wire(input:ContextInput){const good=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R04',1)),input) as {changes:{owners:Record<string,unknown[]>}};return {...good,changes:{owners:{...good.changes.owners,occurrenceCount:[{write:[{operation:'SET',value:1}],evidence:[`U${input.currentTurn}`]}]}}};}

it('uses ONCE without a redundant finite count for a whole explicit single-notification distance instruction',()=>{
 const input=sample(),schema=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);
 expect(schema.safeParse(encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R04',1)),input)).success).toBe(true);
 expect(schema.safeParse(wire(input)).success).toBe(false);expect(decodeKeyedSmallComparison(wire(input),input).status).toBe('REFUSED');
 const proposal=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R04',1)),good=encodeKeyedSmallComparison(proposal,input) as {changes:{owners:Record<string,unknown[]>}};expect(Object.hasOwn(good.changes.owners,'occurrenceCount')).toBe(false);
 expect(decodeKeyedSmallComparison({...good,changes:{owners:{...good.changes.owners,occurrenceCount:[]}}},input).status).toBe('REFUSED');
 proposal.changes.push({field:'occurrenceCount',operation:'SET',value:1,evidence:[{kind:'USER_QUOTE',turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}]});expect(()=>encodeKeyedSmallComparison(proposal,input)).toThrow('FIXED_EMPTY_AUTHORED_ROW');
});
it.each(['Nếu nhắc một lần trước ngày thi 2 ngày.','"Nhắc một lần trước ngày thi 2 ngày."','Nhắc một lần trước ngày thi 2 ngày, và hai lần sau đó.','Nhắc 1 ngày liên tiếp trước ngày thi.'])('declines an unproved source and leaves existing count policy in control: %s',text=>{
 const input=sample();input.turns[input.currentTurn].text=text;expect(keyedSingleNotificationCountAbsent(input)).toBe(false);
});
it('does not exclude a retained finite count or cadence',()=>{
 for(const field of ['frequency','occurrenceCount'] as const){const input=sample();if(field==='frequency')input.activeRequest!.slots.frequency={state:'PROPOSED',value:'DAILY',fact:null};else input.activeRequest!.slots.occurrenceCount={state:'PROPOSED',value:2,fact:null};expect(keyedSingleNotificationCountAbsent(input)).toBe(false);}
});
