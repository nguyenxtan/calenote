import {constrainInitialDateClockUncertainties} from './initial-date-clock-uncertainty';
import {projectUncertaintyFieldNameSchema,encodeUncertaintyFieldNames,decodeUncertaintyFieldNames,fieldNameWirePrompt,UncertaintyFieldNameFailure} from './uncertainty-field-name-wire';
import {compactLiteralInsertionPrompt} from './context-literal-insertion-prompt';
import type {ContextInput,ConversationInterpretationV3} from '../../../conversation/context-contract/contracts';
import {CONTEXT_PROTOCOL_V3,isContextProtocolV3,type ContextProtocolV3} from '../../../conversation/context-contract/protocol';
import {projectWireValidation} from '../../../conversation/context-contract/validation-diagnostics';
import {isInitialExplicitReminderIntentKnown,type GenerationFieldCapability} from '../../../conversation/context-contract/field-capability';
import type {ProviderWireSchemaV3} from './provider-wire-schema';
import * as reference108 from './context-order-reference-wire';
import {validateUncertaintyFieldNameRootJsonWire111,validateLiteralInsertionRootJsonWire109,validateTypedSingletonCarrierJsonV3 as kernelRaw} from './context-provider-wire';
export const LITERAL_INSERTION_OWNERS=Object.freeze([...reference108.ORDER_REFERENCE_ROOTS_V1.map(root=>root.slice(0,-6)),'ordinary0','ordinary1','ordinary2']);
const refs=[...reference108.ORDER_REFERENCE_ROOTS_V1.map(root=>`/${root}`),'/changes/0','/changes/1','/changes/2'];
export const SELECTED_CONTEXT_PROMPT_SHA256='db15b325a54be3e582e297948d208f1239ca8ef0eb1ef6e69efd0818e343fccf';
export const SELECTED_CONTEXT_SCHEMA_SHA256='bfa05ba9f4f63e6637c27a1d4b0c4e60d806e79e65d14a17344278aba540448e';
class PlacementFailure extends Error {constructor(readonly path:PropertyKey[],readonly expected:string){super('LITERAL_INSERTION_INVALID')}}
function fail(path:PropertyKey[],expected='LITERAL_INSERTION_CONTROL'):never{throw new PlacementFailure(path,expected)}
function own(object:object,key:string,path:PropertyKey[]):unknown {const descriptor=Object.getOwnPropertyDescriptor(object,key);if(!descriptor||!Object.hasOwn(descriptor,'value'))return fail(path,'OWN_DATA');return descriptor.value}
function record(value:unknown,path:PropertyKey[]):asserts value is Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(path,'object')}
/** Every valid control vector is a permutation. Payload activity never changes
 * owner insertion, so sparse ordinals and source identity remain observable. */
export function literalInsertionOwnerOrder(placements:unknown):string[] {
 record(placements,['placements']);const keys=Reflect.ownKeys(placements);
 if(keys.length!==13||keys.some(key=>typeof key!=='string'||!LITERAL_INSERTION_OWNERS.includes(key)))fail(['placements']);
 const order:string[]=[];
 for(const [index,owner] of LITERAL_INSERTION_OWNERS.entries()){
  const anchor=own(placements,owner,['placements',owner]);
  if(typeof anchor!=='string'||anchor!=='END'&&!LITERAL_INSERTION_OWNERS.slice(0,index).includes(anchor))fail(['placements',owner]);
  if(anchor==='END')order.push(owner);else order.splice(order.indexOf(anchor),0,owner);
 }
 return order;
}
/** Trusted canonical encoder only; not a received-reference fallback. */
export function literalInsertionControlsForOrder(order:readonly string[]):Record<string,string> {
 if(order.length!==13||new Set(order).size!==13||order.some(owner=>!LITERAL_INSERTION_OWNERS.includes(owner)))throw Error('LITERAL_INSERTION_ENCODER');
 return Object.fromEntries(LITERAL_INSERTION_OWNERS.map((owner,index)=>{const projection=order.filter(value=>LITERAL_INSERTION_OWNERS.slice(0,index+1).includes(value));return [owner,projection[projection.indexOf(owner)+1]??'END']}));
}
function toReferences(raw:unknown):Record<string,unknown> {
 record(raw,[]);if(Object.hasOwn(raw,'orderRefs'))fail(['orderRefs'],'NO_LEGACY_REFS');
 const result:Record<string,unknown>={};for(const key of Reflect.ownKeys(raw)){if(typeof key!=='string')fail([],'object');if(key!=='placements')result[key]=own(raw,key,[key])}
 const changes=own(raw,'changes',['changes']);if(!Array.isArray(changes)||changes.length>3)fail(['changes'],'array');
 const active=new Set<string>();for(let i=0;i<changes.length;i++){own(changes,String(i),['changes',i]);active.add(`ordinary${i}`)}
 reference108.ORDER_REFERENCE_ROOTS_V1.forEach((root,index)=>{if(own(raw,root,[root])!==null)active.add(LITERAL_INSERTION_OWNERS[index])});
 result.orderRefs=literalInsertionOwnerOrder(own(raw,'placements',['placements'])).map(owner=>active.has(owner)?refs[LITERAL_INSERTION_OWNERS.indexOf(owner)]:null);
 return result;
}
export function googleLiteEuContextWireSchemaReference110(capability?:GenerationFieldCapability,input?:ContextInput):Omit<ProviderWireSchemaV3,'version'>&{version:'google-gemini-2.5-flash-lite-vertex-eu-context-literal-owner-insertion-initial-operation-bound-110'} {
 const schema=structuredClone(reference108.googleLiteEuContextWireSchemaV3(capability,input).schema);
 const properties=schema.properties! as Record<string,unknown>;delete properties.orderRefs;schema.required=schema.required!.filter(key=>key!=='orderRefs');
 // Historical108 already excludes operation/MISSING for its certified bound
 // continuation.110 adds the independently certified initial source subset.
 // No target/value is inferred and received canonical uncertainties stay intact.
 if(input&&isInitialExplicitReminderIntentKnown(input)){
  const items=(properties.uncertainties as {items:{anyOf?:Array<{properties?:{reason?:{enum?:string[]};fieldCode?:{type?:string;maximum?:number}}}>}}).items;
  const missing=items.anyOf?.filter(branch=>branch.properties?.reason?.enum?.length===1&&branch.properties.reason.enum[0]==='MISSING');
  if(missing?.length!==1||missing[0].properties?.fieldCode?.type!=='integer'||missing[0].properties.fieldCode.maximum!==15)throw Error('INITIAL_OPERATION_SCHEMA_TOPOLOGY');
  // operation is the final fixed numeric code15; intersection preserves every
  // other field/reason branch, including existing source-qualified exclusions.
  missing[0].properties.fieldCode.maximum=14;
 }
 properties.placements={type:'object',properties:Object.fromEntries(LITERAL_INSERTION_OWNERS.map((owner,index)=>[owner,{type:'string',enum:['END',...LITERAL_INSERTION_OWNERS.slice(0,index)]}])),required:[...LITERAL_INSERTION_OWNERS],additionalProperties:false};schema.required.push('placements');
 return {version:'google-gemini-2.5-flash-lite-vertex-eu-context-literal-owner-insertion-initial-operation-bound-110',schema};
}
export function encodeGoogleLiteEuContextReference110(value:ConversationInterpretationV3,input?:ContextInput):unknown {
 const wire=reference108.encodeGoogleLiteEuContextV3(value,input) as Record<string,unknown>,orderRefs=wire.orderRefs as Array<string|null>,order:Array<string|null>=Array(13).fill(null);
 for(const[index,ref]of orderRefs.entries())if(ref!==null){const owner=refs.indexOf(ref);if(owner<0)throw Error('LITERAL_INSERTION_ENCODER');order[index]=LITERAL_INSERTION_OWNERS[owner]}
 const inactive=LITERAL_INSERTION_OWNERS.filter(owner=>!order.includes(owner));for(let i=0;i<13;i++)if(order[i]===null)order[i]=inactive.shift()!;
 delete wire.orderRefs;wire.placements=literalInsertionControlsForOrder(order as string[]);return wire;
}
function rejection(raw:unknown,error:unknown,observe?:Parameters<typeof reference108.decodeGoogleLiteEuContextTransportV3>[3]){
 const diagnostic=projectWireValidation(raw,error instanceof PlacementFailure||error instanceof UncertaintyFieldNameFailure?error.path:[],error instanceof PlacementFailure||error instanceof UncertaintyFieldNameFailure?error.expected:'LITERAL_INSERTION_INVALID',undefined,'calenote-context-3');try{observe?.(diagnostic)}catch{/* Observation cannot change refusal. */}
 return {status:'REFUSED' as const,reason:'SEMANTIC_PATCH_INVALID' as const};
}
export function decodeGoogleLiteEuContextTransportReference110(raw:unknown,selected:ContextProtocolV3,invalid?:Parameters<typeof reference108.decodeGoogleLiteEuContextTransportV3>[2],wireInvalid?:Parameters<typeof reference108.decodeGoogleLiteEuContextTransportV3>[3],input?:ContextInput):ReturnType<typeof reference108.decodeGoogleLiteEuContextTransportV3> {
 if(!isContextProtocolV3(selected))return {status:'REFUSED',reason:'ENVELOPE_INVALID'};
 try{return reference108.decodeGoogleLiteEuContextTransportV3(toReferences(raw),selected,invalid,wireInvalid,input)}catch(error){return rejection(raw,error,wireInvalid)}
}
export function parseGoogleLiteEuContextSectionsReference110(...args:Parameters<typeof reference108.parseGoogleLiteEuContextSectionsV3>):ReturnType<typeof reference108.parseGoogleLiteEuContextSectionsV3> {
 const[raw,selected,invalid,wireInvalid,decoded]=args;if(!isContextProtocolV3(selected))return {status:'REFUSED',reason:'ENVELOPE_INVALID'};
 try{return reference108.parseGoogleLiteEuContextSectionsV3(toReferences(raw),selected,invalid,wireInvalid,decoded)}catch(error){return rejection(raw,error,wireInvalid)}
}
/** After syntax parsing, scan original bytes/native placement keys for duplicates. */
export function validateTypedSingletonCarrierJsonV3(value:string,input:ContextInput){return validateUncertaintyFieldNameRootJsonWire111(value)??validateLiteralInsertionRootJsonWire109(value)??kernelRaw(value,input)}
const originalInsertionPrompt=reference108.CONTEXT_ORDER_REFERENCE_PROMPT.replaceAll('orderRefs','placements')
 .replace('Author placements separately from the current active payloads only.','Author all13 placements, including inactive placeholders.')
 .replace(/^Order references:.*$/mu,`Insertion ownership: placements has all13 declared owners in this fixed declaration sequence: ${LITERAL_INSERTION_OWNERS.join(',')}. These are payload owners and inactive positional placeholders, never source/value authority.`)
 .replace(/^Order:.*$/mu,'Order: each placements property says where ITS own declared owner is inserted. END appends; any schema-allowed earlier owner means insert directly BEFORE that owner. Process declarations in the fixed sequence above, inserting each exactly once. The resulting13 positions are your authored ordinals0..12; inactive owners are null holes, not proposals. Choose anchors from your desired final order, not schema/root field order. Keep actual ordinary owners in physical index subsequence0,1,2. No rank/ref list, arbitrary target, coercion, defaults, sorting, value repair or pointer traversal.');

export const CONTEXT_ORDER_REFERENCE_PROMPT_REFERENCE110=compactLiteralInsertionPrompt(originalInsertionPrompt);
export const CONTEXT_ORDER_REFERENCE_PROMPT_REFERENCE111=fieldNameWirePrompt(CONTEXT_ORDER_REFERENCE_PROMPT_REFERENCE110);
export const CONTEXT_ORDER_REFERENCE_PROMPT=CONTEXT_ORDER_REFERENCE_PROMPT_REFERENCE111;

export function googleLiteEuContextWireSchemaReference111(capability?:GenerationFieldCapability,input?:ContextInput):Omit<ProviderWireSchemaV3,'version'>&{version:'google-gemini-2.5-flash-lite-vertex-eu-context-literal-owner-insertion-field-name-controls-111'}{const original=googleLiteEuContextWireSchemaReference110(capability,input);return {version:'google-gemini-2.5-flash-lite-vertex-eu-context-literal-owner-insertion-field-name-controls-111',schema:projectUncertaintyFieldNameSchema(original.schema)}}
export function googleLiteEuContextWireSchemaV3(capability?:GenerationFieldCapability,input?:ContextInput):ProviderWireSchemaV3{const original=googleLiteEuContextWireSchemaReference111(capability,input);return {version:CONTEXT_PROTOCOL_V3.wireVersion,schema:constrainInitialDateClockUncertainties(original.schema,input)}}
export function encodeGoogleLiteEuContextV3(value:ConversationInterpretationV3,input?:ContextInput):unknown{return encodeUncertaintyFieldNames(encodeGoogleLiteEuContextReference110(value,input) as Record<string,unknown>)}
export function decodeGoogleLiteEuContextTransportV3(...args:Parameters<typeof decodeGoogleLiteEuContextTransportReference110>):ReturnType<typeof decodeGoogleLiteEuContextTransportReference110>{const [raw,selected,invalid,wireInvalid,input]=args;try{return decodeGoogleLiteEuContextTransportReference110(decodeUncertaintyFieldNames(raw),selected,invalid,wireInvalid,input)}catch(error){return rejection(raw,error,wireInvalid)}}
export function parseGoogleLiteEuContextSectionsV3(...args:Parameters<typeof parseGoogleLiteEuContextSectionsReference110>):ReturnType<typeof parseGoogleLiteEuContextSectionsReference110>{const [raw,selected,invalid,wireInvalid,decoded]=args;try{return parseGoogleLiteEuContextSectionsReference110(decodeUncertaintyFieldNames(raw),selected,invalid,wireInvalid,decoded)}catch(error){return rejection(raw,error,wireInvalid)}}
