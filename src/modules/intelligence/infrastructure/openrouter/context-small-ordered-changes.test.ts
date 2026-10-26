// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {ContextInputSchema,ConversationInterpretationV3Schema} from '../../../conversation/context-contract/contracts';
import {CONTEXT_SMALL_PROTOCOL_V3} from '../../../conversation/context-contract/small-protocol';
import {CONTEXT_TYPED_PROTOCOL_V3} from '../../../conversation/context-contract/typed-protocol';
import {encodeSmallContextV3,decodeSmallContextV3,smallContextSchemaV3} from './context-provider-small-wire';
import {encodeGoogleLiteEuTypedContextV3,decodeGoogleLiteEuTypedContextTransportV3,encodeGoogleLiteEuTypedOrderedContextV3,decodeGoogleLiteEuTypedOrderedContextTransportV3} from './context-provider-typed-wire';
const input=ContextInputSchema.parse(JSON.parse(readFileSync(new URL('./__fixtures__/typed105-r01-before.json',import.meta.url),'utf8')).input);
const evidence=[{kind:'USER_QUOTE' as const,turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
const proposal=ConversationInterpretationV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[
 {field:'location',operation:'SET',value:'event  location',evidence},
 {field:'title',operation:'SET',value:'title receipt notes',evidence},
 {field:'eventDate',operation:'SET',value:{kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null},evidence},
],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
const decode=(wire:unknown)=>decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input);
type Owned={w:Array<{o:string;v:unknown}>;e:string[]};
type Wire={c:{v:Record<string,Owned[]>;o:string[]}}&Record<string,unknown>;
const row=(wire:Wire,index:number)=>wire.c.v[wire.c.o[index]][0];
it('public owners and explicit authored order preserve the typed ordered projection without ranks',()=>{
 const schema=smallContextSchemaV3(input).schema as unknown as {properties:{c:{type:string}}};expect(schema.properties.c.type).toBe('object');
 const wire=encodeSmallContextV3(proposal,input) as Wire;
 expect(wire.c.o).toEqual(['location','title','event']);
 expect(wire.c.o.every(field=>Object.keys(wire.c.v[field][0]).sort().join(',')==='e,w')).toBe(true);
 const baseline=decodeGoogleLiteEuTypedContextTransportV3(encodeGoogleLiteEuTypedContextV3(proposal,input),CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input);
 expect(decode(wire)).toEqual(baseline);
});
it('new typed ordered entry preserves canonical order without indexed carriers',()=>{
 const wire=encodeGoogleLiteEuTypedOrderedContextV3(proposal,input) as {changes:Array<{field:string}>};
 expect(wire.changes.map(c=>c.field)).toEqual(proposal.changes.map(c=>c.field));expect(JSON.stringify(wire)).not.toContain('"rank"');expect(wire).not.toHaveProperty('titleChange');
 expect(decodeGoogleLiteEuTypedOrderedContextTransportV3(wire,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input)).toEqual(decodeGoogleLiteEuTypedContextTransportV3(encodeGoogleLiteEuTypedContextV3(proposal,input),CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input));
 const reversed={...proposal,changes:[...proposal.changes].reverse()};const raw=encodeGoogleLiteEuTypedOrderedContextV3(reversed,input) as typeof wire;expect(raw.changes.map(c=>c.field)).toEqual(reversed.changes.map(c=>c.field));
});
it('refuses duplicate fields, competing operations, ranks and legacy dictionaries unchanged',()=>{
 const original=encodeSmallContextV3(proposal,input) as Wire;
 for(const mutate of [(w:Wire)=>{w.c.v.location.push(structuredClone(row(w,0)));},(w:Wire)=>{w.c.v.location.push({...structuredClone(row(w,0)),w:[]});},(w:Wire)=>{Object.assign(row(w,0),{r:0});},(w:Wire)=>{w.c=w.c.o.map(f=>({f,...w.c.v[f][0]})) as unknown as Wire['c'];},(w:Wire)=>{w.c.v.unknown=w.c.v.location;delete w.c.v.location;}]){const bad=structuredClone(original);mutate(bad);const before=JSON.stringify(bad);expect(decode(bad).status).toBe('REFUSED');expect(JSON.stringify(bad)).toBe(before);}
 const old={...CONTEXT_SMALL_PROTOCOL_V3,wireVersion:'google-gemini-2.5-flash-lite-vertex-eu-context-small-tables-106-single-field-values-29-date-roles-33-text-roles-34'};expect(decodeSmallContextV3(original,old,undefined,undefined,input).status).toBe('REFUSED');
});
it('keeps explicit CLEAR distinct from no row, missing write and null write',()=>{
 const clear=ConversationInterpretationV3Schema.parse({...proposal,changes:[{field:'location',operation:'CLEAR',value:null,evidence}]});
 const raw=encodeSmallContextV3(clear,input) as Wire;expect(raw.c.o).toEqual(['location']);expect(raw.c.v.location).toEqual([{w:[],e:['U0']}]);expect(decode(raw).status).toBe('PARSED');
 const absent=encodeSmallContextV3({...clear,changes:[]},input) as Wire;expect(absent.c.o).toEqual([]);expect(Object.values(absent.c.v).every(rows=>rows.length===0)).toBe(true);expect(decode(absent).status).toBe('PARSED');
 for(const write of [null,undefined,[{o:'s',v:null}],[{o:'r'}],[{o:'s',v:'a'},{o:'r',v:'b'}]]){const bad=structuredClone(raw);if(write===undefined)delete (row(bad,0) as unknown as Record<string,unknown>).w;else row(bad,0).w=write as Owned['w'];const before=JSON.stringify(bad);expect(decode(bad).status).toBe('REFUSED');expect(JSON.stringify(bad)).toBe(before);}
});
it('keeps direct field date validation and source codes strict before semantic projection',()=>{
 const original=encodeSmallContextV3(proposal,input) as Wire;
 for(const mutate of [(w:Wire)=>{(row(w,2).w[0].v as Record<string,unknown>).o=[1];},(w:Wire)=>{row(w,2).w[0].v={};},(w:Wire)=>{row(w,0).e=['U99'];},(w:Wire)=>{row(w,0).w[0].o='c';},(w:Wire)=>{row(w,0).w[0].v=['bad'];}]){const bad=structuredClone(original);mutate(bad);const before=JSON.stringify(bad);expect(decode(bad).status).toBe('REFUSED');expect(JSON.stringify(bad)).toBe(before);}
});

it('preserves ordered evidence through merge, fact allocation and later context-fact authority',async()=>{
 const {buildContextInputV2}=await import('../../../conversation/context-contract/context');
 const {validateEvidenceV3}=await import('../../../conversation/context-contract/evidence');
 const {mergePatchV3}=await import('../../../conversation/context-contract/merge');
 const {chat,message,observation}=await import('../../../conversation/context-contract/context-test-fixtures');
 const msg=message('Ngày 11/10 đi thi.'),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});if(built.status!=='READY')throw Error(built.reason);
 const evidence=[{kind:'USER_QUOTE',turn:built.input.currentTurn,quote:msg.text,occurrence:1}],date={kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null};
 const changes=[{field:'title',operation:'SET',value:'đi thi',evidence},{field:'eventDate',operation:'SET',value:date,evidence}];
 const aliases:string[]=[];
 for(const ordered of [changes,[...changes].reverse()]){
  const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:ordered,query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
  const decoded=decodeSmallContextV3(encodeSmallContextV3(canonical,built.input),CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,built.input);if(decoded.status!=='PARSED')throw Error(decoded.reason);if(!('semantic' in decoded.value))throw Error('UNEXPECTED_LIST');
  const checked=validateEvidenceV3(decoded.value.semantic,built);if(checked.status!=='VALID')throw Error(checked.reason);
  const merged=mergePatchV3(null,checked.patch);if(merged.status!=='MERGED')throw Error(merged.status);
  expect(merged.changedFields).toEqual(ordered.map(c=>c.field));expect(merged.candidate.slots.title.value).toBe('đi thi');expect(merged.candidate.slots.eventDate.value).toEqual(date);
  const titleAlias=merged.candidate.slots.title.fact!;aliases.push(titleAlias);
  const nextMsg={...message('Nhắc lúc 8h.'),id:'next',receivedAt:msg.receivedAt+60000},context={...chat,inboundRowId:3};
  const next=buildContextInputV2({message:nextMsg,context,snapshot:merged.candidate,observation:{...observation(null,nextMsg,context),observed:{presence:'PRESENT',contextId:merged.candidate.id,contextRevision:merged.candidate.contextRevision}}});if(next.status!=='READY')throw Error(next.reason);
  for(const alias of [titleAlias,merged.candidate.slots.eventDate.fact!]){
   const follow=ConversationInterpretationV3Schema.parse({...canonical,requestTarget:{kind:'CURRENT',evidence:[{kind:'USER_QUOTE',turn:next.input.currentTurn,quote:nextMsg.text,occurrence:1}]},changes:[{field:'title',operation:'SET',value:'đi thi',evidence:[{kind:'CONTEXT_FACT',ref:alias}]}]});
   const raw=encodeSmallContextV3(follow,next.input) as Wire;expect(row(raw,0).e).toEqual([`F${alias}`]);const result=decodeSmallContextV3(raw,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,next.input);if(result.status!=='PARSED')throw Error(result.reason);if(!('semantic' in result.value))throw Error('UNEXPECTED_LIST');
   expect(validateEvidenceV3(result.value.semantic,next).status).toBe(alias===titleAlias?'VALID':'REFUSED');
  }
 }
 expect(aliases[0]).not.toBe(aliases[1]);
});
it.each(['CLEAR','REPLACE'] as const)('preserves legitimate %s and current-user authority through public decode/evidence/merge',async operation=>{
 const {buildContextInputV2}=await import('../../../conversation/context-contract/context');const {validateEvidenceV3}=await import('../../../conversation/context-contract/evidence');const {mergePatchV3}=await import('../../../conversation/context-contract/merge');const {ContextSnapshotV2Schema}=await import('../../../conversation/context-contract/state');const {chat,message,observation,withNotes}=await import('../../../conversation/context-contract/context-test-fixtures');
 const previous=ContextSnapshotV2Schema.parse({...withNotes(),schemaVersion:'calenote-context-state-2',pendingSemanticCandidate:null}),text=operation==='CLEAR'?'Xóa ghi chú.':'đổi ghi chú';const msg=message(text),built=buildContextInputV2({message:msg,context:chat,snapshot:previous,observation:{...observation(null,msg),observed:{presence:'PRESENT',contextId:previous.id,contextRevision:previous.contextRevision}}});if(built.status!=='READY')throw Error(built.reason);
 const evidence=[{kind:'USER_QUOTE',turn:built.input.currentTurn,quote:text,occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'CURRENT',evidence},changes:[{field:'notes',operation,value:operation==='CLEAR'?null:'new',evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const raw=encodeSmallContextV3(canonical,built.input) as Wire;expect(row(raw,0).w).toEqual(operation==='CLEAR'?[]:[{o:'r',v:'new'}]);const decoded=decodeSmallContextV3(raw,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,built.input);if(decoded.status!=='PARSED')throw Error(decoded.reason);if(!('semantic' in decoded.value))throw Error('UNEXPECTED_LIST');const checked=validateEvidenceV3(decoded.value.semantic,built);if(checked.status!=='VALID')throw Error(checked.reason);expect(mergePatchV3(previous,checked.patch)).toMatchObject({status:'MERGED',candidate:{slots:{notes:{value:operation==='CLEAR'?null:'new'}}}});
 const old=structuredClone(raw);row(old,0).e=['U0'];const stale=decodeSmallContextV3(old,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,built.input);if(stale.status==='PARSED'&&'semantic' in stale.value)expect(validateEvidenceV3(stale.value.semantic,built).status).toBe('REFUSED');else expect(stale.status).toBe('REFUSED');
});

it('publishes one unambiguous ordered ownership contract without historical rank or dictionary instructions',async()=>{
 const {CONTEXT_SMALL_PROMPT}=await import('../../../conversation/context-contract/small-wire');
 for(const old of ['Each eligible field owns [] unchanged or [one active {rank,write,evidence} row]','Empty field carrier means unchanged','missing required field or inner write keys are invalid','c.title[0]','scope fieldMutation rows with rank'])expect(CONTEXT_SMALL_PROMPT).not.toContain(old);
 expect(CONTEXT_SMALL_PROMPT).toContain('Every valid authored permutation is permitted and preserved as canonical change order');expect(CONTEXT_SMALL_PROMPT).toContain('Empty owner means unchanged, never CLEAR');
});

it('bounds authored order to13 and refuses oversized or duplicated references unchanged',async()=>{
 const {z}=await import('zod');const schema=smallContextSchemaV3(input).schema;const wire=encodeSmallContextV3(proposal,input) as Wire;wire.c.o=Array.from({length:14},()=>wire.c.o[0]);const before=JSON.stringify(wire);
 expect(z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(wire).success).toBe(false);expect(decode(wire).status).toBe('REFUSED');expect(JSON.stringify(wire)).toBe(before);
});

it('separates initial owner authorship from forbidden post-generation order salvage',async()=>{
 const {CONTEXT_SMALL_PROMPT:prompt}=await import('../../../conversation/context-contract/small-wire');
 for(const exact of ['Every valid authored permutation is permitted and preserved as canonical change order','Duplicate/missing/unknown/extra references or unused owners refuse the whole patch before projection','never select, drop, sort, renumber, deduplicate or derive order to repair output','Missing/null owners, order, write or evidence are invalid','Empty owner means unchanged, never CLEAR','Author each WRITE or alternative value only in its declared owner'])expect(prompt).toContain(exact);
 for(const stale of ['changes is the required authored ORDERED array','Root c is the authored ordered changes ARRAY','No rank, field dictionary or independent operand pool'])expect(prompt).not.toContain(stale);
});
