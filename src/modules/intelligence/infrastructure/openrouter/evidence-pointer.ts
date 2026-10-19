import {ContextInputSchema,EvidenceRefSchema,type ContextInput} from "../../../conversation/context-contract/contracts";
import {CONTROL_PLACEHOLDER} from "../../../conversation/context-contract/projection";
import {projectControlEnum,type EvidencePointerDiagnostic} from "../../../conversation/context-contract/validation-diagnostics";
type Path=Array<string|number>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
export class EvidencePointerFailure extends Error {
 constructor(readonly path:Path,readonly diagnostic:EvidencePointerDiagnostic){super("EVIDENCE_POINTER_INVALID");}
}
export function projectEvidencePointerStructure(reason:EvidencePointerDiagnostic["reason"],value:unknown,input?:ContextInput):EvidencePointerDiagnostic {
 const read=(raw:unknown,key:string):unknown=>object(raw)?Object.getOwnPropertyDescriptor(raw,key)?.value:undefined;
 const kind=read(value,"kind"),turn=read(value,"turn"),segment=read(value,"segment");
 const domain=["USER_QUOTE","USER_TURN","USER_SEGMENT","CONTEXT_FACT"] as const;
 const known=domain.find(member=>member===kind),control=projectControlEnum(domain,kind);
 const source=typeof turn==="number"&&Number.isSafeInteger(turn)?input?.turns[turn]:undefined;
 const role=read(source,"role");
 let unknownKeyCount=0,unknownKeyCountTruncated=false;
 if(object(value))for(const key of Object.keys(value))if(!["kind","turn","segment"].includes(key)){
  if(unknownKeyCount===64){unknownKeyCountTruncated=true;break;}unknownKeyCount++;
 }
 return {reason,pointerKind:known??"UNKNOWN",pointerKindType:control.actualType,
  ...(!known&&control.actualDigest?{pointerKindDigest:control.actualDigest,pointerKindLength:control.actualLength}:{}),
  ...(typeof turn==="number"&&Number.isSafeInteger(turn)?{requestedTurn:turn}:{}),
  ...(typeof segment==="number"&&Number.isSafeInteger(segment)?{requestedSegment:segment}:{}),
  sourceRole:!source?"MISSING":role==="USER"||role==="ASSISTANT"?role:"UNKNOWN",
  unknownKeyCount,unknownKeyCountTruncated};
}
function segments(text:string){let start=0;return text.split(CONTROL_PLACEHOLDER).map((part,segment)=>{const result={segment,text:part,start};start+=part.length+CONTROL_PLACEHOLDER.length;return result;});}
/** Outbound source catalogue contains no new facts or authorizing state. */
export function evidenceSourceCatalogue(input:ContextInput){return input.turns.flatMap((turn,index)=>turn.role!=="USER"||!turn.text.includes(CONTROL_PLACEHOLDER)?[]:segments(turn.text).filter(s=>s.text.trim().length>0).map(s=>({kind:"USER_SEGMENT" as const,turn:index,segment:s.segment,text:s.text})));}
/** Generation availability only. Model still selects a pointer; existing scope,
 * source role, value fidelity and entailment validators remain authoritative. */
export function primaryEvidencePointerDomain(input:ContextInput):string[] {
 if(!ContextInputSchema.safeParse(input).success)throw Error("EVIDENCE_SOURCE_CONTEXT_INVALID");
 const whole=input.turns.flatMap((turn,index)=>turn.role==="USER"&&!turn.text.includes(CONTROL_PLACEHOLDER)&&turn.text.trim().length?[{kind:"USER_TURN" as const,turn:index}]:[]);
 const segmented=evidenceSourceCatalogue(input).map(({kind,turn,segment})=>({kind,turn,segment}));
 const facts=input.facts.map(fact=>({kind:"CONTEXT_FACT" as const,ref:fact.alias}));
 const domain=[...new Set([...whole,...segmented,...facts].map(pointer=>JSON.stringify(pointer)))];
 if(!domain.length)throw Error("EVIDENCE_SOURCE_DOMAIN_EMPTY");
 return domain;
}
export const PRIMARY_EVIDENCE_SOURCE_CODEBOOK_VERSION="primary-evidence-source-codebook-1" as const;
export function primaryEvidenceSourceCodebook(input:ContextInput) {
 const entries=primaryEvidencePointerDomain(input).map(pointerJson=>{
  const pointer=JSON.parse(pointerJson) as {kind:"USER_TURN"|"USER_SEGMENT"|"CONTEXT_FACT";turn?:number;segment?:number;ref?:string};
  const code=pointer.kind==="USER_TURN"?`U${pointer.turn}`:pointer.kind==="USER_SEGMENT"?`S${pointer.turn}.${pointer.segment}`:`F${pointer.ref}`;
  return Object.freeze({code,pointerJson,kind:pointer.kind,turn:pointer.turn});
 });
 const forward=new Map(entries.map(entry=>[entry.code,entry.pointerJson])),inverse=new Map(entries.map(entry=>[entry.pointerJson,entry.code]));
 if(forward.size!==entries.length||inverse.size!==entries.length)throw Error("EVIDENCE_SOURCE_CODE_COLLISION");
 return Object.freeze({entries:Object.freeze(entries),codes:Object.freeze(entries.map(entry=>entry.code)),currentCodes:Object.freeze(entries.filter(entry=>entry.kind!=="CONTEXT_FACT"&&entry.turn===input.currentTurn).map(entry=>entry.code)),
  decode:(code:unknown)=>typeof code==="string"?forward.get(code):undefined,
  encode:(pointerJson:string)=>{const code=inverse.get(pointerJson);if(code===undefined)throw Error("EVIDENCE_SOURCE_CODE_UNAVAILABLE");return code;}});
}
/** Exact request-bound lookup only; alternative values and extras are untouched. */
export function expandPrimaryEvidenceSourceCodes(raw:unknown,input:ContextInput):unknown {
 const book=primaryEvidenceSourceCodebook(input);
 const item=(value:unknown,path:Path):unknown=>{
  if(!object(value))return value;
  const evidence=Object.getOwnPropertyDescriptor(value,"evidence")?.value;
  if(!object(evidence))return value;
  const code=Object.getOwnPropertyDescriptor(evidence,"primaryEvidence")?.value;
  const pointer=book.decode(code);
  if(pointer===undefined)throw new EvidencePointerFailure([...path,"evidence","primaryEvidence"],projectEvidencePointerStructure("SOURCE_CODE_INVALID",{kind:code},input));
  return {...value,evidence:{...evidence,primaryEvidence:pointer}};
 };
 if(!object(raw))return raw;
 return {...raw,requestTarget:item(raw.requestTarget,["requestTarget"]),
  query:typeof raw.operationCode==="string"&&["3","4","5"].includes(raw.operationCode)?item(raw.query,["query"]):raw.query,
  changes:Array.isArray(raw.changes)?raw.changes.map((value,index)=>item(value,["changes",index])):raw.changes,
  uncertainties:Array.isArray(raw.uncertainties)?raw.uncertainties.map((issue,index)=>!object(issue)||!Array.isArray(issue.alternatives)?issue:{...issue,alternatives:issue.alternatives.map((text,position)=>{
   if(typeof text!=="string"||new TextEncoder().encode(text).byteLength>32768)return text;
   let parsed:unknown;try{parsed=JSON.parse(text);}catch{return text;}
   const expanded=item(parsed,["uncertainties",index,"alternatives",position]);
   return expanded===parsed?text:JSON.stringify(expanded);
  })}):raw.uncertainties};
}
/** Only explicit source pointers are expanded. No value search or repair. */
export function materializeProviderEvidence(raw:unknown,input?:ContextInput,strictPointers=false):unknown {
 const ref=(value:unknown,path:Path)=>materializeTypedEvidencePointer(value,path,input,strictPointers);
 const json=(value:unknown,path:Path,map:(v:unknown)=>unknown):unknown=>{
  if(typeof value!=="string"||new TextEncoder().encode(value).byteLength>32768)return value;
  let parsed:unknown;try{parsed=JSON.parse(value);}catch{return value;}
  const mapped=map(parsed);
  return mapped===parsed?value:JSON.stringify(mapped);
 };
 const refs=(value:unknown,path:Path):unknown=>Array.isArray(value)?value.map((v,i)=>ref(v,[...path,i])):value;
 const carrier=(value:unknown,path:Path):unknown=>{
  if(!object(value))return value;
  return {...value,primaryEvidence:json(value.primaryEvidence,[...path,"primaryEvidence"],v=>ref(v,[...path,"primaryEvidence"])),additionalEvidenceJson:json(value.additionalEvidenceJson,[...path,"additionalEvidenceJson"],v=>refs(v,[...path,"additionalEvidenceJson"]))};
 };
 const item=(value:unknown,path:Path):unknown=>object(value)&&Object.hasOwn(value,"evidence")?{...value,evidence:carrier(value.evidence,[...path,"evidence"])}:value;
 if(!object(raw))return raw;
 // Branch selection stays in the decoder. Do not inspect inactive query
 // padding or traverse arbitrary business/advisory strings.
 const query=typeof raw.operationCode==="string"&&["3","4","5"].includes(raw.operationCode)?item(raw.query,["query"]):raw.query;
 return {...raw,requestTarget:item(raw.requestTarget,["requestTarget"]),query,
  changes:Array.isArray(raw.changes)?raw.changes.map((v,i)=>item(v,["changes",i])):raw.changes,
  uncertainties:Array.isArray(raw.uncertainties)?raw.uncertainties.map((v,i)=>!object(v)||!Array.isArray(v.alternatives)?v:{...v,alternatives:v.alternatives.map((a,j)=>json(a,["uncertainties",i,"alternatives",j],parsed=>!object(parsed)||!Object.hasOwn(parsed,"evidence")?parsed:{...parsed,evidence:carrier(parsed.evidence,["uncertainties",i,"alternatives",j,"evidence"])}))}):raw.uncertainties};
}

export function materializeTypedEvidencePointer(value:unknown,path:Path,input:ContextInput|undefined,strictPointers=true):unknown {
  const fail:(reason:EvidencePointerDiagnostic["reason"])=>never=reason=>{throw new EvidencePointerFailure(path,projectEvidencePointerStructure(reason,value,input));};
  if(strictPointers&&object(value)&&value.kind==="USER_QUOTE")fail("STRICT_USER_QUOTE");
  if(!object(value)||!["USER_TURN","USER_SEGMENT"].includes(String(value.kind)))return value;
  const segmented=value.kind==="USER_SEGMENT";
  if(Object.keys(value).length!==(segmented?3:2)||!Object.hasOwn(value,"turn")||(segmented&&!Object.hasOwn(value,"segment")))fail("POINTER_SHAPE");
  if(!input)fail("INPUT_MISSING");
  if(typeof value.turn!=="number"||!Number.isSafeInteger(value.turn)||value.turn<0||value.turn>11)fail("TURN_INVALID");
  const source=input.turns[value.turn];
  if(!source)fail("SOURCE_MISSING");
  if(source.role!=="USER")fail("SOURCE_ROLE");
  if(!source.text.isWellFormed()||source.text!==source.text.normalize("NFC"))fail("SOURCE_TEXT_INVALID");
  let quote=source.text,occurrence=1;
  if(segmented){
   if(typeof value.segment!=="number"||!Number.isSafeInteger(value.segment)||value.segment<0)fail("SEGMENT_INVALID");
   if(!source.text.includes(CONTROL_PLACEHOLDER))fail("SEGMENT_SOURCE_UNAVAILABLE");
   const selected=segments(source.text)[value.segment];if(!selected)fail("SEGMENT_MISSING");
   if(!selected.text.trim().length)fail("SEGMENT_EMPTY");
   quote=selected.text;let count=0,offset=0,found=false;
   for(;;){const next=source.text.indexOf(quote,offset);if(next<0)break;count++;if(next===selected.start){found=true;break;}offset=next+quote.length;}
   if(!found)fail("SEGMENT_OCCURRENCE_MISSING");occurrence=count;
  }
  const expanded={kind:"USER_QUOTE",turn:value.turn,quote,occurrence};
  if(!EvidenceRefSchema.safeParse(expanded).success)fail("EXPANDED_REF_INVALID");
  return expanded;
 }
