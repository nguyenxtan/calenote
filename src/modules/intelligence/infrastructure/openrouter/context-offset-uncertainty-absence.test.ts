// @vitest-environment node
import {beforeAll,expect,it} from "vitest";
import {z} from "zod";
import {type ContextInput,ContextInputSchema,ConversationInterpretationV3Schema} from "../../../conversation/context-contract/contracts";
import * as capability from "../../../conversation/context-contract/field-capability";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import {wire98RequestFixture,wire99RequestFixture} from "../../../../../tools/benchmark/context-singleton-json.test-support";
import {createContextContractProbe} from "../../../../../tools/benchmark/context-contract-probe";
import {frozenContextProposal} from "../../../../../tools/benchmark/context-contract-fixtures";
import {encodeFixtureWire107Reference as encodeFixtureV3} from "../../../../../tools/benchmark/context-pointer-fixtures";
import {decodeGoogleLiteEuContextTransportV3,UNCERTAINTY_FIELD_WIRE_CODE_V1} from "./context-provider-wire";
import regressions from "../../../conversation/context-contract/benchmark/regressions.json";
let clockless:ContextInput,clocked:ContextInput,bound:ContextInput;
beforeAll(async()=>{
 for(const id of ["R02","R03"]){const script=regressions.cases.find(c=>c.id===id)!;
  const h=await createContextContractProbe({sourceSha:"5b8ad2a566aff745b4ca9eb6f0b3b252a1668d8c",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>{if(id==="R03")clocked=structuredClone(input);else if(index===1)clockless=structuredClone(input);else bound=structuredClone(input);return frozenContextProposal(input,id,index-1);});
  try{for(const turn of script.turns.slice(0,id==="R02"?2:1))await h.turn(turn.text,turn.receipt);}finally{h.dispose();}
 }if(!clockless||!clocked||!bound)throw Error("TEST_CONTEXT_MISSING");
});
function inline(root:unknown,node:unknown,seen:string[]=[]):unknown{
 if(!node||typeof node!=="object")return node;if(Array.isArray(node))return node.map(v=>inline(root,v,seen));const o=node as Record<string,unknown>;
 if(typeof o.$ref==="string"){const ref=o.$ref;if(!ref.startsWith("#/")||seen.includes(ref))throw Error("TEST_REF");return inline(root,ref.slice(2).split("/").reduce<unknown>((v,k)=>(v as Record<string,unknown>)[k],root),[...seen,ref]);}
 return Object.fromEntries(Object.entries(o).filter(([k])=>k!=="$defs").map(([k,v])=>[k,inline(root,v,seen)]));
}
const schema=(input:ContextInput)=>wire99RequestFixture(input).response_format.json_schema.schema;
const validator=(s:ReturnType<typeof schema>)=>z.fromJSONSchema(inline(s,s.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]);
it.each(["clockless","clocked","bound"])("certified %s source denies only unsupported offset reason language",kind=>{
 const input=kind==="clockless"?clockless:kind==="clocked"?clocked:bound;
 expect(capability.isWholeSeriesOffsetUncertaintyAbsent(input)).toBe(true);
 const current=schema(input),old=wire98RequestFixture(input).response_format.json_schema.schema,a=validator(current),b=validator(old);
 for(const fieldCode of Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V1))for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])for(const n of [0,1,2]){
  const raw=[{fieldCode,reason,alternatives:Array(n).fill("{}")}];expect(a.safeParse(raw).success,`${fieldCode}/${reason}/${n}`).toBe(fieldCode===11?false:b.safeParse(raw).success);
 }
 const ac=structuredClone(current),bc=structuredClone(old);delete ac.properties!.uncertainties;delete bc.properties!.uncertainties;expect(ac).toEqual(bc);
});
it.each(["0","367","500","9007199254740993"].flatMap(token=>["initial","bound"].map(kind=>({token,kind}))))("explicit unsupported $token in $kind first source is not silence",({token,kind})=>{
 const input=structuredClone(kind==="initial"?clockless:bound);input.turns[0].text=`Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc trước ${token} ngày.`;
 expect(capability.isWholeSeriesOffsetAlternativeAbsent(input)).toBe(true);
 expect(capability.isWholeSeriesOffsetUncertaintyAbsent(input)).toBe(false);
 expect(schema(input)).toEqual(wire98RequestFixture(input).response_format.json_schema.schema);
 expect(validator(schema(input)).safeParse([{fieldCode:11,reason:"UNSUPPORTED_COMBINATION",alternatives:[]}]).success).toBe(true);
});
it("supported independent, ambiguous, different-number, occupied fact and before-only first sources retain entire prior language",()=>{
 const independent=structuredClone(clockless);independent.turns[0].text="Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc trước 5 ngày.";
 const current=structuredClone(bound);current.turns[current.currentTurn].text="Nhắc trước 5 ngày.";
 const ambiguous=structuredClone(bound);ambiguous.turns[ambiguous.currentTurn].text="Có thể nhắc trước 2 hoặc 5 ngày.";
 const occupied=structuredClone(bound);occupied.activeRequest!.slots.leadOffsetDays={state:"RESOLVED",value:5,fact:"f999"};occupied.facts.push({...structuredClone(occupied.facts[0]),alias:"f999",scope:"REMINDER",field:"leadOffsetDays",value:5});
 const beforeOnly=structuredClone(bound);beforeOnly.turns[0].text="Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp trước sự kiện.";
 for(const input of [independent,current,ambiguous,occupied,beforeOnly]){expect(capability.isWholeSeriesOffsetUncertaintyAbsent(input)).toBe(false);expect(schema(input)).toEqual(wire98RequestFixture(input).response_format.json_schema.schema);}
});
it("missing duplicate and mismatched fact bindings or unknown state cannot grant stronger absence",()=>{
 const controls=[structuredClone(bound),structuredClone(bound),structuredClone(bound)];controls[0].facts=controls[0].facts.filter(f=>f.field!=="occurrenceCount");controls[1].facts.push({...structuredClone(controls[1].facts.find(f=>f.field==="occurrenceCount")!),alias:"f999"});controls[2].facts.find(f=>f.field==="occurrenceCount")!.value=3;
 for(const input of controls){expect(capability.isWholeSeriesOffsetUncertaintyAbsent(input)).toBe(false);if(ContextInputSchema.safeParse(input).success)expect(schema(input)).toEqual(wire98RequestFixture(input).response_format.json_schema.schema);else {expect(()=>schema(input)).toThrow("EVIDENCE_SOURCE_CONTEXT_INVALID");expect(()=>wire98RequestFixture(input)).toThrow("EVIDENCE_SOURCE_CONTEXT_INVALID");}}
 for(const patch of [{activeRequest:{}},{facts:[{alias:"f1",field:"leadOffsetDays"}]},{pendingQuestion:{}},{ambiguities:[{}]},{reference:{...clockless.reference,instant:"invalid"}},{capabilities:{...clockless.capabilities,calendars:[]}}])expect(capability.isWholeSeriesOffsetUncertaintyAbsent({...structuredClone(clockless),...patch} as unknown as ContextInput)).toBe(false);
});
it.each(["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"] as const)("direct consumer preserves offset $reason marker and authored numeric alternatives without repair",reason=>{
 const base=ConversationInterpretationV3Schema.parse(frozenContextProposal(clocked,"R03",0)),evidence=[{kind:"USER_QUOTE",turn:clocked.currentTurn,quote:clocked.turns[clocked.currentTurn].text,occurrence:1}];
 const proposal=ConversationInterpretationV3Schema.parse({...base,uncertainties:[{field:"leadOffsetDays",reason,alternatives:reason==="MISSING"?[]:[{value:2,evidence}]},{field:"eventRelation",reason:"MISSING",alternatives:[]}]});
 const raw=encodeFixtureV3(proposal,clocked),before=JSON.stringify(raw);
 expect(decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,clocked)).toMatchObject({status:"PARSED",value:{semantic:{uncertainties:proposal.uncertainties}}});expect(JSON.stringify(raw)).toBe(before);
});
it("historical stronger-proof inverse leaves input and current schema immutable",()=>{
 const before=JSON.stringify(bound),current=schema(bound);wire98RequestFixture(bound);expect(schema(bound)).toEqual(current);expect(JSON.stringify(bound)).toBe(before);
});

it.each(["R02","R03"].flatMap(id=>["AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"].map(reason=>({id,reason}))))("full $id direct offset $reason remains unresolved without an independent answer",async ({id,reason})=>{
 const script=regressions.cases.find(c=>c.id===id)!;
 const h=await createContextContractProbe({sourceSha:"5b8ad2a566aff745b4ca9eb6f0b3b252a1668d8c",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>{
  const proposal=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,id,index-1));
  return index===1?{...proposal,uncertainties:[{field:"leadOffsetDays",reason,alternatives:[]}]}:proposal;
 });
 try{const rows=[];for(const turn of script.turns){const result=await h.turn(turn.text,turn.receipt);expect(result).toMatchObject({fullSchemaValid:true,listStoreReads:0,mutations:0});rows.push(result);}
  expect(rows.at(-1)!.status).toBe("CLARIFICATION_REQUESTED");expect(rows.at(-1)!.pendingField).toBe("leadOffsetDays");
 }finally{h.dispose();}
});

it.each(["0","367","500","9007199254740993"].flatMap(token=>["initial","bound"].map(kind=>({token,kind}))))("reversed unsupported $token days-before in $kind source retains old language",({token,kind})=>{
 const input=structuredClone(kind==="initial"?clockless:bound);input.turns[0].text=`Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc ${token} ngày trước.`;
 expect(capability.isWholeSeriesOffsetUncertaintyAbsent(input)).toBe(false);expect(schema(input)).toEqual(wire98RequestFixture(input).response_format.json_schema.schema);
 expect(validator(schema(input)).safeParse([{fieldCode:11,reason:"UNSUPPORTED_COMBINATION",alternatives:[]}]).success).toBe(true);
});
it.each(["0","367","500","9007199254740993"])("unsupported current distance %s is not a matched count source",token=>{
 const input=structuredClone(bound);input.turns[input.currentTurn].text=`Nhắc trước ${token} ngày.`;
 expect(capability.isWholeSeriesOffsetUncertaintyAbsent(input)).toBe(false);expect(schema(input)).toEqual(wire98RequestFixture(input).response_format.json_schema.schema);
});

const unsupportedLayouts=["trước  500 ngày","trước 500  ngày","trước\t500 ngày","trước\n500 ngày","trước\u00a0500 ngày","500  ngày trước","500 ngày  trước"];
it.each(unsupportedLayouts.flatMap(cue=>["initial","bound"].map(kind=>({cue,kind}))))("noncanonical unsupported cue $cue in $kind retains offset uncertainty",({cue,kind})=>{
 const input=structuredClone(kind==="initial"?clockless:bound);input.turns[0].text=`Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc ${cue}.`;
 const before=JSON.stringify(input);expect(capability.isWholeSeriesOffsetUncertaintyAbsent(input)).toBe(false);
 const current=validator(schema(input)),old=validator(wire98RequestFixture(input).response_format.json_schema.schema);
 for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])for(const n of [0,1,2]){
  const raw=[{fieldCode:11,reason,alternatives:Array(n).fill("{}")}];expect(current.safeParse(raw).success).toBe(old.safeParse(raw).success);
 }
 expect(current.safeParse([{fieldCode:11,reason:"UNSUPPORTED_COMBINATION",alternatives:[]}]).success).toBe(true);expect(JSON.stringify(input)).toBe(before);
});
it.each(unsupportedLayouts)("noncanonical initial relation cue %s restores genuine reason channels",cue=>{
 const input=structuredClone(clockless);input.turns[0].text=`Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc ${cue}.`;
 const before=JSON.stringify(input);expect(capability.isInitialRelationUncertaintyAbsent(input)).toBe(false);
 expect(validator(schema(input)).safeParse([{fieldCode:10,reason:"UNSUPPORTED_COMBINATION",alternatives:[]}]).success).toBe(true);expect(JSON.stringify(input)).toBe(before);
});

it.each(["initial","bound"])("a venue that confuses unique relation support cannot hide unsupported offset in %s source",kind=>{
 const input=structuredClone(kind==="initial"?clockless:bound);input.turns[0].text="Ngày 11/10 đi thi tại Bao Gồm Ngày Thi, nhắc 2 ngày liên tiếp, nhắc trước 500 ngày.";
 if(input.activeRequest){const slot=input.activeRequest.slots.location;if(slot.fact){slot.value="Bao Gồm Ngày Thi";const fact=input.facts.find(f=>f.alias===slot.fact);if(fact)fact.value="Bao Gồm Ngày Thi";}}
 expect(ContextInputSchema.safeParse(input).success).toBe(true);
 expect(capability.isWholeSeriesOffsetUncertaintyAbsent(input)).toBe(false);
 if(kind==="initial")expect(capability.isInitialRelationUncertaintyAbsent(input)).toBe(false);
 const current=validator(schema(input));expect(current.safeParse([{fieldCode:11,reason:"UNSUPPORTED_COMBINATION",alternatives:[]}]).success).toBe(true);
});
