import {vi} from "vitest";
import {googleLiteEuContextWireSchemaV3} from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";
const roots=["titleChange","reminderDateChange","reminderTimeChange","eventDateChange","eventTimeChange","eventRelationChange","frequencyChange","occurrenceCountChange","endDateChange","locationChange"] as const;
import * as capabilityModule from "../../src/modules/conversation/context-contract/field-capability";
import {serializeContextRequest} from "../../src/modules/conversation/context-contract/wire";
/** Public historical prompt specimen only; immutable hashes remain asserted. */
export function wire95PromptFixture(prompt:string):string {
 return prompt.replace(/^Rank assembly: [^\n]*\n/mu,"")
 .replace('Serialization example boundary: this syntax fragment deliberately omits rank and is not a complete carrier. Supply an independently authored numeric rank for the real carrier; there is no default rank. This is a partial carrier, not a proposal or source.','Serialization example boundary: this is a partial carrier, not a proposal or source.')
 .replace(/^Serialization example \(syntax only\): (.+)$/mu,(_line,json:string)=>{const value=JSON.parse(json);return "Serialization example (syntax only): "+JSON.stringify({eventRelationChange:{rank:10,change:value.eventRelationChange.change}});});
}
export function wire92PromptFixture(prompt:string):string {
 return wire95PromptFixture(prompt).replace(/^Alternative relation enum: [^\n]*\n/mu,"");
}
export function wire91PromptFixture(prompt:string):string {
 return wire92PromptFixture(prompt).replace(/\nAlternative serialization:[^\n]*\nAlternative example \(syntax only\):[^\n]*\nAlternative example boundary:[^\n]*\n/u,"");
}
export function wire89PromptFixture(prompt:string):string {
 return wire91PromptFixture(prompt).replace(/\nSingleton serialization:[^\n]*\nSerialization example \(syntax only\):[^\n]*\nSerialization example boundary:[^\n]*\n/u,"");
}
/** Previous source language only, never current dispatch or authority. */
export function wire98RequestFixture(input:Parameters<typeof serializeContextRequest>[0]):ReturnType<typeof serializeContextRequest> {
 const relation=capabilityModule.isInitialRelationUncertaintyAbsent;
 const relationInverse=vi.isMockFunction(relation)?undefined:vi.spyOn(capabilityModule,"isInitialRelationUncertaintyAbsent").mockImplementation(value=>capabilityModule.isInitialFiniteSeriesWithoutRelationSource(value));
 const inverse=vi.spyOn(capabilityModule,"isWholeSeriesOffsetUncertaintyAbsent").mockReturnValue(false);
 try{return serializeContextRequest(input);}finally{inverse.mockRestore();relationInverse?.mockRestore();}
}
export function wire97RequestFixture(input:Parameters<typeof serializeContextRequest>[0]):ReturnType<typeof serializeContextRequest> {
 const inverse=vi.spyOn(capabilityModule,"isInitialRelationUncertaintyAbsent").mockReturnValue(false);
 try{return wire98RequestFixture(input);}finally{inverse.mockRestore();}
}
export function wire96RequestFixture(input:Parameters<typeof serializeContextRequest>[0]):ReturnType<typeof serializeContextRequest> {
 const current=capabilityModule.isInitialFiniteSeriesWithoutRelationSource;
 if(vi.isMockFunction(current))return wire97RequestFixture(input);
 const inverse=vi.spyOn(capabilityModule,"isInitialFiniteSeriesWithoutRelationSource").mockImplementation(value=>capabilityModule.isInitialExplicitReminderClockRequired(value)&&current(value));
 try{return wire97RequestFixture(input);}finally{inverse.mockRestore();}
}
export function wire94RequestFixture(input:Parameters<typeof serializeContextRequest>[0]):ReturnType<typeof serializeContextRequest> {
 const inverse=vi.spyOn(capabilityModule,"isWholeSeriesOffsetAlternativeAbsent").mockReturnValue(false);
 try{return wire96RequestFixture(input);}finally{inverse.mockRestore();}
}
export function wire93RequestFixture(input:Parameters<typeof serializeContextRequest>[0]):ReturnType<typeof serializeContextRequest> {
 const inverse=vi.spyOn(capabilityModule,"isInitialFiniteSeriesWithoutRelationSource").mockReturnValue(false);
 const boundInverse=vi.spyOn(capabilityModule,"isBoundSeriesDistanceRelationMissingExcluded").mockReturnValue(false);
 try{return wire94RequestFixture(input);}finally{boundInverse.mockRestore();inverse.mockRestore();}
}
export function wire90RequestFixture(input:Parameters<typeof serializeContextRequest>[0]):ReturnType<typeof serializeContextRequest> {
 const inverse=vi.spyOn(capabilityModule,"isBoundSeriesDistanceOffsetMissingExcluded").mockReturnValue(false);
 try{return wire93RequestFixture(input);}finally{inverse.mockRestore();}
}
/** Pure synchronous public pre-wire89 source-condition inverse, never dispatch. */
export function wire88RequestFixture(input:Parameters<typeof serializeContextRequest>[0]):ReturnType<typeof serializeContextRequest> {
 const inverse=vi.spyOn(capabilityModule,"isInitialExplicitReminderIntentKnown").mockReturnValue(false);
 try{return wire90RequestFixture(input);}finally{inverse.mockRestore();}
}
/** Controlled fixture authoring only; never called by production transport. */
function data(object:object,key:PropertyKey){const descriptor=Object.getOwnPropertyDescriptor(object,key);return descriptor&&Object.hasOwn(descriptor,"value")?descriptor.value:undefined;}
function jsonSafe(value:unknown,depth=0):boolean{
 if(depth>8)return false;if(value===null||typeof value==="string"||typeof value==="boolean")return true;
 if(typeof value==="number")return Number.isFinite(value)&&!Object.is(value,-0);
 if(!value||typeof value!=="object")return false;
 try{if(Object.getPrototypeOf(value)!==(Array.isArray(value)?Array.prototype:Object.prototype))return false;const keys=Reflect.ownKeys(value);if(keys.some(key=>typeof key!=="string"))return false;
  if(Array.isArray(value)){const length=data(value,"length");if(!Number.isSafeInteger(length)||length>256||keys.length!==length+1)return false;for(let i=0;i<length;i++)if(!jsonSafe(data(value,String(i)),depth+1))return false;return true;}
  return keys.every(key=>jsonSafe(data(value,key),depth+1));
 }catch{return false;}
}
function jsonData(value:unknown):unknown{
 if(!value||typeof value!=="object")return value;
 if(Array.isArray(value)){const length=data(value,"length");return Array.from({length},(_,index)=>jsonData(data(value,String(index))));}
 return Object.fromEntries(Reflect.ownKeys(value).map(key=>[key,jsonData(data(value,key))]));
}
function authoring<T>(wire:T,unwrap:boolean):T{
 if(!wire||typeof wire!=="object"||Array.isArray(wire))return wire;
 const changed=new Map<string,unknown>();
 for(const root of roots){const carrier=data(wire,root);if(!carrier||typeof carrier!=="object"||Array.isArray(carrier))continue;
  const change=data(carrier,"change");
  try{let replacement:unknown;
   if(unwrap&&typeof change==="string"){replacement=JSON.parse(change);if(!replacement||typeof replacement!=="object"||Array.isArray(replacement))continue;}
   else if(!unwrap&&change&&typeof change==="object"&&jsonSafe(change))replacement=JSON.stringify(jsonData(change));else continue;
   const wrapper=Object.create(Object.getPrototypeOf(carrier),Object.getOwnPropertyDescriptors(carrier));Object.defineProperty(wrapper,"change",{value:replacement,writable:true,enumerable:true,configurable:true});changed.set(root,wrapper);
  }catch{/* Hostile or malformed fixtures retain their original refusal form. */}
 }
 if(!changed.size)return wire;
 const copy=Object.create(Object.getPrototypeOf(wire),Object.getOwnPropertyDescriptors(wire));for(const [root,value]of changed)Object.defineProperty(copy,root,{value,writable:true,enumerable:true,configurable:true});return copy as T;
}
export const unwrapSingletonAuthoringFixture=<T>(wire:T):T=>authoring(wire,true);
export const wrapSingletonAuthoringFixture=<T>(wire:T):T=>authoring(wire,false);
/** Pure pre-wire89 typed specimen capture. All synchronous spies restored. */
export function typedSingletonSchemaFixture(...args:Parameters<typeof googleLiteEuContextWireSchemaV3>):ReturnType<typeof googleLiteEuContextWireSchemaV3>{
 const clone=globalThis.structuredClone,candidates:Array<ReturnType<typeof googleLiteEuContextWireSchemaV3>["schema"]>=[];
 const inverse=vi.spyOn(capabilityModule,"isInitialExplicitReminderIntentKnown").mockReturnValue(false);
 const seriesInverse=vi.spyOn(capabilityModule,"isBoundSeriesDistanceOffsetMissingExcluded").mockReturnValue(false);
 const initialSeriesInverse=vi.spyOn(capabilityModule,"isInitialFiniteSeriesWithoutRelationSource").mockReturnValue(false);
 const boundRelationInverse=vi.spyOn(capabilityModule,"isBoundSeriesDistanceRelationMissingExcluded").mockReturnValue(false);
 const offsetUncertaintyInverse=vi.spyOn(capabilityModule,"isWholeSeriesOffsetUncertaintyAbsent").mockReturnValue(false);
 const relationUncertaintyInverse=vi.spyOn(capabilityModule,"isInitialRelationUncertaintyAbsent").mockReturnValue(false);
 const offsetAlternativeInverse=vi.spyOn(capabilityModule,"isWholeSeriesOffsetAlternativeAbsent").mockReturnValue(false);
 const spy=vi.spyOn(globalThis,"structuredClone").mockImplementation(value=>{const result=clone(value);const node=value as {properties?:{changes?:{maxItems?:unknown}}};if(typeof node?.properties?.changes?.maxItems==="number"&&node.properties.changes.maxItems<=3){if(candidates.length>=16)throw Error("PUBLIC_TYPED_SPECIMEN_BOUND");candidates.push(clone(value) as typeof candidates[number]);}return result;});
 try{const result=googleLiteEuContextWireSchemaV3(...args),matching=new Map<string,typeof result.schema>();
  for(const candidate of candidates){const restored=clone(result.schema);for(const root of roots)restored.properties![root]=candidate.properties![root];if(JSON.stringify(restored)===JSON.stringify(candidate))matching.set(JSON.stringify(candidate),candidate);}
  if(matching.size!==1)throw Error("PUBLIC_TYPED_SPECIMEN_CAPTURE");return {...result,schema:[...matching.values()][0]};
 }finally{spy.mockRestore();offsetUncertaintyInverse.mockRestore();relationUncertaintyInverse.mockRestore();offsetAlternativeInverse.mockRestore();boundRelationInverse.mockRestore();initialSeriesInverse.mockRestore();seriesInverse.mockRestore();inverse.mockRestore();}
}
