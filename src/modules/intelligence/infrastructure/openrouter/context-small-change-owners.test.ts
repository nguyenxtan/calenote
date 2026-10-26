// @vitest-environment node
import {expect,it} from 'vitest';
import {z} from 'zod';
import {changeOwnerSchema,attachChangeOwners,expandChangeOwners} from './context-small-change-owners';
const row=(field:string,value:unknown,evidence=['U0'])=>({field,write:[{operation:'SET',value}],evidence});
const branch=(field:string,type:string)=>({type:'object',additionalProperties:false,required:['field','write','evidence'],properties:{field:{type:'string',enum:[field]},write:{type:'array',maxItems:1,items:{type:'object',additionalProperties:false,required:['operation','value'],properties:{operation:{type:'string',enum:['SET','REPLACE']},value:{type}}}},evidence:{type:'array',minItems:1,maxItems:3,items:{type:'string',enum:['U0','U1']}}}});
const source={type:'object',additionalProperties:false,required:['changes'],properties:{changes:{type:'array',maxItems:13,items:{anyOf:[branch('title','string'),branch('location','string'),branch('occurrenceCount','integer')]}}}};
const codec=()=>z.fromJSONSchema(changeOwnerSchema(source) as Parameters<typeof z.fromJSONSchema>[0]);
it('exact selected field owners and authored order preserve absence',()=>{
 const wire=attachChangeOwners({changes:[]},source);
 expect(wire.changes).toEqual({owners:{title:[],location:[],occurrenceCount:[]},order:[]});
 expect(codec().safeParse(wire).success).toBe(true);expect(expandChangeOwners(wire,source)).toEqual({changes:[]});
});
it('every valid authored permutation retains evidence and operations without rank or sorting',()=>{
 const rows=[row('title','a',['U0']),row('location','b',['U1']),row('occurrenceCount',2)];
 for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]){
  const value={changes:order.map(i=>rows[i])},before=JSON.stringify(value),wire=attachChangeOwners(value,source);
  expect(codec().safeParse(wire).success).toBe(true);expect(expandChangeOwners(wire,source)).toEqual(value);expect(JSON.stringify(value)).toBe(before);
 }
});
it('CLEAR is explicit owned empty write, unlike empty owner absence',()=>{
 const value={changes:[{field:'title',write:[],evidence:['U0']},{field:'location',write:[{operation:'REPLACE',value:'b'}],evidence:['U1']}]};
 const wire=attachChangeOwners(value,source);expect(wire.changes.owners.title).toHaveLength(1);expect(wire.changes.owners.occurrenceCount).toEqual([]);expect(expandChangeOwners(wire,source)).toEqual(value);
});
it('duplicate value owners and duplicate missing extra references refuse unchanged',()=>{
 const wire=attachChangeOwners({changes:[row('title','a')]},source);
 const bads=[{...wire,changes:{...wire.changes,order:['title','title']}},{...wire,changes:{...wire.changes,order:[]}},{...wire,changes:{...wire.changes,order:['title','location']}},{...wire,changes:{...wire.changes,order:['unknown']}},{...wire,changes:{...wire.changes,owners:{...wire.changes.owners,title:[wire.changes.owners.title[0],wire.changes.owners.title[0]]}}}];
 for(const bad of bads){const before=JSON.stringify(bad);expect(()=>expandChangeOwners(bad,source)).toThrow();expect(JSON.stringify(bad)).toBe(before);}
 expect(()=>attachChangeOwners({changes:[row('title','a'),row('title','a')]},source)).toThrow();expect(()=>attachChangeOwners({changes:[row('title','a'),row('title','different')]},source)).toThrow();
});
it('missing null unknown owner keys and old ordered syntax cannot imply CLEAR or repair',()=>{
 const wire=attachChangeOwners({changes:[row('title','a')]},source);
 for(const changes of [[],null,{owners:wire.changes.owners},{order:wire.changes.order},{...wire.changes,order:null},{...wire.changes,owners:{...wire.changes.owners,location:null}},{...wire.changes,owners:{...wire.changes.owners,other:[]}}]){
  const bad={changes},before=JSON.stringify(bad);expect(()=>expandChangeOwners(bad,source)).toThrow();expect(JSON.stringify(bad)).toBe(before);
 }
 const missing=structuredClone(wire);delete (missing.changes.owners as Record<string,unknown>).location;expect(()=>expandChangeOwners(missing,source)).toThrow();
});
it('typed value ownership and exact row keys are retained before ordered expansion',()=>{
 const wire=attachChangeOwners({changes:[row('title','a')]},source);
 for(const owner of [{write:[{operation:'SET',value:2}],evidence:['U0']},{write:[{operation:'CLEAR',value:'a'}],evidence:['U0']},{write:[{operation:'SET',value:null}],evidence:['U0']},{write:[{operation:'SET',value:'a'}],evidence:[]},{write:null,evidence:['U0']},{evidence:['U0']},{write:[],evidence:['U0'],rank:0}]){
  const bad=structuredClone(wire);bad.changes.owners.title=[owner as never];const before=JSON.stringify(bad);expect(codec().safeParse(bad).success).toBe(false);expect(()=>expandChangeOwners(bad,source)).toThrow();expect(JSON.stringify(bad)).toBe(before);
 }
});

import {readFileSync} from 'node:fs';
import {ContextInputSchema,ConversationInterpretationV3Schema} from '../../../conversation/context-contract/contracts';
import {CONTEXT_SMALL_PROTOCOL_V3} from '../../../conversation/context-contract/small-protocol';
import {frozenContextProposal} from '../../../../../tools/benchmark/context-contract-fixtures';
import {smallContextSchemaV3,encodeSmallContextV3,decodeSmallContextV3} from './context-provider-small-wire';
const input=ContextInputSchema.parse(JSON.parse(readFileSync(new URL('./__fixtures__/typed105-r01-before.json',import.meta.url),'utf8')).input);
it('public compact transport owns fields and explicit order while old array refuses',()=>{
 const value=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0)),wire=encodeSmallContextV3(value,input),c=wire.c as {v:Record<string,unknown[]>;o:string[]};
 expect(Array.isArray(c)).toBe(false);expect(Object.keys(c)).toEqual(['v','o']);expect(c.o).toEqual([]);expect(Object.values(c.v).every(rows=>rows.length===0)).toBe(true);
 const old={...wire,c:[]};expect(z.fromJSONSchema(smallContextSchemaV3(input).schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(old).success).toBe(false);expect(decodeSmallContextV3(old,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input).status).toBe('REFUSED');
});
it('public owner-order mismatch refuses unchanged and old identity cannot fallback',()=>{
 const value=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0)),wire=encodeSmallContextV3(value,input),bad=structuredClone(wire);(bad.c as {o:string[]}).o=['title'];const before=JSON.stringify(bad);
 expect(decodeSmallContextV3(bad,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input).status).toBe('REFUSED');expect(JSON.stringify(bad)).toBe(before);
 const old={...CONTEXT_SMALL_PROTOCOL_V3,promptVersion:'calenote-context-small-tables-106-ordered-changes-36-operation-query-39-date-roles-33-text-roles-34',wireVersion:'google-gemini-2.5-flash-lite-vertex-eu-context-small-tables-106-ordered-changes-36-operation-query-39-date-roles-33-text-roles-34'};
 expect(decodeSmallContextV3(wire,old,undefined,undefined,input).status).toBe('REFUSED');
});
it('all thirteen owners retain equal values with distinct evidence in reversed authored order',()=>{
 const fields=Array.from({length:13},(_,i)=>`f${i}`),schema={...source,properties:{changes:{...source.properties.changes,items:{anyOf:fields.map(f=>branch(f,'string'))}}}},value={changes:fields.toReversed().map((f,i)=>row(f,'same',[i%2?'U0':'U1']))},wire=attachChangeOwners(value,schema);
 expect(wire.changes.order).toEqual(fields.toReversed());expect(Object.keys(wire.changes.owners)).toEqual(fields);expect(expandChangeOwners(wire,schema)).toEqual(value);
});
it('selected WRITE-only and CLEAR-only owner permissions remain exact',()=>{
 const writeOnly=structuredClone(source);writeOnly.properties.changes.items.anyOf[0].properties.write={...writeOnly.properties.changes.items.anyOf[0].properties.write,minItems:1} as never;
 expect(()=>attachChangeOwners({changes:[{field:'title',write:[],evidence:['U0']}]},writeOnly)).toThrow();
 const clearOnly=structuredClone(source);clearOnly.properties.changes.items.anyOf[0].properties.write.maxItems=0;
 expect(()=>attachChangeOwners({changes:[row('title','a')]},clearOnly)).toThrow();expect(expandChangeOwners(attachChangeOwners({changes:[{field:'title',write:[],evidence:['U0']}]},clearOnly),clearOnly).changes).toEqual([{field:'title',write:[],evidence:['U0']}]);
});
