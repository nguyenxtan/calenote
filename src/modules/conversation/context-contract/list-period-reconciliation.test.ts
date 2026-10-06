// @vitest-environment node
import {expect,it} from "vitest";
import {buildContextInputV2} from "./context";
import {chat,message,observation} from "./context-test-fixtures";
import {ConversationInterpretationV3Schema,SemanticPatchProposalV3Schema} from "./contracts";
import {CONTEXT_PROTOCOL_V3} from "./protocol";
import {validateEvidenceV3} from "./evidence";
import {mergePatchV3} from "./merge";
import {encodeGoogleLiteEuContextV3,decodeGoogleLiteEuContextTransportV3} from "../../intelligence/infrastructure/openrouter/context-provider-wire";
import * as reconciliation from "./list-period-reconciliation";
const setup=(text:string,quote=text,intent="LIST_REMINDERS",kind="DATE",transform?:(wire:Record<string,unknown>)=>void)=>{
 const msg=message(text),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
 if(built.status!=="READY")throw Error(built.reason);
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"LIST_REMINDERS",requestTarget:null,changes:[],query:{kind:"LIST",period:{kind:"MONTH",offset:0},statusScope:"DEFAULT",evidence:[{kind:"USER_QUOTE",turn:built.input.currentTurn,quote,occurrence:1}]},uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeGoogleLiteEuContextV3(canonical) as {intent:string;query:{period:{kind:string}}};wire.query.period.kind=kind;wire.intent=intent;
 transform?.(wire);
 const decoded=decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3);
 if(decoded.status!=="PARSED")throw Error(decoded.reason);
 return {built,value:decoded.value};
};
it.each([{text:"tháng này",kind:"MONTH"},{text:"phần còn lại của tháng này",kind:"REST_OF_MONTH"},{text:"7 ngày tới",kind:"NEXT_7_DAYS"}])("selects backend $kind with unknown token",({text,kind})=>{
 const {built,value}=setup(text);const result=reconciliation.reconcileListPeriodV3(value,built);
 expect(result.status).toBe("PARSED");if(result.status!=="PARSED")throw Error(result.reason);
 expect(result.value.semantic.query).toMatchObject({period:{kind}});
 expect(result.value.fullSchemaValid).toBe(true);
});
it.each(["fact-only","override","unknown-null-fact"])("preserves exact fact binding across %s",mode=>{
 const initial=mode==="unknown-null-fact"?setup("Có lịch nào ko?"):setup("lời nhắc tuần sau","lời nhắc tuần sau","LIST_REMINDERS","WEEK");
 const initialSections=reconciliation.reconcileListPeriodV3(initial.value,initial.built);
 if(initialSections.status!=="PARSED")throw Error(initialSections.reason);
 const proposal=SemanticPatchProposalV3Schema.parse({...initialSections.value.semantic,query:{...initialSections.value.semantic.query!,period:mode==="unknown-null-fact"?null:{kind:"WEEK",offset:1}}});
 const checked=validateEvidenceV3(proposal,initial.built);if(checked.status!=="VALID")throw Error(checked.reason);
 const merged=mergePatchV3(null,checked.patch);if(merged.status!=="MERGED")throw Error("merge");
 const state=merged.candidate;
 state.pendingQueryQuestion={questionId:"query-question",text:"Khoảng nào?",scope:"QUERY",field:"queryRange",decisionKind:null,reason:"MISSING",noProgressCount:0,deliveryState:"SENT",issuedAfterOrder:{receivedAt:state.inbound.receivedAt,rowid:state.inbound.rowid}};
 const msg={...message(mode==="fact-only"?"có":"tháng này"),id:"answer",receivedAt:message().receivedAt+60000},context={...chat,inboundRowId:3};
 const observed=observation(null,msg,context);
 const built=buildContextInputV2({message:msg,context,snapshot:state,observation:{...observed,observed:{presence:"PRESENT",contextId:state.id,contextRevision:state.contextRevision}}});
 if(built.status!=="READY")throw Error(built.reason);
 const fact=built.input.facts.find(f=>f.scope==="QUERY")!;
 const canonical=ConversationInterpretationV3Schema.parse({...initialSections.value.semantic,query:{...fact.value,evidence:[{kind:"CONTEXT_FACT",ref:fact.alias},...(mode==="fact-only"?[]:[{kind:"USER_QUOTE",turn:built.input.currentTurn,quote:"tháng này",occurrence:1}])]},uncertainties:mode==="unknown-null-fact"?[{field:"queryRange",reason:"MISSING",alternatives:[]}]:[],conversationDirective:null,replyProposal:null});
 const wire=encodeGoogleLiteEuContextV3(canonical) as {query:{period:unknown}};
 if(mode==="unknown-null-fact")wire.query.period={kind:"DATE",date:null,offset:null,from:null,through:null};
 const decoded=decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3);if(decoded.status!=="PARSED")throw Error(decoded.reason);
 const reconciled=reconciliation.reconcileListPeriodV3(decoded.value,built);
 expect(reconciled.status).toBe("PARSED");if(reconciled.status!=="PARSED")throw Error(reconciled.reason);
 const final=validateEvidenceV3(reconciled.value.semantic,built);expect(final.status).toBe("VALID");
 if(final.status==="VALID")expect(final.patch.resolvedQuery).toMatchObject({period:mode==="fact-only"?null:{kind:"MONTH",offset:0}});
});
it.each(["Có lịch nào ko?",'chữ "tháng này"',"không phải tháng này","tháng này hoặc tuần này"])("unsupported phrase stays missing: %s",text=>{
 const {built,value}=setup(text);const result=reconciliation.reconcileListPeriodV3(value,built);
 expect(result.status).toBe("PARSED");if(result.status!=="PARSED")throw Error(result.reason);
 expect(result.value.semantic.query).toMatchObject({period:null});expect(result.value.semantic.uncertainties).toContainEqual({field:"queryRange",reason:"MISSING",alternatives:[]});
});
it("explicit month cannot rescue a fabricated mandatory quote",()=>{
 const {built,value}=setup("tháng này","fabricated secret");
 expect(reconciliation.reconcileListPeriodV3(value,built).status).toBe("REFUSED");
});
it("final canonical ownership remains strict",()=>{
 expect(()=>setup("tháng này","tháng này","CREATE_REMINDER")).toThrow("SEMANTIC_PATCH_INVALID");
});
it.each(["wrong-role","wrong-occurrence","wrong-fact","bad-alternative"])("explicit month cannot rescue %s",mode=>{
 const {built,value}=setup("tháng này","tháng này","LIST_REMINDERS","DATE",wire=>{
  const query=wire.query as {evidence:{primaryEvidence:string}};
  const primary=JSON.parse(query.evidence.primaryEvidence);
  if(mode==="wrong-role")query.evidence.primaryEvidence=JSON.stringify({...primary,turn:11});
  if(mode==="wrong-occurrence")query.evidence.primaryEvidence=JSON.stringify({...primary,occurrence:2});
  if(mode==="wrong-fact")query.evidence.primaryEvidence=JSON.stringify({kind:"CONTEXT_FACT",ref:"f999",turn:null,quote:null,occurrence:null});
  if(mode==="bad-alternative")wire.uncertainties=[{fieldCode:14,reason:"AMBIGUOUS",alternatives:[JSON.stringify({value:{kind:"MONTH",offset:0},evidence:[{kind:"USER_QUOTE",turn:0,quote:"not present",occurrence:1}]})]}];
 });
 expect(reconciliation.reconcileListPeriodV3(value,built).status).toBe("REFUSED");
});
