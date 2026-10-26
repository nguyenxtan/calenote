// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema} from '../../../conversation/context-contract/contracts';
import {CONTEXT_SMALL_PROTOCOL_V3} from '../../../conversation/context-contract/small-protocol';
import {frozenContextProposal} from '../../../../../tools/benchmark/context-contract-fixtures';
import {smallContextSchemaV3,encodeSmallContextV3,decodeSmallContextV3} from './context-provider-small-wire';
import {encodeInternalFlatV3,decodeInternalFlatV3} from './context-small-intermediate';
type Row=Record<string,unknown>;
const input=ContextInputSchema.parse(JSON.parse(readFileSync(new URL('./__fixtures__/typed105-r01-before.json',import.meta.url),'utf8')).input),base=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0)),evidence=[{kind:'USER_QUOTE' as const,turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
function proposal(code:'CREATE'|'LIST'|'CALENDAR'|'CAPABILITY'){
 return ConversationInterpretationV3Schema.parse(code==='CREATE'?{...base,intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},query:null}:{...base,intent:code==='LIST'?'LIST_REMINDERS':code==='CALENDAR'?'CALENDAR_QUERY':'CAPABILITY_QUERY',requestTarget:null,changes:[],query:code==='LIST'?{kind:'LIST',statusScope:'DEFAULT',period:null,evidence}:code==='CALENDAR'?{kind:'CALENDAR_DATE',date:null,outputCalendar:null,evidence}:{kind:'CAPABILITY',topic:null,evidence},uncertainties:[{field:code==='CAPABILITY'?'intent':'queryRange',reason:'MISSING',alternatives:[]}],conversationDirective:null,replyProposal:null});
}
const generation=()=>z.fromJSONSchema(smallContextSchemaV3(input).schema as Parameters<typeof z.fromJSONSchema>[0]);
it('producer refuses the old independent operation/query contradiction before strict decode',()=>{
 const create=encodeSmallContextV3(proposal('CREATE'),input),list=encodeSmallContextV3(proposal('LIST'),input),recordedMix={...create,q:list.q??{l:[{p:[],e:['U0']}],c:[],b:[]}},before=JSON.stringify(recordedMix);
 expect(generation().safeParse(recordedMix).success).toBe(false);
 expect(decodeSmallContextV3(recordedMix,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input).status).toBe('REFUSED');expect(JSON.stringify(recordedMix)).toBe(before);
});
it.each(['CREATE','LIST','CALENDAR','CAPABILITY'] as const)('one operation owner preserves %s and its authored absent or missing query operands',kind=>{
 const value=proposal(kind),wire=encodeSmallContextV3(value,input),operation=wire.o as Row;
 expect(wire).not.toHaveProperty('q');expect(Object.keys(operation)).toEqual(kind==='CREATE'?['c','e']:['c','e','q']);
 if(kind!=='CREATE'){expect(operation.q).toHaveLength(1);const absent=structuredClone(wire);(absent.o as Row).q=[];expect(generation().safeParse(absent).success).toBe(true);const prior=encodeInternalFlatV3(value,input);prior.query=[];expect(decodeSmallContextV3(absent,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input).status).toBe(decodeInternalFlatV3(prior,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input).status);}
 expect(generation().safeParse(wire).success).toBe(true);const decoded=decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input);expect(decoded.status).toBe('PARSED');
});

import {attachOperationQuery,expandOperationQuery} from './context-small-operation-query';
const kinds=['list','calendar','capability'] as const;
const rowFor=(kind:typeof kinds[number])=>kind==='list'?{period:[],evidence:['U0']}:kind==='calendar'?{date:[],outputCalendar:null,evidence:['U0']}:{topic:null,evidence:['U0']};
it.each(Array.from({length:12},(_,i)=>String(i)))('trusted joint owner preserves exact operation %s target/evidence and query absence',code=>{
 const query={list:[],calendar:[],capability:[]} as Record<typeof kinds[number],unknown[]>,operation={code,targetEvidence:['0','1','2','9','10','11'].includes(code)?['U0']:[]};
 const source={operation,query},before=JSON.stringify(source),wire=attachOperationQuery(source);
 expect(expandOperationQuery(wire)).toEqual(source);expect(JSON.stringify(source)).toBe(before);expect(wire.operation.targetEvidence).toEqual(operation.targetEvidence);
 const kind=code==='3'?'list':code==='4'?'calendar':code==='5'?'capability':undefined;
 if(kind){query[kind]=[rowFor(kind)];const active=attachOperationQuery(source);expect(expandOperationQuery(active)).toEqual(source);expect(active.operation.query).toEqual(query[kind]);}
 else expect(wire.operation).not.toHaveProperty('query');
});
it('trusted contradictory carriers and received branch poisons refuse without selection or mutation',()=>{
 for(const code of Array.from({length:12},(_,i)=>String(i)))for(const kind of kinds){
  if((code==='3'&&kind==='list')||(code==='4'&&kind==='calendar')||(code==='5'&&kind==='capability'))continue;
  const source={operation:{code,targetEvidence:['U0']},query:{list:[],calendar:[],capability:[],[kind]:[rowFor(kind)]}},before=JSON.stringify(source);
  expect(()=>attachOperationQuery(source)).toThrow();expect(JSON.stringify(source)).toBe(before);
 }
 const wire=encodeSmallContextV3(proposal('LIST'),input);
 for(const mutate of [(v:Row)=>{(v.o as Row).c='0';(v.o as Row).e=['U0'];},(v:Row)=>{(v.o as Row).q=null;},(v:Row)=>{delete (v.o as Row).q;},(v:Row)=>{const q=(v.o as Row).q as Row[];q.push(structuredClone(q[0]));},(v:Row)=>{Object.assign(((v.o as Row).q as Row[])[0],{date:[]});},(v:Row)=>{v.q={l:[],c:[],b:[]};}]){
  const bad=structuredClone(wire);mutate(bad);const before=JSON.stringify(bad);expect(generation().safeParse(bad).success).toBe(false);expect(decodeSmallContextV3(bad,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input).status).toBe('REFUSED');expect(JSON.stringify(bad)).toBe(before);
 }
});
it('new protocol rejects old identity and old independent alphabet unchanged',()=>{
 const wire=encodeSmallContextV3(proposal('LIST'),input),old={...CONTEXT_SMALL_PROTOCOL_V3,promptVersion:'calenote-context-small-tables-106-ordered-changes-36-date-roles-33-text-roles-34',wireVersion:'google-gemini-2.5-flash-lite-vertex-eu-context-small-tables-106-ordered-changes-36-date-roles-33-text-roles-34'};
 expect(decodeSmallContextV3(wire,old,undefined,undefined,input).status).toBe('REFUSED');
 const legacy=structuredClone(wire),operation=legacy.o as Row;legacy.q={l:operation.q,c:[],b:[]};delete operation.q;const bytes=JSON.stringify(legacy);expect(generation().safeParse(legacy).success).toBe(false);expect(decodeSmallContextV3(legacy,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input).status).toBe('REFUSED');expect(JSON.stringify(legacy)).toBe(bytes);
});
it('trusted and inverse owner retain operation-selected target evidence cardinality',()=>{
 for(const code of Array.from({length:12},(_,i)=>String(i))){const targeted=['0','1','2','9','10','11'].includes(code),query={list:[],calendar:[],capability:[]};
  for(const targetEvidence of targeted?[[],['U0','U0','U0','U0']]:[['U0']]){
   const source={operation:{code,targetEvidence},query},before=JSON.stringify(source);expect(()=>attachOperationQuery(source)).toThrow('OPERATION_QUERY_INVALID');expect(JSON.stringify(source)).toBe(before);
   const kind=code==='3'||code==='4'||code==='5',raw={operation:{code,targetEvidence,...(kind?{query:[]}:{})}};expect(()=>expandOperationQuery(raw)).toThrow('OPERATION_QUERY_INVALID');
  }
 }
});
it('producer audits all12 operation codes against every query-kind/absence and target-evidence combination',()=>{
 const baseline=encodeSmallContextV3(proposal('CREATE'),input),accept=generation(),rows=Object.fromEntries((['LIST','CALENDAR','CAPABILITY'] as const).map(k=>[k,((encodeSmallContextV3(proposal(k),input).o as Row).q as Row[])[0]]));let cases=0;
 for(const code of Array.from({length:12},(_,i)=>String(i)))for(const e of [[],['U0'],['U0','U0','U0','U0']])for(const q of ['ABSENT','EMPTY','LIST','CALENDAR','CAPABILITY'] as const){
  const kind=code==='3'?'LIST':code==='4'?'CALENDAR':code==='5'?'CAPABILITY':undefined,targeted=['0','1','2','9','10','11'].includes(code),targetAllowed=targeted?e.length>=1&&e.length<=3:e.length===0,queryAllowed=kind?q==='EMPTY'||q===kind:q==='ABSENT';
  const wire={...structuredClone(baseline),o:{c:code,e,...(q==='ABSENT'?{}:{q:q==='EMPTY'?[]:[structuredClone(rows[q])]})}};const before=JSON.stringify(wire);
  expect(accept.safeParse(wire).success,`${code}/${e.length}/${q}`).toBe(targetAllowed&&queryAllowed);if(!(targetAllowed&&queryAllowed))expect(decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input).status).toBe('REFUSED');expect(JSON.stringify(wire)).toBe(before);cases++;
 }
 expect(cases).toBe(180);
});
