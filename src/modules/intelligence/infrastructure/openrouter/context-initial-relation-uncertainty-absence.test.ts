// @vitest-environment node
import {beforeAll,expect,it} from "vitest";
import {z} from "zod";
import {type ContextInput,ConversationInterpretationV3Schema} from "../../../conversation/context-contract/contracts";
import * as capability from "../../../conversation/context-contract/field-capability";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import {wire97RequestFixture,wire98RequestFixture} from "../../../../../tools/benchmark/context-singleton-json.test-support";
import {createContextContractProbe} from "../../../../../tools/benchmark/context-contract-probe";
import {frozenContextProposal} from "../../../../../tools/benchmark/context-contract-fixtures";
import {encodeFixtureWire107Reference as encodeFixtureV3} from "../../../../../tools/benchmark/context-pointer-fixtures";
import {googleLiteEuContextWireSchemaV3,decodeGoogleLiteEuContextTransportV3,UNCERTAINTY_FIELD_WIRE_CODE_V1} from "./context-provider-wire";
import regressions from "../../../conversation/context-contract/benchmark/regressions.json";
let clockless:ContextInput,clocked:ContextInput,bound:ContextInput;
beforeAll(async()=>{
 for(const id of ["R02","R03"]){const script=regressions.cases.find(c=>c.id===id)!;
  const h=await createContextContractProbe({sourceSha:"6695189b2c21e2a0b7beb1755b8e59240b202466",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>{if(id==="R03")clocked=structuredClone(input);else if(index===1)clockless=structuredClone(input);else bound=structuredClone(input);return frozenContextProposal(input,id,index-1);});
  try{for(const turn of script.turns.slice(0,id==="R02"?2:1))await h.turn(turn.text,turn.receipt);}finally{h.dispose();}
 }if(!clockless||!clocked||!bound)throw Error("TEST_CONTEXT_MISSING");
});
function inline(root:unknown,node:unknown,seen:string[]=[]):unknown{
 if(!node||typeof node!=="object")return node;if(Array.isArray(node))return node.map(v=>inline(root,v,seen));const o=node as Record<string,unknown>;
 if(typeof o.$ref==="string"){const ref=o.$ref;if(!ref.startsWith("#/")||seen.includes(ref))throw Error("TEST_REF");return inline(root,ref.slice(2).split("/").reduce<unknown>((v,k)=>(v as Record<string,unknown>)[k],root),[...seen,ref]);}
 return Object.fromEntries(Object.entries(o).filter(([k])=>k!=="$defs").map(([k,v])=>[k,inline(root,v,seen)]));
}
const schema=(input:ContextInput)=>googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(input),input).schema;
const validator=(s:ReturnType<typeof schema>)=>z.fromJSONSchema(inline(s,s.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]);
it.each(["clockless","clocked","unresolved-clock"])("whole %s source excludes only unsupported relation uncertainty language",kind=>{
 const input=structuredClone(kind==="clockless"?clockless:clocked);if(kind==="unresolved-clock")input.turns[0].text="Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc chưa rõ.";
 const current=wire98RequestFixture(input).response_format.json_schema.schema,old=wire97RequestFixture(input).response_format.json_schema.schema,a=validator(current),b=validator(old),absent=capability.isInitialRelationUncertaintyAbsent(input);
 if(kind!=="unresolved-clock")expect(absent).toBe(true);
 for(const fieldCode of Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V1))for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])for(const n of [0,1,2]){
  const raw=[{fieldCode,reason,alternatives:Array(n).fill("{}")}];expect(a.safeParse(raw).success,`${fieldCode}/${reason}/${n}`).toBe(fieldCode===10&&absent?false:b.safeParse(raw).success);
 }
 const ac=structuredClone(current),bc=structuredClone(old);delete ac.properties!.uncertainties;delete bc.properties!.uncertainties;expect(ac).toEqual(bc);
});
it.each(["AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])("currently admitted relation %s marker is absent only in the sufficient source",reason=>{
 expect(validator(wire97RequestFixture(clockless).response_format.json_schema.schema).safeParse([{fieldCode:10,reason,alternatives:[]}]).success).toBe(true);
 expect(validator(schema(clockless)).safeParse([{fieldCode:10,reason,alternatives:[]}]).success).toBe(false);
});
it("independent relation/offset, unknown discourse, retained context and facts keep every prior byte",()=>{
 const controls=[structuredClone(bound)];
 for(const text of ["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp trước sự kiện.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc trước 5 ngày.","Nếu ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.","Ngày 11/10 đi thi, nhắc 31 ngày liên tiếp.","Ngày 11/10 đi thi, nhắc hai ngày liên tiếp.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp trước hoặc sau sự kiện."]){const input=structuredClone(clockless);input.turns[0].text=text;controls.push(input);}
 for(const input of controls){expect(capability.isInitialRelationUncertaintyAbsent(input)).toBe(false);expect(wire98RequestFixture(input).response_format.json_schema.schema).toEqual(wire97RequestFixture(input).response_format.json_schema.schema);}
 for(const patch of [{activeRequest:{}},{facts:[{alias:"f1",field:"eventRelation"}]},{pendingQuestion:{}},{ambiguities:[{}]},{currentTurn:1},{reference:{...clockless.reference,instant:"invalid"}},{capabilities:{...clockless.capabilities,calendars:[]}}])expect(capability.isInitialRelationUncertaintyAbsent({...structuredClone(clockless),...patch} as unknown as ContextInput)).toBe(false);
});
it.each(["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"] as const)("direct consumer still parses supplied relation %s and numeric marker with authored singleton",reason=>{
 const base=ConversationInterpretationV3Schema.parse(frozenContextProposal(clocked,"R03",0)),evidence=[{kind:"USER_QUOTE",turn:clocked.currentTurn,quote:clocked.turns[clocked.currentTurn].text,occurrence:1}];
 const proposal=ConversationInterpretationV3Schema.parse({...base,changes:[...base.changes,{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence}],uncertainties:[{field:"eventRelation",reason,alternatives:[]},{field:"leadOffsetDays",reason:"MISSING",alternatives:[]}]});
 const raw=encodeFixtureV3(proposal,clocked),before=JSON.stringify(raw);
 expect(decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,clocked)).toMatchObject({status:"PARSED",value:{semantic:{changes:proposal.changes,uncertainties:proposal.uncertainties}}});expect(JSON.stringify(raw)).toBe(before);
});
it("historical predicate inverse restores without input or observer leakage",()=>{
 const before=JSON.stringify(clockless),current=schema(clockless);wire97RequestFixture(clockless);expect(schema(clockless)).toEqual(current);expect(JSON.stringify(clockless)).toBe(before);
});

it.each(["R02","R03"].flatMap(id=>["AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"].map(reason=>({id,reason}))))("full $id isolated $reason relation marker preserves actual source-owned continuation",async ({id,reason})=>{
 const script=regressions.cases.find(c=>c.id===id)!;
 const h=await createContextContractProbe({sourceSha:"6695189b2c21e2a0b7beb1755b8e59240b202466",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>{
  const proposal=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,id,index-1));
  return index===1?{...proposal,uncertainties:[{field:"eventRelation",reason,alternatives:[]}]}:proposal;
 });
 let report:unknown;
 try{const rows=[];for(const turn of script.turns){const result=await h.turn(turn.text,turn.receipt);expect(result).toMatchObject({fullSchemaValid:true,listStoreReads:0,mutations:0});rows.push(result);}
  expect(rows.at(-1)!.status).toBe(reason==="CONFLICT"?"CLARIFICATION_REQUESTED":"DRAFT_CREATED");
  report={fixture:id,reason,rows:rows.map(row=>({status:row.status,pendingField:row.pendingField,fullSchemaValid:row.fullSchemaValid,listStoreReads:row.listStoreReads,mutations:row.mutations}))};
 }finally{h.dispose();}
 console.log(JSON.stringify(report));
});
