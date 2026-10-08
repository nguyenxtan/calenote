// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildContextInputV2 } from "./context";
import { chat, message, observation } from "./context-test-fixtures";
import { SemanticPatchProposalV3Schema, FieldChangeV3Schema, UncertaintyV3Schema } from "./contracts";
import { validateEvidenceV3 } from "./evidence";
import { locationCoverageComplete, titleCoverageComplete } from "./semantic-completeness";
import { turn } from "./context-test-fixtures";
import { TranscriptEntrySchema } from "./state";
import { harness, proposal as scriptedProposal, complete } from "./service-test-support";
import { DownstreamDiagnosticSchema, type DownstreamDiagnostic } from "./downstream";

function coverage(text: string, value?: string | null, options: {target?: "NEW" | "CURRENT"; retained?:string; source?:string; intent?:"LIST_REMINDERS"; uncertainty?:boolean; clear?:boolean} = {}) {
  const current=turn(text,"current"), sources=[{kind:"USER_QUOTE" as const,sourceTurnId:options.source??"current",sourceMapTurnId:"current",quote:text,occurrence:1,sourceSpan:{start:0,end:[...text].length},viewSpan:{start:0,end:[...text].length},normalizationVersion:"nfc-codepoint-v1" as const}];
  const bound={field:"location",sources,current:options.source===undefined,provenance:{kind:"EXPLICIT_USER" as const},referenceTime:current.receivedAt};
  return locationCoverageComplete({intent:options.intent??"CREATE_REMINDER",target:{kind:options.target??"NEW",evidence:[]},currentTurn:current,
    changes:value!==undefined&&!options.uncertainty?[FieldChangeV3Schema.parse({field:"location",operation:options.clear||value===null?"CLEAR":"SET",value,evidence:[{kind:"USER_QUOTE",turn:0,quote:text,occurrence:1}]})]:[],changeEvidence:[bound],
    uncertainties:options.uncertainty?[UncertaintyV3Schema.parse({field:"location",reason:"AMBIGUOUS",alternatives:value===undefined?[]:[{value,evidence:[{kind:"USER_QUOTE",turn:0,quote:text,occurrence:1}]}]})]:[],alternativeEvidence:[bound],retainedLocation:options.retained??null});
}

function titleCoverage(value: string|null|undefined, options:{target?:"CURRENT"|"NEW";retained?:string;source?:string;uncertainty?:boolean;span?:{start:number;end:number};role?:"USER"|"ASSISTANT"}={}) {
  const text="Ngày 11/10 đi thi, nhắc tôi trước 2 ngày.",current=options.role==="ASSISTANT" ? TranscriptEntrySchema.parse({...turn(text,"current"),role:"ASSISTANT",kind:"CLARIFICATION",deliveryState:"SENT"}) : turn(text,"current");
  const evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:text,occurrence:1}];
  const bound={field:"title",current:!options.source,sources:[{kind:"USER_QUOTE" as const,sourceTurnId:options.source??"current",sourceMapTurnId:"current",quote:text,occurrence:1,sourceSpan:{start:0,end:[...text].length},viewSpan:options.span??{start:0,end:[...text].length},normalizationVersion:"nfc-codepoint-v1" as const}],provenance:{kind:"EXPLICIT_USER" as const},referenceTime:current.receivedAt};
  return titleCoverageComplete({intent:"CREATE_REMINDER",target:{kind:options.target??"NEW",evidence:[]},currentTurn:current,
    changes:value!==undefined&&!options.uncertainty?[FieldChangeV3Schema.parse({field:"title",operation:value===null?"CLEAR":"SET",value,evidence})]:[],changeEvidence:[bound],
    uncertainties:options.uncertainty?[UncertaintyV3Schema.parse({field:"title",reason:"AMBIGUOUS",alternatives:value===undefined?[]:[{value,evidence}]})]:[],alternativeEvidence:[bound],retainedTitle:options.retained??null});
}
it("title completeness accepts only model subject coverage with current validated source",()=>{
  expect(titleCoverage("đi thi")).toBe(true);
  expect(titleCoverage("đi thi",{source:"old"})).toBe(false);
  expect(titleCoverage("đi thi",{span:{start:0,end:9}})).toBe(false);
  expect(titleCoverage("thi")).toBe(false);
  expect(titleCoverage("khác")).toBe(false);
  expect(titleCoverage(null)).toBe(false);
  expect(titleCoverage(undefined,{target:"CURRENT",retained:"đi thi"})).toBe(true);
  expect(titleCoverage(undefined,{target:"NEW",retained:"đi thi"})).toBe(false);
  expect(titleCoverage(undefined,{target:"CURRENT",retained:"khác"})).toBe(false);
  expect(titleCoverage(null,{target:"CURRENT",retained:"đi thi"})).toBe(false);
  expect(titleCoverage("đi thi",{uncertainty:true})).toBe(true);
  expect(titleCoverage(undefined,{uncertainty:true})).toBe(false);
  expect(titleCoverage(undefined,{role:"ASSISTANT"})).toBe(true);
});

describe("grounded location completeness before patch issuance", () => {
  it.each(["Ngày 11/10 đi thi, nhắc tôi uống thuốc lúc 8h.","Ngày 11/10 đi thi, nhắc tôi đóng tiền trước 2 ngày."])("accepts actual different reminder task without imposing exam title: %s",text=>{
    const msg=message(text),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
    if(built.status!=="READY")throw Error(built.reason);
    const ref={kind:"USER_QUOTE",turn:built.input.currentTurn,quote:text,occurrence:1};
    const changes=[{field:"title",operation:"SET",value:text.includes("uống thuốc")?"uống thuốc":"đóng tiền",evidence:[ref]},...(text.includes("trước 2 ngày")?[{field:"leadOffsetDays",operation:"SET",value:2,evidence:[ref]},{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence:[ref]}]:[])];
    const value=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[ref]},changes,query:null,uncertainties:[]});
    expect(validateEvidenceV3(value,built).status).toBe("VALID");
  });
  it("rejects R05 omitted explicit exam title atomically", () => {
    const msg=message("Ngày 11/10 đi thi, nhắc tôi trước 2 ngày.");
    const built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
    if(built.status!=="READY") throw Error(built.reason);
    const ref={kind:"USER_QUOTE",turn:built.input.currentTurn,quote:msg.text,occurrence:1};
    const value=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[ref]},changes:[{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence:[ref]},{field:"leadOffsetDays",operation:"SET",value:2,evidence:[ref]}],query:null,uncertainties:[]});
    const before=JSON.stringify(value);
    expect(validateEvidenceV3(value,built)).toEqual({status:"REFUSED",reason:"SEMANTIC_TITLE_OMITTED"});
    expect(JSON.stringify(value)).toBe(before);
  });
  it("rejects R02's omitted explicit venue without filling or modifying the proposal", () => {
    const msg = message("Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.");
    const built = buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
    if(built.status!=="READY") throw new Error(built.reason);
    const ref={kind:"USER_QUOTE",turn:built.input.currentTurn,quote:msg.text,occurrence:1};
    const proposal=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[ref]},changes:[{field:"title",operation:"SET",value:"đi thi",evidence:[ref]}],query:null,uncertainties:[]});
    const before=JSON.stringify(proposal);
    const diagnostics: DownstreamDiagnostic[]=[];
    expect(validateEvidenceV3(proposal,built,d=>diagnostics.push(d))).toEqual({status:"REFUSED",reason:"SEMANTIC_LOCATION_OMITTED"});
    expect(diagnostics.some(d=>d.reason==="SEMANTIC_LOCATION_OMITTED")).toBe(true);
    expect(diagnostics.every(d=>DownstreamDiagnosticSchema.safeParse(d).success)).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain("Quang Trung");
    expect(JSON.stringify(proposal)).toBe(before);
    expect(built.candidateSnapshot.slots.location.value).toBeNull();
  });
  it.each([
    ["đi thi ở Quang Trung", "Quang Trung", true],
    ["họp tại Công ty A", "Công ty A", true],
    ["đi thi ở Quang Trung", "khác", false],
    ["đi thi ở Quang Trung", null, false],
    ["đi thi ở Quang Trung", undefined, false],
    ["nhắc gọi mẹ", undefined, true],
    ["không đi thi ở Quang Trung", undefined, true],
    ["nếu đi thi ở Quang Trung", undefined, true],
    ["ví dụ đi thi ở Quang Trung", undefined, true],
    ["tên là đi thi ở Quang Trung", undefined, true],
    ["\"đi thi ở Quang Trung\"", undefined, true],
    ["đi thi ở đâu?", undefined, true],
    ["đi thi ở Quang Trung hay Công ty A", undefined, true],
    ["đi thi ở [CONTROL]", undefined, true],
    ["😀 đi thi ở Quang Trung", "Quang Trung", true],
    ["đi thi ở Quang Trung nhớ mang giấy tờ", "Quang Trung", true],
    ["đi thi ở Quang Trung nhé", "Quang Trung", true],
    ["đi thi ở Quang Trung rồi về nhà", "Quang Trung", true],
    ["đi thi ở Quang Trung và ăn trưa", "Quang Trung", true],
    ["họp tại Công ty Ngày Mới", "Công ty Ngày Mới", true],
    ["họp tại Công ty Ngày Mới", "Công ty", false],
    ["họp tại công ty ngày mới", "công ty", false],
    ["họp tại Công ty Nhớ Mãi", "Công ty", false],
    ["đi thi ở Quang Trung nhớ mua bút", "Quang Trung", true],
    ["họp tại Công ty A rồi chuẩn bị tài liệu", "Công ty A", true],
    ["đi thi ở Quang Trung nhớ mua bút", undefined, true],
    ["đi thi ở Quang Trung nhắc anh mang bút", "Quang Trung", true],
    ["đi thi ở Quang Trung nhắc anh mang bút", undefined, true],
    ["đi thi ở Quang Trung", "Quang", false],
  ] as const)("bounded coverage: %s", (text,value,want) => expect(coverage(text,value)).toBe(want));
  it("current retained exact venue covers KEEP, never NEW or a changed venue",()=>{
    expect(coverage("đi thi ở Quang Trung",undefined,{target:"CURRENT",retained:"Quang Trung"})).toBe(true);
    expect(coverage("đi thi ở Quang Trung",undefined,{retained:"Quang Trung"})).toBe(false);
    expect(coverage("đi thi ở Công ty A",undefined,{target:"CURRENT",retained:"Quang Trung"})).toBe(false);
    expect(coverage("đi thi ở Quang Trung",null,{target:"CURRENT",retained:"Quang Trung",clear:true})).toBe(false);
    expect(coverage("họp tại Công ty Ngày Mới",undefined,{target:"CURRENT",retained:"Công ty"})).toBe(false);
  });
  it("requires current grounded location alternative, not empty uncertainty or old source",()=>{
    expect(coverage("đi thi ở Quang Trung","Quang Trung",{uncertainty:true})).toBe(true);
    expect(coverage("đi thi ở Quang Trung",undefined,{uncertainty:true})).toBe(false);
    expect(coverage("đi thi ở Quang Trung","Quang Trung",{source:"old"})).toBe(false);
    expect(coverage("đi thi ở Quang Trung","Quang Trung",{source:"assistant"})).toBe(false);
  });
  it("side query establishes no fresh reminder coverage obligation",()=>expect(coverage("lịch đi thi ở Quang Trung",undefined,{intent:"LIST_REMINDERS"})).toBe(true));
  it("service blocks omitted venue without creating a partial draft or reminder",async()=>{
    const h=await harness([scriptedProposal(complete)]);
    await h.turn(0,"nhắc 8h ngày 8/10/2026 đi thi ở Quang Trung");
    const state=await h.read(1);
    expect(state?.slots.location.value??null).toBeNull();
    expect(state?.slots.title.value??null).toBeNull();
    expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminders").first("n")).toBe(0);
    expect(h.events.some(e=>e.event==="PROVENANCE_DOMAIN_VALIDATED"&&e.result==="INVALID")).toBe(true);
    expect(h.events.some(e=>e.event==="POST_CANONICAL_STAGE"&&e.diagnostic.reason==="SEMANTIC_LOCATION_OMITTED")).toBe(true);
  });
});
