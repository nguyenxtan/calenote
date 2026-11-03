import {z} from 'zod';
type Schema=Record<string,unknown>;
type Plan={schema:Schema;encode:(value:unknown)=>unknown;decode:(value:unknown)=>unknown};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const zero=(node:Schema)=>node.type==='array'&&node.maxItems===0&&(node.minItems??0)===0;
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
/** Reversible syntax only: omit object properties whose entire selected
 * language is []. No received property is discarded, even when it equals []. */
export function fixedEmptyCarrierCodec(source:unknown){
 const build=(raw:unknown):Plan=>{
  if(!record(raw)||raw.$ref||raw.$defs||raw.allOf||raw.if||raw.then||raw.else)throw Error('FIXED_EMPTY_SCHEMA_UNSUPPORTED');
  if(zero(raw))throw Error('FIXED_EMPTY_POSITION_UNSUPPORTED');
  const schema=structuredClone(raw),unionKey=Array.isArray(raw.anyOf)?'anyOf':Array.isArray(raw.oneOf)?'oneOf':null;
  if(unionKey&&(raw.properties||raw.items))throw Error('FIXED_EMPTY_MIXED_UNION');
  if(unionKey){
   const original=raw[unionKey] as Schema[];if(!original.length)throw Error('FIXED_EMPTY_EMPTY_UNION');const plans=original.map(build);schema[unionKey]=plans.map(plan=>plan.schema);
   let before:z.ZodType[]|undefined,after:z.ZodType[]|undefined;
   const map=(value:unknown,forward:boolean)=>{
    const validators=forward?(before??=original.map(node=>z.fromJSONSchema(node))):(after??=plans.map(plan=>z.fromJSONSchema(plan.schema)));
    const outputs=plans.flatMap((plan,index)=>validators[index].safeParse(value).success?[forward?plan.encode(value):plan.decode(value)]:[]);
    if(!outputs.length||unionKey==='oneOf'&&outputs.length!==1)throw Error('FIXED_EMPTY_BRANCH_INVALID');const first=JSON.stringify(stable(outputs[0]));if(outputs.some(output=>JSON.stringify(stable(output))!==first))throw Error('FIXED_EMPTY_BRANCH_AMBIGUOUS');return outputs[0];
   };
   return {schema,encode:value=>map(value,true),decode:value=>map(value,false)};
  }
  if(record(raw.properties)){
   const children=new Map<string,Plan>(),omitted:string[]=[],properties:Record<string,unknown>={};
   for(const[key,node]of Object.entries(raw.properties)){if(!record(node))throw Error('FIXED_EMPTY_SCHEMA_UNSUPPORTED');if(zero(node)){if(!Array.isArray(raw.required)||!raw.required.includes(key))throw Error('FIXED_EMPTY_OPTIONAL_POSITION');omitted.push(key);continue;}const child=build(node);children.set(key,child);properties[key]=child.schema;}
   schema.properties=properties;if(Array.isArray(raw.required))schema.required=raw.required.filter(key=>!omitted.includes(String(key)));
   const map=(value:unknown,forward:boolean)=>{
    if(!record(value))throw Error('FIXED_EMPTY_OBJECT_INVALID');const result={...value};
    for(const key of omitted){if(forward){if(!Object.hasOwn(value,key)||!Array.isArray(value[key])||value[key].length!==0)throw Error('FIXED_EMPTY_AUTHORED_ROW');delete result[key];}else{if(Object.hasOwn(value,key))throw Error('FIXED_EMPTY_EXTRA_KEY');result[key]=[];}}
    for(const[key,child]of children)if(Object.hasOwn(value,key))result[key]=forward?child.encode(value[key]):child.decode(value[key]);return result;
   };
   return {schema,encode:value=>map(value,true),decode:value=>map(value,false)};
  }
  if(raw.items!==undefined){const child=build(raw.items);schema.items=child.schema;const map=(value:unknown,forward:boolean)=>{if(!Array.isArray(value))throw Error('FIXED_EMPTY_ARRAY_INVALID');return value.map(item=>forward?child.encode(item):child.decode(item));};return {schema,encode:value=>map(value,true),decode:value=>map(value,false)};}
  return {schema,encode:value=>structuredClone(value),decode:value=>structuredClone(value)};
 };
 const plan=build(source);let validator:z.ZodType|undefined;
 const validate=(value:unknown)=>{(validator??=z.fromJSONSchema(plan.schema)).parse(value);};
 return {schema:plan.schema,encode:(value:unknown)=>{const encoded=plan.encode(value);validate(encoded);if(JSON.stringify(stable(plan.decode(encoded)))!==JSON.stringify(stable(value)))throw Error('FIXED_EMPTY_ROUNDTRIP_INVALID');return encoded;},decode:(value:unknown)=>{validate(value);return plan.decode(value);}};
}
