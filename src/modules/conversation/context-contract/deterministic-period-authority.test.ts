// @vitest-environment node
import {expect, it} from "vitest";
import {harness, type Proposal} from "./service-test-support";
import type {QueryOperand} from "./contracts";
import {buildContextInputV2} from "./context";
import {chat, message, observation} from "./context-test-fixtures";
import {SemanticPatchProposalV3Schema} from "./contracts";
import {validateEvidenceV3} from "./evidence";
type Period = Extract<QueryOperand, {kind:"LIST"}>["period"];
const list = (period:Period):Proposal => input => ({schemaVersion:"calenote-context-3",intent:"LIST_REMINDERS",requestTarget:null,changes:[],query:{kind:"LIST",period,statusScope:"DEFAULT",evidence:[{kind:"USER_QUOTE",turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}]},uncertainties:period?[]:[{field:"queryRange",reason:"MISSING",alternatives:[]}],conversationDirective:null,replyProposal:null});
it.each([
 {text:"Tháng này có lịch gì ko?",model:{kind:"REST_OF_MONTH"},start:"2026-09-01",end:"2026-10-01"},
 {text:"tháng này",model:{kind:"MONTH",offset:0},start:"2026-09-01",end:"2026-10-01"},
 {text:"tuần này",model:{kind:"MONTH",offset:0},start:"2026-09-28",end:"2026-10-05"},
 {text:"tháng sau",model:{kind:"MONTH",offset:0},start:"2026-10-01",end:"2026-11-01"},
 {text:"tháng trước",model:{kind:"REST_OF_MONTH"},start:"2026-08-01",end:"2026-09-01"},
 {text:"ngày mai",model:{kind:"MONTH",offset:0},start:"2026-09-29",end:"2026-09-30"},
])("current deterministic period owns exact bounds despite model disagreement: $text",async ({text,model,start,end})=>{
 const h=await harness([list(null),list(model as Period)]), ranges:unknown[]=[];const actual=h.deps.list;
 h.deps.list=input=>{ranges.push(input.range);return actual(input);};
 expect(await h.turn(0,"Có lịch nào ko?")).toEqual({status:"CLARIFICATION_REQUESTED"});expect(ranges).toEqual([]);
 expect(await h.turn(1,text)).toEqual({status:"REMINDERS_LISTED"});
 expect(ranges).toEqual([{start:Date.parse(start+"T00:00:00+07:00"),end:Date.parse(end+"T00:00:00+07:00")}]);
 expect((await h.read(2))?.pendingQueryQuestion).toBeNull();expect(h.inputs).toHaveLength(2);
 expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it.each(["từ giờ đến cuối tháng này","phần còn lại của tháng này","7 ngày tới"])("remaining month and next days are not aliased to MONTH: %s",async text=>{
 const h=await harness([list({kind:"MONTH",offset:0})]);const ranges:unknown[]=[];const actual=h.deps.list;
 h.deps.list=input=>{ranges.push(input.range);return actual(input);};
 expect(await h.turn(0,text)).toEqual({status:"REMINDERS_LISTED"});
 expect(ranges).toHaveLength(1);expect(ranges[0]).not.toEqual({start:Date.parse("2026-09-01T00:00:00+07:00"),end:Date.parse("2026-10-01T00:00:00+07:00")});
});
it.each(["Có lịch nào ko?","cuối tháng này","tháng này hoặc tuần này","không phải tháng này",'chữ "tháng này"'])("unsupported or ambiguous phrase never grants a read: %s",async text=>{
 const h=await harness([list({kind:"REST_OF_MONTH"})]);let reads=0;const actual=h.deps.list;h.deps.list=input=>{reads++;return actual(input);};
 expect(await h.turn(0,text)).toEqual({status:"CLARIFICATION_REQUESTED"});expect(reads).toBe(0);
});
it("discarded query uncertainty cannot shift a later field's source provenance",()=>{
 const msg=message("tháng này gọi mẹ"),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
 if(built.status!=="READY")throw Error(built.reason);
 const ref=(quote:string)=>[{kind:"USER_QUOTE",turn:built.input.currentTurn,quote,occurrence:1}];
 const semantic=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"LIST_REMINDERS",requestTarget:null,changes:[],query:{kind:"LIST",period:{kind:"REST_OF_MONTH"},statusScope:"DEFAULT",evidence:ref(msg.text)},uncertainties:[
  {field:"queryRange",reason:"AMBIGUOUS",alternatives:[{value:{kind:"MONTH",offset:0},evidence:ref("tháng này")}]},
  {field:"title",reason:"AMBIGUOUS",alternatives:[{value:"gọi mẹ",evidence:ref("gọi mẹ")}]},
 ]});
 const result=validateEvidenceV3(semantic,built);expect(result.status).toBe("VALID");
 if(result.status!=="VALID")throw Error(result.reason);
 expect(result.patch.resolvedUncertainties.map(u=>u.field)).toEqual(["title"]);
 expect(result.patch.alternativeEvidence).toHaveLength(1);
 expect(result.patch.alternativeEvidence[0]).toMatchObject({field:"title",sources:[{quote:"gọi mẹ"}]});
 expect(result.patch.queryEvidence).toMatchObject([{quote:"tháng này",sourceTurnId:msg.id}]);
});
it.each(["367 ngày nữa","367 ngày trước","9".repeat(400)+" ngày nữa"])("out-of-canonical deterministic offset stays clarification with no DB read: %s",async text=>{
 const h=await harness([list({kind:"DAY",date:{kind:"RELATIVE_DAY",offsetDays:0}})]);let reads=0;const actual=h.deps.list;
 h.deps.list=input=>{reads++;return actual(input);};
 expect(await h.turn(0,text)).toEqual({status:"CLARIFICATION_REQUESTED"});expect(reads).toBe(0);
});
