// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {type ContextInput,ConversationInterpretationV3Schema} from '../../src/modules/conversation/context-contract/contracts';
import {keyedSmallComparisonSchema,encodeKeyedSmallComparison,decodeKeyedSmallComparison} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
import {frozenContextProposal} from './context-contract-fixtures';
const sample=()=>JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/keyed132-r06-turn1-before.json','utf8')).input as ContextInput;
it('excludes the observed intent-MISSING control from a concrete reminder while preserving genuine reminder issues',()=>{
 const input=sample(),wire=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R06',1)),input),schema=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);
 const bad={...wire,uncertainties:[{fieldCode:13,reason:'MISSING',alternatives:[{value:'CREATE_REMINDER',evidence:['U2']}]}]};
 expect(schema.safeParse(bad).success).toBe(false);expect(decodeKeyedSmallComparison(bad,input).status).toBe('REFUSED');
 expect(schema.safeParse({...wire,uncertainties:[{fieldCode:6,reason:'AMBIGUOUS',alternatives:[]}]}).success).toBe(true);
});
it('places missing query controls under their owning query operation and refuses reminder ownership',()=>{
 const original=JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/typed105-r01-before.json','utf8')).input as ContextInput;
 const wire=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(original,'R01',0)),original) as {operation:{code:string;controlUncertainties:unknown[]};uncertainties:unknown[]};
 expect(wire.uncertainties).toEqual([]);expect(wire.operation.controlUncertainties).toEqual([{fieldCode:14,reason:'MISSING',alternatives:[]}]);
 expect(decodeKeyedSmallComparison(wire,original).status).toBe('PARSED');
 const input=sample(),reminder=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R06',1)),input);
 expect(decodeKeyedSmallComparison({...reminder,operation:{...reminder.operation as Record<string,unknown>,controlUncertainties:wire.operation.controlUncertainties}},input).status).toBe('REFUSED');
});
it('preserves all three issue carriers in declared order and enforces their shared four-issue bound',()=>{
 const old=sample(),input={...old,turns:[{role:'USER' as const,text:'Tôi chưa rõ muốn thao tác nào với cuộc hẹn.'}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[]};
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const proposal=ConversationInterpretationV3Schema.parse({schemaVersion:'calenote-context-3',intent:'AMBIGUOUS',requestTarget:null,changes:[],query:null,uncertainties:[{field:'operation',reason:'AMBIGUOUS',alternatives:[{value:'CURRENT',evidence}]},{field:'intent',reason:'AMBIGUOUS',alternatives:[{value:'CREATE_REMINDER',evidence}]},{field:'location',reason:'AMBIGUOUS',alternatives:[]},{field:'notes',reason:'AMBIGUOUS',alternatives:[]}],conversationDirective:null,replyProposal:null});
 const wire=encodeKeyedSmallComparison(proposal,input) as {uncertainties:unknown[]};
 const schema=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);expect(schema.safeParse(wire).success).toBe(true);
 const result=decodeKeyedSmallComparison(wire,input);expect(result.status).toBe('PARSED');if(result.status==='PARSED'){expect('semantic' in result.value).toBe(true);if('semantic' in result.value)expect(result.value.semantic.uncertainties.map(issue=>issue.field)).toEqual(['operation','intent','location','notes']);}
 const bad={...wire,uncertainties:[...wire.uncertainties,{fieldCode:0,reason:'AMBIGUOUS',alternatives:[]}]};expect(schema.safeParse(bad).success).toBe(true);expect(decodeKeyedSmallComparison(bad,input).status).toBe('REFUSED');
});
