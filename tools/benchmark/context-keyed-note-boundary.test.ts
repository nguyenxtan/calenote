// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {type ContextInput,ConversationInterpretationV3Schema} from '../../src/modules/conversation/context-contract/contracts';
import {keyedSmallComparisonSchema,encodeKeyedSmallComparison,decodeKeyedSmallComparison} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
const before=JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/keyed125-r06-turn2-before.json','utf8')).input as ContextInput;
function wire(input:ContextInput,value:string){
 const evidence=[{kind:'USER_QUOTE',turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
 return encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:input.activeRequest?'CURRENT':'NEW',evidence},changes:[{field:'notes',operation:'SET',value,evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null}),input);
}
function admits(input:ContextInput,value:string){try{return z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(wire(input,value)).success;}catch{return false;}}
function source(text:string,initial=false):ContextInput{return {...before,turns:[{role:'USER',text}],currentTurn:0,...initial?{activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[]}:{} };}
it('excludes the observed terminal chat full stop before generation and at decoding',()=>{
 expect(admits(before,'đừng bỏ quên giấy tờ')).toBe(true);
 const bad=wire(before,'đừng bỏ quên giấy tờ') as {changes:{owners:{notes:Array<{write:Array<{value:string}>}>}}};bad.changes.owners.notes[0].write[0].value+='.';expect(admits(before,'đừng bỏ quên giấy tờ.')).toBe(false);expect(decodeKeyedSmallComparison(bad,before).status).toBe('REFUSED');
});
it.each(['Ngày mai đi họp, nhớ mang hồ sơ.','Ngày mai gọi mẹ, ghi chú hỏi thăm sức khỏe.'])('constrains a positively bounded trailing note clause: %s',text=>{
 const input=source(text,true);expect(admits(input,'mang hồ sơ.')).toBe(false);expect(admits(input,'mang hồ sơ')).toBe(true);
});
it.each(['Ghi chú là: "đừng bỏ quên giấy tờ."','Ghi chú là: hỏi Dr.','Ghi chú là: kiểm tra v.v.','Ghi chú là: gọi lại. Mang giấy tờ.','Ghi chú là: mang giấy tờ!','Ghi chú nguyên văn: mang giấy tờ.','Ghi chú giữ nguyên dấu chấm: mang giấy tờ.','Ghi chú là: mang PDF.','Ghi chú là: mang giấy tờ.\nĐúng vậy.'])('leaves unproved punctuation untouched: %s',text=>{
 const input=source(text);expect(admits(input,'giấy tờ.')).toBe(true);
});
it('preserves the unrestricted language when an addition can retain old punctuation',()=>{
 const input=structuredClone(before);input.activeRequest!.slots.notes={state:'PROPOSED',value:'Gọi bác sĩ.',fact:null};expect(admits(input,'Gọi bác sĩ. đừng bỏ quên giấy tờ')).toBe(true);
});
