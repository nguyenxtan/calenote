// @vitest-environment node
import {createHash} from "node:crypto";
import {wire103PromptFixture} from "../../../../../tools/benchmark/context-singleton-json.test-support";
import {expect,it} from "vitest";
import {CONTEXT_CONTRACT_PROMPT} from "../../../conversation/context-contract/prompt";
import {createContextContractProbe} from "../../../../../tools/benchmark/context-contract-probe";
import {frozenContextProposal} from "../../../../../tools/benchmark/context-contract-fixtures";
import manifest from "../../../conversation/context-contract/benchmark/regressions.json";
import {deriveGenerationFieldCapability} from "../../../conversation/context-contract/field-capability";
import {encodeFixtureV3} from "../../../../../tools/benchmark/context-pointer-fixtures";
import {decodeGoogleLiteEuContextTransportV3} from "./context-provider-wire";
import {ConversationInterpretationV3Schema} from "../../../conversation/context-contract/contracts";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";

it("notes grounding distinguishes scheduling repetition from independently grounded notes without treating capability as evidence",()=>{
 const guide=/^Notes grounding: (.+)$/m.exec(CONTEXT_CONTRACT_PROMPT)?.[1];
 expect(guide).toBeDefined();
 expect(guide).toContain("merely because it supplies schedule fields");
 expect(guide).toContain("explicitly requested notes");expect(guide).toContain("independent grounded task details");
 expect(guide).toContain("retained notes");expect(guide).toContain("SET/REPLACE/CLEAR");
 expect(guide).toContain("notesProposalAllowed=true is availability, never notes evidence");
});

it.each(["baseline","schedulingAsNotes","explicitNotes","implicitDetail","explicitScheduleNote","retainedNotes","replaceNotes","clearNotes"] as const)("public R03 %s preserves current decoder/service notes language without a new guard",async mode=>{
 const script=manifest.cases.find(c=>c.id==="R03")!;
 const retained=["retainedNotes","replaceNotes","clearNotes"].includes(mode);
 let currentInput:Parameters<typeof encodeFixtureV3>[1]|undefined,currentProposal:Parameters<typeof encodeFixtureV3>[0]|undefined;
 const h=await createContextContractProbe({sourceSha:"57619590a180fa64100a69eaf883c2de8b4ad283",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>{
  const proposal=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,"R03",index-1)),evidence=[{kind:"USER_QUOTE" as const,turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
  if(index===1&&retained)proposal.changes.push({field:"notes",operation:"SET",value:"mang giấy tờ",evidence});
  if(index===2){
   if(["schedulingAsNotes","explicitNotes","implicitDetail","explicitScheduleNote"].includes(mode))proposal.changes.push({field:"notes",operation:"SET",value:mode==="schedulingAsNotes"||mode==="explicitScheduleNote"?script.turns[1].text:"mang giấy tờ",evidence});
   if(mode==="replaceNotes")proposal.changes.push({field:"notes",operation:"REPLACE",value:"mang bút",evidence});
   if(mode==="clearNotes")proposal.changes.push({field:"notes",operation:"CLEAR",value:null,evidence});
   currentInput=structuredClone(input);currentProposal=proposal;
  }
  return proposal;
 });
 try{
  const first=script.turns[0].text+(retained?" Ghi chú mang giấy tờ.":"");
  const initial=await h.turn(first,script.turns[0].receipt);expect(initial.fullSchemaValid).toBe(true);expect(initial.status).toBe("CLARIFICATION_REQUESTED");
  const tail=mode==="explicitNotes"?" Ghi chú mang giấy tờ.":mode==="implicitDetail"?" Nhớ mang giấy tờ.":mode==="explicitScheduleNote"?" Ghi chú: "+script.turns[1].text:mode==="replaceNotes"?" Sửa ghi chú thành mang bút.":mode==="clearNotes"?" Xóa ghi chú.":"";
  const final=await h.turn(script.turns[1].text+tail,script.turns[1].receipt);expect(final.fullSchemaValid).toBe(true);expect(final.status).toBe("DRAFT_CREATED");expect(final.mutations).toBe(0);
  expect(deriveGenerationFieldCapability(currentInput!).notesProposalAllowed).toBe(true);
  const raw=encodeFixtureV3(currentProposal!,currentInput!),before=JSON.stringify(raw);expect(decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,currentInput!).status).toBe("PARSED");expect(JSON.stringify(raw)).toBe(before);
  expect(final.fields.notes).toEqual(mode==="baseline"||mode==="clearNotes"?null:mode==="schedulingAsNotes"||mode==="explicitScheduleNote"?script.turns[1].text:mode==="replaceNotes"?"mang bút":"mang giấy tờ");
 }finally{h.dispose();}
});

it("notes grounding paragraph inverse preserves the exact immutable wire103 prompt",()=>{
 expect(createHash("sha256").update(wire103PromptFixture(CONTEXT_CONTRACT_PROMPT)).digest("hex")).toBe("9eea1ef10498a93d56ab256c56590dcc906b84c2426c4562bc5cfaaf2f28d9f0");
});
