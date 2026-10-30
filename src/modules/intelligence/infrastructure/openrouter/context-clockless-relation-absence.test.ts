// @vitest-environment node
// Schema-wide historical comparisons undo wire105 transport only; actual
// producer membership and service/decoder assertions use current wire105.
import {beforeAll,expect,it} from "vitest";
import {z} from "zod";
import {type ContextInput,ConversationInterpretationV3Schema} from "../../../conversation/context-contract/contracts";
import * as capability from "../../../conversation/context-contract/field-capability";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import {wire104SchemaFixture,wire96RequestFixture,wire97RequestFixture} from "../../../../../tools/benchmark/context-singleton-json.test-support";
import {createContextContractProbe} from "../../../../../tools/benchmark/context-contract-probe";
import {frozenContextProposal} from "../../../../../tools/benchmark/context-contract-fixtures";
import {encodeFixtureWire107Reference as encodeFixtureV3} from "../../../../../tools/benchmark/context-pointer-fixtures";
import {googleLiteEuContextWireSchemaV3,decodeGoogleLiteEuContextTransportV3,UNCERTAINTY_FIELD_WIRE_CODE_V1} from "./context-provider-wire";
import regressions from "../../../conversation/context-contract/benchmark/regressions.json";
let initial:ContextInput;
beforeAll(async()=>{
 const script=regressions.cases.find(c=>c.id==="R02")!;
 const h=await createContextContractProbe({sourceSha:"58d7e2523a8e5b2c4080fe2833889e27a2e00115",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>{initial=structuredClone(input);return frozenContextProposal(input,"R02",index-1);});
 try{await h.turn(script.turns[0].text,script.turns[0].receipt);}finally{h.dispose();}
 if(!initial)throw Error("TEST_CONTEXT_MISSING");
});
function inline(root:unknown,node:unknown,seen:string[]=[]):unknown{
 if(!node||typeof node!=="object")return node;if(Array.isArray(node))return node.map(v=>inline(root,v,seen));const o=node as Record<string,unknown>;
 if(typeof o.$ref==="string"){const ref=o.$ref;if(!ref.startsWith("#/")||seen.includes(ref))throw Error("TEST_REF");return inline(root,ref.slice(2).split("/").reduce<unknown>((v,k)=>(v as Record<string,unknown>)[k],root),[...seen,ref]);}
 return Object.fromEntries(Object.entries(o).filter(([k])=>k!=="$defs").map(([k,v])=>[k,inline(root,v,seen)]));
}
const schema=(input:ContextInput)=>googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(input),input).schema;
it("whole actual clockless initial source proves optional relation absence without clock authority",()=>{
 expect(capability.isInitialExplicitReminderClockRequired(initial)).toBe(false);
 expect(capability.isInitialFiniteSeriesWithoutRelationSource(initial)).toBe(true);
 expect(capability.deriveGenerationFieldCapability(initial).allowedClockFields).not.toContain("reminderTime");
});
it("complete differential changes only relation MISSING and no non-uncertainty bytes",()=>{
 const current=wire97RequestFixture(initial).response_format.json_schema.schema,old=wire96RequestFixture(initial).response_format.json_schema.schema;
 const a=z.fromJSONSchema(inline(current,current.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]),b=z.fromJSONSchema(inline(old,old.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]);
 for(const fieldCode of Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V1))for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])for(const n of [0,1,2]){
  const value=[{fieldCode,reason,alternatives:Array(n).fill("{}")}];expect(a.safeParse(value).success,`${fieldCode}/${reason}/${n}`).toBe(fieldCode===10&&reason==="MISSING"?false:b.safeParse(value).success);
 }
 const ac=structuredClone(current),bc=structuredClone(old);delete ac.properties!.uncertainties;delete bc.properties!.uncertainties;expect(ac).toEqual(bc);
});
it.each(["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.","Ngày 11/10 đi thi, nhắc 3 ngày liên tiếp."])("complete clockless source %s retains supported cadence without requiring relation",text=>{
 const input=structuredClone(initial);input.turns[0].text=text;expect(capability.isInitialFiniteSeriesWithoutRelationSource(input)).toBe(true);
});
it.each(["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 25h.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc chưa rõ."])("absence proof never creates clock authority for %s",text=>{
 const input=structuredClone(initial);input.turns[0].text=text;const before=capability.deriveGenerationFieldCapability(input);capability.isInitialFiniteSeriesWithoutRelationSource(input);expect(capability.deriveGenerationFieldCapability(input)).toEqual(before);expect(capability.isInitialExplicitReminderClockRequired(input)).toBe(false);
 const current=wire104SchemaFixture(schema(input)),old=structuredClone(wire96RequestFixture(input).response_format.json_schema.schema);delete current.properties!.uncertainties;delete old.properties!.uncertainties;expect(current).toEqual(old);
});
it("independent relation/offset, unknown or occupied state keeps entire prior schema",()=>{
 for(const text of ["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp trước sự kiện.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc trước 5 ngày.","Nếu ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.","Ngày 11/10 đi thi, nhắc 31 ngày liên tiếp.","Ngày 11/10 đi thi, nhắc hai ngày liên tiếp."]){const input=structuredClone(initial);input.turns[0].text=text;expect(capability.isInitialFiniteSeriesWithoutRelationSource(input)).toBe(false);expect(wire104SchemaFixture(schema(input))).toEqual(wire96RequestFixture(input).response_format.json_schema.schema);}
 for(const patch of [{activeRequest:{}},{facts:[{alias:"f1",field:"eventRelation"}]},{pendingQuestion:{}},{ambiguities:[{}]},{currentTurn:1},{reference:{...initial.reference,instant:"invalid"}},{capabilities:{...initial.capabilities,calendars:[]}}])expect(capability.isInitialFiniteSeriesWithoutRelationSource({...structuredClone(initial),...patch} as unknown as ContextInput)).toBe(false);
});
it("direct combined marker consumer preserves existing parsing and input immutability",()=>{
 const before=JSON.stringify(initial),base=ConversationInterpretationV3Schema.parse(frozenContextProposal(initial,"R02",0));
 const proposal=ConversationInterpretationV3Schema.parse({...base,uncertainties:[{field:"eventRelation",reason:"MISSING",alternatives:[]},{field:"leadOffsetDays",reason:"MISSING",alternatives:[]}]});
 expect(decodeGoogleLiteEuContextTransportV3(encodeFixtureV3(proposal,initial),CONTEXT_PROTOCOL_V3,undefined,undefined,initial)).toMatchObject({status:"PARSED",value:{semantic:{uncertainties:proposal.uncertainties}}});
 expect(JSON.stringify(initial)).toBe(before);const current=schema(initial);wire96RequestFixture(initial);expect(schema(initial)).toEqual(current);
});

it.each([{fields:[]},{fields:["eventRelation"]},{fields:["leadOffsetDays"]},{fields:["eventRelation","leadOffsetDays"]}])("full initial R02 marker axis $fields preserves actual state propagation",async ({fields})=>{
 const script=regressions.cases.find(c=>c.id==="R02")!;
 const h=await createContextContractProbe({sourceSha:"58d7e2523a8e5b2c4080fe2833889e27a2e00115",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>{
  const proposal=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,"R02",index-1));
  return index===1?{...proposal,uncertainties:[{field:"reminderTime",reason:"MISSING",alternatives:[]},...fields.map(field=>({field,reason:"MISSING",alternatives:[]}))]}:proposal;
 });
 try{const rows=[];for(const turn of script.turns){const result=await h.turn(turn.text,turn.receipt);expect(result).toMatchObject({fullSchemaValid:true,listStoreReads:0,mutations:0});rows.push(result);}
  expect(rows[0].pendingField).toBe("reminderTime");
  expect(rows.at(-1)!.status).toBe(fields.includes("leadOffsetDays")?"CLARIFICATION_REQUESTED":"DRAFT_CREATED");
 }finally{h.dispose();}
});

it.each(["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 25h.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc chưa rõ."])("clock-axis whole field/reason/candidate differential remains bounded for %s",text=>{
 const input=structuredClone(initial);input.turns[0].text=text;
 const current=wire97RequestFixture(input).response_format.json_schema.schema,old=wire96RequestFixture(input).response_format.json_schema.schema;
 const a=z.fromJSONSchema(inline(current,current.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]),b=z.fromJSONSchema(inline(old,old.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]);
 for(const fieldCode of Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V1))for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])for(const n of [0,1,2]){
  const raw=[{fieldCode,reason,alternatives:Array(n).fill("{}")}];expect(a.safeParse(raw).success,`${fieldCode}/${reason}/${n}`).toBe(fieldCode===10&&reason==="MISSING"&&capability.isInitialFiniteSeriesWithoutRelationSource(input)?false:b.safeParse(raw).success);
 }
});
