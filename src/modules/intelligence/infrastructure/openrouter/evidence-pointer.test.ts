// @vitest-environment node
import {expect,it} from "vitest";
import * as pointerModule from "./evidence-pointer";
import {materializeProviderEvidence,evidenceSourceCatalogue,EvidencePointerFailure,projectEvidencePointerStructure,primaryEvidencePointerDomain} from "./evidence-pointer";
import {ContextInputSchema,SemanticPatchProposalV3Schema} from "../../../conversation/context-contract/contracts";
import {buildContextInputV2} from "../../../conversation/context-contract/context";
import {chat,message,observation,snapshot} from "../../../conversation/context-contract/context-test-fixtures";
import {ContextSnapshotV2Schema} from "../../../conversation/context-contract/state";
import {validateEvidenceV3} from "../../../conversation/context-contract/evidence";
import {encodeFixtureV3} from "../../../../../tools/benchmark/context-pointer-fixtures";
const input=ContextInputSchema.parse({schemaVersion:"calenote-context-input-2",reference:{instant:"2026-09-28T03:00:00.000Z",localDate:"2026-09-28",timezone:"Asia/Ho_Chi_Minh"},turns:[{role:"USER",text:"nhắc gọi mẹ"},{role:"ASSISTANT",text:"Bạn muốn lúc nào?"},{role:"USER",text:"8h sáng"}],currentTurn:2,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:"context-capabilities-1",supported:["ONCE"],unsupported:["YEARLY"],calendars:["GREGORIAN"],limits:{dailyCount:30,horizonDays:366}}});
const carrier=(ref:unknown)=>({primaryEvidence:JSON.stringify(ref),additionalEvidenceJson:"[]"});
it("wire53 preserves all source choices through one exact codebook and current subset",()=>{
 const context=structuredClone(input);context.turns[0].text="a[CONTROL]b";
 context.facts=[{alias:"f1",scope:"REMINDER",field:"title",value:"PRIVATE",provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:"2026-09-28T03:00:00Z",dependencies:[]}];
 const book=pointerModule.primaryEvidenceSourceCodebook(context);
 expect(book.codes).toEqual(["U2","S0.0","S0.1","Ff1"]);
 expect(book.currentCodes).toEqual(["U2"]);
 expect(book.decode("S0.1")).toBe('{"kind":"USER_SEGMENT","turn":0,"segment":1}');
 expect(book.encode('{"kind":"CONTEXT_FACT","ref":"f1"}')).toBe("Ff1");
 expect(Object.isFrozen(book)).toBe(true);expect(Object.isFrozen(book.entries)).toBe(true);
 for(const entry of book.entries){expect(book.decode(book.encode(entry.pointerJson))).toBe(entry.pointerJson);expect(Object.isFrozen(entry)).toBe(true);}
 expect(JSON.stringify(book.entries)).not.toContain("PRIVATE");
});
it("wire53 never maps inactive padding or extra/alternative code strings, and safe failure cannot leak secrets",()=>{
 const evidence={primaryEvidence:"PRIVATE_SOURCE_SECRET",additionalEvidenceJson:"[]"};let failure:EvidencePointerFailure|undefined;
 try{pointerModule.expandPrimaryEvidenceSourceCodes({changes:[{evidence}]},input);}catch(error){failure=error as EvidencePointerFailure;}
 expect(failure?.diagnostic).toMatchObject({reason:"SOURCE_CODE_INVALID",pointerKind:"UNKNOWN",pointerKindType:"string"});expect(failure?.diagnostic.pointerKindDigest).toHaveLength(64);expect(JSON.stringify(failure)).not.toContain("PRIVATE_SOURCE_SECRET");
 const raw={operationCode:"6",query:{evidence},requestTarget:null,changes:[],uncertainties:[{alternatives:['{"value":"PRIVATE_SOURCE_SECRET","evidence":["U2"]}']}],replyProposal:{text:"U2"}};
 expect(pointerModule.expandPrimaryEvidenceSourceCodes(raw,input)).toEqual(raw);
 const getter={get primaryEvidence(){throw Error("PRIVATE_ACCESSOR");},additionalEvidenceJson:"[]"};
 expect(()=>pointerModule.expandPrimaryEvidenceSourceCodes({changes:[{evidence:getter}]},input)).toThrow(EvidencePointerFailure);
});
it("wire53 expands only active primary slots and refuses legacy JSON without fallback",()=>{
 const raw={operationCode:"3",requestTarget:null,query:{evidence:{primaryEvidence:"U2",additionalEvidenceJson:'[{"kind":"USER_TURN","turn":0}]'}},changes:[],uncertainties:[{alternatives:['{"value":"U2"}']}],replyProposal:{text:"U2"}};
 const out=pointerModule.expandPrimaryEvidenceSourceCodes(raw,input) as typeof raw;
 expect(out.query.evidence.primaryEvidence).toBe('{"kind":"USER_TURN","turn":2}');
 expect(out.query.evidence.additionalEvidenceJson).toBe(raw.query.evidence.additionalEvidenceJson);
 expect(out.uncertainties).toEqual(raw.uncertainties);expect(out.replyProposal).toEqual(raw.replyProposal);expect(raw.query.evidence.primaryEvidence).toBe("U2");
 for(const code of ['{"kind":"USER_TURN","turn":2}',"U1","U02"," u2","U2 ","u2","S2.0","Ff1",null,1])expect(()=>pointerModule.expandPrimaryEvidenceSourceCodes({...raw,query:{evidence:{primaryEvidence:code,additionalEvidenceJson:"[]"}}},input)).toThrow();
});
it("source availability excludes assistant/controlled whole-turn pointers and preserves existing aliases",()=>{
  const context=structuredClone(input);context.turns[0].text="a[CONTROL]b[CONTROL]";
  context.facts=[{alias:"f1",scope:"REMINDER",field:"title",value:"private retained",provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:"2026-09-28T03:00:00Z",dependencies:[]},{alias:"f2",scope:"QUERY",field:"queryRange",value:{kind:"LIST",period:null,statusScope:"DEFAULT",evidence:[{kind:"USER_QUOTE",turn:2,quote:"8h sáng",occurrence:1}]},provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:"2026-09-28T03:00:00Z",dependencies:[]}];
  const before=JSON.stringify(context),domain=primaryEvidencePointerDomain(context);
  expect(domain.map(text=>JSON.parse(text))).toEqual([{kind:"USER_TURN",turn:2},{kind:"USER_SEGMENT",turn:0,segment:0},{kind:"USER_SEGMENT",turn:0,segment:1},{kind:"CONTEXT_FACT",ref:"f1"},{kind:"CONTEXT_FACT",ref:"f2"}]);
  expect(JSON.stringify(domain)).not.toContain("private");expect(JSON.stringify(context)).toBe(before);
});
it("invalid/empty source context fails closed without default pointer",()=>{
  const invalid=structuredClone(input);invalid.currentTurn=1;
  expect(()=>primaryEvidencePointerDomain(invalid)).toThrow("EVIDENCE_SOURCE_CONTEXT_INVALID");
  const empty=structuredClone(input);empty.turns=[{role:"USER",text:"[CONTROL]"}];empty.currentTurn=0;
  expect(()=>primaryEvidencePointerDomain(empty)).toThrow("EVIDENCE_SOURCE_DOMAIN_EMPTY");
});
it("source domains preserve every eligible controlled segment and fact without silent caps",()=>{
  const context=structuredClone(input);
  context.turns=Array.from({length:12},(_,index)=>({role:index%2?"USER" as const:"ASSISTANT" as const,text:Array.from({length:10},()=>"x").join("[CONTROL]")}));context.currentTurn=11;
  context.facts=Array.from({length:26},(_,index)=>({alias:`f${index+1}`,scope:"REMINDER" as const,field:"title" as const,value:"private",provenance:{kind:"EXPLICIT_USER" as const},sourceReferenceTime:"2026-09-28T03:00:00Z",dependencies:[]}));
  const domain=primaryEvidencePointerDomain(context).map(text=>JSON.parse(text));
  expect(domain).toHaveLength(86);
  expect(domain).toContainEqual({kind:"USER_SEGMENT",turn:11,segment:9});expect(domain).toContainEqual({kind:"CONTEXT_FACT",ref:"f26"});
  expect(domain.some(value=>value.kind==="USER_TURN")).toBe(false);
  const book=pointerModule.primaryEvidenceSourceCodebook(context);
  expect(book.codes).toHaveLength(86);expect(book.currentCodes).toEqual(Array.from({length:10},(_,index)=>`S11.${index}`));
  expect(book.decode("S11.9")).toBe('{"kind":"USER_SEGMENT","turn":11,"segment":9}');expect(book.decode("Ff26")).toBe('{"kind":"CONTEXT_FACT","ref":"f26"}');
});
it("pointer diagnostic projection reads only descriptor scalars and counts secret keys",()=>{
  const pointer={kind:"PRIVATE_UNKNOWN_KIND",turn:2,segment:1,PRIVATE_KEY:"PRIVATE_VALUE",get quote(){throw Error("PRIVATE_ACCESSOR");}};
  const diagnostic=projectEvidencePointerStructure("POINTER_SHAPE",pointer,input);
  expect(diagnostic).toMatchObject({reason:"POINTER_SHAPE",pointerKind:"UNKNOWN",pointerKindType:"string",requestedTurn:2,requestedSegment:1,sourceRole:"USER",unknownKeyCount:2});
  expect(diagnostic.pointerKindDigest).toHaveLength(64);
  expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE_");
  expect(projectEvidencePointerStructure("POINTER_SHAPE",{get kind(){throw Error("PRIVATE_ACCESSOR");},get turn(){throw Error("PRIVATE_ACCESSOR");}},input)).toMatchObject({pointerKind:"UNKNOWN",pointerKindType:"undefined",sourceRole:"MISSING"});
});
it("pointer diagnostics bound observed unknown-key count without names or values",()=>{
  const pointer={kind:"USER_TURN",turn:2,...Object.fromEntries(Array.from({length:70},(_,index)=>[`PRIVATE_KEY_${index}`,"PRIVATE_VALUE"]))};
  let failure:EvidencePointerFailure|undefined;
  try{materializeProviderEvidence({changes:[{evidence:carrier(pointer)}]},input,true);}catch(error){failure=error as EvidencePointerFailure;}
  expect(failure?.diagnostic).toMatchObject({reason:"POINTER_SHAPE",unknownKeyCount:64,unknownKeyCountTruncated:true});
  expect(JSON.stringify(failure)).not.toContain("PRIVATE_");
});
it.each([
  ["INPUT_MISSING",{kind:"USER_TURN",turn:0},undefined,false],
  ["SOURCE_TEXT_INVALID",{kind:"USER_TURN",turn:0},"a\u0301",true],
  ["SEGMENT_INVALID",{kind:"USER_SEGMENT",turn:0,segment:-1},"a[CONTROL]b",true],
  ["SEGMENT_MISSING",{kind:"USER_SEGMENT",turn:0,segment:2},"a[CONTROL]b",true],
  ["SEGMENT_EMPTY",{kind:"USER_SEGMENT",turn:0,segment:1},"a[CONTROL]",true],
  ["SEGMENT_OCCURRENCE_MISSING",{kind:"USER_SEGMENT",turn:0,segment:1},"[CONTROL]]]",true],
  ["EXPANDED_REF_INVALID",{kind:"USER_TURN",turn:0},"",true]
] as const)("remaining pointer throw branch %s has exact finite diagnostics",(reason,pointer,text,hasInput)=>{
  const context=structuredClone(input);if(text!==undefined)context.turns[0].text=text;
  let failure:EvidencePointerFailure|undefined;
  try{materializeProviderEvidence({changes:[{evidence:carrier(pointer)}]},hasInput?context:undefined,true);}catch(error){expect(error).toBeInstanceOf(EvidencePointerFailure);failure=error as EvidencePointerFailure;}
  expect(failure?.diagnostic.reason).toBe(reason);
});
it.each([
  [{kind:"USER_QUOTE",turn:2,quote:"PRIVATE_QUOTE",occurrence:1},"STRICT_USER_QUOTE"],
  [{kind:"USER_TURN",turn:2,PRIVATE_SECRET_KEY:"PRIVATE_VALUE"},"POINTER_SHAPE"],
  [{kind:"USER_TURN",turn:-1},"TURN_INVALID"],
  [{kind:"USER_TURN",turn:3},"SOURCE_MISSING"],
  [{kind:"USER_TURN",turn:1},"SOURCE_ROLE"],
  [{kind:"USER_SEGMENT",turn:2,segment:0},"SEGMENT_SOURCE_UNAVAILABLE"],
] as const)("pointer failure carries finite throw-boundary reason %# without raw values",(pointer,reason)=>{
  let failure:EvidencePointerFailure|undefined;
  try{materializeProviderEvidence({changes:[{evidence:carrier(pointer)}]},input,true);}catch(error){expect(error).toBeInstanceOf(EvidencePointerFailure);failure=error as EvidencePointerFailure;}
  expect(failure).toBeDefined();
  expect(failure).toHaveProperty("diagnostic.reason",reason);
  expect(JSON.stringify(failure)).not.toContain("PRIVATE_");
});
it("materializes only the exact unchanged selected USER source",()=>{
 const raw={requestTarget:{evidence:carrier({kind:"USER_TURN",turn:2})},changes:[{value:"USER_TURN",evidence:carrier({kind:"USER_TURN",turn:0})}],query:null,uncertainties:[],replyProposal:{text:"untouched"}};
 const expanded=materializeProviderEvidence(raw,input) as typeof raw;
 expect(JSON.parse(expanded.requestTarget.evidence.primaryEvidence)).toEqual({kind:"USER_QUOTE",turn:2,quote:"8h sáng",occurrence:1});
 expect(JSON.parse(expanded.changes[0].evidence.primaryEvidence)).toEqual({kind:"USER_QUOTE",turn:0,quote:"nhắc gọi mẹ",occurrence:1});
 expect(raw.requestTarget.evidence.primaryEvidence).toContain("USER_TURN");expect(expanded.replyProposal).toEqual(raw.replyProposal);
});
it.each([{kind:"USER_TURN",turn:1},{kind:"USER_TURN",turn:3},{kind:"USER_TURN",turn:-1},{kind:"USER_TURN",turn:"0"},{kind:"USER_TURN",turn:0,quote:"forged"},{kind:"USER_TURN",turn:0,occurrence:1}])("rejects invalid pointer %j without substitution",ref=>expect(()=>materializeProviderEvidence({operationCode:"3",query:{evidence:carrier(ref)}},input)).toThrow());
it("pointer without validated dispatch context fails closed",()=>expect(()=>materializeProviderEvidence({operationCode:"3",query:{evidence:carrier({kind:"USER_TURN",turn:0})}})).toThrow());
it.each(["","x".repeat(2001),"e\u0301","\ud800"])("does not clip or normalize invalid source",text=>expect(()=>materializeProviderEvidence({operationCode:"3",query:{evidence:carrier({kind:"USER_TURN",turn:0})}},{...input,turns:[{role:"USER",text}]})).toThrow());
it("preserves legacy refs and fact pointers losslessly and expands alternatives",()=>{
 const refs=[{kind:"CONTEXT_FACT",ref:"f1"},{kind:"USER_QUOTE",turn:0,quote:"gọi mẹ",occurrence:1}];
 const raw={operationCode:"3",query:{evidence:{primaryEvidence:JSON.stringify(refs[0]),additionalEvidenceJson:JSON.stringify([refs[1],{kind:"USER_TURN",turn:2}])}},uncertainties:[{alternatives:[JSON.stringify({value:2,evidence:[{kind:"USER_TURN",turn:0}]})]}]};
 const out=materializeProviderEvidence(raw,input) as typeof raw;
 expect(JSON.parse(out.query.evidence.primaryEvidence)).toEqual(refs[0]);expect(JSON.parse(out.query.evidence.additionalEvidenceJson)[0]).toEqual(refs[1]);
 expect(JSON.parse(out.uncertainties[0].alternatives[0]).evidence[0].quote).toBe("nhắc gọi mẹ");
});
it.each(["Nhắc 2 ngày liên tiếp.","mang 2 cây bút","Đừng nhắc trước 2 ngày.","Ví dụ nhắc trước 2 ngày.","Nhắc trước 3 ngày.","Nhắc trước ngày thi; tôi đi công tác 2 ngày trước."])("pointer cannot authorize unsupported offset: %s",text=>{
 const msg=message(text),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
 if(built.status!=="READY")throw Error(built.reason);
 const out=materializeProviderEvidence({requestTarget:{evidence:carrier({kind:"USER_TURN",turn:built.input.currentTurn})}},built.input) as {requestTarget:{evidence:{primaryEvidence:string}}};
 const evidence=[JSON.parse(out.requestTarget.evidence.primaryEvidence)];
 expect(validateEvidenceV3(SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"leadOffsetDays",operation:"SET",value:2,evidence}],query:null,uncertainties:[]}),built).status).toBe("REFUSED");
});
it("grounded offset still passes the unchanged validator",()=>{
 const msg=message("Nhắc trước 2 ngày."),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
 if(built.status!=="READY")throw Error(built.reason);
 const out=materializeProviderEvidence({operationCode:"3",query:{evidence:carrier({kind:"USER_TURN",turn:built.input.currentTurn})}},built.input) as {operationCode:"3",query:{evidence:{primaryEvidence:string}}};
 const evidence=[JSON.parse(out.query.evidence.primaryEvidence)];
 expect(validateEvidenceV3(SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"leadOffsetDays",operation:"SET",value:2,evidence}],query:null,uncertainties:[]}),built).status).toBe("VALID");
});
it("historical USER pointer cannot authorize a current request target",()=>{
 const state=ContextSnapshotV2Schema.parse({...snapshot(),schemaVersion:"calenote-context-state-2",pendingSemanticCandidate:null});
 const msg=message("nhắc mới"),built=buildContextInputV2({message:msg,context:chat,snapshot:state,observation:observation(snapshot(),msg)});
 if(built.status!=="READY")throw Error(built.reason);
 const out=materializeProviderEvidence({requestTarget:{evidence:carrier({kind:"USER_TURN",turn:0})}},built.input) as {requestTarget:{evidence:{primaryEvidence:string}}};
 const evidence=[JSON.parse(out.requestTarget.evidence.primaryEvidence)];
 expect(validateEvidenceV3(SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[],query:null,uncertainties:[]}),built).status).toBe("REFUSED");
});
it("whole-source materialization does not bypass removed control-span protection",()=>{
 const base=snapshot();base.controlRegistry=[{handle:"CN-AbC123",kind:"TOKEN",ownerId:"owner",chatIdentityId:"identity",chatId:"chat",decisionId:"d",contextRevision:1,draftRevision:1,expiresAt:"2026-09-28T03:10:00.000Z"}];
 const state=ContextSnapshotV2Schema.parse({...base,schemaVersion:"calenote-context-state-2",pendingSemanticCandidate:null});
 const msg=message("đổi CN-AbC123 sang 9h"),built=buildContextInputV2({message:msg,context:chat,snapshot:state,observation:observation(base,msg)});
 if(built.status!=="READY")throw Error(built.reason);
 const out=materializeProviderEvidence({requestTarget:{evidence:carrier({kind:"USER_TURN",turn:built.input.currentTurn})}},built.input) as {requestTarget:{evidence:{primaryEvidence:string}}};
 const evidence=[JSON.parse(out.requestTarget.evidence.primaryEvidence)];
 expect(validateEvidenceV3(SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[],query:null,uncertainties:[]}),built)).toEqual({status:"REFUSED",reason:"EVIDENCE_REMOVED_SPAN"});
});
it.each(["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.","Không nhắc trước ngày thi.","Ví dụ nhắc trước ngày thi.","Nhắc trước ngày thi và tính cả ngày thi."])("source pointer cannot substantiate an unsupported relation: %s",text=>{
 const msg=message(text),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
 if(built.status!=="READY")throw Error(built.reason);
 const out=materializeProviderEvidence({requestTarget:{evidence:carrier({kind:"USER_TURN",turn:built.input.currentTurn})}},built.input) as {requestTarget:{evidence:{primaryEvidence:string}}};
 const evidence=[JSON.parse(out.requestTarget.evidence.primaryEvidence)];
 const title=text.startsWith("Ngày 11/10 đi thi")?[{field:"title",operation:"SET",value:"đi thi",evidence}]:[];
 const checked=validateEvidenceV3(SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[...title,{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence}],query:null,uncertainties:[]}),built);
 expect(checked.status).toBe("VALID");
 if(checked.status==="VALID"){
  expect(checked.patch.resolvedChanges.filter(change=>change.field==="eventRelation")).toEqual([]);
  expect(checked.patch.resolvedChanges).toEqual(title);
 }
});
it("inactive query padding is never materialized into evidence authority",()=>{
 const query={evidence:carrier({kind:"USER_TURN",turn:99})};
 expect((materializeProviderEvidence({operationCode:"1",query},input) as {query:unknown}).query).toBe(query);
});
it.each(["primary","extra","alternative"])("current transport rejects model-authored quotes in %s",location=>{
 const quote={kind:"USER_QUOTE",turn:0,quote:"nhắc gọi mẹ",occurrence:1};
 const raw=location==="alternative"?{uncertainties:[{alternatives:[JSON.stringify({value:2,evidence:[quote]})]}]}:{operationCode:"3",query:{evidence:location==="primary"?carrier(quote):{primaryEvidence:JSON.stringify({kind:"USER_TURN",turn:0}),additionalEvidenceJson:JSON.stringify([quote])}}};
 expect(()=>materializeProviderEvidence(raw,input,true)).toThrow("EVIDENCE_POINTER_INVALID");
});
it("backend catalogues exact segments without trimming and materializes only selected segment",()=>{
 const selected={...input,turns:[{role:"USER" as const,text:"đổi sang 9h. [CONTROL] ghi chú"}],currentTurn:0};
 expect(evidenceSourceCatalogue(selected)).toEqual([{kind:"USER_SEGMENT",turn:0,segment:0,text:"đổi sang 9h. "},{kind:"USER_SEGMENT",turn:0,segment:1,text:" ghi chú"}]);
 const raw={requestTarget:{evidence:carrier({kind:"USER_SEGMENT",turn:0,segment:0})}};
 const out=materializeProviderEvidence(raw,selected,true) as typeof raw;
 expect(JSON.parse(out.requestTarget.evidence.primaryEvidence)).toEqual({kind:"USER_QUOTE",turn:0,quote:"đổi sang 9h. ",occurrence:1});
 for(const segment of [-1,2,"0",null])expect(()=>materializeProviderEvidence({requestTarget:{evidence:carrier({kind:"USER_SEGMENT",turn:0,segment})}},selected,true)).toThrow();
});
it("an explicit segment beside a removed control still runs unchanged source-map validation",()=>{
 const base=snapshot();base.controlRegistry=[{handle:"CN-AbC123",kind:"TOKEN",ownerId:"owner",chatIdentityId:"identity",chatId:"chat",decisionId:"d",contextRevision:1,draftRevision:1,expiresAt:"2026-09-28T03:10:00.000Z"}];
 const state=ContextSnapshotV2Schema.parse({...base,schemaVersion:"calenote-context-state-2",pendingSemanticCandidate:null});
 const msg=message("đổi sang 9h. CN-AbC123"),built=buildContextInputV2({message:msg,context:chat,snapshot:state,observation:observation(base,msg)});
 if(built.status!=="READY")throw Error(built.reason);
 const out=materializeProviderEvidence({requestTarget:{evidence:carrier({kind:"USER_SEGMENT",turn:built.input.currentTurn,segment:0})}},built.input,true) as {requestTarget:{evidence:{primaryEvidence:string}}};
 const evidence=[JSON.parse(out.requestTarget.evidence.primaryEvidence)];
 expect(validateEvidenceV3(SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[],query:null,uncertainties:[]}),built).status).toBe("VALID");
});
it("repeated segments materialize the selected exact occurrence, never the first matching segment",()=>{
 const selected={...input,turns:[{role:"USER" as const,text:"x[CONTROL]x"}],currentTurn:0};
 const raw={requestTarget:{evidence:carrier({kind:"USER_SEGMENT",turn:0,segment:1})}};
 const out=materializeProviderEvidence(raw,selected,true) as typeof raw;
 expect(JSON.parse(out.requestTarget.evidence.primaryEvidence)).toEqual({kind:"USER_QUOTE",turn:0,quote:"x",occurrence:2});
});
it("catalogue excludes ASSISTANT sources and never renumbers empty segments",()=>{
 const selected={...input,turns:[{role:"ASSISTANT" as const,text:"a[CONTROL]b"},{role:"USER" as const,text:"[CONTROL]x"}],currentTurn:1};
 expect(evidenceSourceCatalogue(selected)).toEqual([{kind:"USER_SEGMENT",turn:1,segment:1,text:"x"}]);
 expect(()=>materializeProviderEvidence({requestTarget:{evidence:carrier({kind:"USER_SEGMENT",turn:1,segment:0})}},selected,true)).toThrow();
});
it("fixture conversion preserves the second identical quote's source segment",()=>{
 const selected={...input,turns:[{role:"USER" as const,text:"x[CONTROL]x"}],currentTurn:0};
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"x",occurrence:2}];
 const canonical={schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[],query:null,uncertainties:[],conversationDirective:null,replyProposal:null};
 const wire=encodeFixtureV3(canonical,selected) as {requestTarget:{evidence:{primaryEvidence:string}}};
 expect(wire.requestTarget.evidence.primaryEvidence).toBe("S0.1");
 const expanded=materializeProviderEvidence(pointerModule.expandPrimaryEvidenceSourceCodes(wire,selected),selected,true) as typeof wire;
 expect(JSON.parse(expanded.requestTarget.evidence.primaryEvidence)).toEqual(evidence[0]);
});
