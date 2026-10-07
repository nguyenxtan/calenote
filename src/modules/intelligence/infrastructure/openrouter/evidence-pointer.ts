import {EvidenceRefSchema,type ContextInput} from "../../../conversation/context-contract/contracts";
import {CONTROL_PLACEHOLDER} from "../../../conversation/context-contract/projection";
type Path=Array<string|number>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
export class EvidencePointerFailure extends Error {
 constructor(readonly path:Path){super("EVIDENCE_POINTER_INVALID");}
}
function segments(text:string){let start=0;return text.split(CONTROL_PLACEHOLDER).map((part,segment)=>{const result={segment,text:part,start};start+=part.length+CONTROL_PLACEHOLDER.length;return result;});}
/** Outbound source catalogue contains no new facts or authorizing state. */
export function evidenceSourceCatalogue(input:ContextInput){return input.turns.flatMap((turn,index)=>turn.role!=="USER"||!turn.text.includes(CONTROL_PLACEHOLDER)?[]:segments(turn.text).filter(s=>s.text.trim().length>0).map(s=>({kind:"USER_SEGMENT" as const,turn:index,segment:s.segment,text:s.text})));}
/** Only explicit source pointers are expanded. No value search or repair. */
export function materializeProviderEvidence(raw:unknown,input?:ContextInput,strictPointers=false):unknown {
 const ref=(value:unknown,path:Path):unknown=>{
  if(strictPointers&&object(value)&&value.kind==="USER_QUOTE")throw new EvidencePointerFailure(path);
  if(!object(value)||!["USER_TURN","USER_SEGMENT"].includes(String(value.kind)))return value;
  const segmented=value.kind==="USER_SEGMENT";
  if(Object.keys(value).length!==(segmented?3:2)||!Object.hasOwn(value,"turn")||(segmented&&!Object.hasOwn(value,"segment"))||!input||typeof value.turn!=="number"||!Number.isSafeInteger(value.turn)||value.turn<0||value.turn>11)throw new EvidencePointerFailure(path);
  const source=input.turns[value.turn];
  if(!source||source.role!=="USER"||!source.text.isWellFormed()||source.text!==source.text.normalize("NFC"))throw new EvidencePointerFailure(path);
  let quote=source.text,occurrence=1;
  if(segmented){
   if(typeof value.segment!=="number"||!Number.isSafeInteger(value.segment)||value.segment<0||!source.text.includes(CONTROL_PLACEHOLDER))throw new EvidencePointerFailure(path);
   const selected=segments(source.text)[value.segment];if(!selected||!selected.text.trim().length)throw new EvidencePointerFailure(path);
   quote=selected.text;let count=0,offset=0,found=false;
   for(;;){const next=source.text.indexOf(quote,offset);if(next<0)break;count++;if(next===selected.start){found=true;break;}offset=next+quote.length;}
   if(!found)throw new EvidencePointerFailure(path);occurrence=count;
  }
  const expanded={kind:"USER_QUOTE",turn:value.turn,quote,occurrence};
  if(!EvidenceRefSchema.safeParse(expanded).success)throw new EvidencePointerFailure(path);
  return expanded;
 };
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
  uncertainties:Array.isArray(raw.uncertainties)?raw.uncertainties.map((v,i)=>!object(v)||!Array.isArray(v.alternatives)?v:{...v,alternatives:v.alternatives.map((a,j)=>json(a,["uncertainties",i,"alternatives",j],parsed=>!object(parsed)||!Object.hasOwn(parsed,"evidence")?parsed:{...parsed,evidence:refs(parsed.evidence,["uncertainties",i,"alternatives",j,"evidence"])}))}):raw.uncertainties};
}
