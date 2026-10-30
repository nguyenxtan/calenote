import type {ContextInput,ConversationInterpretationV3} from '../../../conversation/context-contract/contracts';
import {CONTEXT_PROTOCOL_V3,isContextProtocolV3,type ContextProtocolV3} from '../../../conversation/context-contract/protocol';
import {CONTEXT_CONTRACT_PROMPT} from '../../../conversation/context-contract/prompt';
import {projectWireValidation,type CanonicalValidationDiagnostics} from '../../../conversation/context-contract/validation-diagnostics';
import type {GenerationFieldCapability} from '../../../conversation/context-contract/field-capability';
import type {ProviderWireSchemaV3} from './provider-wire-schema';
import {parseGoogleLiteEuContextSectionsV3 as kernelParse,googleLiteEuContextWireSchemaV3 as kernelSchema,encodeGoogleLiteEuContextV3 as kernelEncode,decodeGoogleLiteEuContextTransportV3 as kernelDecode,validateTypedSingletonCarrierJsonV3 as kernelRaw,validateOrderReferenceRootJsonWire107Reference} from './context-provider-wire';

export const ORDER_REFERENCE_ROOTS_V1=Object.freeze(['titleChange','reminderDateChange','reminderTimeChange','eventDateChange','eventTimeChange','eventRelationChange','frequencyChange','occurrenceCountChange','endDateChange','locationChange'] as const);
export const SELECTED_CONTEXT_PROMPT_SHA256='e39d325baa8571f416d51788e4957f0361cd22209866eb50ffeeae8cbd09ecbc';
export const SELECTED_CONTEXT_SCHEMA_SHA256='7b7d433b2b12ee59157dedd8d497b3d1baa85a9d5e20a2ba9a07d211aae11ecf';
type Node={type?:string;$ref?:string;properties?:Record<string,Node>;required?:string[];anyOf?:Node[];items?:Node;maxItems?:number;$defs?:Record<string,Node>;[key:string]:unknown};
class ReferenceFailure extends Error {constructor(readonly path:PropertyKey[],readonly expected:string){super('ORDER_REFERENCE_INVALID')}}
function fail(path:PropertyKey[],expected='ORDER_REFERENCE_BIJECTION'):never{throw new ReferenceFailure(path,expected)}
function own(object:object,key:string,path:PropertyKey[]):unknown {const d=Object.getOwnPropertyDescriptor(object,key);if(!d||!Object.hasOwn(d,'value'))return fail(path,'OWN_DATA');return d.value}
function record(value:unknown,path:PropertyKey[]):asserts value is Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(path,'object')}
function array(value:unknown,maximum:number,path:PropertyKey[]):asserts value is unknown[] {
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)fail(path,'array');
 const length=own(value,'length',path);if(typeof length!=='number'||!Number.isSafeInteger(length)||length>maximum)fail(path,'array');
 const allowed=new Set(['length',...Array.from({length},(_,i)=>String(i))]);
 if(Reflect.ownKeys(value).some(key=>typeof key!=='string'||!allowed.has(key)))fail(path,'array');
 for(let i=0;i<length;i++)own(value,String(i),[...path,i]);
}
function wrapper(value:unknown,path:PropertyKey[]):unknown {
 record(value,path);if(Reflect.ownKeys(value).length!==1||!Object.hasOwn(value,'change'))fail(path,'REFERENCE_WRAPPER');
 return own(value,'change',[...path,'change']);
}
/** Guard only payload data. Guidance has independent quarantine/budgets. */
function data(value:unknown,path:PropertyKey[],depth=0,state={nodes:0}):void {
 if(depth>8||++state.nodes>256)fail(path,'OWN_DATA');
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;
 if(Array.isArray(value)){array(value,256,path);for(let i=0;i<value.length;i++)data(own(value,String(i),[...path,i]),[...path,i],depth+1,state);return}
 record(value,path);for(const key of Reflect.ownKeys(value)){if(typeof key!=='string')fail(path,'OWN_DATA');data(own(value,key,[...path,key]),[...path,key],depth+1,state)}
}
function deref(node:Node,schema:Node):Node {if(!node.$ref)return node;const target=node.$ref.slice(2).split('/').reduce<unknown>((p,key)=>p&&typeof p==='object'?Object.getOwnPropertyDescriptor(p,key)?.value:undefined,schema);if(!target||typeof target!=='object'||Object.keys(node).length!==1)throw Error('ORDER_REFERENCE_SCHEMA_TOPOLOGY');return target as Node}
export function googleLiteEuContextWireSchemaV3(capability?:GenerationFieldCapability,input?:ContextInput):Omit<ProviderWireSchemaV3,"version">&{version:"google-gemini-2.5-flash-lite-vertex-eu-context-physical-order-references-108"} {
 const schema=structuredClone(kernelSchema(capability,input).schema) as unknown as Node;
 const strip=(raw:Node)=>{const node=deref(raw,schema);if(node.type==='null')return;if(node.type!=='object'||!node.properties?.rank||!node.properties.change||JSON.stringify(node.required)!=='["rank","change"]')throw Error('ORDER_REFERENCE_SCHEMA_TOPOLOGY');delete node.properties.rank;node.required=['change']};
 const refs:string[]=[];
 for(const root of ORDER_REFERENCE_ROOTS_V1){const node=schema.properties?.[root];if(!node)throw Error('ORDER_REFERENCE_SCHEMA_TOPOLOGY');for(const branch of node.anyOf??[node])strip(branch);if(node.type!=='null')refs.push(`/${root}`)}
 const changes=schema.properties?.changes,maximum=changes?.maxItems;if(!changes?.items||typeof maximum!=='number'||!Number.isSafeInteger(maximum)||maximum<0||maximum>3)throw Error('ORDER_REFERENCE_SCHEMA_TOPOLOGY');strip(changes.items);
 for(let i=0;i<maximum;i++)refs.push(`/changes/${i}`);
 if(!schema.$defs?.r||!schema.required||schema.properties?.orderRefs)throw Error('ORDER_REFERENCE_SCHEMA_TOPOLOGY');delete schema.$defs.r;
 schema.properties!.orderRefs={type:'array',items:refs.length?{anyOf:[{type:'string',enum:refs},{type:'null'}]}:{type:'null'},maxItems:13};schema.required.push('orderRefs');
 return {version:"google-gemini-2.5-flash-lite-vertex-eu-context-physical-order-references-108",schema:schema as ReturnType<typeof kernelSchema>['schema']};
}
/** Canonical encoder only; never translate a received legacy rank output. */
export function encodeGoogleLiteEuContextV3(value:ConversationInterpretationV3,input?:ContextInput):unknown {
 const result=kernelEncode(value,input) as Record<string,unknown>,refs:Array<string|null>=[];
 const move=(entry:unknown,ref:string)=>{record(entry,[]);const rank=own(entry,'rank',[]);if(typeof rank!=='number'||!Number.isSafeInteger(rank)||rank<0||rank>12||refs[rank])throw Error('ORDER_REFERENCE_ENCODER');refs[rank]=ref;delete entry.rank};
 (result.changes as unknown[]).forEach((entry,i)=>move(entry,`/changes/${i}`));for(const root of ORDER_REFERENCE_ROOTS_V1)if(result[root]!==null)move(result[root],`/${root}`);
 result.orderRefs=Array.from({length:refs.length},(_,i)=>refs[i]??null);return result;
}
function unfold(raw:unknown):Record<string,unknown> {
 record(raw,[]);const refs=own(raw,'orderRefs',['orderRefs']),changes=own(raw,'changes',['changes']);array(refs,13,['orderRefs']);array(changes,3,['changes']);
 const active=new Map<string,{change:unknown;path:PropertyKey[]}>();
 for(let i=0;i<changes.length;i++){const path=['changes',i],change=wrapper(own(changes,String(i),path),path);data(change,[...path,'change']);active.set(`/changes/${i}`,{change,path})}
 for(const root of ORDER_REFERENCE_ROOTS_V1){const entry=own(raw,root,[root]);if(entry!==null){const change=wrapper(entry,[root]);data(change,[root,'change']);active.set(`/${root}`,{change,path:[root]})}}
 const positions=new Map<string,number>();let prior=-1;
 for(let rank=0;rank<refs.length;rank++){const ref=own(refs,String(rank),['orderRefs',rank]);if(ref===null)continue;if(typeof ref!=='string'||!active.has(ref)||positions.has(ref))fail(['orderRefs',rank]);if(ref.startsWith('/changes/')){const index=Number(ref.slice(9));if(index<=prior)fail(['orderRefs',rank],'ORDER_REFERENCE_SUBSEQUENCE');prior=index}positions.set(ref,rank)}
 if(positions.size!==active.size)fail(['orderRefs']);
 const result:Record<string,unknown>={};for(const key of Reflect.ownKeys(raw)){if(typeof key!=='string')fail([],'object');if(key!=='orderRefs')result[key]=own(raw,key,[key])}
 result.changes=Array.from({length:changes.length},(_,i)=>({rank:positions.get(`/changes/${i}`),change:active.get(`/changes/${i}`)!.change}));
 for(const root of ORDER_REFERENCE_ROOTS_V1)result[root]=active.has(`/${root}`)?{rank:positions.get(`/${root}`),change:active.get(`/${root}`)!.change}:null;
 return result;
}
export function decodeGoogleLiteEuContextTransportV3(raw:unknown,selected:ContextProtocolV3,observeInvalid?:Parameters<typeof kernelDecode>[2],observeWireInvalid?:Parameters<typeof kernelDecode>[3],input?:ContextInput):ReturnType<typeof kernelDecode> {
 if(!isContextProtocolV3(selected))return {status:'REFUSED',reason:'ENVELOPE_INVALID'};
 try{return kernelDecode(unfold(raw),selected,observeInvalid,observeWireInvalid,input)}catch(error){const d=projectWireValidation(raw,error instanceof ReferenceFailure?error.path:[],error instanceof ReferenceFailure?error.expected:'ORDER_REFERENCE_INVALID',undefined,'calenote-context-3');try{observeWireInvalid?.(d)}catch{/* Observers cannot change refusal. */}return {status:'REFUSED',reason:'SEMANTIC_PATCH_INVALID'}}
}
/** Diagnostic observer uses the same strict108 reference projection, never legacy admission. */
export function parseGoogleLiteEuContextSectionsV3(...args:Parameters<typeof kernelParse>):ReturnType<typeof kernelParse> {
 const [raw,selected,invalid,wireInvalid,decoded]=args;
 if(!isContextProtocolV3(selected))return {status:'REFUSED',reason:'ENVELOPE_INVALID'};
 try{return kernelParse(unfold(raw),selected,invalid,wireInvalid,decoded)}catch{return {status:'REFUSED',reason:'SEMANTIC_PATCH_INVALID'}}
}
export function validateTypedSingletonCarrierJsonV3(value:string,input:ContextInput):CanonicalValidationDiagnostics|undefined {return validateOrderReferenceRootJsonWire107Reference(value)??kernelRaw(value,input)}

// Wire107 prompt remains immutable. These changes describe only108 transport.
export const CONTEXT_ORDER_REFERENCE_PROMPT=CONTEXT_CONTRACT_PROMPT
 .replaceAll('carriers={rank,change:object}','carriers={change:object}').replaceAll('carriers={rank,change:JSON string','carriers={change:JSON string').replaceAll('ordinary={rank,change:object}','ordinary={change:object}').replace('CLEAR ranked despite value=null.','CLEAR remains active despite value=null.')
 .replace(/^Serialization example boundary:.*$/mu,'Serialization example boundary: this syntax fragment omits orderRefs and other required roots and is not a complete response. Author orderRefs separately from the current active payloads only. Never copy its relation, operation or source placeholder; select actual grounded values and an available source. Complete all required outer roots using the selected schema.')
 .replace(/^Rank assembly:.*$/mu,'Order references: after choosing your current grounded payloads, author ONE orderRefs array identifying each active payload once. Singleton references are exact literal /<root> paths, such as /eventRelationChange; ordinary references are /changes/0, /changes/1 or /changes/2 only when that actual entry exists. Refer to NONNULL payloads, including CLEAR; never list null roots or all required root keys. This is physical payload addressing, not a field/source codebook or pointer evaluation.')
 .replace(/^Order:.*$/mu,'Order: orderRefs length0..13; each cell is a schema-allowed literal active-payload reference or null. Cell position0..12 is your authored ordinal; null holes are legal sparse positions. Dense refs are ordinary list ordering. Include every active payload exactly once, no duplicates/missing/extra/unknown references; keep ordinary refs in increasing physical array-index subsequence. No rank property anywhere. Empty array only when no changes. No field sort, defaults, receiver repair, dropping payloads or pointer traversal.')
 .replace('evidence, rank or source authority','evidence, order or source authority');
