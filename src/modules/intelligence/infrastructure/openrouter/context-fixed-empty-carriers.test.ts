// @vitest-environment node
import {expect,it} from 'vitest';
import {fixedEmptyCarrierCodec} from './context-fixed-empty-carriers';

const path='changes.owners.reminderDate[].write';
const empty=()=>({type:'array',maxItems:0,items:{type:'string'}});
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const row=(code:string,write=true,padding=true)=>object({
 ...(write?{write:empty()}:{}),
 evidence:{type:'array',minItems:1,maxItems:3,items:{type:'string',enum:[code]}},
 ...(padding?{padding:empty()}:{}),
});
const schema=(write=true,padding=true)=>object({
 changes:object({owners:object({reminderDate:{type:'array',minItems:1,maxItems:1,items:{anyOf:[row('U2',write,padding),row('S2.0',write,padding)]}}})}),
 query:object({status:{type:'string',enum:['DEFAULT']},...(padding?{inactive:empty()}:{} )}),
 ...(padding?{unusedTable:empty()}:{}),
});
const value=(code='U2')=>({changes:{owners:{reminderDate:[{write:[] as unknown[],evidence:[code],padding:[]}]}},query:{status:'DEFAULT',inactive:[]},unusedTable:[]});
const wire=(code='U2',write=true)=>({changes:{owners:{reminderDate:[{...(write?{write:[]}:{}),evidence:[code]}]}},query:{status:'DEFAULT'}});

it('keeps default emitted schema and round trips byte-identical without preservation options',()=>{
 for(const options of [undefined,{}, {preserveEmptyArrays:[]}]){
  const codec=fixedEmptyCarrierCodec(schema(),options);
  expect(JSON.stringify(codec.schema)).toBe(JSON.stringify(schema(false,false)));
  for(const code of ['U2','S2.0']){
   expect(JSON.stringify(codec.encode(value(code)))).toBe(JSON.stringify(wire(code,false)));
   expect(JSON.stringify(codec.decode(wire(code,false)))).toBe(JSON.stringify({changes:{owners:{reminderDate:[{evidence:[code],write:[],padding:[]}]}},query:{status:'DEFAULT',inactive:[]},unusedTable:[]}));
  }
 }
});

it('preserves explicit required write arrays through object, array and anyOf wire paths',()=>{
 const source=schema(),before=JSON.stringify(source),paths=Object.freeze([path]);
 const codec=fixedEmptyCarrierCodec(source,{preserveEmptyArrays:paths});
 expect(JSON.stringify(codec.schema)).toBe(JSON.stringify(schema(true,false)));
 for(const code of ['U2','S2.0']){
  const original=value(code),encoded=codec.encode(original) as ReturnType<typeof wire>;
  expect(encoded).toEqual(wire(code));
  expect(encoded.changes.owners.reminderDate[0].write).not.toBe(original.changes.owners.reminderDate[0].write);
  const decoded=codec.decode(encoded) as ReturnType<typeof value>;
  expect(decoded).toEqual(original);
  expect(decoded.changes.owners.reminderDate[0].write).not.toBe(encoded.changes.owners.reminderDate[0].write);
 }
 expect(JSON.stringify(source)).toBe(before);
 expect(paths).toEqual([path]);
});

it('refuses missing write in either direction instead of reconstructing semantic emptiness',()=>{
 const codec=fixedEmptyCarrierCodec(schema(),{preserveEmptyArrays:[path]});
 const original=value();Reflect.deleteProperty(original.changes.owners.reminderDate[0],'write');
 expect(()=>codec.encode(original)).toThrow();
 expect(()=>codec.decode(wire('U2',false))).toThrow();
});

for(const invalid of [['authored'],null,{}])it('refuses a preserved write that is not an explicitly supplied empty array: '+JSON.stringify(invalid),()=>{
 const codec=fixedEmptyCarrierCodec(schema(),{preserveEmptyArrays:[path]}),original=value(),encoded=wire();
 Reflect.set(original.changes.owners.reminderDate[0],'write',invalid);
 Reflect.set(encoded.changes.owners.reminderDate[0],'write',invalid);
 expect(()=>codec.encode(original)).toThrow();
 expect(()=>codec.decode(encoded)).toThrow();
});

it('refuses a preserved fixed-empty property that is optional',()=>{
 expect(()=>fixedEmptyCarrierCodec(object({write:empty()},[]),{preserveEmptyArrays:['write']})).toThrow('FIXED_EMPTY_PRESERVED_OPTIONAL');
});

for(const unused of ['changes.owners.reminderDate.write','changes.owners.other[].write','query.status'])it('refuses an unused preservation path: '+unused,()=>{
 expect(()=>fixedEmptyCarrierCodec(schema(),{preserveEmptyArrays:[path,unused]})).toThrow('FIXED_EMPTY_PRESERVED_PATH_UNUSED');
});

it('threads an array item marker from an array root without adding a union branch index',()=>{
 const source={type:'array',minItems:1,maxItems:1,items:{anyOf:[object({write:empty(),kind:{type:'string',enum:['A']}}),object({write:empty(),kind:{type:'string',enum:['B']}})]}};
 const codec=fixedEmptyCarrierCodec(source,{preserveEmptyArrays:['[].write']});
 expect(codec.schema).toEqual(source);
 for(const kind of ['A','B'])expect(codec.decode(codec.encode([{write:[],kind}]))).toEqual([{write:[],kind}]);
});

it('validates and clones a preserved fixed-empty array item directly',()=>{
 const source={type:'array',minItems:1,maxItems:1,items:empty()},codec=fixedEmptyCarrierCodec(source,{preserveEmptyArrays:['[]']}),original=[[]];
 expect(codec.schema).toEqual(source);
 const encoded=codec.encode(original) as unknown[][],decoded=codec.decode(encoded) as unknown[][];
 expect(decoded).toEqual(original);
 expect(encoded[0]).not.toBe(original[0]);
 expect(decoded[0]).not.toBe(encoded[0]);
 expect(()=>codec.encode([['unexpected']])).toThrow();
 expect(()=>codec.decode([['unexpected']])).toThrow();
});
