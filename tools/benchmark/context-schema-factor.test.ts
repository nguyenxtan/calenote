// @vitest-environment node
import {expect,it} from 'vitest';
import {z} from 'zod';
import {factorContextSchema} from './context-schema-factor';
const cell={type:'array',minItems:1,maxItems:3,items:{type:'string',enum:['reminderTime','eventRelation','occurrenceCount']}};
const original={type:'object',additionalProperties:false,required:['one','two','three'],description:'Annotation only',properties:{one:cell,two:cell,three:cell}};
it('factors repeated validation schemas, preserves accepted and refused values, and leaves input untouched',()=>{
 const before=JSON.stringify(original),result=factorContextSchema(original);
 expect(JSON.stringify(result.schema).length).toBeLessThan(before.length);
 expect(result.definitions).toBeGreaterThan(0);
 const a=z.fromJSONSchema(original as Parameters<typeof z.fromJSONSchema>[0]),b=z.fromJSONSchema(result.schema as Parameters<typeof z.fromJSONSchema>[0]);
 for(const value of [{one:['reminderTime'],two:['eventRelation'],three:['occurrenceCount']},{one:[],two:[],three:[]},{one:['wrong'],two:['eventRelation'],three:['reminderTime']},{one:['reminderTime'],two:['eventRelation']},{one:['reminderTime'],two:['eventRelation'],three:['reminderTime'],extra:1}])expect(b.safeParse(value).success).toBe(a.safeParse(value).success);
 expect(JSON.stringify(original)).toBe(before);
});
it('keeps a property named description while removing schema annotations',()=>{
 const result=factorContextSchema({type:'object',additionalProperties:false,required:['description'],properties:{description:{type:'string',enum:['keep-me'],description:'annotation'}}});
 expect(result.schema).toEqual({type:'object',additionalProperties:false,required:['description'],properties:{description:{type:'string',enum:['keep-me']}}});
});
it('refuses preexisting references rather than rebasing them into a new namespace',()=>{
 expect(()=>factorContextSchema({type:'object',properties:{x:{$ref:'#/$defs/existing'}}})).toThrow();
});
it('inlines single-use nested definitions after repeated parent schemas are shared',()=>{
 const parent={type:'object',additionalProperties:false,required:['cell'],properties:{cell}};
 const factored=factorContextSchema({type:'object',additionalProperties:false,required:['one','two','three'],properties:{one:parent,two:parent,three:parent}}).schema;
 const counts=new Map<string,number>();
 const visit=(v:unknown)=>{if(v&&typeof v==='object'){const n=v as Record<string,unknown>;if(typeof n.$ref==='string')counts.set(n.$ref,(counts.get(n.$ref)??0)+1);for(const value of Object.values(n))if(Array.isArray(value))value.forEach(visit);else visit(value);}};
 visit(factored);
 for(const name of Object.keys(factored.$defs as Record<string,unknown>))expect(counts.get(`#/$defs/${name}`)).toBeGreaterThan(1);
});
it('keeps zero-length arrays inline for provider grammar compatibility',()=>{
 const empty={type:'array',maxItems:0,items:{type:'string'}},properties={a:empty,b:empty,c:empty,d:empty,e:empty,f:empty,g:empty,h:empty};
 const source={type:'object',additionalProperties:false,required:Object.keys(properties),properties},result=factorContextSchema(source);
 expect(result.schema).toEqual(source);
 expect(z.fromJSONSchema(result.schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse({a:[],b:[],c:[],d:[],e:[],f:[],g:[],h:[]}).success).toBe(true);
});
