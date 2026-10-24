import type { z } from "zod";
import { createHash } from "node:crypto";
import { projectCanonicalConstraint, type CanonicalConstraintId, type OwnershipControlState } from "./canonical-constraints";
import { FieldChangeV3Schema, UncertaintyV3Schema } from "./contracts";
import { CHANGE_ORDER_FIELDS_V3, decodeAuthoredChangeRank } from "./output-authority";
// Decoder traversal: ordinary entries first, then these fixed singleton roots.
const rankCarrierRoots=["titleChange","reminderDateChange","reminderTimeChange","eventDateChange","eventTimeChange","eventRelationChange","frequencyChange","occurrenceCountChange","endDateChange","locationChange"] as const;
interface RankLocation {root:typeof rankCarrierRoots[number]|"changes";index?:number}
export interface RankControlDiagnostic {
  reason:"NON_INTEGER"|"NEGATIVE"|"OUT_OF_RANGE"|"COLLISION"|"NON_INCREASING"|"UNAVAILABLE";
  minRank:0;maxRank:number;actualRank?:number;previousOrdinaryRank?:number;
  ordinaryCount:number;carrierCount:number;collisionLocations:RankLocation[];
  unavailable:boolean;truncated:boolean;
}

export interface CatalogueDiagnostic {
  constraint:"ORDER_SET"|"ORDER_SUBSEQUENCE";
  catalogueCount:number;emittedCount:number;ordinaryCount:number;
  missingFields?:string[];extraFields?:string[];
  ordinaryCatalogueCodes?:number[];ordinaryChangeCodes?:number[];firstMismatchIndex?:number;
}
/** Only fixed own data slots and bounded finite transport controls are observable. */
export function projectCatalogueDiagnostic(raw:unknown):CatalogueDiagnostic|undefined {
 try {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return;
  const read=(object:object,key:string)=>{const descriptor=Object.getOwnPropertyDescriptor(object,key);return descriptor&&Object.hasOwn(descriptor,"value")?descriptor.value:undefined;};
  const count=(value:unknown):value is number=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0&&value<=13;
  const constraint=read(raw,"constraint");if(constraint!=="ORDER_SET"&&constraint!=="ORDER_SUBSEQUENCE")return;
  const catalogueCount=read(raw,"catalogueCount"),emittedCount=read(raw,"emittedCount"),ordinaryCount=read(raw,"ordinaryCount");if(!count(catalogueCount)||!count(emittedCount)||!count(ordinaryCount))return;
  const list=(key:string,code:boolean):Array<string|number>|undefined=>{const value=read(raw,key);if(!Array.isArray(value))return;const length=read(value,"length");if(!count(length))return;const result:Array<string|number>=[];for(let index=0;index<length;index++){const item=read(value,String(index));if(code?typeof item!=="number"||!Number.isSafeInteger(item)||item<0||item>=13:typeof item!=="string"||!(CHANGE_ORDER_FIELDS_V3 as readonly string[]).includes(item))return;result.push(item);}return result;};
  const result:CatalogueDiagnostic={constraint,catalogueCount,emittedCount,ordinaryCount};
  if(constraint==="ORDER_SET"){const missingFields=list("missingFields",false),extraFields=list("extraFields",false);if(!missingFields||!extraFields)return;result.missingFields=missingFields as string[];result.extraFields=extraFields as string[];}
  else {const ordinaryCatalogueCodes=list("ordinaryCatalogueCodes",true),ordinaryChangeCodes=list("ordinaryChangeCodes",true),firstMismatchIndex=read(raw,"firstMismatchIndex");if(!ordinaryCatalogueCodes||!ordinaryChangeCodes||!count(firstMismatchIndex)||firstMismatchIndex>=13)return;result.ordinaryCatalogueCodes=ordinaryCatalogueCodes as number[];result.ordinaryChangeCodes=ordinaryChangeCodes as number[];result.firstMismatchIndex=firstMismatchIndex;}
  return result;
 }catch{return;}
}

const keys = new Set("schemaVersion operationCode intent requestTarget dialogueAct continuation changes query uncertainties controlEvidence conversationDirective replyProposal field fieldCode operation value evidence primaryEvidence additionalEvidence additionalEvidenceJson kind calendar day month year leapMonth offsetDays weekday qualifier hour minute turn quote occurrence ref period statusScope date outputCalendar topic offset from through reason alternatives issue queryKind text".split(" "));
const rootKeys = new Set("schemaVersion operationCode intent requestTarget dialogueAct continuation changes query uncertainties controlEvidence conversationDirective replyProposal".split(" "));
for(const key of ["changeOrder","titleChange","reminderDateChange","reminderTimeChange","eventDateChange","eventTimeChange","eventRelationChange","frequencyChange","occurrenceCountChange","endDateChange","locationChange","index","rank","change"])keys.add(key);
for(const key of ["changeOrder","titleChange","reminderDateChange","reminderTimeChange","eventDateChange","eventTimeChange","eventRelationChange","frequencyChange","occurrenceCountChange","endDateChange","locationChange"])rootKeys.add(key);
// Trusted provider-envelope paths only; values and unknown keys stay redacted.
for (const key of ["choices", "message", "content", "finish_reason", "tool_calls", "function_call"]) keys.add(key);
const types = new Set(["string", "number", "boolean", "null", "undefined", "array", "object", "int"]);
export interface EvidencePointerDiagnostic {
  reason:"SOURCE_CODE_INVALID"|"STRICT_USER_QUOTE"|"POINTER_SHAPE"|"INPUT_MISSING"|"TURN_INVALID"|"SOURCE_MISSING"|"SOURCE_ROLE"|"SOURCE_TEXT_INVALID"|"SEGMENT_INVALID"|"SEGMENT_SOURCE_UNAVAILABLE"|"SEGMENT_MISSING"|"SEGMENT_EMPTY"|"SEGMENT_OCCURRENCE_MISSING"|"EXPANDED_REF_INVALID";
  pointerKind:"USER_QUOTE"|"USER_TURN"|"USER_SEGMENT"|"CONTEXT_FACT"|"UNKNOWN";
  pointerKindType:string;pointerKindDigest?:string;pointerKindLength?:number;
  requestedTurn?:number;requestedSegment?:number;
  sourceRole:"USER"|"ASSISTANT"|"MISSING"|"UNKNOWN";unknownKeyCount:number;unknownKeyCountTruncated:boolean;
}
export interface SmallTableDiagnostic {
  location?:"PADDED_OPERAND"|"PERIOD_UNSUPPORTED_KIND"|"NON_PERIOD_ALTERNATIVE"|"NON_DATE_VALUE"|"NON_CLOCK_VALUE"|"QUERY_DATE"|"QUERY_PERIOD";
  reason:"GENERATION_SHAPE_INVALID"|"INVALID_TABLE_VALUE"|"TABLE_REFERENCE_INVALID"|"TABLE_CAPACITY_EXCEEDED"|"UNUSED_TABLE_ROWS"|"COLLECTION_CARDINALITY_INVALID"|"EVIDENCE_CARDINALITY_INVALID"|"INACTIVE_VALUE_NON_NULL"|"CHANGE_ORDER_INVALID"|"CHANGE_VALUE_INVALID";
  table?:"texts"|"integers"|"dates"|"clocks"|"periods";
}
export interface CanonicalValidationIssue {
  typedDecoder?:{stage:"SCHEMA"|"PERIOD"|"INDEXED_CHANGES"|"EVIDENCE"|"UNCERTAINTIES"|"CANONICAL_CODEC"|"INTERPRETATION";reason:"WIRE_SHAPE_INVALID"|"EVIDENCE_POINTER_INVALID"|"INTERNAL_FAILURE"};
  smallTables?:SmallTableDiagnostic;
  path: Array<string | number>; code: string; expected?: string; actualType: string;
  classification: "missing" | "extra" | "value"; unknownPathSegments: number; extraKeyCount?: number;
  constraint?: "ARRAY_CARDINALITY" | "CONTROL_ENUM"; actualCount?: number; minItems?: number; maxItems?: number;
  acceptedDomainId?: string; acceptedValueCount?: number; actualSafeToken?: string; actualDigest?: string; actualLength?: number;
  constraintId?: CanonicalConstraintId; participatingFields?: string[]; expectedCategory?: string; actualCategory?: string;
  ownershipState?: OwnershipControlState;
  embeddedJsonType?: "object" | "array" | "null" | "string" | "number" | "boolean" | "INVALID_JSON" | "OVERSIZED";
  titleOwnership?: {ordinaryCount:number;carrierOperation:ReturnType<typeof projectControlEnum>;ordinaryOperations:Array<{index:number}&ReturnType<typeof projectControlEnum>>;truncated:boolean};
  /** Counts describe only the first 64 observed entries, not unseen payload. */
  duplicateFieldCounts?: Array<{field:string;count:number;indexes:number[]}>;
  duplicateFieldCountsTruncated?: boolean;
  evidencePointer?:EvidencePointerDiagnostic;
  catalogue?:CatalogueDiagnostic;
  rankControl?:RankControlDiagnostic;
  dateOperand?:DateOperandDiagnostic;
  singletonJson?:SingletonJsonDiagnostic;
  uncertaintyShape?:UncertaintyWireShape;
  /** carrierCount counts observed non-null object roots, not validated changes. */
  carrierPosition?: {reason:"NON_INTEGER"|"NEGATIVE"|"COLLISION"|"OUT_OF_RANGE"|"UNCLASSIFIED";actualIndex?:number;ordinaryCount:number;carrierCount:number;combinedCount:number;minIndex:0;maxIndex:number;collisionRoots:string[]};
}
/** Decoder-owned finite refusal controls; no authored JSON or key names. */
export interface SingletonJsonDiagnostic {
  stage:"WIRE_VALUE"|"JSON_PARSE"|"JSON_SCAN"|"TYPED_PREDICATE"|"TYPED_PROJECTION";
  reason:"WRONG_WIRE_TYPE"|"OVERSIZED"|"INVALID_JSON"|"NON_OBJECT"|"DUPLICATE_KEY"|"DEPTH_LIMIT"|"NODE_LIMIT"|"SCAN_INVALID"|"INVALID_TYPED_ROOT"|"PROJECTION_UNAVAILABLE";
}
export interface UncertaintyWireShape {
  index:number;itemType:string;keys:string[];unavailable:boolean;
  requiredKeys:Record<"fieldCode"|"reason"|"alternatives","MISSING"|"DATA"|"ACCESSOR">;
  fieldCodeType:string;fieldType:string;reasonType:string;alternativesType:string;
  fieldCode?:number;field?:string;reason?:string;fieldDigest?:string;reasonDigest?:string;fieldCodeDigest?:string;
  alternativeCount?:number;unknownKeyCount:number;unknownKeyCountTruncated:boolean;
}
/** Trusted immutable codebook supplied by the decoder; inspect only own
 * descriptors and finite controls, never alternatives' contents or getters. */
export function projectUncertaintyWireShape(raw:unknown,path:PropertyKey[],domain:ReadonlyMap<number,string>):UncertaintyWireShape|undefined {
  const index=path[1];if(path[0]!=="uncertainties"||typeof index!=="number"||!Number.isSafeInteger(index)||index<0||index>3)return;
  const result:UncertaintyWireShape={index,itemType:"undefined",keys:[],unavailable:false,requiredKeys:{fieldCode:"MISSING",reason:"MISSING",alternatives:"MISSING"},fieldCodeType:"undefined",fieldType:"undefined",reasonType:"undefined",alternativesType:"undefined",unknownKeyCount:0,unknownKeyCountTruncated:false};
  try{
    const read=(object:unknown,key:PropertyKey)=>object&&typeof object==="object"?Object.getOwnPropertyDescriptor(object,key):undefined;
    const array=read(raw,"uncertainties")?.value,item=read(array,String(index))?.value;
    result.itemType=jsonType(item);if(!item||typeof item!=="object"||Array.isArray(item))return result;
    const allowed=["fieldCode","reason","alternatives","field"];
    const names=Object.getOwnPropertyNames(item);
    result.unknownKeyCount=names.slice(0,64).filter(key=>!allowed.includes(key)).length;result.unknownKeyCountTruncated=names.length>64;
    const descriptors=Object.fromEntries(allowed.map(key=>[key,read(item,key)]));
    result.keys=allowed.filter(key=>descriptors[key]!==undefined);
    for(const key of ["fieldCode","reason","alternatives"] as const){const descriptor=descriptors[key];result.requiredKeys[key]=!descriptor?"MISSING":Object.hasOwn(descriptor,"value")?"DATA":"ACCESSOR";}
    const code=descriptors.fieldCode?.value,field=descriptors.field?.value,reason=descriptors.reason?.value,alternatives=descriptors.alternatives?.value;
    result.fieldCodeType=jsonType(code);result.fieldType=jsonType(field);result.reasonType=jsonType(reason);result.alternativesType=jsonType(alternatives);
    const knownField=(value:unknown)=>typeof value==="string"&&UncertaintyV3Schema.options.some(branch=>branch.shape.field.safeParse(value).success);
    if(typeof code==="number"&&Number.isSafeInteger(code)&&domain.has(code)&&knownField(domain.get(code)))result.fieldCode=code;
    if(knownField(field))result.field=field;
    if(typeof reason==="string"&&["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"].includes(reason))result.reason=reason;
    for(const [value,key,known] of [[code,"fieldCodeDigest",result.fieldCode!==undefined],[field,"fieldDigest",result.field!==undefined],[reason,"reasonDigest",result.reason!==undefined]] as const){if(!known&&typeof value==="string"&&value.length<=32768)result[key]=createHash("sha256").update(value).digest("hex");}
    if(Array.isArray(alternatives)){const length=read(alternatives,"length")?.value;if(typeof length==="number"&&Number.isSafeInteger(length)&&length>=0)result.alternativeCount=length;}
  }catch{result.unavailable=true;result.unknownKeyCountTruncated=true;}
  return result;
}
export interface DateOperandDiagnostic {
  stage:"WIRE_VALUE"|"JSON_PARSE"|"CANONICAL_OPERAND";
  reason:"WRONG_WIRE_TYPE"|"OVERSIZED"|"INVALID_JSON"|"UNKNOWN_KIND"|"INVALID_OPERAND";
  field?:"eventDate"|"reminderDate"|"endDate";
  kind:"CIVIL_DATE"|"RELATIVE_DAY"|"WEEKDAY"|"UNKNOWN";
  actualType:string;unknownKeyCount:number;unknownKeyCountTruncated:boolean;
  issueCode?:string;
}
/** Fixed keys and own data descriptors only: no values, unknown key names,
 * accessors or source strings are exposed or evaluated. */
export function projectDateOperandFailure(value:unknown,stage:DateOperandDiagnostic["stage"],reason:DateOperandDiagnostic["reason"],field?:DateOperandDiagnostic["field"],issueCode?:string):DateOperandDiagnostic {
  const object=value&&typeof value==="object"&&!Array.isArray(value)?value:undefined;
  const tag=object?Object.getOwnPropertyDescriptor(object,"kind")?.value:undefined;
  const kind:DateOperandDiagnostic["kind"]=tag==="CIVIL_DATE"||tag==="RELATIVE_DAY"||tag==="WEEKDAY"?tag:"UNKNOWN";
  const allowed=kind==="CIVIL_DATE"?["kind","calendar","day","month","year","leapMonth"]:kind==="RELATIVE_DAY"?["kind","offsetDays"]:kind==="WEEKDAY"?["kind","weekday","qualifier"]:["kind"];
  const count=object?Object.getOwnPropertyNames(object).filter(key=>!allowed.includes(key)).length:0;
  return {stage,reason,...(field?{field}:{}),kind,actualType:jsonType(value),unknownKeyCount:Math.min(count,64),unknownKeyCountTruncated:count>64,
    ...(["invalid_type","too_small","too_big","unrecognized_keys","invalid_value","invalid_union","custom"].includes(issueCode??"")?{issueCode}: {})};
}
/** Inspect only eight fixed transport roots and index scalars; never changes'
 * values/evidence, unknown fields, or authored change operands. */
function carrierPositionStructure(raw:unknown,path:PropertyKey[]):CanonicalValidationIssue["carrierPosition"]|undefined {
  const roots=["titleChange","reminderDateChange","reminderTimeChange","eventDateChange","eventTimeChange","eventRelationChange","frequencyChange","occurrenceCountChange","endDateChange","locationChange"] as const;
  if(path.length!==2||path[1]!=="index"||!roots.some(root=>root===path[0])||!raw||typeof raw!=="object"||Array.isArray(raw))return;
  const read=(object:object,key:PropertyKey):unknown=>Object.getOwnPropertyDescriptor(object,key)?.value;
  const changes=read(raw,"changes");if(!Array.isArray(changes))return;
  const records=roots.map(root=>{const carrier=read(raw,root);return {root,present:!!carrier&&typeof carrier==="object"&&!Array.isArray(carrier),index:carrier&&typeof carrier==="object"&&!Array.isArray(carrier)?read(carrier,"index"):undefined};});
  const selected=records.find(record=>record.root===path[0])!;
  const index=selected.index,carrierCount=records.filter(record=>record.present).length,ordinaryCount=changes.length,combinedCount=ordinaryCount+carrierCount;
  const collisionRoots=typeof index==="number"&&Number.isInteger(index)?records.slice(0,records.indexOf(selected)).filter(record=>record.present&&record.index===index).map(record=>record.root):[];
  const reason=typeof index!=="number"||!Number.isInteger(index)?"NON_INTEGER":index<0?"NEGATIVE":collisionRoots.length?"COLLISION":index>=combinedCount?"OUT_OF_RANGE":"UNCLASSIFIED";
  return {reason,...(typeof index==="number"&&Number.isSafeInteger(index)?{actualIndex:index}:{}),ordinaryCount,carrierCount,combinedCount,minIndex:0,maxIndex:combinedCount-1,collisionRoots};
}
function duplicateChangeStructure(raw:unknown):Pick<CanonicalValidationIssue,"duplicateFieldCounts"|"duplicateFieldCountsTruncated"> {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return {};
  const changes:unknown=Object.getOwnPropertyDescriptor(raw,"changes")?.value;
  if(!Array.isArray(changes))return {};
  const fields=new Map<string,{field:string;count:number;indexes:number[]}>();
  let truncated=changes.length>64;
  for(let index=0;index<Math.min(changes.length,64);index++){
    const change:unknown=Object.getOwnPropertyDescriptor(changes,String(index))?.value;
    if(!change||typeof change!=="object"||Array.isArray(change))continue;
    const field:unknown=Object.getOwnPropertyDescriptor(change,"field")?.value;
    if(typeof field!=="string"||!FieldChangeV3Schema.options.some(branch=>branch.shape.field.safeParse(field).success))continue;
    let entry=fields.get(field);
    if(!entry){if(fields.size>=13){truncated=true;continue;}entry={field,count:0,indexes:[]};fields.set(field,entry);}
    entry.count++;if(entry.indexes.length<8)entry.indexes.push(index);else truncated=true;
  }
  return {duplicateFieldCounts:[...fields.values()].filter(entry=>entry.count>1),duplicateFieldCountsTruncated:truncated};
}
/** Only the decoder's trusted finite domains may call this projector. Never
 * infer control authority from an arbitrary string's shape. */
export function projectControlEnum(domain: readonly unknown[], actual: unknown): Pick<CanonicalValidationIssue, "constraint" | "acceptedDomainId" | "acceptedValueCount" | "actualSafeToken" | "actualDigest" | "actualLength" | "actualType" | "classification"> {
  const values = [...new Set(domain.map(value => JSON.stringify(value)))].sort();
  return { constraint: "CONTROL_ENUM", acceptedDomainId: `CONTROL_DOMAIN_SHA256:${createHash("sha256").update(JSON.stringify(values)).digest("hex")}`, acceptedValueCount: values.length, actualType: jsonType(actual), classification: actual === undefined ? "missing" : "value",
    ...(typeof actual === "string" ? { actualLength: actual.length, actualDigest: createHash("sha256").update(actual, "utf8").digest("hex"),
      ...(/^[A-Za-z0-9_:.\-]{1,48}$/.test(actual) ? { actualSafeToken: actual } : {}) } : {}) };
}
export interface CanonicalValidationDiagnostics {
  schemaVersion: "calenote-context-2" | "calenote-context-3"; issues: CanonicalValidationIssue[];
  topLevelKeys: string[]; unknownTopLevelKeyCount: number; truncated: boolean;
  uncertaintyAlternatives?: AlternativeStructure[];
  uncertaintyAlternativesTruncated?: boolean;
}
export interface AlternativeStructure {
  uncertaintyIndex:number;alternativeIndex:number;field:string;fieldCode?:number;reason:string;
  fieldType:string;reasonType:string;fieldDigest?:string;reasonDigest?:string;
  alternativeType:string;valueType:string;evidenceType:string;alternativeKeys:string[];evidenceKeys:string[];
  /** Unknown counts cover only the first64 own names when truncated. */
  alternativeUnknownKeyCount:number;alternativeUnknownKeyCountTruncated:boolean;evidenceUnknownKeyCount:number;evidenceUnknownKeyCountTruncated:boolean;
}
/** Observed decoded structure only, never union-branch literals or values.
 * Fixed 4x2 entries and own data descriptors keep accessor inputs inert. */
function alternativeStructure(raw:unknown):Pick<CanonicalValidationDiagnostics,"uncertaintyAlternatives"|"uncertaintyAlternativesTruncated"> {
  const read=(object:unknown,key:PropertyKey):unknown=>{try{return object&&typeof object==="object"?Object.getOwnPropertyDescriptor(object,key)?.value:undefined;}catch{return undefined;}};
  const membership=(object:unknown,allowed:readonly string[])=>{
    try{
      const names=object&&typeof object==="object"&&!Array.isArray(object)?Object.getOwnPropertyNames(object):[];
      const count=names.slice(0,64).filter(name=>!allowed.includes(name)).length;
      return {keys:allowed.filter(key=>object&&typeof object==="object"&&Object.getOwnPropertyDescriptor(object,key)!==undefined),count,truncated:names.length>64};
    }catch{return {keys:[],count:0,truncated:true};}
  };
  const uncertainties=read(raw,"uncertainties");if(!Array.isArray(uncertainties))return {};
  const fields=["title","location","notes","eventDate","eventTime","reminderDate","reminderTime","calendar","frequency","occurrenceCount","eventRelation","leadOffsetDays","endDate","intent","queryRange","operation"];
  const records:AlternativeStructure[]=[];let truncated=uncertainties.length>4;
  for(let i=0;i<Math.min(4,uncertainties.length);i++){
    const uncertainty=read(uncertainties,String(i)),field=read(uncertainty,"field"),reason=read(uncertainty,"reason"),alternatives=read(uncertainty,"alternatives");
    if(!Array.isArray(alternatives))continue;
    truncated ||= alternatives.length>2;
    const knownField=typeof field==="string"&&UncertaintyV3Schema.options.some(branch=>branch.shape.field.safeParse(field).success);
    const knownReason=typeof reason==="string"&&["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"].includes(reason);
    for(let j=0;j<Math.min(2,alternatives.length);j++){
      const alternative=read(alternatives,String(j)),evidence=read(alternative,"evidence"),a=membership(alternative,["value","evidence"]),e=membership(evidence,["primaryEvidence","additionalEvidenceJson"]);
      records.push({uncertaintyIndex:i,alternativeIndex:j,field:knownField?field:"UNKNOWN",...(knownField?{fieldCode:fields.indexOf(field)}:{}),reason:knownReason?reason:"UNKNOWN",fieldType:jsonType(field),reasonType:jsonType(reason),
        ...(!knownField&&typeof field==="string"&&field.length<=32768?{fieldDigest:createHash("sha256").update(field).digest("hex")}:{}),...(!knownReason&&typeof reason==="string"&&reason.length<=32768?{reasonDigest:createHash("sha256").update(reason).digest("hex")}:{}),
        alternativeType:jsonType(alternative),valueType:jsonType(read(alternative,"value")),evidenceType:jsonType(evidence),alternativeKeys:a.keys,evidenceKeys:e.keys,alternativeUnknownKeyCount:a.count,alternativeUnknownKeyCountTruncated:a.truncated,evidenceUnknownKeyCount:e.count,evidenceUnknownKeyCountTruncated:e.truncated});
    }
  }
  return records.length||truncated?{uncertaintyAlternatives:records,uncertaintyAlternativesTruncated:truncated}:{};
}
const jsonType = (value: unknown) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "object" ? "object" : types.has(typeof value) ? typeof value : "non_json";
/** Fixed own DATA rank controls only; never change operands, evidence or unknown names. */
function rankControlStructure(raw:unknown,path:PropertyKey[]):RankControlDiagnostic|undefined {
  const bound=CHANGE_ORDER_FIELDS_V3.length;
  const ordinary=path.length===3&&path[0]==="changes"&&typeof path[1]==="number"&&Number.isSafeInteger(path[1])&&path[1]>=0&&path[1]<bound&&path[2]==="rank";
  const carrier=path.length===2&&rankCarrierRoots.some(root=>root===path[0])&&path[1]==="rank";
  if(!ordinary&&!carrier)return;
  const result:RankControlDiagnostic={reason:"UNAVAILABLE",minRank:0,maxRank:bound-1,ordinaryCount:0,carrierCount:0,collisionLocations:[],unavailable:false,truncated:false};
  try{
    const data=(object:unknown,key:PropertyKey):unknown=>{if(!object||typeof object!=="object")throw Error();const descriptor=Object.getOwnPropertyDescriptor(object,key);if(!descriptor||!Object.hasOwn(descriptor,"value"))throw Error();return descriptor.value;};
    if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error();
    const changes=data(raw,"changes");if(!Array.isArray(changes))throw Error();
    const length=data(changes,"length");if(typeof length!=="number"||!Number.isSafeInteger(length)||length<0)throw Error();
    result.ordinaryCount=Math.min(length,bound);result.truncated=length>bound;
    const entries:Array<{location:RankLocation;rank:unknown}>=[];
    const add=(wrapper:unknown,location:RankLocation)=>{if(!wrapper||typeof wrapper!=="object"||Array.isArray(wrapper))throw Error();entries.push({location,rank:data(wrapper,"rank")});};
    for(let index=0;index<result.ordinaryCount;index++)add(data(changes,String(index)),{root:"changes",index});
    for(const root of rankCarrierRoots){const wrapper=data(raw,root);if(wrapper!==null){if(wrapper&&typeof wrapper==="object"&&!Array.isArray(wrapper))result.carrierCount++;add(wrapper,{root});}}
    const selected=entries.findIndex(entry=>ordinary?entry.location.root==="changes"&&entry.location.index===path[1]:entry.location.root===path[0]);
    if(selected<0||result.truncated)throw Error();
    const rank=decodeAuthoredChangeRank(entries[selected].rank);
    if(rank!==undefined)result.actualRank=rank;
    // Prior rank failures would have stopped the decoder before this path.
    const prior=entries.slice(0,selected);
    const seen=new Set<number>();let previousOrdinary=-1;
    for(const entry of prior){const ordinal=decodeAuthoredChangeRank(entry.rank);if(ordinal===undefined||seen.has(ordinal))throw Error();if(entry.location.root==="changes"){if(ordinal<=previousOrdinary)throw Error();previousOrdinary=ordinal;}seen.add(ordinal);}
    if(rank===undefined)result.reason="NON_INTEGER";
    else {
      result.collisionLocations=prior.filter(entry=>decodeAuthoredChangeRank(entry.rank)===rank).map(entry=>entry.location);
      if(result.collisionLocations.length)result.reason="COLLISION";
      else if(ordinary&&typeof path[1]==="number"&&path[1]>0){const previous=decodeAuthoredChangeRank(entries[selected-1].rank)!;result.previousOrdinaryRank=previous;if(rank<=previous)result.reason="NON_INCREASING";}
    }
    if(result.reason==="UNAVAILABLE")result.unavailable=true;
  }catch{result.reason="UNAVAILABLE";result.unavailable=true;result.collisionLocations=[];delete result.previousOrdinaryRank;}
  return result;
}
/** Zod issues are untrusted: never copy messages, inputs or unknown names.
 * Visit bounded issues/paths and schema-accepted duplicate field tags only,
 * never value, evidence or business-text trees. */
export function projectCanonicalValidation(raw: unknown, issues: readonly z.core.$ZodIssue[], schemaVersion: CanonicalValidationDiagnostics["schemaVersion"] = "calenote-context-2"): CanonicalValidationDiagnostics {
  const result: CanonicalValidationDiagnostics = { schemaVersion, issues: [], topLevelKeys: [], unknownTopLevelKeyCount: 0, truncated: false };
  if(schemaVersion==="calenote-context-3")Object.assign(result,alternativeStructure(raw));
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of Object.keys(raw)) {
      if (rootKeys.has(key)) result.topLevelKeys.push(key);
      else result.unknownTopLevelKeyCount++;
    }
  }
  let visited = 0;
  const visit = (list: readonly z.core.$ZodIssue[], depth: number, prefix: PropertyKey[] = []) => {
    for (const issue of list) {
      if (result.issues.length >= 24 || visited++ >= 128 || depth > 4) { result.truncated = true; return; }
      const fullPath = [...prefix, ...issue.path];
      const segments = fullPath.slice(0, 8); let value = raw, unknownPathSegments = 0;
      const path = segments.map(segment => {
        try{value=value&&typeof value==="object"?Object.getOwnPropertyDescriptor(value,segment)?.value:undefined;}catch{value=undefined;}
        if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0) return segment;
        if (typeof segment === "string" && keys.has(segment)) return segment;
        unknownPathSegments++; return "REDACTED";
      });
      if (fullPath.length > 8) result.truncated = true;
      result.issues.push({ path, code: issue.code, actualType: jsonType(value), unknownPathSegments,
        classification: issue.code === "unrecognized_keys" ? "extra" : value === undefined && issue.code === "invalid_type" ? "missing" : "value",
        ...(issue.code === "invalid_type" && types.has(issue.expected) ? { expected: issue.expected } : issue.code === "invalid_value" ? { expected: "CONTROL_ENUM" } : {}),
        ...(issue.code === "unrecognized_keys" ? { extraKeyCount: issue.keys.length } : {}),
        ...(issue.code === "custom" ? projectCanonicalConstraint(issue.params) : {}) });
      const projected=result.issues.at(-1)!;
      if(projected.constraintId==="DUPLICATE_CHANGE_FIELD"&&fullPath.length===0)Object.assign(projected,duplicateChangeStructure(raw));
      if (issue.code === "invalid_union") {
        // Prefer branches whose trusted control discriminants matched. Otherwise
        // the first text branch can consume the budget before a later date or
        // evidence branch exposes the actual structural failure.
        const rank = (branch: readonly z.core.$ZodIssue[]) => branch.filter(child => child.code === "invalid_value"
          && ["field", "operation", "kind"].includes(String(child.path.at(-1)))).length;
        for (const branch of [...issue.errors].sort((a, b) => rank(a) - rank(b))) { visit(branch, depth + 1, fullPath); if (result.truncated) break; }
      }
    }
  };
  visit(issues, 0); return result;
}
export function projectWireValidation(raw: unknown, path: PropertyKey[], expected: string, extraKeyCount?: number, schemaVersion: CanonicalValidationDiagnostics["schemaVersion"] = "calenote-context-2", cardinality?: { actualCount: number; minItems?: number; maxItems?: number }, control?: ReturnType<typeof projectControlEnum>): CanonicalValidationDiagnostics {
  const result = projectCanonicalValidation(raw, [{ code: "custom", path, message: "" }], schemaVersion);
  // These two trusted transport slots encode evidence JSON. Traverse the
  // bounded decoded structure only for type telemetry, never retain values.
  // Canonical projection and all acceptance predicates remain unchanged.
  let structural: unknown = raw, decodedBoundary = false;
  for (const segment of path.slice(0, 8)) {
    try{structural=structural&&typeof structural==="object"?Object.getOwnPropertyDescriptor(structural,segment)?.value:undefined;}catch{structural=undefined;}
    if ((segment === "primaryEvidence" || segment === "additionalEvidenceJson") && typeof structural === "string"
      && new TextEncoder().encode(structural).length <= 32768) {
      try { structural = JSON.parse(structural); decodedBoundary = true; } catch { /* Invalid JSON stays a string. */ }
    }
  }
  if (decodedBoundary) {
    result.issues[0].actualType = jsonType(structural);
    result.issues[0].classification = structural === undefined ? "missing" : "value";
  }
  result.issues[0].code = "WIRE_SHAPE_INVALID";
  if (["null", "string", "number", "integer", "boolean", "array", "object", "CONTROL_ENUM", "UNION", "REQUIRED_PROPERTY", "DATE_OPERAND_JSON", "UNIQUE_TITLE_OWNER", "TITLE_SET_CARRIER_REQUIRED", "UNIQUE_FIELD_OWNER", "FIELD_CARRIER_REQUIRED", "FIELD_CHANGE", "CHANGE_POSITION", "CHANGE_RANK", "BOUNDED_JSON_OBJECT", "JSON_OBJECT", "EVIDENCE_SOURCE_POINTER"].includes(expected)) result.issues[0].expected = expected;
  if (result.issues[0].actualType === "undefined") result.issues[0].classification = "missing";
  if (extraKeyCount !== undefined) { result.issues[0].classification = "extra"; result.issues[0].extraKeyCount = extraKeyCount; }
  if (result.issues[0].actualType === "array" && cardinality && [cardinality.actualCount, cardinality.minItems, cardinality.maxItems].every(value => value === undefined || Number.isSafeInteger(value) && value >= 0)) {
    result.issues[0].constraint = "ARRAY_CARDINALITY";
    result.issues[0].actualCount = cardinality.actualCount;
    if (cardinality.minItems !== undefined) result.issues[0].minItems = cardinality.minItems;
    if (cardinality.maxItems !== undefined) result.issues[0].maxItems = cardinality.maxItems;
  }
  if (expected === "CONTROL_ENUM" && control) Object.assign(result.issues[0], control);
  if(expected==="CHANGE_POSITION"){
    const position=carrierPositionStructure(raw,path);
    if(position)result.issues[0].carrierPosition=position;
  }
  if(expected==="CHANGE_RANK"){
    const rank=rankControlStructure(raw,path);
    if(rank)result.issues[0].rankControl=rank;
  }
  if(expected==="UNIQUE_TITLE_OWNER" && path.length===1 && path[0]==="titleChange" && raw && typeof raw==="object" && !Array.isArray(raw)){
    const object=raw as Record<string,unknown>,carrier=object.titleChange as {change?:{operation?:unknown}}|undefined;
    if(carrier && typeof carrier==="object" && Array.isArray(object.changes)){
      const domain=[...new Set(FieldChangeV3Schema.options.flatMap(branch=>{
        const operation=branch.shape.operation;
        return "options" in operation ? operation.options : [operation.value];
      }))];
      const operationMetadata=(value:unknown)=>{
        const projected=projectControlEnum(domain,value);
        if(!domain.some(member=>member===value))delete projected.actualSafeToken;
        return projected;
      };
      const operations:Array<{index:number}&ReturnType<typeof projectControlEnum>>=[];
      let ordinaryCount=0;
      for(const [index,entry] of object.changes.entries()){
        const wrapped=entry&&typeof entry==="object"?Object.getOwnPropertyDescriptor(entry,"change"):undefined;
        const change=wrapped&&Object.hasOwn(wrapped,"value")?wrapped.value:entry;
        if(change && typeof change==="object" && !Array.isArray(change) && Object.getOwnPropertyDescriptor(change,"field")?.value==="title"){
        ordinaryCount++;
        if(operations.length<8)operations.push({index,...operationMetadata(Object.getOwnPropertyDescriptor(change,"operation")?.value)});
        }
      }
      result.issues[0].titleOwnership={ordinaryCount,carrierOperation:operationMetadata(carrier.change?.operation),ordinaryOperations:operations,truncated:ordinaryCount>operations.length};
    }
  }
  // This carrier must be an object, never JSON-in-a-string. Inspect only the
  // rejected top-level requestTarget for bounded type telemetry; do not use
  // the parsed value for decoding, repair, semantic authority or acceptance.
  if (path.length === 1 && path[0] === "requestTarget" && expected === "object" && typeof structural === "string") {
    // Only exact members of the application-owned target control family are
    // safe to retain here. Never use arbitrary token shape to classify text.
    if (["CURRENT", "NEW", "UNRESOLVED"].includes(structural)) result.issues[0].actualSafeToken = structural;
    if (structural.length > 32768 || new TextEncoder().encode(structural).byteLength > 32768) result.issues[0].embeddedJsonType = "OVERSIZED";
    else {
      try { result.issues[0].embeddedJsonType = jsonType(JSON.parse(structural)) as NonNullable<CanonicalValidationIssue["embeddedJsonType"]>; }
      catch { result.issues[0].embeddedJsonType = "INVALID_JSON"; }
    }
  }
  return result;
}
