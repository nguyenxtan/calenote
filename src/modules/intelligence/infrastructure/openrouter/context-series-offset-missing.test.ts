// @vitest-environment node
import {beforeAll,expect,it} from "vitest";
import {z} from "zod";
import {type ContextInput} from "../../../conversation/context-contract/contracts";
import * as capability from "../../../conversation/context-contract/field-capability";
import {googleLiteEuContextWireSchemaV3,UNCERTAINTY_FIELD_WIRE_CODE_V1} from "./context-provider-wire";
import {createContextContractProbe} from "../../../../../tools/benchmark/context-contract-probe";
import {frozenContextProposal} from "../../../../../tools/benchmark/context-contract-fixtures";
import regressions from "../../../conversation/context-contract/benchmark/regressions.json";
import {wire90RequestFixture} from "../../../../../tools/benchmark/context-singleton-json.test-support";
let bound:ContextInput;
beforeAll(async()=>{
 const script=regressions.cases.find(row=>row.id==="R02")!;let captured:ContextInput|undefined;
 const h=await createContextContractProbe({sourceSha:"becc62b21a2d8e10e4bffdbbf19c506b81280697",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>{if(index===2)captured=structuredClone(input);return frozenContextProposal(input,"R02",index-1);});
 try{for(const turn of script.turns.slice(0,2))await h.turn(turn.text,turn.receipt);if(!captured)throw Error("TEST_BOUND_CONTEXT_MISSING");bound=captured;}finally{h.dispose();}
});
const excluded=(input:ContextInput)=>(capability as unknown as {isBoundSeriesDistanceOffsetMissingExcluded?:(input:ContextInput)=>boolean}).isBoundSeriesDistanceOffsetMissingExcluded?.(input);
function inline(root:unknown,node:unknown,seen:string[]=[]):unknown {
 if(!node||typeof node!=="object")return node;if(Array.isArray(node))return node.map(value=>inline(root,value,seen));
 const object=node as Record<string,unknown>;
 if(typeof object.$ref==="string"){const ref=object.$ref;if(Object.keys(object).length!==1||!ref.startsWith("#/")||seen.includes(ref))throw Error("TEST_REFERENCE_BINDING");const target=ref.slice(2).split("/").reduce<unknown>((value,key)=>(value as Record<string,unknown>)?.[key.replaceAll("~1","/").replaceAll("~0","~")],root);if(!target)throw Error("TEST_REFERENCE_MISSING");return inline(root,target,[...seen,ref]);}
 return Object.fromEntries(Object.entries(object).filter(([key])=>key!=="$defs").map(([key,value])=>[key,inline(root,value,seen)]));
}
function admits(input:ContextInput,fieldCode:number,reason:string){const schema=googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(input),input).schema;return z.fromJSONSchema(inline(schema,schema.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]).safeParse([{fieldCode,reason,alternatives:[]}]).success;}
it("actual bound producer forbids the causally harmful missing-offset marker",()=>{expect(admits(bound,UNCERTAINTY_FIELD_WIRE_CODE_V1.leadOffsetDays,"MISSING")).toBe(false);});
it.each(["Nhắc trước 2 ngày.","Nhắc tôi trước hai ngày.","2 ngày trước."])("finite retained distance source excludes only missing independent offset: %s",text=>{
 const input=structuredClone(bound);input.turns[input.currentTurn].text=text;
 expect(excluded(input)).toBe(true);expect(admits(input,UNCERTAINTY_FIELD_WIRE_CODE_V1.leadOffsetDays,"MISSING")).toBe(false);
 for(const reason of ["AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])expect(admits(input,UNCERTAINTY_FIELD_WIRE_CODE_V1.leadOffsetDays,reason)).toBe(true);
});
it.each(["Nhắc trước 2 ngày.","Nhắc tôi trước hai ngày.","2 ngày trước."])("exact matched-count relation also excludes contradictory missing relation: %s",text=>{
 const input=structuredClone(bound);input.turns[input.currentTurn].text=text;
 expect(capability.isBoundSeriesDistanceRelationMissingExcluded(input)).toBe(true);
 expect(admits(input,UNCERTAINTY_FIELD_WIRE_CODE_V1.eventRelation,"MISSING")).toBe(false);
 for(const reason of ["AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])expect(admits(input,UNCERTAINTY_FIELD_WIRE_CODE_V1.eventRelation,reason)).toBe(true);
});
it.each(["Nhắc trước 3 ngày.","Nhắc trước 5 ngày.","Nếu nhắc trước 2 ngày.","Không nhắc trước 2 ngày.",'"Nhắc trước 2 ngày."',"Nhắc trước 2 ngày rồi đi khám.","Nhắc trước 2 ngày [CONTROL].","Nhắc trước bao nhiêu ngày?","8h."])("unknown, independent or clock source retains missing offset: %s",text=>{
 const input=structuredClone(bound);input.turns[input.currentTurn].text=text;expect(excluded(input)).toBe(false);expect(capability.isBoundSeriesDistanceRelationMissingExcluded(input)).toBe(false);expect(admits(input,UNCERTAINTY_FIELD_WIRE_CODE_V1.leadOffsetDays,"MISSING")).toBe(true);expect(admits(input,UNCERTAINTY_FIELD_WIRE_CODE_V1.eventRelation,"MISSING")).toBe(true);
});
it("unbound state and inconsistent retained facts grant no exclusion",()=>{
 const cases=[{activeRequest:null},{pendingQuestion:null},{pendingQuestion:{...bound.pendingQuestion!,field:"leadOffsetDays"}},{facts:undefined},{reference:{...bound.reference,instant:"invalid"}}];
 for(const patch of cases)expect(excluded({...structuredClone(bound),...patch} as unknown as ContextInput)).toBe(false);
 for(const field of ["frequency","occurrenceCount","eventDate"] as const){const input=structuredClone(bound);input.activeRequest!.slots[field].fact=null;expect(excluded(input)).toBe(false);}
});
it("independent offset in the retained whole USER source never loses its missing marker",()=>{
 const input=structuredClone(bound);input.turns[0].text=input.turns[0].text.replace(/\.$/u,", nhắc trước 5 ngày.");
 expect(excluded(input)).toBe(false);expect(admits(input,UNCERTAINTY_FIELD_WIRE_CODE_V1.leadOffsetDays,"MISSING")).toBe(true);
});
it("entire field/reason/alternative domain changes only at the proven bound-series missing pairs",()=>{
 const current=googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(bound),bound).schema;
 const prior=wire90RequestFixture(bound).response_format.json_schema.schema;
 const next=z.fromJSONSchema(inline(current,current.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]);
 const old=z.fromJSONSchema(inline(prior,(prior.properties!.uncertainties)) as Parameters<typeof z.fromJSONSchema>[0]);
 for(const fieldCode of Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V1))for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])for(const count of [0,1,2]){
  const raw=[{fieldCode,reason,alternatives:Array(count).fill("{}")}];
  expect(next.safeParse(raw).success,`${fieldCode}/${reason}/${count}`).toBe([UNCERTAINTY_FIELD_WIRE_CODE_V1.eventRelation,UNCERTAINTY_FIELD_WIRE_CODE_V1.leadOffsetDays].includes(fieldCode as 10|11)&&reason==="MISSING"?false:old.safeParse(raw).success);
 }
});
it("historical constructor never mutates input or leaks its scoped source inverse",()=>{
 const before=JSON.stringify(bound),current=googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(bound),bound).schema;
 const prior=wire90RequestFixture(bound).response_format.json_schema.schema;
 expect(prior).not.toEqual(current);expect(JSON.stringify(bound)).toBe(before);
 expect(googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(bound),bound).schema).toEqual(current);
});
it("duplicate or mismatched factual bindings and occupied offsets remain outside the exclusion",()=>{
 for(const field of ["frequency","occurrenceCount","eventDate"] as const){const duplicate=structuredClone(bound),alias=duplicate.activeRequest!.slots[field].fact;const fact=duplicate.facts.find(row=>row.alias===alias)!;duplicate.facts.push(structuredClone(fact));expect(excluded(duplicate)).toBe(false);
  const missing=structuredClone(bound);missing.facts=missing.facts.filter(row=>row.alias!==alias);expect(excluded(missing)).toBe(false);
 }
 const occupied=structuredClone(bound);occupied.activeRequest!.slots.leadOffsetDays={state:"PROPOSED",value:5,fact:null};expect(excluded(occupied)).toBe(false);
 const mismatch=structuredClone(bound);mismatch.activeRequest!.slots.occurrenceCount.value=3;expect(excluded(mismatch)).toBe(false);
});
