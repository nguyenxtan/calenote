// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {auditTypedNumericChoiceUnions,expandTypedSchemaReferences} from './context-typed-grammar-audit';
import {googleLiteEuTypedContextWireSchemaV3,googleLiteEuTypedContextValidationSchemaV3} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-typed-wire';
import {serializeContextRequest} from '../../src/modules/conversation/context-contract/wire';
const read=(name:string)=>JSON.parse(readFileSync(`src/modules/intelligence/infrastructure/openrouter/__fixtures__/${name}`,'utf8'));
const uncertaintyCodes=(schema:unknown)=>{
 const root=expandTypedSchemaReferences(schema) as {properties:{uncertainties:{items:{anyOf?:Array<{properties:{fieldCode:unknown}}>;properties?:{fieldCode:unknown}}}}};
 const item=root.properties.uncertainties.items;
 return z.fromJSONSchema((item.properties?.fieldCode??{anyOf:item.anyOf!.map(branch=>branch.properties.fieldCode)}) as Parameters<typeof z.fromJSONSchema>[0]);
};
it('isolates the singleton numeric disjunction from the exact failing request and admitted104 control',()=>{
 const frozen=read('typed105-c44-r01-generation.json'),input=read('typed105-r01-before.json').input;
 expect(createHash('sha256').update(JSON.stringify(frozen)).digest('hex')).toBe('8617d57ad8aa3a75b0c41be2f5efeca99c4ed72686e97b99b9a36d288f73057f');
 const before=auditTypedNumericChoiceUnions(frozen);
 expect(before).toEqual([{path:'$.uncertainties[].fieldCode',arrayAncestors:['$.uncertainties'],points:Array.from({length:16},(_,i)=>i),contiguous:true}]);
 const admitted=serializeContextRequest(input).response_format.json_schema.schema;
 expect(createHash('sha256').update(JSON.stringify(admitted)).digest('hex')).toBe('492a283db43db63cd3e05c8ec24168837085b13f2a5e0759cabf648bdd190678');
 expect(auditTypedNumericChoiceUnions(admitted)).toEqual([]);
 const after=googleLiteEuTypedContextWireSchemaV3(input).schema;
 // Correlated branches may share smaller exact code sets. The old global
 // sixteen-way discriminator is absent; prove the overall domain below.
 expect(auditTypedNumericChoiceUnions(after).every(row=>row.points.length<16)).toBe(true);
 const old=expandTypedSchemaReferences(frozen) as {properties:{uncertainties:{items:{properties:{fieldCode:unknown}}}}};
 const oldCode=z.fromJSONSchema(old.properties.uncertainties.items.properties.fieldCode as Parameters<typeof z.fromJSONSchema>[0]),newCode=uncertaintyCodes(after);
 for(const value of [-2,-1,...Array.from({length:16},(_,i)=>i),16,17,.5,'0',null])expect(newCode.safeParse(value).success).toBe(oldCode.safeParse(value).success);
 // Later correlation preservation deliberately changes other object branches;
 // the exact fieldCode domain proof above remains independent of those branches.
});
it('refuses cyclic or unbound reference audits',()=>{
 expect(()=>expandTypedSchemaReferences({type:'object',properties:{x:{$ref:'#/$defs/a'}},$defs:{a:{$ref:'#/$defs/a'}}})).toThrow();
 expect(()=>expandTypedSchemaReferences({$ref:'#/$defs/missing'})).toThrow();
});

it('preserves holes in R02 input-selected field-code domains',()=>{
 const input=read('typed105-r01-before.json').input;
 input.turns=[{role:'USER',text:'Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.'}];
 const strict=expandTypedSchemaReferences(googleLiteEuTypedContextValidationSchemaV3(input).schema) as {properties:{uncertainties:{items:Record<string,unknown>}}};
 const codes=new Set<number>();
 const collect=(value:unknown):void=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(collect);return;}const node=value as Record<string,unknown>;const properties=node.properties as Record<string,unknown>|undefined;if(properties?.fieldCode){const points=(field:unknown):void=>{const raw=field as Record<string,unknown>;if(Array.isArray(raw.anyOf))raw.anyOf.forEach(points);else if(typeof raw.minimum==='number'&&raw.minimum===raw.maximum)codes.add(raw.minimum);};points(properties.fieldCode);}Object.values(node).forEach(collect);};
 collect(strict.properties.uncertainties.items);
 expect([...codes].sort((a,b)=>a-b)).toEqual([0,1,2,3,4,5,6,7,12,13,14,15]);
 const validator=uncertaintyCodes(googleLiteEuTypedContextWireSchemaV3(input).schema);
 for(let value=-1;value<=16;value++)expect(validator.safeParse(value).success).toBe(codes.has(value));
});

it('preserves correlated QueryPeriod controls instead of admitting cross-variant combinations',()=>{
 const input=read('typed105-r01-before.json').input;
 const findPeriod=(value:unknown):unknown=>{if(!value||typeof value!=='object')return undefined;const node=value as Record<string,unknown>,properties=node.properties as Record<string,unknown>|undefined;if(properties?.period)return properties.period;if(Array.isArray(node.anyOf))for(const branch of node.anyOf){const found=findPeriod(branch);if(found)return found;}return undefined;};
 const strict=expandTypedSchemaReferences(googleLiteEuTypedContextValidationSchemaV3(input).schema) as {properties:{query:unknown}},generated=expandTypedSchemaReferences(googleLiteEuTypedContextWireSchemaV3(input).schema) as typeof strict;
 const validator=(value:unknown)=>z.fromJSONSchema(value as Parameters<typeof z.fromJSONSchema>[0]);
 const a=validator(findPeriod(strict.properties.query)),b=validator(findPeriod(generated.properties.query));
 const operand={kind:'RELATIVE_DAY',offsetDays:0};
 const mixed={kind:'DAY',date:operand,offset:1,from:operand,through:operand};
 expect(a.safeParse(mixed).success).toBe(false);expect(b.safeParse(mixed).success).toBe(false);
 for(const kind of ['DAY','WEEK','MONTH','WEEKEND','REST_OF_MONTH','NEXT_7_DAYS','UPCOMING','DATE_BOUNDS'])for(const date of [null,operand])for(const offset of [null,-1,0,1])for(const from of [null,operand])for(const through of [null,operand]){
  const value={kind,date,offset,from,through};expect(b.safeParse(value).success).toBe(a.safeParse(value).success);
 }
});
