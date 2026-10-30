import {vi} from "vitest";
import {googleLiteEuContextWireSchemaV3} from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";
const roots=["titleChange","reminderDateChange","reminderTimeChange","eventDateChange","eventTimeChange","eventRelationChange","frequencyChange","occurrenceCountChange","endDateChange","locationChange"] as const;
import * as capabilityModule from "../../src/modules/conversation/context-contract/field-capability";
import {serializeWire107ContextRequestReference as serializeContextRequest} from "../../src/modules/conversation/context-contract/wire";
/** Exact wire105 prompt specimen; no runtime compatibility fallback. */
export function wire106PromptFixture(prompt:string):string {
 prompt=prompt.replace("Nonnull schema-selected eventDateChange/frequencyChange OBJECT carriers={rank,change:object}; eventDateChange selects OBJECT when input.fieldCapability.eventDateYearNullRequired=true; frequencyChange selects OBJECT only when the supplied schema requires its typed change. Other carriers={rank,change:JSON string of {field,operation,value,evidence}};","Nonnull eventDateChange carrier={rank,change:object} when input.fieldCapability.eventDateYearNullRequired=true; every other carrier={rank,change:JSON string of {field,operation,value,evidence}};");
 prompt=prompt.replace("Singleton serialization: for each schema-selected OBJECT carrier, keep change as an object and encode it only with the outer response. Frequency value remains one exact canonical enum string inside its selected object; never stringify the completed typed frequency change.","Singleton serialization: for the schema-selected eventDateChange object carrier, keep change as an object and encode it only with the outer response.");
 prompt=prompt.replace("SECOND keep each schema-selected OBJECT change carrier as an object; for each STRING carrier JSON-serialize the completed change object into the carrier change STRING;","SECOND keep the completed eventDateChange change as an OBJECT when its input flag is true; for every other carrier JSON-serialize the completed change object into the carrier change STRING;");
 prompt=prompt.replace("For STRING carriers, the change STRING does not make its inner value a STRING.","For other carriers, the change STRING does not make its inner value a STRING.");
 prompt=prompt.replace("keep c as an OBJECT for a schema-selected OBJECT carrier, otherwise JSON-serialize c into the carrier change STRING","keep c as an OBJECT for the selected eventDateChange object carrier, otherwise JSON-serialize c into the carrier change STRING");
 return prompt;
}
/** Public historical prompt specimen only; immutable hashes remain asserted. */
export function wire105PromptFixture(prompt:string):string {
 prompt=wire106PromptFixture(prompt);
 prompt=prompt.replace("Nonnull eventDateChange carrier={rank,change:object} when input.fieldCapability.eventDateYearNullRequired=true; every other carrier={rank,change:JSON string of {field,operation,value,evidence}};","Nonnull carrier={rank,change:JSON string of {field,operation,value,evidence}};");
 prompt=prompt.replace("Singleton serialization: for the schema-selected eventDateChange object carrier, keep change as an object and encode it only with the outer response. For every string carrier, finish each inner change object first, then JSON-serialize it as the change string, then JSON-serialize the outer response.","Singleton serialization: finish each inner change object first, then JSON-serialize it as the change string, then JSON-serialize the outer response.");
 prompt=prompt.replace("SECOND keep the completed eventDateChange change as an OBJECT when its input flag is true; for every other carrier JSON-serialize the completed change object into the carrier change STRING;","SECOND JSON-serialize the completed change object into the carrier change STRING for either branch;");
 prompt=prompt.replace("Date carrier emission check: The selected eventDateChange change carrier is an OBJECT when eventDateYearNullRequired=true, never a JSON string. For other carriers, the change STRING does not make its inner value a STRING.","Date carrier emission check: The carrier change STRING does not make its inner value a STRING.");
 prompt=prompt.replace("Validate this inner type before encoding; keep c as an OBJECT for the selected eventDateChange object carrier, otherwise JSON-serialize c into the carrier change STRING, then encode the outer response.","Validate this inner type before JSON-serializing c into the carrier change STRING, then encode the outer response.");
 return prompt;
}
export function wire104PromptFixture(prompt:string):string {
 return wire105PromptFixture(prompt).replace(/\nDate carrier emission check: [^\n]*\n/u,"");
}
export function wire103PromptFixture(prompt:string):string {
 return wire104PromptFixture(prompt).replace(/\nNotes grounding: [^\n]*\n/u,"");
}
export function wire102PromptFixture(prompt:string):string {
 return wire103PromptFixture(prompt).replace(/^Date singleton serialization: [^\n]*\n/mu,"Date singleton serialization: for an eventDate/reminderDate/endDate SET or REPLACE whose selected inner grammar requires a STRING, FIRST author an independently grounded canonical DateOperand object and JSON-serialize that operand exactly once into the inner value STRING; SECOND JSON-serialize the completed change object into the carrier change STRING; THIRD JSON-serialize the outer response. Check all three layers separately, escaping quotes and backslashes at each layer. Only the selected eventDateYearNullRequired=true eventDate six-key CIVIL_DATE/year-null branch keeps the inner value as an object and skips FIRST; it still requires SECOND and THIRD. CLEAR stays null, never the string \"null\". Canonical date alternative values remain typed objects inside their alternative JSON strings; do not apply this singleton operand-string step to alternatives. Query date/from/through keep their existing DateOperand JSON-string representation and query envelope grammar; they are not singleton change carriers. These are emission steps only: no received-value repair/coercion, date arithmetic, source/value/default inference or invented evidence.\n");
}
export function wire101PromptFixture(prompt:string):string {
 return wire102PromptFixture(prompt).replace(/^Date singleton serialization: [^\n]*\n/mu,"");
}
export function wire95PromptFixture(prompt:string):string {
 return wire101PromptFixture(prompt).replace(/^Rank assembly: [^\n]*\n/mu,"")
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
/** Exact wire106 request specimen; source guard inversion is test-only. */
export function wire106RequestFixture(input:Parameters<typeof serializeContextRequest>[0]):ReturnType<typeof serializeContextRequest> {
 const inverse=vi.spyOn(capabilityModule,"isBoundOperationMissingExcluded").mockReturnValue(false);
 try{return serializeContextRequest(input);}finally{inverse.mockRestore();}
}
/** Previous source language only, never current dispatch or authority. */
export function wire104RequestFixture(input:Parameters<typeof serializeContextRequest>[0]):ReturnType<typeof serializeContextRequest> {
 const request=wire106RequestFixture(input);
 request.response_format.json_schema.schema=wire104SchemaFixture(request.response_format.json_schema.schema);
 request.messages[0].content=wire104PromptFixture(request.messages[0].content);
 return request;
}
/** Exact wire105 schema projection for historical evidence only. */
export function wire105SchemaFixture(schema:ReturnType<typeof googleLiteEuContextWireSchemaV3>["schema"]):ReturnType<typeof googleLiteEuContextWireSchemaV3>["schema"] {
 const result=structuredClone(schema),node=result.properties!.frequencyChange;
 if(typeof node==="boolean")throw Error("PUBLIC_WIRE105_SPECIMEN_SHAPE");
 if(node.type!=="null"){for(const branch of node.anyOf??[node])if(branch.type!=="null")branch.properties!.change={type:"string"};}
 return result;
}
/** Exact old transport projection for historical grammar comparisons only. */
export function wire104SchemaFixture(schema:ReturnType<typeof googleLiteEuContextWireSchemaV3>["schema"]):ReturnType<typeof googleLiteEuContextWireSchemaV3>["schema"] {
 const result=wire105SchemaFixture(schema),node=result.properties!.eventDateChange;
 if(typeof node==="boolean")throw Error("PUBLIC_WIRE104_SPECIMEN_SHAPE");
 if(node.type!=="null"){for(const branch of node.anyOf??[node])if(branch.type!=="null")branch.properties!.change={type:"string"};}
 return result;
}

export function wire100RequestFixture(input:Parameters<typeof serializeContextRequest>[0]):ReturnType<typeof serializeContextRequest> {
 const inverse=vi.spyOn(capabilityModule,"isBoundRelationUncertaintyAbsent").mockReturnValue(false);
 try{return wire104RequestFixture(input);}finally{inverse.mockRestore();}
}
export function wire99RequestFixture(input:Parameters<typeof serializeContextRequest>[0]):ReturnType<typeof serializeContextRequest> {
 const inverse=vi.spyOn(capabilityModule,"isInitialReminderDateMissingExcluded").mockReturnValue(false);
 try{return wire100RequestFixture(input);}finally{inverse.mockRestore();}
}
export function wire98RequestFixture(input:Parameters<typeof serializeContextRequest>[0]):ReturnType<typeof serializeContextRequest> {
 const relation=capabilityModule.isInitialRelationUncertaintyAbsent;
 const relationInverse=vi.isMockFunction(relation)?undefined:vi.spyOn(capabilityModule,"isInitialRelationUncertaintyAbsent").mockImplementation(value=>capabilityModule.isInitialFiniteSeriesWithoutRelationSource(value));
 const inverse=vi.spyOn(capabilityModule,"isWholeSeriesOffsetUncertaintyAbsent").mockReturnValue(false);
 try{return wire99RequestFixture(input);}finally{inverse.mockRestore();relationInverse?.mockRestore();}
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
function authoring<T>(wire:T,unwrap:boolean,input?:Parameters<typeof serializeContextRequest>[0]):T{
 if(!wire||typeof wire!=="object"||Array.isArray(wire))return wire;
 const changed=new Map<string,unknown>();
 for(const root of roots){if(!unwrap&&input&&((root==="eventDateChange"&&capabilityModule.isInitialEventDateYearNullRequired(input))||(root==="frequencyChange"&&capabilityModule.isInitialUniqueCadenceCountRequired(input))))continue;const carrier=data(wire,root);if(!carrier||typeof carrier!=="object"||Array.isArray(carrier))continue;
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
export const wrapSingletonAuthoringFixture=<T>(wire:T,input?:Parameters<typeof serializeContextRequest>[0]):T=>authoring(wire,false,input);
/** Pure pre-wire89 typed specimen capture. All synchronous spies restored. */
export function typedSingletonSchemaFixture(...args:Parameters<typeof googleLiteEuContextWireSchemaV3>):ReturnType<typeof googleLiteEuContextWireSchemaV3>{
 const clone=globalThis.structuredClone,candidates:Array<ReturnType<typeof googleLiteEuContextWireSchemaV3>["schema"]>=[];
 // This named specimen predates the wire107 producer-only operation bound.
 const operationMissingInverse=vi.spyOn(capabilityModule,"isBoundOperationMissingExcluded").mockReturnValue(false);
 const inverse=vi.spyOn(capabilityModule,"isInitialExplicitReminderIntentKnown").mockReturnValue(false);
 const seriesInverse=vi.spyOn(capabilityModule,"isBoundSeriesDistanceOffsetMissingExcluded").mockReturnValue(false);
 const initialSeriesInverse=vi.spyOn(capabilityModule,"isInitialFiniteSeriesWithoutRelationSource").mockReturnValue(false);
 const boundRelationInverse=vi.spyOn(capabilityModule,"isBoundSeriesDistanceRelationMissingExcluded").mockReturnValue(false);
 const offsetUncertaintyInverse=vi.spyOn(capabilityModule,"isWholeSeriesOffsetUncertaintyAbsent").mockReturnValue(false);
 const relationUncertaintyInverse=vi.spyOn(capabilityModule,"isInitialRelationUncertaintyAbsent").mockReturnValue(false);
 const dateMissingInverse=vi.spyOn(capabilityModule,"isInitialReminderDateMissingExcluded").mockReturnValue(false);
 const boundUncertaintyInverse=vi.spyOn(capabilityModule,"isBoundRelationUncertaintyAbsent").mockReturnValue(false);
 const offsetAlternativeInverse=vi.spyOn(capabilityModule,"isWholeSeriesOffsetAlternativeAbsent").mockReturnValue(false);
 const spy=vi.spyOn(globalThis,"structuredClone").mockImplementation(value=>{const result=clone(value);const node=value as {properties?:{changes?:{maxItems?:unknown}}};if(typeof node?.properties?.changes?.maxItems==="number"&&node.properties.changes.maxItems<=3){if(candidates.length>=16)throw Error("PUBLIC_TYPED_SPECIMEN_BOUND");candidates.push(clone(value) as typeof candidates[number]);}return result;});
 try{const result=googleLiteEuContextWireSchemaV3(...args),matching=new Map<string,typeof result.schema>();
  for(const candidate of candidates){const restored=clone(result.schema);for(const root of roots)restored.properties![root]=candidate.properties![root];if(JSON.stringify(restored)===JSON.stringify(candidate))matching.set(JSON.stringify(candidate),candidate);}
  if(matching.size!==1)throw Error("PUBLIC_TYPED_SPECIMEN_CAPTURE");return {...result,schema:[...matching.values()][0]};
 }finally{spy.mockRestore();operationMissingInverse.mockRestore();boundUncertaintyInverse.mockRestore();dateMissingInverse.mockRestore();offsetUncertaintyInverse.mockRestore();relationUncertaintyInverse.mockRestore();offsetAlternativeInverse.mockRestore();boundRelationInverse.mockRestore();initialSeriesInverse.mockRestore();seriesInverse.mockRestore();inverse.mockRestore();}
}
