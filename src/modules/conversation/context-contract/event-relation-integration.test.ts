import { expect, it } from "vitest";
import { harness, proposal } from "./service-test-support";
import { date, time } from "./resolution-test-support";
import { buildContextInputV2 } from "./context";
import { chat, message, observation } from "./context-test-fixtures";
import { SemanticPatchProposalV3Schema } from "./contracts";
import { validateEvidenceV3 } from "./evidence";

it("trusted prior relation survives count/time-only continuation and unsupported reassertion",async()=>{
  const h=await harness([proposal({title:"đi thi",eventDate:date(),frequency:"DAILY",occurrenceCount:2,eventRelation:"BEFORE_EVENT"}),proposal({reminderTime:time(),eventRelation:"BEFORE_EVENT"},"CURRENT")]);
  await h.turn(0,"Nhắc trước ngày thi 11/10 hai ngày liên tiếp.");
  expect((await h.read(1))?.slots.eventRelation.value).toBe("BEFORE_EVENT");
  expect(await h.turn(1,"8h.")).toEqual({status:"DRAFT_CREATED"});
  expect((await h.read(2))?.slots.eventRelation.value).toBe("BEFORE_EVENT");
});
it("explicit relation correction follows existing replacement semantics",async()=>{
  const h=await harness([proposal({title:"đi thi",eventDate:date(),frequency:"DAILY",occurrenceCount:2,eventRelation:"BEFORE_EVENT"}),proposal({eventRelation:"INCLUDING_EVENT"},"CURRENT",null,null,["eventRelation"])]);
  await h.turn(0,"Nhắc trước ngày thi 11/10 hai ngày liên tiếp.");
  await h.turn(1,"Đổi lại, tính cả ngày thi.");
  expect((await h.read(2))?.slots.eventRelation.value).toBe("INCLUDING_EVENT");
  expect((await h.read(2))?.pendingReminderQuestion?.field).toBe("reminderTime");
});
it("unsupported relation alternatives cannot acquire authority through retained uncertainty",()=>{
  const msg=message("Nhắc 2 ngày liên tiếp."),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
  if(built.status!=="READY")throw new Error(built.reason);
  const evidence=[{kind:"USER_QUOTE",turn:built.input.currentTurn,quote:msg.text,occurrence:1}];
  const semantic=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[],query:null,uncertainties:[{field:"eventRelation",reason:"AMBIGUOUS",alternatives:[{value:"BEFORE_EVENT",evidence}]}]});
  const result=validateEvidenceV3(semantic,built);
  expect(result.status).toBe("VALID");
  if(result.status==="VALID")expect(result.patch).toMatchObject({resolvedUncertainties:[{field:"eventRelation",reason:"AMBIGUOUS",alternatives:[]}],alternativeEvidence:[]});
});
