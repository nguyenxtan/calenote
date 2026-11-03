// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {type ContextInput,ConversationInterpretationV3Schema} from '../../src/modules/conversation/context-contract/contracts';
import {keyedSmallComparisonSchema,encodeKeyedSmallComparison,decodeKeyedSmallComparison} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
const before=JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/keyed126-r07-turn3-before.json','utf8')).input as ContextInput;
function wire(input:ContextInput,operation:'SET'|'REPLACE'){
 const evidence=[{kind:'USER_QUOTE',turn:input.currentTurn,quote:input.turns[input.currentTurn].text.split('[CONTROL]').at(-1)!.trim(),occurrence:1}];
 return encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'CURRENT',evidence},changes:[{field:'reminderTime',operation,value:{hour:9,minute:0,qualifier:'H24'},evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null}),input);
}
function admits(input:ContextInput,operation:'SET'|'REPLACE'){try{return z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(wire(input,operation)).success;}catch{return false;}}
it.each(['Đổi sang 9h.','Có, nhưng đổi sang 9h.','Có [CONTROL], nhưng đổi sang 09:00.'])('requires REPLACE for an authored whole correction to the sole bound clock: %s',text=>{
 const input=structuredClone(before);input.turns[input.currentTurn].text=text;
 expect(admits(input,'REPLACE')).toBe(true);expect(admits(input,'SET')).toBe(false);const bad=wire(input,'REPLACE') as {changes:{owners:{reminderTime:Array<{write:Array<{operation:string}>}>}}};bad.changes.owners.reminderTime[0].write[0].operation='SET';expect(decodeKeyedSmallComparison(bad,input).status).toBe('REFUSED');
 const clear=wire(input,'REPLACE') as {changes:{owners:{reminderTime:Array<{write:unknown[]}>}}};clear.changes.owners.reminderTime[0].write=[];expect(z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(clear).success).toBe(false);
});
it.each(['9h.','Nếu đổi sang 9h.','"Đổi sang 9h."','Đổi sang 9h hoặc 10h.','Đổi sang 9h, thêm việc khác.'])('does not constrain an unproved correction: %s',text=>{
 const input=structuredClone(before);input.turns[input.currentTurn].text=text;expect(admits(input,'SET')).toBe(true);
});
it('declines a clock role competing with a pending answer or another occupied clock',()=>{
 const pending=structuredClone(before);pending.pendingQuestion={text:'Giờ sự kiện?',scope:'REMINDER',field:'eventTime',decisionKind:null,reason:'MISSING'};expect(admits(pending,'SET')).toBe(true);
 const competing=structuredClone(before);competing.activeRequest!.slots.eventTime={state:'PROPOSED',value:{hour:10,minute:0,qualifier:'H24'},fact:null};expect(admits(competing,'SET')).toBe(true);
 const unbound=structuredClone(before);unbound.facts=unbound.facts.filter(fact=>fact.field!=='reminderTime');expect(admits(unbound,'SET')).toBe(true);
});
