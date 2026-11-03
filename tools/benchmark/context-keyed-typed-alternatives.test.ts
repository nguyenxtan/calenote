// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ConversationInterpretationV3Schema,type ContextInput} from '../../src/modules/conversation/context-contract/contracts';
import {keyedSmallComparisonSchema,encodeKeyedSmallComparison,decodeKeyedSmallComparison} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
import {frozenContextProposal} from './context-contract-fixtures';
import {constrainComparisonDateSchema} from './context-comparison-date-schema';
import {encodeSmallContextV3,decodeSmallContextV3} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-small-wire';
import {CONTEXT_SMALL_PROTOCOL_V3} from '../../src/modules/conversation/context-contract/small-protocol';
function assertClosedObjects(value:unknown):void {
 if(Array.isArray(value)){value.forEach(assertClosedObjects);return;}if(!value||typeof value!=='object')return;
 const node=value as Record<string,unknown>;
 if(node.type==='object'&&node.properties&&typeof node.properties==='object'){expect(node.additionalProperties).toBe(false);expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties).sort());}
 Object.values(node).forEach(assertClosedObjects);
}
it('rejects the observed all-inactive end-date alternative before generation',()=>{
 const input=JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/keyed123-r02-turn1-before.json','utf8')).input as ContextInput;
 const wire=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R02',1)),input);
 const bad={...wire,uncertainties:[{fieldCode:12,reason:'UNSUPPORTED_COMBINATION',alternatives:[{value:null,text:null,date:[],period:[],clock:[],evidence:['U2']}]}]};
 const schema=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);expect(schema.safeParse(bad).success).toBe(false);expect(decodeKeyedSmallComparison(bad,input).status).toBe('REFUSED');
 expect(schema.safeParse({...wire,uncertainties:[{fieldCode:12,reason:'UNSUPPORTED_COMBINATION',alternatives:[{value:null,evidence:['U2']}]}]}).success).toBe(false);
 expect(schema.safeParse({...wire,uncertainties:[{fieldCode:12,reason:'UNSUPPORTED_COMBINATION'}]}).success).toBe(false);
});
it.each([
 ['title','cuộc hẹn'],['location','Quang Trung'],['notes','mang hồ sơ'],
 ['eventDate',{kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null}],
 ['eventTime',{hour:8,minute:0,qualifier:'H24'}],['reminderDate',{kind:'RELATIVE_DAY',offsetDays:1}],
 ['reminderTime',{hour:9,minute:0,qualifier:'H24'}],['calendar','GREGORIAN'],['frequency','DAILY'],['occurrenceCount',2],
 ['eventRelation','BEFORE_EVENT'],['leadOffsetDays',2],['endDate',{kind:'WEEKDAY',weekday:5,qualifier:'NEXT_WEEK'}],
 ['intent','CREATE_REMINDER'],['queryRange',{kind:'MONTH',offset:0}],
])('keeps a direct typed %s alternative and its evidence without padded columns', (field,value)=>{
 const initial=JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/typed105-r01-before.json','utf8')).input as ContextInput;
 const input={...initial,turns:[{role:'USER' as const,text:'Nhắc tôi chốt chi tiết cuộc hẹn, ngày và giờ đang cân nhắc.'}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[]};
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const control=field==='intent'||field==='queryRange';
 const proposal=ConversationInterpretationV3Schema.parse({schemaVersion:'calenote-context-3',intent:control?'AMBIGUOUS':'CREATE_REMINDER',requestTarget:control?null:{kind:'NEW',evidence},changes:[],query:null,uncertainties:[{field,reason:'AMBIGUOUS',alternatives:[{value,evidence}]}],conversationDirective:null,replyProposal:null});
 const wire=encodeKeyedSmallComparison(proposal,input) as {operation:{controlUncertainties?:Array<{alternatives:Array<Record<string,unknown>>}>};uncertainties:Array<{alternatives:Array<Record<string,unknown>>}>};
 expect((control?wire.operation.controlUncertainties!:wire.uncertainties)[0].alternatives[0]).toEqual({value,evidence:['U0']});
 const schema=constrainComparisonDateSchema(keyedSmallComparisonSchema(input));assertClosedObjects(schema);expect(z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(wire).success).toBe(true);
 const result=decodeKeyedSmallComparison(wire,input),expected=decodeSmallContextV3(encodeSmallContextV3(proposal,input),CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input);expect(expected.status).toBe('PARSED');expect(result).toEqual(expected);
});
it('omits and restores an alternatives property only when the selected strict carrier requires zero candidates',()=>{
 const original=JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/small106-r02-turn2-before.json','utf8')).input as ContextInput;
 const input={...original,turns:[{role:'USER' as const,text:'Ngày 11/10 đi thi ở Quang Trung, nhắc  2 ngày liên tiếp giúp tôi.'}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[]};
 const proposal=ConversationInterpretationV3Schema.parse({...frozenContextProposal(input,'R02',0) as object,uncertainties:[{field:'leadOffsetDays',reason:'AMBIGUOUS',alternatives:[]}]});
 const wire=encodeKeyedSmallComparison(proposal,input) as {uncertainties:Array<Record<string,unknown>>};expect(wire.uncertainties[0]).not.toHaveProperty('alternatives');
 const schema=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);expect(schema.safeParse(wire).success).toBe(true);expect(decodeKeyedSmallComparison(wire,input).status).toBe('PARSED');
});
