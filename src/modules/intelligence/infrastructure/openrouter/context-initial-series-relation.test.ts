// @vitest-environment node
import {beforeAll,expect,it} from "vitest";
import {z} from "zod";
import {type ContextInput,ConversationInterpretationV3Schema} from "../../../conversation/context-contract/contracts";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import * as capability from "../../../conversation/context-contract/field-capability";
import {wire93RequestFixture,wire94RequestFixture} from "../../../../../tools/benchmark/context-singleton-json.test-support";
import {googleLiteEuContextWireSchemaV3,UNCERTAINTY_FIELD_WIRE_CODE_V1,decodeGoogleLiteEuContextTransportV3} from "./context-provider-wire";
import {encodeFixtureV3} from "../../../../../tools/benchmark/context-pointer-fixtures";
import {createContextContractProbe} from "../../../../../tools/benchmark/context-contract-probe";
import {frozenContextProposal} from "../../../../../tools/benchmark/context-contract-fixtures";
import regressions from "../../../conversation/context-contract/benchmark/regressions.json";
let initial:ContextInput;
beforeAll(async()=>{
 const script=regressions.cases.find(row=>row.id==="R03")!;let captured:ContextInput|undefined;
 const h=await createContextContractProbe({sourceSha:"f4fb25ef276c44fb4fa248b7992ee0b1d2fa5e63",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>{captured=structuredClone(input);return frozenContextProposal(input,"R03",index-1);});
 try{await h.turn(script.turns[0].text,script.turns[0].receipt);if(!captured)throw Error("TEST_INITIAL_CONTEXT_MISSING");initial=captured;}finally{h.dispose();}
});
const excluded=(input:ContextInput)=>(capability as unknown as {isInitialFiniteSeriesWithoutRelationSource?:(input:ContextInput)=>boolean}).isInitialFiniteSeriesWithoutRelationSource?.(input)??false;
function inline(root:unknown,node:unknown,seen:string[]=[]):unknown {
 if(!node||typeof node!=="object")return node;if(Array.isArray(node))return node.map(value=>inline(root,value,seen));
 const object=node as Record<string,unknown>;
 if(typeof object.$ref==="string"){const ref=object.$ref;if(Object.keys(object).length!==1||!ref.startsWith("#/")||seen.includes(ref))throw Error("TEST_REFERENCE_BINDING");const target=ref.slice(2).split("/").reduce<unknown>((value,key)=>(value as Record<string,unknown>)?.[key.replaceAll("~1","/").replaceAll("~0","~")],root);if(!target)throw Error("TEST_REFERENCE_MISSING");return inline(root,target,[...seen,ref]);}
 return Object.fromEntries(Object.entries(object).filter(([key])=>key!=="$defs").map(([key,value])=>[key,inline(root,value,seen)]));
}
const prior=wire93RequestFixture;
function admits(input:ContextInput,fieldCode:number,reason:string){const schema=googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(input),input).schema;return z.fromJSONSchema(inline(schema,schema.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]).safeParse([{fieldCode,reason,alternatives:[]}]).success;}
it("actual initial source forbids both causally harmful optional missing markers",()=>{
 expect(excluded(initial)).toBe(true);
 for(const field of ["eventRelation","leadOffsetDays"] as const)expect(admits(initial,UNCERTAINTY_FIELD_WIRE_CODE_V1[field],"MISSING")).toBe(false);
});
it.each(["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.","Ngày 11/10 đi thi, nhắc 3 ngày liên tiếp lúc 9h."])("complete initial finite clock source is bounded: %s",text=>{const input=structuredClone(initial);input.turns[0].text=text;expect(excluded(input)).toBe(true);});
it.each(["Ngày 11/10 đi thi, nhắc hai ngày liên tiếp lúc 8h.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp trước sự kiện lúc 8h.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h, nhắc trước 5 ngày.","Ngày 11/10 đi thi, nhắc 31 ngày liên tiếp lúc 8h.","Ngày 11/10 đi thi, nhắc một lần lúc 8h.","Nếu ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.","Không ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.",'"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h."',"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h [CONTROL].","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h rồi đi khám."])("unknown, relation, independent offset, unsupported or control source retains prior language: %s",text=>{
 const input=structuredClone(initial);input.turns[0].text=text;expect(excluded(input)).toBe(false);
 expect(admits(input,UNCERTAINTY_FIELD_WIRE_CODE_V1.eventRelation,"MISSING")).toBe(true);
});
it("noninitial, occupied, invalid reference or unsupported capabilities never grant absence",()=>{
 for(const patch of [{currentTurn:1},{turns:[...initial.turns,{role:"ASSISTANT",text:"x"}]},{activeRequest:{}},{facts:[{alias:"f1",field:"eventRelation"}]},{pendingQuestion:{}},{ambiguities:[{}]},{reference:{...initial.reference,instant:"invalid"}},{capabilities:{...initial.capabilities,calendars:[]}},{capabilities:{...initial.capabilities,supported:[]}}])expect(excluded({...structuredClone(initial),...patch} as unknown as ContextInput)).toBe(false);
});
it("entire field/reason/count differential changes only the two proven missing pairs",()=>{
 const schema=wire94RequestFixture(initial).response_format.json_schema.schema,old=prior(initial).response_format.json_schema.schema;
 const current=z.fromJSONSchema(inline(schema,schema.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]),previous=z.fromJSONSchema(inline(old,old.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]);
 for(const fieldCode of Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V1))for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])for(const count of [0,1,2]){
  const raw=[{fieldCode,reason,alternatives:Array(count).fill("{}")}];
  expect(current.safeParse(raw).success,`${fieldCode}/${reason}/${count}`).toBe([UNCERTAINTY_FIELD_WIRE_CODE_V1.eventRelation,UNCERTAINTY_FIELD_WIRE_CODE_V1.leadOffsetDays].includes(fieldCode as 10|11)&&reason==="MISSING"?false:previous.safeParse(raw).success);
 }
});
it("historical constructor restores source predicate without mutating input",()=>{
 const before=JSON.stringify(initial),schema=googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(initial),initial).schema;
 expect(prior(initial).response_format.json_schema.schema).not.toEqual(schema);expect(JSON.stringify(initial)).toBe(before);
 expect(googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(initial),initial).schema).toEqual(schema);
});
it("only uncertainty producer grammar differs and direct singleton/combined-marker consumer acceptance is preserved",()=>{
 const current=structuredClone(googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(initial),initial).schema),old=structuredClone(prior(initial).response_format.json_schema.schema);
 delete current.properties!.uncertainties;delete old.properties!.uncertainties;expect(current).toEqual(old);
 const baseline=ConversationInterpretationV3Schema.parse(frozenContextProposal(initial,"R03",0));
 const evidence=[{kind:"USER_QUOTE",turn:initial.currentTurn,quote:initial.turns[initial.currentTurn].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...baseline,changes:[...baseline.changes,{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence}],uncertainties:[{field:"eventRelation",reason:"MISSING",alternatives:[]},{field:"leadOffsetDays",reason:"MISSING",alternatives:[]}]});
 const wire=encodeFixtureV3(canonical,initial);
 expect(decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,undefined,initial)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes,uncertainties:canonical.uncertainties}}});
});
