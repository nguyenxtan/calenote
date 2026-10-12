// @vitest-environment node
import {beforeAll,expect,it} from "vitest";
import {z} from "zod";
import {type ContextInput,ConversationInterpretationV3Schema} from "../../../conversation/context-contract/contracts";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import * as capability from "../../../conversation/context-contract/field-capability";
import {createContextContractProbe} from "../../../../../tools/benchmark/context-contract-probe";
import {frozenContextProposal} from "../../../../../tools/benchmark/context-contract-fixtures";
import {googleLiteEuContextWireSchemaV3,decodeGoogleLiteEuContextTransportV3,UNCERTAINTY_FIELD_WIRE_CODE_V1} from "./context-provider-wire";
import {wire99RequestFixture} from "../../../../../tools/benchmark/context-singleton-json.test-support";
import {encodeFixtureV3} from "../../../../../tools/benchmark/context-pointer-fixtures";
import regressions from "../../../conversation/context-contract/benchmark/regressions.json";
let clockless:ContextInput,clocked:ContextInput,bound:ContextInput;
beforeAll(async()=>{
 for(const id of ["R02","R03"]){const script=regressions.cases.find(c=>c.id===id)!;
  const h=await createContextContractProbe({sourceSha:"37a875376d4a072a67f6ba44965356b9d81bfd90",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>{if(id==="R03")clocked=structuredClone(input);else if(index===1)clockless=structuredClone(input);else bound=structuredClone(input);return frozenContextProposal(input,id,index-1);});
  try{for(const turn of script.turns.slice(0,id==="R02"?2:1))await h.turn(turn.text,turn.receipt);}finally{h.dispose();}
 }
});
function inline(root:unknown,node:unknown,seen:string[]=[]):unknown{
 if(!node||typeof node!=="object")return node;if(Array.isArray(node))return node.map(v=>inline(root,v,seen));const o=node as Record<string,unknown>;
 if(typeof o.$ref==="string"){const ref=o.$ref;if(!ref.startsWith("#/")||seen.includes(ref))throw Error("TEST_REF");return inline(root,ref.slice(2).split("/").reduce<unknown>((v,k)=>(v as Record<string,unknown>)[k],root),[...seen,ref]);}
 return Object.fromEntries(Object.entries(o).filter(([k])=>k!=="$defs").map(([k,v])=>[k,inline(root,v,seen)]));
}
const schema=(input:ContextInput)=>googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(input),input).schema;
const validator=(input:ContextInput)=>{const s=schema(input);return z.fromJSONSchema(inline(s,s.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]);};
it.each(["clockless","clocked"])("initial %s event-owned finite source excludes authored date MISSING only",kind=>{
 const input=kind==="clockless"?clockless:clocked,before=JSON.stringify(input);
 expect(capability.isInitialRelationUncertaintyAbsent(input)).toBe(true);expect(capability.deriveGenerationFieldCapability(input).reminderDateProposalAllowed).toBe(false);
 expect(validator(input).safeParse([{fieldCode:5,reason:"MISSING",alternatives:[]}]).success).toBe(false);
 for(const reason of ["AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])expect(validator(input).safeParse([{fieldCode:5,reason,alternatives:[]}]).success).toBe(true);
 expect(JSON.stringify(input)).toBe(before);
});
it.each(["clockless","clocked"])("raw %s field/reason language differs only at MISSING5",kind=>{
 const input=kind==="clockless"?clockless:clocked,current=schema(input),old=wire99RequestFixture(input).response_format.json_schema.schema;
 const a=validator(input),b=z.fromJSONSchema(inline(old,old.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]);
 for(const fieldCode of Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V1))for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])for(const n of [0,1,2]){const raw=[{fieldCode,reason,alternatives:Array(n).fill("{}")}];expect(a.safeParse(raw).success,`${fieldCode}/${reason}/${n}`).toBe(fieldCode===5&&reason==="MISSING"?false:b.safeParse(raw).success);}
 const ac=structuredClone(current),bc=structuredClone(old);delete ac.properties!.uncertainties;delete bc.properties!.uncertainties;expect(ac).toEqual(bc);
});
it.each(["Ngày 11/10 đi thi, nhắc tôi ngày 10/10.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc trước 500 ngày.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc 5 ngày trước.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp trước sự kiện.","Ngày 11/10 đi thi, nhắc 2  ngày liên tiếp.","Ngày 11/10 âm đi thi, nhắc 2 ngày liên tiếp.","Mai nhắc tôi gọi mẹ."])("independent or uncertified source %s retains whole prior language",text=>{
 const input=structuredClone(clockless);input.turns[0].text=text;const before=JSON.stringify(input);
 expect(capability.isInitialReminderDateMissingExcluded(input)).toBe(false);expect(schema(input)).toEqual(wire99RequestFixture(input).response_format.json_schema.schema);
 expect(validator(input).safeParse([{fieldCode:5,reason:"MISSING",alternatives:[]}]).success).toBe(true);expect(JSON.stringify(input)).toBe(before);
});
it("invalid reference calendar and incomplete state do not establish initial date bound",()=>{
 for(const patch of [{activeRequest:{}},{facts:[{}]},{pendingQuestion:{}},{ambiguities:[{}]},{reference:{...clockless.reference,instant:"invalid"}},{capabilities:{...clockless.capabilities,calendars:[]}}])expect(capability.isInitialReminderDateMissingExcluded({...structuredClone(clockless),...patch} as unknown as ContextInput)).toBe(false);
 const before=JSON.stringify(clockless),current=schema(clockless);wire99RequestFixture(clockless);expect(schema(clockless)).toEqual(current);expect(JSON.stringify(clockless)).toBe(before);
});
it.each(["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"] as const)("direct consumer preserves date %s marker and alternatives",reason=>{
 const base=ConversationInterpretationV3Schema.parse(frozenContextProposal(clocked,"R03",0)),evidence=[{kind:"USER_QUOTE",turn:0,quote:clocked.turns[0].text,occurrence:1}];
 const proposal=ConversationInterpretationV3Schema.parse({...base,uncertainties:[{field:"reminderDate",reason,alternatives:reason==="MISSING"?[]:[{value:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null},evidence}]}]});
 const raw=encodeFixtureV3(proposal,clocked),before=JSON.stringify(raw);expect(decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,clocked)).toMatchObject({status:"PARSED",value:{semantic:{uncertainties:proposal.uncertainties}}});expect(JSON.stringify(raw)).toBe(before);
});
it("bound date missing remains an admitted proposal",()=>{expect(validator(bound).safeParse([{fieldCode:5,reason:"MISSING",alternatives:[]}]).success).toBe(true);});
it.each(["R02","R03"])("full %s backend still owns required date clarification and eventual draft",async id=>{
 const script=regressions.cases.find(c=>c.id===id)!;
 const h=await createContextContractProbe({sourceSha:"37a875376d4a072a67f6ba44965356b9d81bfd90",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>frozenContextProposal(input,id,index-1));
 try{const rows=[];for(const turn of script.turns){const result=await h.turn(turn.text,turn.receipt);expect(result).toMatchObject({fullSchemaValid:true,listStoreReads:0,mutations:0});rows.push(result);}
  expect(rows[0].pendingField).toBe(id==="R02"?"reminderTime":"reminderDate");expect(rows.at(-1)!.status).toBe("DRAFT_CREATED");
 }finally{h.dispose();}
});
it.each(["R02","R03"].flatMap(id=>["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"].map(reason=>({id,reason}))))("full $id incoming date $reason remains backend authority",async({id,reason})=>{
 const script=regressions.cases.find(c=>c.id===id)!;
 const h=await createContextContractProbe({sourceSha:"37a875376d4a072a67f6ba44965356b9d81bfd90",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>{const p=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,id,index-1));return index===1?{...p,uncertainties:[{field:"reminderDate",reason,alternatives:[]}]}:p;});
 try{const rows=[];for(const turn of script.turns){const result=await h.turn(turn.text,turn.receipt);expect(result).toMatchObject({fullSchemaValid:true,listStoreReads:0,mutations:0});rows.push(result);}
  expect(rows[0].pendingField).toBe("reminderDate");expect(rows.at(-1)!.pendingField).toBe("reminderDate");expect(rows.at(-1)!.status).toBe("CLARIFICATION_REQUESTED");
 }finally{h.dispose();}
});
