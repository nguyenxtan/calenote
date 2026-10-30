import {UNCERTAINTY_FIELD_WIRE_CODE_V1 as codes} from './context-provider-wire';
const fields=Object.keys(codes) as Array<keyof typeof codes>;
const schemaKeys=new Set(['type','minimum','maximum','anyOf','enum','description','$ref']);
function topology():never{throw Error('UNCERTAINTY_CODE_SCHEMA_TOPOLOGY')}
/** Exhaust the fixed control universe, intersecting siblings and anyOf. This
 * visits schema controls only, never sources or inner alternative values. */
export function uncertaintyIntegerDomain(node:unknown,root:unknown,depth=0):number[]{
 if(depth>=32||!node||typeof node!=='object'||Array.isArray(node))return topology();
 const n=node as Record<string,unknown>;if(Object.keys(n).some(key=>!schemaKeys.has(key)))return topology();
 if(n.$ref!==undefined){if(Object.keys(n).length!==1||typeof n.$ref!=='string'||!n.$ref.startsWith('#/'))return topology();let target=root;for(const part of n.$ref.slice(2).split('/')){if(!target||typeof target!=='object')return topology();target=(target as Record<string,unknown>)[part.replaceAll('~1','/').replaceAll('~0','~')]}return uncertaintyIntegerDomain(target,root,depth+1)}
 if(n.type!=='integer'&&!(n.type===undefined&&Array.isArray(n.anyOf)))return topology();
 for(const key of ['minimum','maximum'])if(n[key]!==undefined&&!Number.isSafeInteger(n[key]))return topology();
 if(n.enum!==undefined&&(!Array.isArray(n.enum)||!n.enum.length||n.enum.some(value=>typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>15)))return topology();
 if(n.anyOf!==undefined&&(!Array.isArray(n.anyOf)||!n.anyOf.length))return topology();
 const children=Array.isArray(n.anyOf)?n.anyOf.map(child=>uncertaintyIntegerDomain(child,root,depth+1)):undefined;
 return Object.values(codes).filter(code=>(n.minimum===undefined||code>=(n.minimum as number))&&(n.maximum===undefined||code<=(n.maximum as number))&&(!Array.isArray(n.enum)||n.enum.includes(code))&&(!children||children.some(domain=>domain.includes(code))));
}
export function projectUncertaintyFieldNameSchema<T>(original:T):T{
 const schema=structuredClone(original);let count=0;
 function visit(value:unknown){if(Array.isArray(value)){value.forEach(visit);return}if(!value||typeof value!=='object')return;const node=value as Record<string,unknown>,properties=node.properties as Record<string,unknown>|undefined;
  if(properties&&Object.hasOwn(properties,'fieldCode')){const domain=uncertaintyIntegerDomain(properties.fieldCode,original);if(!domain.length)return topology();properties.fieldCode={type:'string',enum:domain.map(code=>fields.find(field=>codes[field]===code)!)};count++}
  for(const[key,child]of Object.entries(node))if(key!=='fieldCode')visit(child);
 }
 visit(schema);if(!count)return topology();return schema;
}
export class UncertaintyFieldNameFailure extends Error{constructor(readonly path:PropertyKey[],readonly expected='UNCERTAINTY_FIELD_CODE_LITERAL'){super('UNCERTAINTY_FIELD_NAME_INVALID')}}
function refuse(path:PropertyKey[],expected?:string):never{throw new UncertaintyFieldNameFailure(path,expected)}
function own(value:object,key:PropertyKey,path:PropertyKey[]):unknown{const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))return refuse(path,'OWN_DATA');return d.value}
function data(value:unknown,path:PropertyKey[],depth=0,state={nodes:0}):void{
 if(depth>8||++state.nodes>256)return refuse(path,'UNCERTAINTY_FIELD_CODE_JSON');
 if(value===null||['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value))return;
 if(!value||typeof value!=='object')return refuse(path,'OWN_DATA');const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);if(prototype!==(array?Array.prototype:Object.prototype)&&prototype!==null)return refuse(path,'OWN_DATA');
 const keys=Reflect.ownKeys(value);
 if(array){const length=own(value,'length',path);if(typeof length!=='number'||!Number.isSafeInteger(length)||length<0||length>256||keys.length!==length+1||keys.some(key=>key!=='length'&&(typeof key!=='string'||!Number.isSafeInteger(Number(key))||Number(key)<0||Number(key)>=length||String(Number(key))!==key)))return refuse(path,'OWN_DATA')}
 for(const key of keys){if(array&&key==='length')continue;if(typeof key!=='string')return refuse(path,'OWN_DATA');data(own(value,key,[...path,key]),[...path,key],depth+1,state)}
 if(array)for(let i=0;i<value.length;i++)own(value,String(i),[...path,i]);
}
/** Exact closed literals only. No numeric/alias/whitespace fallback. */
export function decodeUncertaintyFieldNames(raw:unknown):Record<string,unknown>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))return refuse([],'object');const result:Record<string,unknown>={};for(const key of Reflect.ownKeys(raw)){if(typeof key!=='string'||key==='__proto__')return refuse([],'object');result[key]=own(raw,key,[key])}
 const entries=own(raw,'uncertainties',['uncertainties']);if(!Array.isArray(entries)||entries.length>4)return refuse(['uncertainties'],'array');data(entries,['uncertainties']);
 result.uncertainties=entries.map((item,index)=>{const path:PropertyKey[]=['uncertainties',index];if(!item||typeof item!=='object'||Array.isArray(item))return refuse(path,'object');const keys=Reflect.ownKeys(item);if(keys.length!==3||keys.some(key=>typeof key!=='string'||!['fieldCode','reason','alternatives'].includes(key)))return refuse(path,'UNCERTAINTY_FIELD_CODE_LITERAL');const label=own(item,'fieldCode',[...path,'fieldCode']);if(typeof label!=='string'||!fields.includes(label as typeof fields[number]))return refuse([...path,'fieldCode']);return {fieldCode:codes[label as typeof fields[number]],reason:own(item,'reason',[...path,'reason']),alternatives:own(item,'alternatives',[...path,'alternatives'])}});return result;
}
/** Trusted canonical encoder inverse; inner JSON alternatives remain byte-exact. */
export function encodeUncertaintyFieldNames(raw:Record<string,unknown>):Record<string,unknown>{return {...raw,uncertainties:(raw.uncertainties as Array<{fieldCode:number}>).map(item=>{const field=fields.find(field=>codes[field]===item.fieldCode);if(!field)return topology();return {...item,fieldCode:field}})}}
export function fieldNameWirePrompt(original:string):string{
 const clause='Wire fieldCode is schema numeric, never canonical field string; alternatives are schema-defined JSON strings.';
 if(original.split(clause).length!==2)return topology();let examples=0;
 const prompt=original.replace(clause,'Wire fieldCode is the exact schema STRING field name, never numeric; alternatives stay schema-defined JSON strings.').split('\n').map(line=>{const prefix='Alternative example (syntax only): ';if(line.startsWith(prefix)){examples++;return prefix+JSON.stringify(encodeUncertaintyFieldNames(JSON.parse(line.slice(prefix.length))))}return line.replace(/fieldCode(?:=)?(\d+)(?:\([^)]*\))?/gu,(_match,n)=>{const field=fields.find(field=>codes[field]===Number(n));if(!field)return topology();return 'fieldCode='+JSON.stringify(field)}).replace('/11 leadOffsetDays','/fieldCode="leadOffsetDays"')}).join('\n');if(examples!==1||/fieldCode(?:=)?\d/u.test(prompt))return topology();return prompt;
}
