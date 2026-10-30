// @vitest-environment node
import {beforeAll,expect,it} from "vitest";
import {z} from "zod";
import {type ContextInput,ConversationInterpretationV3Schema} from "../../../conversation/context-contract/contracts";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import * as capability from "../../../conversation/context-contract/field-capability";
import {wire94RequestFixture,wire96RequestFixture} from "../../../../../tools/benchmark/context-singleton-json.test-support";
import {googleLiteEuContextWireSchemaV3,UNCERTAINTY_FIELD_WIRE_CODE_V1,decodeGoogleLiteEuContextTransportV3} from "./context-provider-wire";
import {encodeFixtureWire107Reference as encodeFixtureV3} from "../../../../../tools/benchmark/context-pointer-fixtures";
import {createContextContractProbe} from "../../../../../tools/benchmark/context-contract-probe";
import {frozenContextProposal} from "../../../../../tools/benchmark/context-contract-fixtures";
import regressions from "../../../conversation/context-contract/benchmark/regressions.json";
let initial:ContextInput,initialClockless:ContextInput,bound:ContextInput;
beforeAll(async()=>{
 for(const fixtureId of ["R02","R03"]){const script=regressions.cases.find(row=>row.id===fixtureId)!;
  const h=await createContextContractProbe({sourceSha:"1b91cfb945937d7e30c025a40a887ab908aeff27",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>{if(fixtureId==="R03")initial=structuredClone(input);if(fixtureId==="R02"&&index===1)initialClockless=structuredClone(input);if(fixtureId==="R02"&&index===2)bound=structuredClone(input);return frozenContextProposal(input,fixtureId,index-1);});
  try{for(const turn of script.turns.slice(0,fixtureId==="R02"?2:1))await h.turn(turn.text,turn.receipt);}finally{h.dispose();}
 }if(!initial||!initialClockless||!bound)throw Error("TEST_SOURCE_CONTEXT_MISSING");
});
function inline(root:unknown,node:unknown,seen:string[]=[]):unknown {
 if(!node||typeof node!=="object")return node;if(Array.isArray(node))return node.map(value=>inline(root,value,seen));const object=node as Record<string,unknown>;
 if(typeof object.$ref==="string"){const ref=object.$ref;if(Object.keys(object).length!==1||!ref.startsWith("#/")||seen.includes(ref))throw Error("TEST_REFERENCE_BINDING");const target=ref.slice(2).split("/").reduce<unknown>((value,key)=>(value as Record<string,unknown>)?.[key.replaceAll("~1","/").replaceAll("~0","~")],root);if(!target)throw Error("TEST_REFERENCE_MISSING");return inline(root,target,[...seen,ref]);}
 return Object.fromEntries(Object.entries(object).filter(([key])=>key!=="$defs").map(([key,value])=>[key,inline(root,value,seen)]));
}
const prior=wire94RequestFixture;
function validator(schema:ReturnType<typeof googleLiteEuContextWireSchemaV3>["schema"]){return z.fromJSONSchema(inline(schema,schema.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]);}
it.each(["initial-clock","initial-clockless","bound"])("whole %s source excludes offset candidates but preserves every admitted reason",kind=>{
 const input=kind==="initial-clock"?initial:kind==="initial-clockless"?initialClockless:bound,current=validator(wire96RequestFixture(input).response_format.json_schema.schema),old=validator(prior(input).response_format.json_schema.schema);
 for(const fieldCode of Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V1))for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])for(const count of [0,1,2]){
  const raw=[{fieldCode,reason,alternatives:Array(count).fill(JSON.stringify({value:2,evidence:{primaryEvidence:"unavailable",additionalEvidenceJson:"[]"}}))}];
  expect(current.safeParse(raw).success,`${kind}/${fieldCode}/${reason}/${count}`).toBe(fieldCode===UNCERTAINTY_FIELD_WIRE_CODE_V1.leadOffsetDays&&(count>0||reason==="MISSING")?false:old.safeParse(raw).success);
 }
});
it.each(["initial-clock","initial-clockless","bound"])("source-bound %s control remains exact without numeric enum support",kind=>{
 const input=kind==="initial-clock"?initial:kind==="initial-clockless"?initialClockless:bound,schema=googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(input),input).schema;
 const declared=validator(schema),stripped=inline(schema,schema.properties!.uncertainties);let fieldDomains=0;
 const check=(value:unknown):void=>{if(!value||typeof value!=="object")return;if(Array.isArray(value)){value.forEach(check);return;}const node=value as {properties?:{fieldCode?:{enum?:unknown;anyOf?:Array<{enum?:unknown;type?:unknown;minimum?:unknown;maximum?:unknown}>;type?:unknown;minimum?:unknown;maximum?:unknown}}};const field=node.properties?.fieldCode;if(field){fieldDomains++;expect(field.enum).toBeUndefined();for(const range of field.anyOf??[field]){expect(range.enum).toBeUndefined();expect(range.type).toBe("integer");expect(Number.isSafeInteger(range.minimum)).toBe(true);expect(Number.isSafeInteger(range.maximum)).toBe(true);}}Object.values(value).forEach(check);};check(stripped);expect(fieldDomains).toBeGreaterThan(0);
 const actual=z.fromJSONSchema(stripped as Parameters<typeof z.fromJSONSchema>[0]);
 for(const fieldCode of Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V1))for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])for(const count of [0,1,2]){const raw=[{fieldCode,reason,alternatives:Array(count).fill("{}")}];expect(actual.safeParse(raw).success,`${kind}/${fieldCode}/${reason}/${count}`).toBe(declared.safeParse(raw).success);}
});
it("independent, unknown and retained offset authority retains the previous whole candidate language",()=>{
 const independent=structuredClone(initial);independent.turns[0].text="Ngày 11/10 đi thi, nhắc một lần trước sự kiện 5 ngày lúc 8h.";
 const unknown=structuredClone(bound);unknown.turns[unknown.currentTurn].text="Có thể nhắc trước 2 hoặc 5 ngày.";
 const occupied=structuredClone(bound);occupied.activeRequest!.slots.leadOffsetDays={state:"RESOLVED",value:5,fact:"f999"};occupied.facts.push({...structuredClone(occupied.facts[0]),alias:"f999",scope:"REMINDER",field:"leadOffsetDays",value:5});
 const history=structuredClone(bound);history.turns[0].text=history.turns[0].text.replace(/\.$/u,", nhắc trước 5 ngày.");
 for(const input of [independent,unknown,occupied,history])expect(googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(input),input).schema).toEqual(prior(input).response_format.json_schema.schema);
});
it("direct consumer still parses valid numeric alternatives and refuses numeric strings without source repair",()=>{
 const baseline=ConversationInterpretationV3Schema.parse(frozenContextProposal(initial,"R03",0)),evidence=[{kind:"USER_QUOTE",turn:initial.currentTurn,quote:initial.turns[initial.currentTurn].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...baseline,uncertainties:[{field:"leadOffsetDays",reason:"AMBIGUOUS",alternatives:[{value:2,evidence}]}]}),wire=encodeFixtureV3(canonical,initial) as {uncertainties:Array<{alternatives:string[]}>};
 expect(decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,undefined,initial)).toMatchObject({status:"PARSED",value:{semantic:{uncertainties:canonical.uncertainties}}});
 const alternative=JSON.parse(wire.uncertainties[0].alternatives[0]);wire.uncertainties[0].alternatives[0]=JSON.stringify({...alternative,value:"2"});
 expect(decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,undefined,initial).status).toBe("REFUSED");
});
it("historical candidate bound restores without input or spy leakage",()=>{
 const before=JSON.stringify(bound),schema=googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(bound),bound).schema;expect(prior(bound).response_format.json_schema.schema).not.toEqual(schema);expect(JSON.stringify(bound)).toBe(before);expect(googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(bound),bound).schema).toEqual(schema);
});
