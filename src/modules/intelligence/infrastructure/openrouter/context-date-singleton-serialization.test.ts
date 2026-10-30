// @vitest-environment node
import {createHash} from "node:crypto";
import {wire101PromptFixture,wire102PromptFixture} from "../../../../../tools/benchmark/context-singleton-json.test-support";
import {expect,it} from "vitest";
import {CONTEXT_CONTRACT_PROMPT} from "../../../conversation/context-contract/prompt";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import {deriveGenerationFieldCapability} from "../../../conversation/context-contract/field-capability";
import {createContextContractProbe} from "../../../../../tools/benchmark/context-contract-probe";
import {frozenContextProposal} from "../../../../../tools/benchmark/context-contract-fixtures";
import {encodeFixtureWire107Reference as encodeFixtureV3} from "../../../../../tools/benchmark/context-pointer-fixtures";
import {decodeGoogleLiteEuContextTransportV3} from "./context-provider-wire";

it("date singleton emission explicitly orders operand string, change string and outer JSON without changing other field representations",()=>{
 const guide=/^Date singleton serialization: (.+)$/m.exec(CONTEXT_CONTRACT_PROMPT)?.[1];
 expect(guide).toBeDefined();
 expect(guide).toContain("FIRST");expect(guide).toContain("SECOND");expect(guide).toContain("THIRD");
 expect(guide).toContain("selected inner grammar requires a STRING");
 expect(guide).toContain("eventDateYearNullRequired=true");
 expect(guide).toContain('CLEAR stays null, never the string "null"');
 expect(guide).toContain("Canonical date alternative values remain typed objects");
 expect(guide).toContain("Query date/from/through keep their existing DateOperand JSON-string representation");
});

it.each([
 {id:"D01",text:"Mai nhắc tui gọi mẹ lúc 8h.",root:"reminderDateChange",typed:false},
 {id:"R02",text:"Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.",root:"eventDateChange",typed:true},
 {id:"R03",text:"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.",root:"eventDateChange",typed:true},
])("$id public actual-service date singleton preserves selected type and refuses the other type without mutation",async c=>{
 let captured:Parameters<typeof encodeFixtureV3>[1]|undefined,proposal:Parameters<typeof encodeFixtureV3>[0]|undefined;
 const h=await createContextContractProbe({sourceSha:"87bfd594b11061279faa1ea83f23f7b2bff3d990",referenceNow:Date.parse("2026-09-28T03:00:00Z")},(input,index)=>{captured=structuredClone(input);proposal=frozenContextProposal(input,c.id,index-1);return proposal;});
 try{
  const actual=await h.turn(c.text,"2026-09-28T03:00:00Z");expect(actual.fullSchemaValid).toBe(true);expect(actual.mutations).toBe(0);
  expect(deriveGenerationFieldCapability(captured!).eventDateYearNullRequired).toBe(c.typed);
  const raw=encodeFixtureV3(proposal!,captured!) as Record<string,{change:string|Record<string,unknown>}>,before=JSON.stringify(raw),change=c.typed?raw[c.root].change as Record<string,unknown>:JSON.parse(raw[c.root].change as string);
  expect(typeof raw[c.root].change).toBe(c.typed?"object":"string");
  expect(typeof change.value).toBe(c.typed?"object":"string");
  expect(decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,captured!).status).toBe("PARSED");expect(JSON.stringify(raw)).toBe(before);
  const wrong=structuredClone(raw),inner=c.typed?wrong[c.root].change as Record<string,unknown>:JSON.parse(wrong[c.root].change as string);inner.value=c.typed?JSON.stringify(inner.value):JSON.parse(inner.value);wrong[c.root].change=c.typed?inner:JSON.stringify(inner);
  const original=JSON.stringify(wrong);expect(decodeGoogleLiteEuContextTransportV3(wrong,CONTEXT_PROTOCOL_V3,undefined,undefined,captured!).status).toBe("REFUSED");expect(JSON.stringify(wrong)).toBe(original);
 }finally{h.dispose();}
});

it("date serialization guide inverse preserves the exact immutable wire101 prompt",()=>{
 expect(createHash("sha256").update(wire101PromptFixture(CONTEXT_CONTRACT_PROMPT)).digest("hex")).toBe("78e4c9f0598735f0af40f71804bb4c01c11f22ee3d2583420292c527a24c094d");
});

it("date serialization selects operation and field representation before any operand encoding",()=>{
 const guide=/^Date singleton serialization: (.+)$/m.exec(CONTEXT_CONTRACT_PROMPT)?.[1];
 expect(guide).toContain("FIRST select the inner value representation");
 expect(guide).toContain("SET/REPLACE reminderDate and endDate always use a STRING");
 expect(guide).toContain("SET/REPLACE eventDate uses an OBJECT only when input.fieldCapability.eventDateYearNullRequired=true; otherwise it uses a STRING");
 expect(guide).toContain("The flag applies only to eventDate");
 expect(guide).toContain("For the selected OBJECT branch, author the grounded six-key CIVIL_DATE/year-null object directly; do not JSON-serialize the operand");
 expect(guide!.indexOf("FIRST select")).toBeLessThan(guide!.indexOf("For the selected STRING branch"));
});

it("branch-first guide inverse preserves the exact immutable wire102 prompt",()=>{
 expect(createHash("sha256").update(wire102PromptFixture(CONTEXT_CONTRACT_PROMPT)).digest("hex")).toBe("d37a1d01278acbf713ae93cefe991493d1bf9e9e50f6a6cda8b99b9d3d2e444b");
});
