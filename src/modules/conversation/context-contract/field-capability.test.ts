import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ContextInputSchema, SLOT_NAMES, type ContextInput } from "./contracts";
import { CONTROL_PLACEHOLDER } from "./projection";
import { serializeContextRequest } from "./wire";
import { z } from "zod";
import { ConversationInterpretationV3Schema } from "./contracts";
import { encodeGoogleLiteEuContextV3 as encodeCanonical, googleLiteEuContextWireSchemaV3, decodeGoogleLiteEuContextTransportV3 as decodeRawSingletonTransport } from "../../intelligence/infrastructure/openrouter/context-provider-wire";
import { CONTEXT_PROTOCOL_V3 } from "./protocol";
import { harness, proposal } from "./service-test-support";
import { date } from "./resolution-test-support";
import { deriveGenerationFieldCapability, isInitialEventDateYearNullRequired } from "./field-capability";
import * as capabilityModule from "./field-capability";
import {encodeFixtureV3} from "../../../../tools/benchmark/context-pointer-fixtures";
import {typedSingletonSchemaFixture,unwrapSingletonAuthoringFixture,wrapSingletonAuthoringFixture} from "../../../../tools/benchmark/context-singleton-json.test-support";
// Original capability language witnesses inspect the captured typed producer
// AST, not the deliberately broader opaque upstream change-string schema.
const decodeGoogleLiteEuContextTransportV3=(raw:unknown,selected:Parameters<typeof decodeRawSingletonTransport>[1],invalid?:Parameters<typeof decodeRawSingletonTransport>[2],wireInvalid?:Parameters<typeof decodeRawSingletonTransport>[3],context?:ContextInput)=>decodeRawSingletonTransport(wrapSingletonAuthoringFixture(raw),selected,invalid,wireInvalid,context);
function noClockCandidateInput(){
 const context=input("Nhắc trước 2 ngày.");context.turns=[{role:"USER",text:"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp."},{role:"ASSISTANT",text:"Nhắc lúc nào?"},{role:"USER",text:"Nhắc trước 2 ngày."}];context.currentTurn=2;
 const slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];
 slots.frequency={state:"PROPOSED",value:"DAILY",fact:null};slots.occurrenceCount={state:"PROPOSED",value:2,fact:null};slots.eventDate={state:"PROPOSED",value:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null},fact:null};context.activeRequest={lifecycle:"CLARIFYING",slots};context.pendingQuestion={scope:"REMINDER",field:"reminderTime",reason:"MISSING",text:"time?",decisionKind:null};return context;
}
function completeClockInput(){
 const context=noClockCandidateInput();context.turns[2].text="12h trưa.";
 const values={title:"đi thi",eventDate:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null},frequency:"DAILY",occurrenceCount:2,eventRelation:"BEFORE_EVENT"};
 const facts=Object.entries(values).map(([field,value],index)=>{const alias=`f${index+1}`;Object.assign(context.activeRequest!.slots[field as typeof SLOT_NAMES[number]],{state:"RESOLVED",value,fact:alias});return {alias,scope:"REMINDER",field,value,provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:context.reference.instant,dependencies:[]};});
 return ContextInputSchema.parse({...context,facts});
}
it("wire81 complete factual answer has no applicable uncertainty but retains null carriers",()=>{
 const context=completeClockInput(),evidence=[{kind:"USER_QUOTE",turn:2,quote:"12h trưa.",occurrence:1}];
 expect(capabilityModule.isBoundSourceUniqueReminderClock(context)).toBe(true);
 expect(capabilityModule.isBoundCompleteFiniteSeriesClockAnswer(context)).toBe(true);
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeFixtureV3(canonical,context);if(!wire||typeof wire!=="object"||Array.isArray(wire))throw Error("wire object required");const check=validator(context);expect(check.safeParse(wire).success).toBe(true);
 for(let fieldCode=0;fieldCode<16;fieldCode++)for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])expect(check.safeParse({...wire,uncertainties:[{fieldCode,reason,alternatives:[]}]}).success,`${fieldCode}/${reason}`).toBe(false);
 const typed=ConversationInterpretationV3Schema.parse({...canonical,uncertainties:[{field:"operation",reason:"AMBIGUOUS",alternatives:[{value:"CURRENT",evidence}]}]});expect(check.safeParse(encodeFixtureV3(typed,context)).success).toBe(false);
 for(const operation of ["SET","REPLACE","CLEAR"]){const value=ConversationInterpretationV3Schema.parse({...canonical,changes:[{field:"reminderTime",operation,value:operation==="CLEAR"?null:{hour:12,minute:0,qualifier:"H24"},evidence}]});expect(check.safeParse(encodeFixtureV3(value,context)).success,operation).toBe(true);}
});
it("wire81 each incomplete or unbound fact preserves prior operation uncertainty language",()=>{
 const baseline=completeClockInput();
 const mutations:((context:ContextInput)=>void)[]=[
  ...["title","eventDate","frequency","occurrenceCount","eventRelation"].flatMap(field=>[
   (context:ContextInput)=>{context.activeRequest!.slots[field as typeof SLOT_NAMES[number]].fact="f99";},
   (context:ContextInput)=>{context.activeRequest!.slots[field as typeof SLOT_NAMES[number]].fact=field==="title"?"f2":"f1";},
   (context:ContextInput)=>{context.activeRequest!.slots[field as typeof SLOT_NAMES[number]].state="PROPOSED";context.activeRequest!.slots[field as typeof SLOT_NAMES[number]].fact=null;},
  ]),
  context=>{context.facts.find(fact=>fact.field==="occurrenceCount")!.value=3;},
  context=>{const fact=context.facts.find(fact=>fact.field==="title")!;fact.value="other title";},
  context=>{context.facts.push({...context.facts[0],alias:"f99"});},
  context=>{context.activeRequest!.slots.calendar.fact="f99";},
  context=>{context.activeRequest!.slots.eventRelation.value="STARTING_ON";context.facts.find(fact=>fact.field==="eventRelation")!.value="STARTING_ON";},
  context=>{context.activeRequest!.slots.eventDate.value={kind:"RELATIVE_DAY",offsetDays:2};context.facts.find(fact=>fact.field==="eventDate")!.value={kind:"RELATIVE_DAY",offsetDays:2};},
  context=>{const date={kind:"CIVIL_DATE" as const,calendar:"LUNAR_VN" as const,day:11,month:10,year:null,leapMonth:null};context.activeRequest!.slots.eventDate.value=date;context.facts.find(fact=>fact.field==="eventDate")!.value=date;},
  ...["leadOffsetDays","reminderDate","endDate"].map(field=>(context:ContextInput)=>{Object.assign(context.activeRequest!.slots[field as typeof SLOT_NAMES[number]],{state:"PROPOSED",value:field==="leadOffsetDays"?2:{kind:"RELATIVE_DAY",offsetDays:2},fact:null});}),
  context=>{context.activeRequest!.slots.location={state:"CONFLICT",value:"other",fact:null};},
  context=>{context.activeRequest!.slots.calendar={state:"PROPOSED",value:"LUNAR_VN",fact:null};},
 ];
 for(const mutate of mutations){const context=structuredClone(baseline);mutate(context);if(context.activeRequest!.slots.calendar.state==="MISSING"&&context.activeRequest!.slots.calendar.fact!==null){expect(capabilityModule.isBoundCompleteFiniteSeriesClockAnswer(context)).toBe(false);continue;}ContextInputSchema.parse(context);expect(capabilityModule.isBoundCompleteFiniteSeriesClockAnswer(context)).toBe(false);
  const evidence=[{kind:"USER_QUOTE",turn:2,quote:"12h trưa.",occurrence:1}],value=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[],query:null,uncertainties:[{field:"operation",reason:"MISSING",alternatives:[]}],conversationDirective:null,replyProposal:null});
  expect(validator(context).safeParse(encodeFixtureV3(value,context)).success).toBe(true);
 }
});
it("wire79 bound exact clock excludes only its contradictory MISSING language without requiring a carrier",()=>{
 const context=noClockCandidateInput();context.turns[2].text="12h trưa.";
 context.turns[0].text+=" Ghi chú mang giấy tờ."; // Outside source-unique wire80 subset.
 const check=validator(context),wire=encodeFixtureV3(ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence:[{kind:"USER_QUOTE",turn:2,quote:"12h trưa.",occurrence:1}]},changes:[],query:null,uncertainties:[],conversationDirective:null,replyProposal:null}),context);
 expect(check.safeParse(wire).success).toBe(true);
 if(!wire||typeof wire!=="object"||Array.isArray(wire))throw Error("authored wire object required");
 for(let fieldCode=0;fieldCode<16;fieldCode++)for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"]){
  expect(check.safeParse({...wire,uncertainties:[{fieldCode,reason,alternatives:[]}]}).success,`${fieldCode}/${reason}`).toBe(!(fieldCode===6&&reason==="MISSING"));
 }
});
it.each(["8h.","12h trưa.","20:30"])("wire80 source-unique clock excludes only code6 across all reasons: %s",text=>{
 const context=noClockCandidateInput();context.turns[2].text=text;
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence:[{kind:"USER_QUOTE",turn:2,quote:text,occurrence:1}]},changes:[],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeFixtureV3(canonical,context);if(!wire||typeof wire!=="object"||Array.isArray(wire))throw Error("wire object required");
 const check=validator(context);expect(check.safeParse(wire).success).toBe(true);
 for(let fieldCode=0;fieldCode<16;fieldCode++)for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"]){expect(check.safeParse({...wire,uncertainties:[{fieldCode,reason,alternatives:[]}]}).success,`${fieldCode}/${reason}`).toBe(fieldCode!==6);}
});
it("wire80 competing retained and source candidates preserve typed uncertainty languages",()=>{
 const baseline=noClockCandidateInput();baseline.turns[2].text="12h trưa.";
 expect(capabilityModule.isBoundSourceUniqueReminderClock(baseline)).toBe(true);
 const mutations:((context:ContextInput)=>void)[]=[
  ...["eventTime","reminderTime"].map(field=>(context:ContextInput)=>{context.activeRequest!.slots[field as "eventTime"|"reminderTime"]={state:"PROPOSED",value:{hour:8,minute:0,qualifier:"H24"},fact:null};}),
  context=>{context.turns[0].text+=" lúc 8h";},context=>{context.turns[0].text+=" lúc sáng";},
  context=>{context.turns[0].text+=" Ghi chú mang giấy tờ.";},context=>{context.turns[0].text="Nhắc gọi mẹ.";},
  context=>{context.turns[0].text+=" lúc trưa";},context=>{context.turns[0].text+=" lúc 8h hoặc 9h";},
  context=>{context.activeRequest!.slots.frequency.state="CONFLICT";},
  context=>{context.activeRequest!.slots.occurrenceCount.value=31;},context=>{context.activeRequest!.slots.eventDate={state:"MISSING",value:null,fact:null};},
  context=>{context.activeRequest!.slots.notes={state:"PROPOSED",value:"meaningful",fact:null};},
  context=>{context.capabilities.supported=[];},
  ...["eventTime","reminderTime"].map(field=>(context:ContextInput)=>{context.facts=[{alias:"f1",scope:"REMINDER",field:field as "eventTime"|"reminderTime",value:{hour:8,minute:0,qualifier:"H24"},provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:context.reference.instant,dependencies:[]}];}),
  context=>{context.turns.splice(2,0,{role:"USER",text:"Nhắc trước 2 ngày lúc 8h."},{role:"ASSISTANT",text:"time?"});context.currentTurn=4;},
  context=>{context.ambiguities=[{field:"reminderTime",reason:"AMBIGUOUS",alternatives:[]}];},
 ];
 for(const mutate of mutations){
  const context=structuredClone(baseline);mutate(context);expect(capabilityModule.isBoundSourceUniqueReminderClock(context)).toBe(false);
  const evidence=[{kind:"USER_QUOTE",turn:context.currentTurn,quote:"12h trưa.",occurrence:1}];
  const value=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[],query:null,uncertainties:[{field:"reminderTime",reason:"AMBIGUOUS",alternatives:[{value:{hour:12,minute:0,qualifier:"H24"},evidence}]}],conversationDirective:null,replyProposal:null});
  expect(validator(context).safeParse(encodeFixtureV3(value,context)).success).toBe(true);
 }
 for(const field of ["eventTime","reminderTime"] as const)for(const corrupt of ["value","fact"] as const){const context=structuredClone(baseline);if(corrupt==="value")context.activeRequest!.slots[field].value={hour:8,minute:0,qualifier:"H24"};else context.activeRequest!.slots[field].fact="f1";expect(capabilityModule.isBoundSourceUniqueReminderClock(context)).toBe(false);}
});
it("wire79 exclusion declines every unproven binding and leaves operations available",()=>{
 const baseline=noClockCandidateInput();baseline.turns[2].text="12h trưa.";
 expect(capabilityModule.isBoundExactReminderClockMissingExcluded(baseline)).toBe(true);
 const mutations:((context:ContextInput)=>void)[]=[
  context=>{context.reference.instant="invalid";},context=>{context.activeRequest=null;},
  context=>{context.activeRequest!.lifecycle="AWAITING_CONFIRMATION";},context=>{context.pendingQuestion=null;},
  context=>{context.pendingQuestion!.scope="QUERY";},context=>{context.pendingQuestion!.field="eventTime";},
  context=>{context.pendingQuestion!.reason="AMBIGUOUS";},context=>{context.turns[2].role="ASSISTANT";},
  ...["sáng",'"12h"',"12h và mang giấy tờ", "không 12h", "12h hoặc 13h"].map(text=>(context:ContextInput)=>{context.turns[2].text=text;})
 ];
 for(const mutate of mutations){const context=structuredClone(baseline);mutate(context);expect(capabilityModule.isBoundExactReminderClockMissingExcluded(context)).toBe(false);}
 const evidence=[{kind:"USER_QUOTE",turn:2,quote:"12h trưa.",occurrence:1}];
 for(const operation of ["SET","REPLACE","CLEAR"]){
  const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"reminderTime",operation,value:operation==="CLEAR"?null:{hour:12,minute:0,qualifier:"H24"},evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
  expect(validator(baseline).safeParse(encodeFixtureV3(canonical,baseline)).success,operation).toBe(true);
 }
});
it("wire77 no-clock proof declines candidate-bearing or unproven contexts",()=>{
 const check=capabilityModule.isBoundMissingReminderClockWithoutCandidates;
 expect(check(noClockCandidateInput())).toBe(true);
 const mutations:((context:ContextInput)=>void)[]=[
  context=>{context.turns[0].text+=" lúc 8h";},
  context=>{context.turns[0].text+=" lúc sáng";},
  context=>{context.turns[0].text+=" lúc trưa";},
  context=>{context.turns[0].text+=" Mang giấy tờ.";},
  context=>{context.turns[2].text+=" lúc 8h";},
  context=>{context.turns[2].text="12h trưa.";},
  context=>{context.pendingQuestion=null;},
  context=>{context.pendingQuestion!.reason="AMBIGUOUS";},
  context=>{context.pendingQuestion={scope:"REMINDER",field:"eventTime",reason:"MISSING",text:"?",decisionKind:null};},
  context=>{context.activeRequest!.slots.reminderTime={state:"PROPOSED",value:{hour:8,minute:0,qualifier:"H24"},fact:null};},
  context=>{context.activeRequest!.slots.eventTime={state:"PROPOSED",value:{hour:8,minute:0,qualifier:"H24"},fact:null};},
  context=>{context.ambiguities=[{field:"reminderTime",reason:"MISSING",alternatives:[]}];},
  context=>{context.ambiguities=[{field:"reminderTime",reason:"MISSING",alternatives:[{value:{hour:8,minute:0,qualifier:"H24"},evidence:[{kind:"USER_QUOTE",turn:0,quote:"8h",occurrence:1}]}]}];},
  context=>{context.activeRequest!.slots.occurrenceCount.value=31;},
  context=>{context.activeRequest!.slots.frequency.value="WEEKLY";},
  context=>{context.activeRequest=null;},
 ];
 for(const mutate of mutations){const context=noClockCandidateInput();mutate(context);expect(check(context)).toBe(false);}
 const marker=noClockCandidateInput();marker.ambiguities=[{field:"queryRange",reason:"MISSING",alternatives:[]}];expect(check(marker)).toBe(true);
});
it("wire77 no-clock source subset permits only empty reminderTime MISSING candidates",()=>{
 const context=noClockCandidateInput(),evidence=[{kind:"USER_QUOTE",turn:2,quote:context.turns[2].text,occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeGoogleLiteEuContextV3(canonical) as {uncertainties:unknown[]},check=validator(context),candidate=JSON.stringify({value:null,evidence:{primaryEvidence:"U2",additionalEvidenceJson:"[]"}});
 const uncertainty=serializeContextRequest(context).response_format.json_schema.schema.properties!.uncertainties;
 if(typeof uncertainty==="boolean")throw Error("EXPECTED_UNCERTAINTY_SCHEMA");
 const item=uncertainty.items!;
 if(typeof item==="boolean"||Array.isArray(item))throw Error("EXPECTED_ITEM_SCHEMA");
 expect(item.anyOf).toHaveLength(3); // Disjoint item branches, no root Cartesian product.
 expect(check.safeParse(wire).success).toBe(true);
 wire.uncertainties=[{fieldCode:6,reason:"MISSING",alternatives:[]}];expect(check.safeParse(wire).success).toBe(true);
 wire.uncertainties=[{fieldCode:6,reason:"MISSING",alternatives:[candidate]}];expect(check.safeParse(wire).success).toBe(false);
 for(let fieldCode=0;fieldCode<16;fieldCode++)for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"]){wire.uncertainties=[{fieldCode,reason,alternatives:[candidate]}];expect(check.safeParse(wire).success,`${fieldCode}/${reason}`).toBe(!(fieldCode===6&&reason==="MISSING"));}
 context.turns[0].text+=" lúc 8h";expect(validator(context).safeParse({...wire,uncertainties:[{fieldCode:6,reason:"MISSING",alternatives:[candidate]}]}).success).toBe(true);
});
it.each(["USER","SEGMENT","FACT"])("wire77 grounded typed MISSING candidate remains represented outside subset: %s",source=>{
 const context=noClockCandidateInput(),value={hour:8,minute:0,qualifier:"H24" as const};
 let evidence:unknown[];
 if(source==="FACT"){
  context.facts=[{alias:"f1",scope:"REMINDER",field:"reminderTime",value,provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:"2026-10-08T03:00:00Z",dependencies:[]}];
  context.activeRequest!.slots.reminderTime={state:"RESOLVED",value,fact:"f1"};evidence=[{kind:"CONTEXT_FACT",ref:"f1"}];
 }else{
  context.turns[0].text=source==="SEGMENT"?`Nhắc lúc 8h.${CONTROL_PLACEHOLDER}Ngày 11/10 đi thi.`:"Ngày 11/10 đi thi, nhắc lúc 8h.";
  evidence=[{kind:"USER_QUOTE",turn:0,quote:"8h",occurrence:1}];
 }
 expect(capabilityModule.isBoundMissingReminderClockWithoutCandidates(context)).toBe(false);
 const current=[{kind:"USER_QUOTE",turn:2,quote:context.turns[2].text,occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence:current},changes:[],query:null,uncertainties:[{field:"reminderTime",reason:"MISSING",alternatives:[{value,evidence}]}],conversationDirective:null,replyProposal:null});
 const wire=encodeFixtureV3(canonical,context);
 expect(validator(context).safeParse(wire).success).toBe(true);
 const decoded=decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,undefined,context);
 expect(decoded.status).toBe("PARSED");
 if(decoded.status==="PARSED"){
  expect("semantic" in decoded.value).toBe(true);
  if(!("semantic" in decoded.value))throw Error("EXPECTED_SEMANTIC_PATCH");
  const materializedEvidence=source==="FACT"?evidence:[{kind:"USER_QUOTE",turn:0,quote:source==="SEGMENT"?"Nhắc lúc 8h.":context.turns[0].text,occurrence:1}];
  expect(decoded.value.semantic.uncertainties).toEqual([{field:"reminderTime",reason:"MISSING",alternatives:[{value,evidence:materializedEvidence}]}]);
 }
});
it("wire74 bound clock schema admits coherent clock only and refuses every notes operation",()=>{
 const context=input("12h trưa.");context.turns=[{role:"USER",text:"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp."},{role:"ASSISTANT",text:"Nhắc lúc nào?"},{role:"USER",text:"Nhắc trước 2 ngày."},{role:"ASSISTANT",text:"Nhắc lúc nào?"},{role:"USER",text:"12h trưa."}];context.currentTurn=4;
 const slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];slots.frequency={state:"PROPOSED",value:"DAILY",fact:null};slots.occurrenceCount={state:"PROPOSED",value:2,fact:null};slots.eventDate={state:"PROPOSED",value:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null},fact:null};context.activeRequest={lifecycle:"CLARIFYING",slots};context.pendingQuestion={scope:"REMINDER",field:"reminderTime",reason:"MISSING",text:"time?",decisionKind:null};
 const evidence=[{kind:"USER_QUOTE",turn:4,quote:context.turns[4].text,occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"reminderTime",operation:"SET",value:{hour:12,minute:0,qualifier:"H24"},evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null}),check=validator(context);
 expect(check.safeParse(encodeGoogleLiteEuContextV3(canonical)).success).toBe(true);expect(catalogue(context).notesProposalAllowed).toBe(false);
 for(const operation of ["SET","REPLACE","CLEAR"]){const authored=ConversationInterpretationV3Schema.parse({...canonical,changes:[...canonical.changes,{field:"notes",operation,value:operation==="CLEAR"?null:"private-note",evidence}]});expect(check.safeParse(encodeGoogleLiteEuContextV3(authored)).success,operation).toBe(false);}
 context.turns[2].text+=" Ghi chú mang giấy tờ.";expect(catalogue(context).notesProposalAllowed).toBe(true);const notes=ConversationInterpretationV3Schema.parse({...canonical,changes:[...canonical.changes,{field:"notes",operation:"SET",value:"mang giấy tờ",evidence:[{kind:"USER_QUOTE",turn:2,quote:context.turns[2].text,occurrence:1}]}]});expect(validator(context).safeParse(encodeGoogleLiteEuContextV3(notes)).success).toBe(true);
});
it("wire70 bound scheduling continuation excludes all ordinary notes operations",()=>{
 const context=input("Nhắc trước 2 ngày.");context.turns=[{role:"USER",text:"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp."},{role:"ASSISTANT",text:"Nhắc lúc nào?"},{role:"USER",text:"Nhắc trước 2 ngày."}];context.currentTurn=2;
 const slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];
 slots.frequency={state:"PROPOSED",value:"DAILY",fact:null};slots.occurrenceCount={state:"PROPOSED",value:2,fact:null};slots.eventDate={state:"PROPOSED",value:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null},fact:null};context.activeRequest={lifecycle:"CLARIFYING",slots};context.pendingQuestion={scope:"REMINDER",field:"reminderTime",reason:"MISSING",text:"time?",decisionKind:null};
 const evidence=[{kind:"USER_QUOTE",turn:2,quote:context.turns[2].text,occurrence:1}];const check=validator(context);
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});expect(check.safeParse(encodeGoogleLiteEuContextV3(canonical)).success).toBe(true);
 for(const operation of ["SET","REPLACE","CLEAR"]){const value=ConversationInterpretationV3Schema.parse({...canonical,changes:[...canonical.changes,{field:"notes",operation,value:operation==="CLEAR"?null:"private-note",evidence}]});expect(check.safeParse(encodeGoogleLiteEuContextV3(value)).success,operation).toBe(false);}
 expect(catalogue(context).notesProposalAllowed).toBe(false);
 context.turns[0].text+=" Ghi chú mang giấy tờ.";
 const earlier=[{kind:"USER_QUOTE",turn:0,quote:context.turns[0].text,occurrence:1}];
 const notes=ConversationInterpretationV3Schema.parse({...canonical,changes:[...canonical.changes,{field:"notes",operation:"SET",value:"mang giấy tờ",evidence:earlier}]});
 expect(catalogue(context).notesProposalAllowed).toBe(true);expect(validator(context).safeParse(encodeGoogleLiteEuContextV3(notes)).success).toBe(true);
});
it("wire69 initial event-only date forbids reminder date generation without defaulting values",()=>{
 const context=input("Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.");
 expect(Reflect.get(deriveGenerationFieldCapability(context),"reminderDateProposalAllowed")).toBe(false);
 expect(serializeContextRequest(context).response_format.json_schema.schema.properties?.reminderDateChange).toEqual({type:"null"});
 const capability=deriveGenerationFieldCapability(context),before=JSON.stringify(capability);
 expect(googleLiteEuContextWireSchemaV3({...capability,reminderDateProposalAllowed:true}).schema.properties?.reminderDateChange).not.toEqual({type:"null"});
 const missing=structuredClone(capability);Reflect.deleteProperty(missing,"reminderDateProposalAllowed");expect(()=>googleLiteEuContextWireSchemaV3(missing)).toThrow();expect(JSON.stringify(capability)).toBe(before);
});
it("wire61 support requires finite DAILY bounds, capability and no independent lead while preserving uniqueness",()=>{
 const supported=Reflect.get(capabilityModule,"isInitialSupportedCadenceCount") as ((input:ContextInput)=>boolean)|undefined;
 expect(supported).toBeTypeOf("function");
 for(const text of ["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi.","Ngày 11/10 đi thi, nhắc 30 ngày liên tiếp.","Ngày 11/10 đi thi, nhắc hai ngày liên tiếp.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc 2 ngày liên tiếp."]){expect(supported!(input(text))).toBe(true);}
 for(const text of ["Ngày 11/10 đi thi, nhắc 1 ngày liên tiếp.","Ngày 11/10 đi thi, nhắc 31 ngày liên tiếp.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc trước 3 ngày."]){const context=input(text);expect(capabilityModule.isInitialUniqueCadenceCountRequired(context)).toBe(true);expect(supported!(context)).toBe(false);}
 for(const text of ["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc 3 ngày liên tiếp.","Ngày 11/10 đi thi, nhắc trước 2 ngày.","Ngày 11/10 đi thi, nhắc một lần.","Ngày 11/10 đi thi, nhắc mỗi tuần.",'"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp."',"Nếu ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.","Ngày 11/10 đi thi, không nhắc 2 ngày liên tiếp.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp [CONTROL]","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, gọi mẹ."]){expect(supported!(input(text))).toBe(false);}
 const noCapability=input("Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");noCapability.capabilities.supported=["ONCE"];expect(capabilityModule.isInitialUniqueCadenceCountRequired(noCapability)).toBe(true);expect(supported!(noCapability)).toBe(false);
 for(const key of ["capabilities","activeRequest","facts","pendingQuestion","ambiguities"]){const context=input("Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");Reflect.deleteProperty(context,key);expect(supported!(context),key).toBe(false);}
 const history=input("Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");history.turns.unshift({role:"ASSISTANT",text:"prior"});history.currentTurn=1;expect(supported!(history)).toBe(false);
 for(const [key,value] of [["facts",[{alias:"f1"}]],["pendingQuestion",{scope:"REMINDER",field:"occurrenceCount"}],["ambiguities",[{field:"frequency"}]],["activeRequest",{lifecycle:"CLARIFYING",slots:{}}]] as const){const context=input("Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");Reflect.set(context,key,value);expect(supported!(context),key).toBe(false);}
});
it("wire56 unique supported initial cadence/count establishes presence without values",()=>{
 const helper=Reflect.get(capabilityModule,"isInitialUniqueCadenceCountRequired") as ((input:ContextInput)=>boolean)|undefined;
 expect(helper).toBeTypeOf("function");
 for(const text of ["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi.","Ngày 11/10 đi thi, nhắc hai ngày liên tiếp giúp tôi.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc 2 ngày liên tiếp."]){expect(helper!(input(text)),text).toBe(true);}
 for(const text of ["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc 3 ngày liên tiếp.","Ngày 11/10 đi thi, nhắc trước 2 ngày.","Ngày 11/10 đi thi.","Ngày 11/10 đi thi, ghi chú 2 người.",'"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp."',"Nếu ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.","Ngày 11/10 đi thi, không nhắc 2 ngày liên tiếp.","Xem lịch đi thi."]){expect(helper!(input(text)),text).toBe(false);}
 const historical=input("Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");historical.turns.push({role:"USER",text:historical.turns[0].text});historical.currentTurn=1;expect(helper!(historical)).toBe(false);
 const occupied=input("Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");
 occupied.activeRequest={lifecycle:"CLARIFYING",slots:Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"]};expect(helper!(occupied)).toBe(false);
 for(const [key,value] of [["facts",[{}]],["pendingQuestion",{scope:"REMINDER",field:"occurrenceCount"}],["ambiguities",[{}]]] as const){const context=input("Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");Reflect.set(context,key,value);expect(helper!(context),key).toBe(false);}
 for(const key of ["facts","pendingQuestion","ambiguities","activeRequest"]){const context=input("Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");Reflect.deleteProperty(context,key);expect(helper!(context),key).toBe(false);}
 for(const text of ["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp mỗi tuần.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc một lần.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp [CONTROL]", "Sửa nhắc 2 ngày liên tiếp.","Ngày 11/10 đi thi lúc 2h.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, gọi mẹ."]){expect(helper!(input(text)),text).toBe(false);}
});
it("wire56 actual numeric carriers cannot be null or contradict MISSING",()=>{
 const context=input("Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi."),check=validator(context);
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:context.turns[0].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence},{field:"frequency",operation:"SET",value:"DAILY",evidence},{field:"occurrenceCount",operation:"SET",value:2,evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const raw=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>;expect(check.safeParse(raw).success).toBe(true);
 expect(decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,context).status).toBe("PARSED");
 for(const field of ["frequencyChange","occurrenceCountChange"]){expect(check.safeParse({...raw,[field]:null}).success,field).toBe(false);}
 for(const fieldCode of [8,9])expect(check.safeParse({...raw,uncertainties:[{fieldCode,reason:"MISSING",alternatives:[]}]}).success).toBe(false);
 expect(check.safeParse({...raw,uncertainties:[{fieldCode:6,reason:"MISSING",alternatives:[]}]}).success).toBe(true);
 for(const fieldCode of [8,9])for(const reason of ["AMBIGUOUS","CONFLICT"])expect(check.safeParse({...raw,uncertainties:[{fieldCode,reason,alternatives:[]}]}).success,`${fieldCode}/${reason}`).toBe(false);
 for(const field of ["frequencyChange","occurrenceCountChange"]){const carrier=raw[field] as {change:Record<string,unknown>};expect(check.safeParse({...raw,[field]:{...carrier,change:{...carrier.change,operation:"REPLACE"}}}).success).toBe(false);expect(check.safeParse({...raw,[field]:{...carrier,change:{...carrier.change,operation:"CLEAR",value:null}}}).success).toBe(false);}
});
it.each(["history","CURRENT","pending"] as const)("wire58 %s context preserves source numeric ambiguity generation",kind=>{
 const context=input("Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi.");
 if(kind==="history"){context.turns.unshift({role:"USER",text:"Nhắc đi thi."});context.currentTurn=1;}
 if(kind==="CURRENT")context.activeRequest={lifecycle:"CLARIFYING",slots:Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"]};
 if(kind==="pending")context.pendingQuestion={text:"Mấy giờ?",scope:"REMINDER",field:"reminderTime",decisionKind:null,reason:"MISSING"};
 const evidence=[{kind:"USER_QUOTE",turn:context.currentTurn,quote:context.turns[context.currentTurn].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence},...authoredSeries(evidence)],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const raw=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>,check=validator(context);expect(check.safeParse(raw).success).toBe(true);
 for(const fieldCode of [8,9])for(const reason of ["AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])expect(check.safeParse({...raw,uncertainties:[{fieldCode,reason,alternatives:[]}]}).success).toBe(true);
});
// Independent schema-membership fixtures use source-pointer representation,
// retaining the authored turn index and every field value. No source is filled.
function encodeGoogleLiteEuContextV3(canonical:Parameters<typeof encodeCanonical>[0]):unknown {
  const wire=unwrapSingletonAuthoringFixture(encodeCanonical(canonical));
  const map=(value:unknown):unknown=>{
    if(!value||typeof value!=="object")return value;
    if(Array.isArray(value))return value.map(map);
    return Object.fromEntries(Object.entries(value).map(([key,child])=>{
      if(key==="primaryEvidence"&&typeof child==="string"){
        const ref=JSON.parse(child);if(ref.kind==="USER_QUOTE")return [key,`U${ref.turn}`];if(ref.kind==="CONTEXT_FACT")return [key,`F${ref.ref}`];
      }
      return [key,map(child)];
    }));
  };return map(wire);
}

function input(text: string): ContextInput {
  return ContextInputSchema.parse({ schemaVersion: "calenote-context-input-2", reference: { instant: "2026-10-08T03:00:00Z", localDate: "2026-10-08", timezone: "Asia/Ho_Chi_Minh" }, turns: [{ role: "USER", text }], currentTurn: 0, activeRequest: null, facts: [], pendingQuestion: null, ambiguities: [], capabilities: { version: "v1", supported: ["ONCE", "FINITE_DAILY"], unsupported: ["WEEKLY", "MONTHLY", "YEARLY"], calendars: ["GREGORIAN"], limits: { dailyCount: 30, horizonDays: 366 } } });
}
function authoredSeries(evidence:unknown,count=2){return [{field:"frequency",operation:"SET",value:"DAILY",evidence},{field:"occurrenceCount",operation:"SET",value:count,evidence}];}
it("wire54 isolated day-month source serializes year-null ownership without resolving a year",()=>{
 const context=input("Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi.");
 const request=serializeContextRequest(context);
 expect(JSON.parse(request.messages[1].content).fieldCapability.eventDateYearNullRequired).toBe(true);
 expect(request.messages[0].content).toContain("eventDateYearNullRequired=true");
 expect(context.turns).toEqual([{role:"USER",text:"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi."}]);
 for(const instant of ["2025-12-20T03:00:00Z","2027-01-01T03:00:00Z"]){
  const shifted={...context,reference:{...context.reference,instant}};
  expect(Reflect.get(deriveGenerationFieldCapability(shifted),"eventDateYearNullRequired")).toBe(true);
 }
});
it.each(["Ngày 11/10/2026 đi thi.","Ngày 11/10 đi thi, ngày 12/10 nữa.","Mai đi thi.","Thứ hai đi thi.","Ngày 11/10 âm đi thi.","Ngày 11/10 đi thi, ghi chú mang bút.","Nếu ngày 11/10 đi thi.",'"Ngày 11/10 đi thi."',"Không đi thi ngày 11/10.","Sửa ngày đi thi thành 11/10.","Ngày 11/10 đi thi ở đâu?"])("wire54 declines non-isolated or unknown year source (%#)",text=>{
 expect(Reflect.get(deriveGenerationFieldCapability(input(text)),"eventDateYearNullRequired")).toBe(false);
});
it("wire54 prior turns or pending context cannot be treated as initial isolated year ownership",()=>{
 const context=input("Ngày 11/10 đi thi.");
 const history={...context,turns:[{role:"USER" as const,text:"Giúp tôi"},...context.turns],currentTurn:1};
 expect(Reflect.get(deriveGenerationFieldCapability(history),"eventDateYearNullRequired")).toBe(false);
 const pending={...context,pendingQuestion:{scope:"REMINDER",field:"eventDate"}} as ContextInput;
 expect(Reflect.get(deriveGenerationFieldCapability(pending),"eventDateYearNullRequired")).toBe(false);
});
it("wire54 insufficient trusted context, retained facts, ambiguity or active state declines the checkpoint",()=>{
 for(const key of ["activeRequest","facts","pendingQuestion","ambiguities"]){
  const missing=input("Ngày 11/10 đi thi.");Reflect.deleteProperty(missing,key);
  expect(isInitialEventDateYearNullRequired(missing)).toBe(false);
 }
 for(const [key,value] of [["activeRequest",{}],["facts",[{}]],["ambiguities",[{}]]] as const){
  const occupied=input("Ngày 11/10 đi thi.");Reflect.set(occupied,key,value);
  expect(isInitialEventDateYearNullRequired(occupied)).toBe(false);
 }
});
it.each([[2026,"Ngày 11/10 đi thi.","REJECTED"],[null,"Ngày 11/10 đi thi.","CLARIFICATION_REQUESTED"],[2026,"Ngày 11/10/2026 đi thi.","CLARIFICATION_REQUESTED"]] as const)("wire54 actual service preserves year evidence refusal and authored null/explicit year (%#)",async(year,text,status)=>{
 const value={kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year,leapMonth:null};
 const h=await harness([proposal({title:"đi thi",eventDate:value})]);
 expect(await h.turn(0,text)).toEqual({status});
 expect(await h.f.db.prepare("SELECT count(*) AS count FROM reminders").first<number>("count")).toBe(0);
 const state=await h.read(1);
 if(status==="REJECTED")expect(state).toBeNull();
 else expect(state?.slots.eventDate.value).toEqual(value);
});
it.each(["numeric-year","wrong-day","valid"] as const)("wire55 actual model-authored object retains source fidelity: %s",async mode=>{
 const value={kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null};
 const h=await harness([proposal({title:"đi thi",eventDate:value})],wire=>{
  const raw=unwrapSingletonAuthoringFixture(wire) as {eventDateChange:{change:{value:Record<string,unknown>}}};
  raw.eventDateChange.change.value={...raw.eventDateChange.change.value,...(mode==="numeric-year"?{year:2026}:mode==="wrong-day"?{day:10}:{})};return wrapSingletonAuthoringFixture(raw);
 });
 expect(await h.turn(0,"Ngày 11/10 đi thi.")).toEqual({status:mode==="valid"?"CLARIFICATION_REQUESTED":"REJECTED"});
 const state=await h.read(1);if(mode==="valid")expect(state?.slots.eventDate.value).toEqual(value);else expect(state).toBeNull();
 expect(await h.f.db.prepare("SELECT count(*) AS count FROM reminders").first<number>("count")).toBe(0);
});
it.each(["Giúp tôi", "Ngày 15/12 đi thi, nhắc 3 ngày liên tiếp giúp tôi."])("wire52 actual request uncertainty cardinality remains max four (%#)",text=>{
 const context=input(text),evidence=[{kind:"USER_QUOTE",turn:0,quote:text,occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null}),wire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>;
 const schema=serializeContextRequest(context).response_format.json_schema.schema as unknown as {properties:{uncertainties:Record<string,unknown>};$defs:Record<string,unknown>};
 if(capabilityModule.isInitialUniqueCadenceCountRequired(context))canonical.changes.push(...ConversationInterpretationV3Schema.parse({...canonical,changes:authoredSeries(evidence,3)}).changes);
 const boundWire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>,slot=validator(context);
 const item={fieldCode:1,reason:"MISSING",alternatives:[]};
 for(const count of [0,4])expect(slot.safeParse({...boundWire,uncertainties:Array.from({length:count},()=>item)}).success).toBe(true);
 expect(slot.safeParse({...boundWire,uncertainties:Array.from({length:5},()=>item)}).success).toBe(false);
 expect(schema.properties.uncertainties.maxItems).toBe(4);expect(wire.uncertainties).toEqual([]);
});
it("wire52 actual service atomically refuses five authored uncertainties without creating a draft",async()=>{
 const h=await harness([proposal({title:"đi thi"})],wire=>({...wire as Record<string,unknown>,uncertainties:Array.from({length:5},()=>({fieldCode:2,reason:"MISSING",alternatives:[]}))}));
 expect(await h.turn(0,"Ngày 15/12 đi thi.")).toEqual({status:"REJECTED"});expect(await h.read(1)).toBeNull();expect(await h.f.db.prepare("SELECT count(*) AS count FROM reminders").first<number>("count")).toBe(0);
});
it("wire51 empty ordinary availability requires explicit empty changes and sole location carrier",()=>{
 const context=input("Ngày 15/12 đi thi ở Quang Trung, nhắc 3 ngày liên tiếp giúp tôi."),evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:context.turns[0].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence},{field:"location",operation:"SET",value:"Quang Trung",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 canonical.changes.push(...ConversationInterpretationV3Schema.parse({...canonical,changes:authoredSeries(evidence,3)}).changes);
 const wire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>,schema=serializeContextRequest(context).response_format.json_schema.schema as unknown as {properties:{changes:unknown}};
 expect(schema.properties.changes).toEqual({type:"array",items:{type:"null"},maxItems:0});expect(wire.changes).toEqual([]);expect(validator(context).safeParse(wire).success).toBe(true);
 for(const changes of [[null],[{field:"location",operation:"SET",value:"Quang Trung",evidence}]])expect(validator(context).safeParse({...wire,changes}).success).toBe(false);
});
it("wire50 initial complete exam instruction has no independent notes generation",()=>{
 const context=input("Ngày 15/12 đi thi, nhắc 3 ngày liên tiếp giúp tôi.");
 expect(Reflect.get(deriveGenerationFieldCapability(context),"notesProposalAllowed")).toBe(false);
 const evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:context.turns[0].text,occurrence:1}];
 for(const operation of ["SET","REPLACE","CLEAR"]){const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence},{field:"notes",operation,value:operation==="CLEAR"?null:"nhắc 3 ngày liên tiếp",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});expect(validator(context).safeParse(encodeGoogleLiteEuContextV3(canonical)).success).toBe(false);}
});
it.each(["Ngày 15/12 đi thi, ghi chú mang giấy tờ.","Ngày 15/12 đi thi, nhớ mang giấy tờ.","Sửa ghi chú thành mang giấy tờ.","Nhắc gọi mẹ, ghi chú mang giấy tờ."])("wire50 meaningful or unknown notes remain available (%#)",text=>{
 const context=input(text),evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:text,occurrence:1}];expect(deriveGenerationFieldCapability(context).notesProposalAllowed).toBe(true);
 for(const operation of ["SET","REPLACE","CLEAR"]){const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"notes",operation,value:operation==="CLEAR"?null:"mang giấy tờ",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});expect(validator(context).safeParse(encodeGoogleLiteEuContextV3(canonical)).success).toBe(true);}
});
it("actual source-bound date schema admits strings but strict runtime rejects invalid DateWire JSON",()=>{
 const context=input("Nhắc gọi mẹ ngày 11/10."),evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:context.turns[0].text,occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"reminderDate",operation:"SET",value:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null},evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeGoogleLiteEuContextV3(canonical) as {reminderDateChange:{change:{value:unknown}}};
 expect(validator(context).safeParse(wire).success).toBe(true);
 for(const value of ["{",'{"kind":"CIVIL_DATE","day":11}',{kind:"C",calendar:"GREGORIAN",day:32,month:10,year:null,leapMonth:null,offsetDays:null,weekday:null,qualifier:null}]){
  const specimen={...wire,reminderDateChange:{...wire.reminderDateChange,change:{...wire.reminderDateChange.change,value}}};
  expect(validator(context).safeParse(specimen).success).toBe(typeof value==="string");
  expect(decodeGoogleLiteEuContextTransportV3(specimen,CONTEXT_PROTOCOL_V3,undefined,undefined,context).status).toBe("REFUSED");
 }
});
it("actual source-bound schema forbids two ordinary eventRelation proposals",()=>{
 const context=input("Nhắc trước 2 ngày."),evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:context.turns[0].text,occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeGoogleLiteEuContextV3(canonical) as {changes:unknown[];eventRelationChange?:{change:unknown}},ordinary=wire.eventRelationChange?.change??wire.changes[0];
 const duplicate={...wire,...(wire.eventRelationChange?{eventRelationChange:null}:{}),changes:[ordinary,structuredClone(ordinary)]};
 expect(validator(context).safeParse(duplicate).success).toBe(false);
});
it.each(["frequency","occurrenceCount"] as const)("actual source-bound schema forbids duplicate ordinary %s",field=>{
 const context=input("Nhắc 2 ngày liên tiếp."),evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:context.turns[0].text,occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field,operation:"SET",value:field==="frequency"?"DAILY":2,evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>,carrier=wire[field+"Change"] as {change:unknown}|undefined,ordinary=carrier?.change??(wire.changes as unknown[])[0];
 expect(validator(context).safeParse({...wire,...(carrier?{[field+"Change"]:null}:{}),changes:[ordinary,structuredClone(ordinary)]}).success).toBe(false);
});
it.each(["frequency","occurrenceCount"])("numeric exclusion requires null %s carrier while included source preserves it",field=>{
 const excluded=serializeContextRequest(input("Nhắc trước 2 ngày.")).response_format.json_schema.schema as {properties:Record<string,unknown>};
 const included=serializeContextRequest(input("Nhắc 2 ngày liên tiếp.")).response_format.json_schema.schema as {properties:Record<string,unknown>};
 expect(excluded.properties[field+"Change"]).toEqual({type:"null"});expect(included.properties[field+"Change"]).toHaveProperty("anyOf");
});
function catalogue(context: ContextInput) {
  return JSON.parse(serializeContextRequest(context).messages[1].content).fieldCapability;
}
it("initial first-person exam assertion requires title and event clock without inventing values",()=>{
 for(const text of ["Tôi thi ngày 11/10 lúc 8h.","Em thi ngày 20/12 lúc 12h trưa."]){
 const context=input(text),evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:text,occurrence:1}],make=(changes:unknown[],uncertainties:unknown[]=[])=>encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes,query:null,uncertainties,conversationDirective:null,replyProposal:null}));
 const title={field:"title",operation:"SET",value:"đi thi",evidence},clock={field:"eventTime",operation:"SET",value:{hour:8,minute:0,qualifier:"H24"},evidence};
 expect(catalogue(context).titlePresenceRequired).toBe(true);
 const check=validator(context);expect(check.safeParse(make([title,clock])).success).toBe(true);
 expect(check.safeParse(make([title])).success).toBe(false);expect(check.safeParse(make([clock])).success).toBe(false);
 expect(check.safeParse(make([title,clock],[{field:"eventTime",reason:"MISSING",alternatives:[]}])).success).toBe(false);
 expect(check.safeParse(make([title,clock],[{field:"reminderTime",reason:"MISSING",alternatives:[]}])).success).toBe(true);
 }
});
it.each(["Tôi thi ngày 11/10 lúc 8h?","Không tôi thi ngày 11/10 lúc 8h.","Nếu tôi thi ngày 11/10 lúc 8h.",'"Tôi thi ngày 11/10 lúc 8h."',"Tôi thi ngày 11/10 lúc [CONTROL]8h.","Tôi thi ngày 11/10 lúc 8h, nhắc lúc 7h.","Tôi thi ngày 11/10 lúc 8h và về nhà.","Đổi tôi thi ngày 11/10 lúc 8h.","Tôi thi ngày 11/10 lúc khoảng 8h.","Tôi thi ngày 11/10 lúc 25h.","Thi ngày 11/10 lúc 8h."])("bare exam lower bound declines unknown/control/query/correction: %s",text=>{
 expect(catalogue(input(text)).titlePresenceRequired).toBe(false);
});
it("bare exam presence is initial only, with no inherited source or ASSISTANT authority",()=>{
 const context=input("Tôi thi ngày 11/10 lúc 8h."),slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];
 context.activeRequest={lifecycle:"CLARIFYING",slots};expect(catalogue(context).titlePresenceRequired).toBe(false);
 const current=input("Giữ như cũ.");current.turns.unshift({role:"USER",text:"Tôi thi ngày 11/10 lúc 8h."},{role:"ASSISTANT",text:"Tôi thi ngày 11/10 lúc 8h."});current.currentTurn=2;expect(catalogue(current).titlePresenceRequired).toBe(false);
 current.turns[2]={role:"ASSISTANT",text:"Tôi thi ngày 11/10 lúc 8h."};expect(deriveGenerationFieldCapability(current).titlePresenceRequired).toBe(false);
});
it.each(["SET","REPLACE","CLEAR"] as const)("date-only R04 does not grant calendar %s generation",operation=>{
 const context=input("Tôi thi ngày 11/10 lúc 8h."),text=context.turns[0].text,evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:text,occurrence:1}];
 const raw=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence},{field:"calendar",operation,value:operation==="CLEAR"?null:"GREGORIAN",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 expect(validator(context).safeParse(encodeGoogleLiteEuContextV3(raw)).success).toBe(false);
 expect(fields(context)).not.toContain("calendar");expect(catalogue(context).calendarProposalAllowed).toBe(false);
});
it.each(["âm lịch","lịch âm","ngày âm","dương lịch","lịch dương","am lich","lich am","ngay am","duong lich","lich duong","Đổi sang dương lịch.","Dùng âm lịch."])("explicit finite calendar cue keeps ordinary operations: %s",text=>{
 const context=input(text),evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:text,occurrence:1}];
 context.pendingQuestion={text:"Dùng lịch nào?",scope:"REMINDER",field:"calendar",decisionKind:null,reason:"MISSING"};
 expect(catalogue(context).calendarProposalAllowed).toBe(true);expect(fields(context)).toContain("calendar");
 for(const operation of ["SET","REPLACE","CLEAR"]){const raw=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"calendar",operation,value:operation==="CLEAR"?null:"LUNAR_VN",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});expect(validator(context).safeParse(encodeGoogleLiteEuContextV3(raw)).success).toBe(true);}
});
it.each(["Ngày 11/10.","GREGORIAN","LUNAR_VN","Không dùng âm lịch.","Nếu dùng dương lịch.","Giả sử dùng lịch âm.",'"âm lịch"',"Tên là âm lịch.","âm[CONTROL]lịch","Không [CONTROL] dùng dương lịch.","xam lich","duong lich_key"])("calendar cue cannot be default, quoted, hypothetical or control-borrowed: %s",text=>{
 expect(catalogue(input(text)).calendarProposalAllowed).toBe(false);expect(fields(input(text))).not.toContain("calendar");
});
it("calendar availability is CURRENT-slot bound, not unbound facts, history or ASSISTANT text",()=>{
 const context=input("Giữ như cũ."),slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];
 context.turns.unshift({role:"USER",text:"Dùng âm lịch."},{role:"ASSISTANT",text:"Dương lịch?"});context.currentTurn=2;
 const fact={alias:"f1",scope:"REMINDER" as const,field:"calendar" as const,value:"LUNAR_VN" as const,provenance:{kind:"EXPLICIT_USER" as const},sourceReferenceTime:"2026-10-08T03:00:00Z",dependencies:[]};context.facts=[fact];
 expect(catalogue(context).calendarProposalAllowed).toBe(false);
 context.activeRequest={lifecycle:"CLARIFYING",slots};expect(catalogue(context).calendarProposalAllowed).toBe(false);
 for(const state of ["PROPOSED","RESOLVED","CONFLICT"] as const){slots.calendar={state,value:fact.value,fact:"f1"};expect(catalogue(context).calendarProposalAllowed).toBe(true);expect(fields(context)).toContain("calendar");}
 const current=[{kind:"USER_QUOTE" as const,turn:2,quote:"Giữ như cũ.",occurrence:1}],raw=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence:current},changes:[{field:"calendar",operation:"SET",value:"LUNAR_VN",evidence:[{kind:"CONTEXT_FACT",ref:"f1"}]}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 expect(validator(context).safeParse(encodeGoogleLiteEuContextV3(raw)).success).toBe(true);
 slots.calendar={state:"MISSING",value:null,fact:null};context.facts=[];
 context.facts=[{alias:"f2",scope:"QUERY",field:"queryRange",value:{kind:"CALENDAR_DATE",date:{kind:"RELATIVE_DAY",offsetDays:0},outputCalendar:"LUNAR_VN",evidence:current},provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:fact.sourceReferenceTime,dependencies:[]}];
 expect(catalogue(context).calendarProposalAllowed).toBe(false);
 context.turns[2].text="[CONTROL] Dương lịch.";expect(catalogue(context).calendarProposalAllowed).toBe(true);
});
it("closed calendar slot does not prune civil date/calendar-query output or uncertainty representation",()=>{
 const context=input("Ngày 11/10/2026 là ngày gì?"),evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:context.turns[0].text,occurrence:1}];
 const raw=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CALENDAR_QUERY",requestTarget:null,changes:[],query:{kind:"CALENDAR_DATE",date:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:2026,leapMonth:null},outputCalendar:"LUNAR_VN",evidence},uncertainties:[{field:"calendar",reason:"MISSING",alternatives:[]}],conversationDirective:null,replyProposal:null});
 expect(validator(context).safeParse(encodeGoogleLiteEuContextV3(raw)).success).toBe(true);
});
it.each(["REPLACE","CLEAR"] as const)("mutating %s primary evidence must select current USER rather than history or fact",operation=>{
 const context=input("Đổi nhắc hai ngày liên tiếp.");context.turns=[{role:"USER",text:"Nhắc hai ngày liên tiếp."},{role:"ASSISTANT",text:"Bạn muốn lúc nào?"},{role:"USER",text:"trước hôm thi"},{role:"ASSISTANT",text:"Mấy giờ?"},{role:"USER",text:context.turns[0].text}];context.currentTurn=4;
 context.facts=[{alias:"f1",scope:"REMINDER",field:"frequency",value:"DAILY",provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:"2026-10-08T03:00:00Z",dependencies:[]}];
 const evidence=[{kind:"USER_QUOTE" as const,turn:4,quote:context.turns[4].text,occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"frequency",operation,value:operation==="CLEAR"?null:"DAILY",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeGoogleLiteEuContextV3(canonical) as {frequencyChange:{change:{operation:string;evidence:{primaryEvidence:string;additionalEvidenceJson:string}}}},check=validator(context),change=wire.frequencyChange.change;
 expect(check.safeParse(wire).success).toBe(true);
 for(const pointer of [{kind:"USER_TURN",turn:0},{kind:"CONTEXT_FACT",ref:"f1"}]){change.evidence.primaryEvidence=pointer.kind==="USER_TURN"?`U${"turn" in pointer?pointer.turn:0}`:`F${"ref" in pointer?pointer.ref:""}`;expect(check.safeParse(wire).success,JSON.stringify(pointer)).toBe(false);}
 change.evidence.primaryEvidence="U4";change.evidence.additionalEvidenceJson=JSON.stringify([{kind:"USER_TURN",turn:0},{kind:"CONTEXT_FACT",ref:"f1"}]);expect(check.safeParse(wire).success).toBe(true);
 if(operation==="REPLACE"){change.operation="SET";for(const pointer of [{kind:"USER_TURN",turn:0},{kind:"CONTEXT_FACT",ref:"f1"}]){change.evidence.primaryEvidence=pointer.kind==="USER_TURN"?`U${"turn" in pointer?pointer.turn:0}`:`F${"ref" in pointer?pointer.ref:""}`;expect(check.safeParse(wire).success).toBe(true);}}
});
it.each(["reminderDate","reminderTime"] as const)("indexed %s mutating evidence uses current controlled segments only",field=>{
 const context=input("Đổi nhắc ngày 11/10 lúc 9h.[CONTROL]ghi chú.");context.turns=[{role:"USER",text:"Nhắc ngày 11/10 lúc 8h."},{role:"ASSISTANT",text:"Giữ lại không?"},{role:"USER",text:context.turns[0].text}];context.currentTurn=2;
 const evidence=[{kind:"USER_QUOTE" as const,turn:2,quote:context.turns[2].text,occurrence:1}],value=field==="reminderDate"?{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null}:{hour:9,minute:0,qualifier:"H24"};
 const raw=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field,operation:"REPLACE",value,evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeGoogleLiteEuContextV3(raw) as Record<string,{change:{operation:string;value:unknown;evidence:{primaryEvidence:string}};evidence:{primaryEvidence:string}}>;
 const carrier=wire[field==="reminderDate"?"reminderDateChange":"reminderTimeChange"],pointer="S2.0";wire.requestTarget.evidence.primaryEvidence=pointer;carrier.change.evidence.primaryEvidence=pointer;
 const check=validator(context);expect(check.safeParse(wire).success).toBe(true);
 for(const source of [{kind:"USER_TURN",turn:0},{kind:"USER_TURN",turn:2}]){carrier.change.evidence.primaryEvidence=`U${source.turn}`;expect(check.safeParse(wire).success).toBe(false);}
 carrier.change.evidence.primaryEvidence=pointer;carrier.change.operation="CLEAR";carrier.change.value=null;expect(check.safeParse(wire).success).toBe(true);
});
it("no current semantic source removes mutations without dropping SET/history/query domains",()=>{
 const context=input("[CONTROL]");context.turns=[{role:"USER",text:"Nhắc hai ngày liên tiếp."},{role:"ASSISTANT",text:"Giữ lại không?"},{role:"USER",text:"[CONTROL]"}];context.currentTurn=2;
 const schema=serializeContextRequest(context).response_format.json_schema.schema as unknown as {$defs:Record<string,unknown>};
 expect(schema.$defs.__current).toBeUndefined();expect(schema.$defs.c).toBeUndefined();
 const evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:context.turns[0].text,occurrence:1}],raw=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"notes",operation:"SET",value:"literal",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeGoogleLiteEuContextV3(raw) as {changes:Array<{operation:string;value:unknown}>},check=validator(context);expect(check.safeParse(wire).success).toBe(true);wire.changes[0].operation="REPLACE";expect(check.safeParse(wire).success).toBe(false);wire.changes[0].operation="CLEAR";wire.changes[0].value=null;expect(check.safeParse(wire).success).toBe(false);
});
it("bounded title obligation requires a targeted operation and non-null target without selecting either",()=>{
 const context=input("Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.");
 const schema=serializeContextRequest(context).response_format.json_schema.schema as unknown as {properties:{operationCode:{enum:string[]};requestTarget:{type?:string}}};
 const evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:context.turns[0].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 canonical.changes.push(...ConversationInterpretationV3Schema.parse({...canonical,changes:authoredSeries(evidence)}).changes);
 const wire=encodeGoogleLiteEuContextV3(canonical) as {operationCode:string;requestTarget:unknown};const target=wire.requestTarget,check=validator(context);
 for(const code of ["0","1","2","9","10","11"]){wire.operationCode=code;wire.requestTarget=target;expect(check.safeParse(wire).success,code).toBe(true);wire.requestTarget=null;expect(check.safeParse(wire).success,`${code}/null`).toBe(false);}
 for(const code of ["3","4","5","6","7","8"]){wire.operationCode=code;wire.requestTarget=target;expect(check.safeParse(wire).success,code).toBe(false);}
 expect(schema.properties.operationCode.enum).toEqual(["0","1","2","9","10","11"]);
 expect(schema.properties.requestTarget.type).toBe("object");
});
it.each(["xem lịch đi thi","giúp tôi","Nhắc uống thuốc."])("non-obligated request retains full operation/target domains: %s",text=>{
 const context=input(text),schema=serializeContextRequest(context).response_format.json_schema.schema as unknown as {properties:{operationCode:{enum:string[]};requestTarget:{anyOf:unknown[]}}};
 expect(catalogue(context).titlePresenceRequired).toBe(false);
 expect(schema.properties.operationCode.enum).toEqual(Array.from({length:12},(_,index)=>String(index)));
 expect(schema.properties.requestTarget.anyOf).toHaveLength(2);
});
it("targeted generation availability still cannot grant unavailable CURRENT authority",async()=>{
 let schemaAccepted=false;
 const h=await harness([context=>{
  expect(context.activeRequest).toBeNull();expect(catalogue(context).titlePresenceRequired).toBe(true);
  const raw=proposal({title:"đi thi"},"CURRENT")(context);
  schemaAccepted=validator(context).safeParse(encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(raw))).success;
  return raw;
 }]);
 await h.turn(0,"Ngày 11/10 đi thi.");
 expect(schemaAccepted).toBe(true);expect(await h.read(1)).toBeNull();
});
it("actual three-turn request uses one shared general enum and one current mutation enum",()=>{
  const context=input("Nhắc 9h.");context.turns=[{role:"USER",text:"Nhắc gọi mẹ."},{role:"ASSISTANT",text:"Lúc nào?"},{role:"USER",text:"9h."}];context.currentTurn=2;
  const schema=typedSingletonSchemaFixture(deriveGenerationFieldCapability(context),context).schema as unknown as {$defs:Record<string,{type:string;enum?:string[]}>};
  expect(schema.$defs.s).toEqual({type:"string",enum:["U0","U2"]});
  const references:string[]=[];let sourceEnums=0,evidenceReferences=0;
  const walk=(value:unknown)=>{if(!value||typeof value!=="object")return;const node=value as Record<string,unknown>;if(node.$ref==="#/$defs/s")references.push(node.$ref);if(node.$ref==="#/$defs/e")evidenceReferences++;if(Array.isArray(node.enum)&&node.enum.some(v=>typeof v==="string"&&/^U\d+$/.test(v)))sourceEnums++;Object.values(node).forEach(walk);};walk(schema);
  expect(references).toHaveLength(1);expect(sourceEnums).toBe(2);expect(evidenceReferences).toBeGreaterThan(3);
  expect(schema.$defs.__current).toEqual({type:"string",enum:["U2"]});
  expect(schema.$defs.e).toMatchObject({type:"object",properties:{primaryEvidence:{$ref:"#/$defs/s"},additionalEvidenceJson:{type:"string"}},required:["primaryEvidence","additionalEvidenceJson"],additionalProperties:false});
  const evidence=[{kind:"USER_QUOTE" as const,turn:2,quote:"9h.",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"notes",operation:"SET",value:"literal",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {changes:Array<{change:{evidence:{primaryEvidence:string;additionalEvidenceJson:string}}}>};
  const check=validator(context);expect(check.safeParse(wire).success).toBe(true);
  wire.changes[0].change.evidence.primaryEvidence="U1";
  expect(check.safeParse(wire).success).toBe(false);
  wire.changes[0].change.evidence.primaryEvidence="U2";
  wire.changes[0].change.evidence.additionalEvidenceJson=JSON.stringify([{kind:"USER_TURN",turn:1}]);
  expect(check.safeParse(wire).success).toBe(true); // Scalar extras still require unchanged downstream checks.
});
it("requires a generated title carrier for an asserted exam reminder",()=>{
  const context=input("Ngày 11/10 đi thi, nhắc tôi trước 2 ngày.");
  expect(catalogue(context).titlePresenceRequired).toBe(true);
  const schema=serializeContextRequest(context).response_format.json_schema.schema as unknown as {required:string[];properties:{titleChange:{type?:string}}};
  expect(schema.required).toContain("titleChange");
  expect(schema.properties.titleChange.type).toBe("object");
  expect(fields(context)).not.toContain("title");
});
it("R02 simplified request schema pins single title ownership and reachable definitions",()=>{
  const context=input("Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.");
  const request=serializeContextRequest(context);
  expect(catalogue(context)).toEqual({version:"generation-field-capability-16",allowedNumericFields:["frequency","occurrenceCount"],allowedClockFields:[],titlePresenceRequired:true,titleCorrectionAllowed:false,calendarProposalAllowed:false,notesProposalAllowed:false,reminderDateProposalAllowed:false,eventDateYearNullRequired:true});
  expect(createHash("sha256").update(JSON.stringify(request.response_format.json_schema.schema)).digest("hex")).toBe("3678349a47b2b9bcfdd618bc642b83f1b4e6c47e93e3e5cb5ac1b8ed17a3c60b");
  const withoutCardinality=structuredClone(request.response_format.json_schema.schema) as unknown as {properties:{uncertainties:{maxItems?:number}}};delete withoutCardinality.properties.uncertainties.maxItems;
  expect(createHash("sha256").update(JSON.stringify(withoutCardinality)).digest("hex")).toBe("721b4bb3c86050ca701c9ce16eb29c08d3bc80a5565f6387c02db0a3978dd3dc");
  expect(fields(context)).not.toContain("title");
});
it.each(["Tiếp tục bản nháp đi thi.","xem lịch đi thi","giúp tôi xem đi thi","không đi thi","nếu đi thi","\"đi thi\"","đi thi [CONTROL]","nhắc trước 2 ngày","giải thích đi thi"])("unasserted exam mention does not force a title: %s",text=>expect(catalogue(input(text)).titlePresenceRequired).toBe(false));
it.each(["Ngày 11/10 đi thi ở Quang Trung, nhắc tôi chuẩn bị giấy tờ.","Đổi tiêu đề thành đi thi","Sửa title thành đi thi","Thay tên thành đi thi"])("different reminder subject or correction establishes no SET obligation: %s",text=>expect(catalogue(input(text)).titlePresenceRequired).toBe(false));
it.each(["Bạn nghĩ sao về đi thi","bao giờ đi thi","dịch đi thi"])("unknown or interrogative discourse remains outside bounded title assertion: %s",text=>expect(catalogue(input(text)).titlePresenceRequired).toBe(false));
it.each(["Ngày 11/10 đi thi, nhắc tôi uống thuốc lúc 8h.","Ngày 11/10 đi thi, nhắc tôi đóng tiền trước 2 ngày.","đi thi ở đâu","đi thi rồi uống thuốc","đi thi, điều này nghĩa là gì"])("unknown continuation or competing subject cannot force exam title: %s",text=>expect(catalogue(input(text)).titlePresenceRequired).toBe(false));
function fields(context: ContextInput) {
  type Node={type?:string;$ref?:string;anyOf?:Node[];properties?:Record<string,Node>;enum?:string[];const?:string};
  const schema = serializeContextRequest(context).response_format.json_schema.schema as unknown as { properties: { changes: { items: Node;maxItems?:number } }; $defs: Record<string,Node> };
  const resolve=(node:Node):Node=>node.$ref?resolve(schema.$defs[node.$ref.split("/").at(-1)!]):node;
  const item=resolve(schema.properties.changes.items);
  let ordinary:string[]=[];
  if(item.type==="null")expect(schema.properties.changes.maxItems).toBe(0);
  else{
    expect(item.properties).toHaveProperty("rank");expect(item.properties).toHaveProperty("change");
    const change=resolve(item.properties!.change);expect(change.anyOf?.length).toBeGreaterThan(0);
    ordinary=change.anyOf!.flatMap(branch=>branch.properties!.field.enum??[branch.properties!.field.const!]);
  }
  // Numeric singleton availability lives in its root, not the ordinary array.
  const roots=schema.properties as unknown as Record<string,{type?:string}>;
  return [...ordinary,...["frequency","occurrenceCount"].filter(field=>roots[field+"Change"].type!=="null")];
}
it.each([
  ["Nhắc trước 2 ngày.", ["leadOffsetDays"]],
  ["Nhắc 2 lần.", ["occurrenceCount"]],
  ["Nhắc 2 ngày liên tiếp.", ["frequency", "occurrenceCount"]],
  ["Nhắc mỗi ngày trong 3 ngày; nhắc trước 2 ngày.", ["frequency", "occurrenceCount", "leadOffsetDays"]],
  ["Nhắc hàng tuần.", ["frequency"]],
  ["Nhắc hàng tháng.", ["frequency"]],
  ["Nhắc hàng năm.", ["frequency"]],
  ["Phòng số 2, lúc 2h ngày 2/10.", []],
  ["Nhắc cách ngày theo chu kỳ tùy ý.", []],
  ["Không nhắc 2 ngày liên tiếp.", []],
  ["Nếu nhắc 2 ngày liên tiếp.", []],
  ["Nhắc '2 ngày liên tiếp'.", []],
  ["Không nhắc trước 2 ngày.", []],
  [`Nhắc ${CONTROL_PLACEHOLDER} trước 2 ngày.`, []],
  [`${CONTROL_PLACEHOLDER} Nhắc trước 2 ngày.`, ["leadOffsetDays"]],
  [`Không ${CONTROL_PLACEHOLDER} nhắc 2 ngày liên tiếp.`, []],
  [`Nếu ${CONTROL_PLACEHOLDER} nhắc trước 2 ngày.`, []],
  [`🗓️ ${CONTROL_PLACEHOLDER} Nhắc trước 2 ngày.`, ["leadOffsetDays"]],
  [`🗓️ ${CONTROL_PLACEHOLDER} Nhắc 2 ngày liên tiếp.`, ["frequency", "occurrenceCount"]],
] as const)("request field upper bound preserves numeric ownership: %s", (text, allowed) => {
  const context = input(text), before = JSON.stringify(context);
  expect(catalogue(context)).toMatchObject({ version: "generation-field-capability-16", allowedNumericFields: allowed });
  const domain = fields(context);
  for (const field of ["frequency", "occurrenceCount", "leadOffsetDays"]) expect(domain.includes(field)).toBe((allowed as readonly string[]).includes(field));
  expect(domain).not.toContain("title"); // SET remains in the separate carrier.
  expect(JSON.stringify(context)).toBe(before);
});
it.each(["Đừng bỏ.", "Tiếp tục.", "Nhắc trước 2 ngày.", "Nhắc buổi sáng."])("absent clocks close generation branches without answering pending clock: %s", text => {
  const context = input(text);
  context.pendingQuestion = { text: "Mấy giờ?", scope: "REMINDER", field: "reminderTime", decisionKind: null, reason: "MISSING" };
  expect(catalogue(context).allowedClockFields).toEqual([]);
  expect(fields(context)).not.toContain("reminderTime");
  expect(fields(context)).not.toContain("eventTime");
});
it.each(["8h.", "08:00.", "nửa đêm", "noon", "midnight"])("clock source presence opens an upper bound, never a value: %s", text => {
  expect(catalogue(input(text)).allowedClockFields).toEqual(["eventTime", "reminderTime"]);
});
it("initial explicit notification source requires authored clock presence and forbids only its MISSING label",()=>{
 const text="Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.",context=input(text),evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:text,occurrence:1}];
 const raw=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence},{field:"reminderTime",operation:"SET",value:{hour:8,minute:0,qualifier:"H24"},evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 raw.changes.push(...ConversationInterpretationV3Schema.parse({...raw,changes:authoredSeries(evidence)}).changes);
 const wire=encodeGoogleLiteEuContextV3(raw) as {reminderTimeChange:unknown;uncertainties:unknown[]},check=validator(context);
 expect(check.safeParse(wire).success).toBe(true);
 wire.uncertainties=[{fieldCode:6,reason:"MISSING",alternatives:[]}];expect(check.safeParse(wire).success).toBe(false);
 for(const fieldCode of [0,1,2,3,4,5,7,10,11,12,13,14,15]){wire.uncertainties=[{fieldCode,reason:"MISSING",alternatives:[]}];expect(check.safeParse(wire).success).toBe(true);}
 for(const fieldCode of [8,9]){wire.uncertainties=[{fieldCode,reason:"MISSING",alternatives:[]}];expect(check.safeParse(wire).success).toBe(false);}
 for(const reason of ["AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"]){wire.uncertainties=[{fieldCode:6,reason,alternatives:[]}];expect(check.safeParse(wire).success).toBe(true);}
 wire.uncertainties=[];wire.reminderTimeChange=null;expect(check.safeParse(wire).success).toBe(false);
 expect(check.safeParse(encodeGoogleLiteEuContextV3(raw)).success).toBe(true);
 for(const operation of ["REPLACE","CLEAR"]){const changed=ConversationInterpretationV3Schema.parse({...raw,changes:raw.changes.map(change=>change.field==="reminderTime"?{...change,operation,value:operation==="CLEAR"?null:change.value}:change)});expect(changed.changes.filter(change=>change.field!=="reminderTime")).toEqual(raw.changes.filter(change=>change.field!=="reminderTime"));expect(check.safeParse(encodeGoogleLiteEuContextV3(changed)).success).toBe(false);}
});
it("initial explicit notification clause cannot omit its model-authored clock carrier",()=>{
 const text="Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.",context=input(text),evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:text,occurrence:1}];
 const raw=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 raw.changes.push(...ConversationInterpretationV3Schema.parse({...raw,changes:[...authoredSeries(evidence),{field:"reminderTime",operation:"SET",value:{hour:8,minute:0,qualifier:"H24"},evidence}]}).changes);
 const check=validator(context);expect(check.safeParse(encodeGoogleLiteEuContextV3(raw)).success).toBe(true);
 const omitted=ConversationInterpretationV3Schema.parse({...raw,changes:raw.changes.filter(change=>change.field!=="reminderTime")});
 expect(omitted.changes).toEqual(raw.changes.filter(change=>change.field!=="reminderTime"));expect(check.safeParse(encodeGoogleLiteEuContextV3(omitted)).success).toBe(false);
});
it.each(["Nhắc 2 ngày liên tiếp lúc 8h.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h giúp tôi.","Đổi nhắc 2 ngày liên tiếp lúc 8h."])("availability alone does not require clock presence or exclude MISSING: %s",text=>{
 const context=input(text),evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:text,occurrence:1}],raw=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[],query:null,uncertainties:[{field:"reminderTime",reason:"MISSING",alternatives:[]}],conversationDirective:null,replyProposal:null});
 // A bounded title obligation can independently require its title carrier.
 if(catalogue(context).titlePresenceRequired)raw.changes.unshift({field:"title",operation:"SET",value:"đi thi",evidence});
 if(capabilityModule.isInitialUniqueCadenceCountRequired(context))raw.changes.push(...ConversationInterpretationV3Schema.parse({...raw,changes:authoredSeries(evidence)}).changes);
 const check=validator(context);expect(check.safeParse(encodeGoogleLiteEuContextV3(raw)).success).toBe(true);
});
it("genuine multiple-clock uncertainty preserves canonical alternatives and optional clock carrier",()=>{
 const text="Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h hoặc 9h.",context=input(text),evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:text,occurrence:1}];
 const raw=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence}],query:null,uncertainties:[{field:"reminderTime",reason:"AMBIGUOUS",alternatives:[{value:{hour:8,minute:0,qualifier:"H24"},evidence},{value:{hour:9,minute:0,qualifier:"H24"},evidence}]}],conversationDirective:null,replyProposal:null});
 const wire=encodeGoogleLiteEuContextV3(raw);expect(validator(context).safeParse(wire).success).toBe(true);
});
it("retained CURRENT notification clauses preserve optional clock, correction and uncertainty domains",()=>{
 const text="Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.",context=input(text),slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];
 context.activeRequest={lifecycle:"CLARIFYING",slots};const evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:text,occurrence:1}];
 const wire=(operation:string,value:unknown)=>encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence},{field:"reminderTime",operation,value,evidence}],query:null,uncertainties:[{field:"reminderTime",reason:"MISSING",alternatives:[]}],conversationDirective:null,replyProposal:null}));
 for(const operation of ["SET","REPLACE","CLEAR"])expect(validator(context).safeParse(wire(operation,operation==="CLEAR"?null:{hour:8,minute:0,qualifier:"H24"})).success).toBe(true);
 const absent=wire("SET",{hour:8,minute:0,qualifier:"H24"}) as {reminderTimeChange:unknown};absent.reminderTimeChange=null;expect(validator(context).safeParse(absent).success).toBe(true);
});
it.each([
 ["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.",8,0],
 ["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 12h trưa.",12,0],
 ["Nhắc tôi hai ngày liên tiếp lúc 08:00.",8,0],
] as const)("explicit finite notification clock grants reminder carrier, not eventTime: %s",(text,hour,minute)=>{
 const context=input(text),before=JSON.stringify(context),evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:text,occurrence:1}];
 const wire=(field:string,operation:string,value:unknown)=>encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[...(catalogue(context).titlePresenceRequired?[{field:"title",operation:"SET",value:"đi thi",evidence}]:[]),...(field!=="reminderTime"?[{field:"reminderTime",operation:"SET",value:{hour,minute,qualifier:"H24"},evidence}]:[]),{field,operation,value,evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null}));
 const check=validator(context);
 const authoredWire=(field:string,operation:string,value:unknown)=>encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[...(catalogue(context).titlePresenceRequired?[{field:"title",operation:"SET",value:"đi thi",evidence}]:[]),...(capabilityModule.isInitialUniqueCadenceCountRequired(context)?authoredSeries(evidence):[]),...(field!=="reminderTime"?[{field:"reminderTime",operation:"SET",value:{hour,minute,qualifier:"H24"},evidence}]:[]),{field,operation,value,evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null}));
 expect(check.safeParse(authoredWire("eventTime","SET",{hour,minute,qualifier:"H24"})).success).toBe(false);
 expect(check.safeParse(authoredWire("reminderTime","SET",{hour,minute,qualifier:"H24"})).success).toBe(true);
 expect(catalogue(context).allowedClockFields).toEqual(["reminderTime"]);
 // Initial unique-source lower bound is SET-only; outside it corrections remain.
 for(const [field,value] of [["frequency","DAILY"],["occurrenceCount",2]] as const)for(const operation of ["REPLACE","CLEAR"])
  expect(check.safeParse(wire(field,operation,operation==="CLEAR"?null:value)).success).toBe(!capabilityModule.isInitialUniqueCadenceCountRequired(context));
 expect(JSON.stringify(context)).toBe(before);
});
it.each([
 "Tôi thi ngày 11/10 lúc 8h.","Ngày 20/12 họp lúc 9h.","Đổi giờ thi sang 9h.",
 "Nhắc 2 ngày liên tiếp lúc 8h giúp tôi.","Nhắc 2 ngày liên tiếp lúc 8h; gọi mẹ.",
 "Thi lúc 9h, nhắc 2 ngày liên tiếp lúc 8h.","Thi lúc 8h, nhắc 2 ngày liên tiếp lúc 8h.",
 "Nhắc 2 ngày liên tiếp lúc 8h và 9h.","Không nhắc 2 ngày liên tiếp lúc 8h.","Nếu nhắc 2 ngày liên tiếp lúc 8h.",
 "\"Nhắc 2 ngày liên tiếp lúc 8h.\"","Nhắc 2 ngày liên tiếp lúc 8h?","Nhắc 2 ngày liên tiếp lúc 8h [CONTROL]",
 "Nhắc 2 ngày liên tiếp lúc 8h sáng.","Nhắc 2 ngày liên tiếp lúc 8h30.","Nhắc 2 ngày liên tiếp lúc 8 giờ.",
 "Nhắc hàng tuần lúc 8h.","Đổi nhắc 2 ngày liên tiếp lúc 8h.",
])("unknown or independently owned notification clock preserves both original upper bounds: %s",text=>{
 expect(catalogue(input(text)).allowedClockFields).toEqual(["eventTime","reminderTime"]);
});
it("explicit notification ownership preserves earlier USER and occupied eventTime sources",()=>{
 const context=input("Nhắc 2 ngày liên tiếp lúc 8h."),slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];
 expect(catalogue(context).allowedClockFields).toEqual(["reminderTime"]);
 const fact={alias:"f1",scope:"REMINDER" as const,field:"eventTime" as const,value:{hour:9,minute:0,qualifier:"H24" as const},provenance:{kind:"EXPLICIT_USER" as const},sourceReferenceTime:"2026-10-08T03:00:00Z",dependencies:[]};context.facts=[fact];context.activeRequest={lifecycle:"CLARIFYING",slots};
 for(const state of ["PROPOSED","RESOLVED","CONFLICT"] as const){slots.eventTime={state,value:fact.value,fact:"f1"};expect(catalogue(context).allowedClockFields).toEqual(["eventTime","reminderTime"]);}
 slots.eventTime={state:"MISSING",value:null,fact:null};context.facts=[];context.turns.unshift({role:"USER",text:"Thi lúc 9h."},{role:"ASSISTANT",text:"Mấy giờ nhắc?"});context.currentTurn=2;
 expect(catalogue(context).allowedClockFields).toEqual(["eventTime","reminderTime"]);
});
it.each([["8h.",8,0],["08:00.",8,0],["20:30",20,30],["12h trưa",12,0]] as const)("bound reminder clock answer closes eventTime in the actual request schema: %s",(text,hour,minute)=>{
 const context=input(text),slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];
 context.turns=[{role:"USER",text:"Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi."},{role:"ASSISTANT",text:"Bạn muốn nhắc lúc mấy giờ?"},{role:"USER",text:"Nhắc trước 2 ngày."},{role:"ASSISTANT",text:"Bạn muốn nhắc lúc mấy giờ?"},{role:"USER",text}];context.currentTurn=4;context.activeRequest={lifecycle:"CLARIFYING",slots};context.pendingQuestion={text:"Bạn muốn nhắc lúc mấy giờ?",scope:"REMINDER",field:"reminderTime",decisionKind:null,reason:"MISSING"};
 const evidence=[{kind:"USER_QUOTE" as const,turn:4,quote:text,occurrence:1}],raw=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"eventTime",operation:"SET",value:{hour,minute,qualifier:"H24"},evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const check=validator(context);expect(check.safeParse(encodeGoogleLiteEuContextV3(raw)).success).toBe(false);
 expect(check.safeParse(encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse({...raw,changes:[{...raw.changes[0],field:"reminderTime"}]}))).success).toBe(true);
 expect(catalogue(context).allowedClockFields).toEqual(["reminderTime"]);
});
it.each([
 "Tôi thi lúc 9h.","Ngày 20/12 họp lúc 9h.","Đổi sang 9h.","Đổi giờ thi sang 9h.",
 "8h giúp tôi.","8h; gọi mẹ.","8h và 9h.","\"8h.\"","8h [CONTROL]","8h?","noon","nửa đêm","24:99",
 "8h sáng","8h tối","8h30","8 giờ",
])("unknown or independently owned clock clause preserves original upper bounds: %s",text=>{
 const context=input(text),slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];
 context.activeRequest={lifecycle:"CLARIFYING",slots};context.pendingQuestion={text:"Mấy giờ nhắc?",scope:"REMINDER",field:"reminderTime",decisionKind:null,reason:"MISSING"};
 expect(catalogue(context).allowedClockFields).toEqual(catalogue(input(text)).allowedClockFields);
});
it("clock answer restriction requires bound reminder question and preserves other clock sources/facts",()=>{
 const context=input("8h."),slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];
 context.pendingQuestion={text:"Mấy giờ?",scope:"REMINDER",field:"reminderTime",decisionKind:null,reason:"MISSING"};
 expect(catalogue(context).allowedClockFields).toEqual(["eventTime","reminderTime"]);
 context.activeRequest={lifecycle:"CLARIFYING",slots};expect(catalogue(context).allowedClockFields).toEqual(["reminderTime"]);
 context.pendingQuestion.scope="QUERY";context.pendingQuestion.field="queryRange";expect(catalogue(context).allowedClockFields).toEqual(["eventTime","reminderTime"]);
 context.pendingQuestion.scope="REMINDER";context.pendingQuestion.field="eventTime";expect(catalogue(context).allowedClockFields).toEqual(["eventTime","reminderTime"]);
 context.pendingQuestion.field="reminderTime";
 const fact={alias:"f1",scope:"REMINDER" as const,field:"eventTime" as const,value:{hour:9,minute:0,qualifier:"H24" as const},provenance:{kind:"EXPLICIT_USER" as const},sourceReferenceTime:"2026-10-08T03:00:00Z",dependencies:[]};context.facts=[fact];
 for(const state of ["PROPOSED","RESOLVED","CONFLICT"] as const){slots.eventTime={state,value:fact.value,fact:"f1"};expect(catalogue(context).allowedClockFields).toEqual(["eventTime","reminderTime"]);}
 slots.eventTime={state:"MISSING",value:null,fact:null};context.facts=[];context.turns.unshift({role:"USER",text:"Thi lúc 9h."},{role:"ASSISTANT",text:"Mấy giờ nhắc?"});context.currentTurn=2;
 expect(catalogue(context).allowedClockFields).toEqual(["eventTime","reminderTime"]);
});
it.each(["title","frequency","occurrenceCount","eventRelation","endDate"] as const)("bound bare clock declines non-clock %s mutations but preserves exact SET facts and both clocks",field=>{
 const context=input("8h."),slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];
 context.turns=[{role:"USER",text:"Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi."},{role:"ASSISTANT",text:"Mấy giờ nhắc?"},{role:"USER",text:"Nhắc trước 2 ngày."},{role:"ASSISTANT",text:"Mấy giờ nhắc?"},{role:"USER",text:"8h."}];context.currentTurn=4;
 slots.frequency={state:"PROPOSED",value:"DAILY",fact:null};slots.occurrenceCount={state:"PROPOSED",value:2,fact:null};slots.eventRelation={state:"PROPOSED",value:"BEFORE_EVENT",fact:null};slots.eventTime={state:"PROPOSED",value:{hour:9,minute:0,qualifier:"H24"},fact:null};
 context.activeRequest={lifecycle:"CLARIFYING",slots};context.pendingQuestion={text:"Mấy giờ nhắc?",scope:"REMINDER",field:"reminderTime",decisionKind:null,reason:"MISSING"};
 const value=field==="title"?"đi thi":field==="frequency"?"DAILY":field==="occurrenceCount"?2:field==="endDate"?{kind:"RELATIVE_DAY",offsetDays:2}:"BEFORE_EVENT",evidence=[{kind:"USER_QUOTE" as const,turn:4,quote:"8h.",occurrence:1}];
 slots.title={state:"PROPOSED",value:"đi thi",fact:null};
 context.facts=[{alias:"f1",scope:"REMINDER",field,value,provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:"2026-10-08T03:00:00Z",dependencies:[]}] as ContextInput["facts"];
 const wire=(field:string,operation:string,value:unknown,refs:unknown[]=evidence)=>encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field,operation,value,evidence:refs}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null}));
 const check=validator(context);
 for(const operation of ["REPLACE","CLEAR"]){expect(check.safeParse(wire(field,operation,operation==="CLEAR"?null:value)).success).toBe(false);for(const clock of ["eventTime","reminderTime"])expect(check.safeParse(wire(clock,operation,operation==="CLEAR"?null:{hour:8,minute:0,qualifier:"H24"})).success).toBe(true);}
 expect(check.safeParse(wire(field,"SET",value,[{kind:"CONTEXT_FACT",ref:"f1"}])).success).toBe(true);
 for(const operation of ["REPLACE","CLEAR"])expect(check.safeParse(wire("reminderDate",operation,operation==="CLEAR"?null:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null})).success).toBe(false);
 slots.eventTime={state:"MISSING",value:null,fact:null};
 for(const operation of ["REPLACE","CLEAR"]){expect(validator(context).safeParse(wire("eventTime",operation,operation==="CLEAR"?null:{hour:8,minute:0,qualifier:"H24"})).success).toBe(false);expect(validator(context).safeParse(wire("reminderTime",operation,operation==="CLEAR"?null:{hour:8,minute:0,qualifier:"H24"})).success).toBe(true);}
 slots.eventTime={state:"PROPOSED",value:{hour:9,minute:0,qualifier:"H24"},fact:null};
 for(const text of ["Đổi số lần sang 3 lần.","Ngày 20/12 đi làm việc mới lúc 9h.","8h giúp tôi.","8h và 9h."]){context.turns[4].text=text;const refs=[{...evidence[0],quote:text}];for(const operation of ["REPLACE","CLEAR"])expect(validator(context).safeParse(wire(field,operation,operation==="CLEAR"?null:value,refs)).success).toBe(true);}
});
it.each(["noon2", "user_midnight_key", "nửa đêm2", "midnight_", "_noon", "noon\u0338"])("embedded clock token does not open branches: %s", text => {
  expect(catalogue(input(text)).allowedClockFields).toEqual([]);
});
it("assistant clocks cannot lend source presence but prior USER sources preserve legal CURRENT SET", () => {
  const context = input("Đừng bỏ.");
  context.turns.unshift({ role: "ASSISTANT", text: "9h." }); context.currentTurn = 1;
  expect(catalogue(context).allowedClockFields).toEqual([]);
  context.turns.unshift({ role: "USER", text: "8h." }); context.currentTurn = 2;
  expect(catalogue(context).allowedClockFields).toEqual(["eventTime", "reminderTime"]);
});
it("occupied retained clock keeps correction/CLEAR while null slot does not", () => {
  const context = input("Giữ như cũ.");
  const slots = Object.fromEntries(SLOT_NAMES.map(field => [field, { state: "MISSING", value: null, fact: null }])) as NonNullable<ContextInput["activeRequest"]>["slots"];
  slots.reminderTime = { state: "PROPOSED", value: { hour: 8, minute: 0, qualifier: "H24" }, fact: null };
  context.activeRequest = { lifecycle: "CLARIFYING", slots };
  expect(catalogue(context).allowedClockFields).toEqual(["reminderTime"]);
  slots.reminderTime.state = "CONFLICT";
  expect(catalogue(context).allowedClockFields).toEqual(["reminderTime"]);
  slots.reminderTime.value = null;
  expect(catalogue(context).allowedClockFields).toEqual([]);
});
it("assistant and unrelated older turns do not open numeric fields", () => {
  const context = input("Giúp tôi.");
  context.turns.unshift({ role: "USER", text: "Nhắc 2 ngày liên tiếp." }, { role: "ASSISTANT", text: "Nhắc trước 2 ngày." });
  context.currentTurn = 2;
  expect(catalogue(context)?.allowedNumericFields).toEqual([]);
});
it("retained operands preserve corrections and CLEAR without lending a series offset", () => {
  const context = input("Bỏ số lần, giữ như cũ.");
  const slots = Object.fromEntries(SLOT_NAMES.map(field => [field, { state: "MISSING", value: null, fact: null }])) as NonNullable<ContextInput["activeRequest"]>["slots"];
  slots.frequency = { state: "PROPOSED", value: "DAILY", fact: null };
  slots.occurrenceCount = { state: "PROPOSED", value: 2, fact: null };
  context.activeRequest = { lifecycle: "CLARIFYING", slots };
  expect(catalogue(context)?.allowedNumericFields).toEqual(["frequency", "occurrenceCount"]);
  context.turns[0].text = "Trước 2 ngày.";
  expect(catalogue(context)?.allowedNumericFields).toEqual(["frequency", "occurrenceCount"]);
  context.turns[0].text = "Nhắc trước 2 ngày.";
  expect(catalogue(context)?.allowedNumericFields).toEqual(["frequency", "occurrenceCount"]);
  context.turns[0].text = "Bắt đầu nhắc trước 2 ngày.";
  expect(catalogue(context)?.allowedNumericFields).toEqual(["frequency", "occurrenceCount", "leadOffsetDays"]);
  context.turns[0].text = "Ngày 20/12 đi làm việc mới, nhắc trước 2 ngày.";
  expect(catalogue(context)?.allowedNumericFields).toEqual(["frequency", "occurrenceCount", "leadOffsetDays"]);
  slots.frequency.state = "CONFLICT"; slots.occurrenceCount.state = "CONFLICT";
  context.turns[0].text = "Bỏ số lần nhắc.";
  expect(catalogue(context)?.allowedNumericFields).toEqual(["frequency", "occurrenceCount"]);
  slots.frequency.value = null; slots.occurrenceCount.value = null;
  expect(catalogue(context)?.allowedNumericFields).toEqual([]);
});
it.each([
 ["Nhắc trước 2 ngày.",false], ["Nhắc trước hai ngày.",false], ["Nhắc 2 ngày trước ngày thi.",false],
 ["Bắt đầu nhắc trước 2 ngày.",true], ["Nhắc một lần trước ngày thi 2 ngày.",true],
 ["Nhắc trước 3 ngày.",true], ["Ngày 20/12 đi làm việc mới, nhắc trước 2 ngày.",true],
 ["Nhắc trước 2 ngày lúc 8h.",true], ["Nhắc trước 2 ngày giúp tôi.",true],
 ["Nhắc trước 2 ngày; gọi mẹ.",true],
] as const)("retained series request capability and actual schema bound whole answer only: %s",(text,available)=>{
 const context=input(text),slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];
 slots.frequency={state:"PROPOSED",value:"DAILY",fact:null};slots.occurrenceCount={state:"PROPOSED",value:2,fact:null};context.activeRequest={lifecycle:"CLARIFYING",slots};
 const evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"leadOffsetDays",operation:"SET",value:text.includes("3 ngày")?3:2,evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const check=validator(context),wire=encodeGoogleLiteEuContextV3(canonical);
 expect(check.safeParse(wire).success).toBe(available);
 expect(catalogue(context).allowedNumericFields.includes("leadOffsetDays")).toBe(available);
 slots.leadOffsetDays={state:"PROPOSED",value:2,fact:null};expect(validator(context).safeParse(wire).success).toBe(true);
 context.activeRequest=null;expect(validator(context).safeParse(wire).success).toBe(true);
});
it.each(["PROPOSED","RESOLVED","CONFLICT"] as const)("actual R02 role indexes and %s state preserve bound series/fact ownership",state=>{
 const context=input("Nhắc trước 2 ngày."),slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];
 context.turns=[{role:"USER",text:"Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi."},{role:"ASSISTANT",text:"Bạn muốn nhắc lúc mấy giờ?"},{role:"USER",text:"Nhắc trước 2 ngày."}];context.currentTurn=2;
 const common={scope:"REMINDER" as const,provenance:{kind:"EXPLICIT_USER" as const},sourceReferenceTime:"2026-10-08T03:00:00Z",dependencies:[]};
 context.facts=[{...common,alias:"f1",field:"frequency",value:"DAILY"},{...common,alias:"f2",field:"occurrenceCount",value:2}];
 slots.frequency={state,value:"DAILY",fact:"f1"};slots.occurrenceCount={state,value:2,fact:"f2"};context.activeRequest={lifecycle:"CLARIFYING",slots};
 const evidence=[{kind:"USER_QUOTE" as const,turn:2,quote:context.turns[2].text,occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"leadOffsetDays",operation:"SET",value:2,evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeGoogleLiteEuContextV3(canonical);expect(validator(context).safeParse(wire).success).toBe(state==="CONFLICT");
 context.facts.push({...common,alias:"f3",field:"leadOffsetDays",value:2});slots.leadOffsetDays={state:"RESOLVED",value:2,fact:"f3"};
 expect(validator(context).safeParse(wire).success).toBe(true);
 const reused=encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse({...canonical,changes:[{field:"leadOffsetDays",operation:"SET",value:2,evidence:[{kind:"CONTEXT_FACT",ref:"f3"}]}]}));
 expect(validator(context).safeParse(reused).success).toBe(true);
});
it("only the actual pending count question allows a bare answer", () => {
  const context = input("2");
  expect(catalogue(context)?.allowedNumericFields).toEqual([]);
  context.activeRequest = { lifecycle: "CLARIFYING", slots: Object.fromEntries(SLOT_NAMES.map(field => [field, { state: "MISSING", value: null, fact: null }])) as NonNullable<ContextInput["activeRequest"]>["slots"] };
  context.pendingQuestion = { text: "Nhắc bao nhiêu lần?", scope: "REMINDER", field: "occurrenceCount", decisionKind: null, reason: "MISSING" };
  expect(catalogue(context)?.allowedNumericFields).toEqual(["occurrenceCount"]);
  context.pendingQuestion.scope = "QUERY";
  expect(catalogue(context)?.allowedNumericFields).toEqual([]);
});
it("occupied conflict fields remain available for CLEAR while null conflicts grant no operands", () => {
  const context = input("Bỏ số lần nhắc."), slots = Object.fromEntries(SLOT_NAMES.map(field => [field, { state: "MISSING", value: null, fact: null }])) as NonNullable<ContextInput["activeRequest"]>["slots"];
  slots.occurrenceCount = { state: "CONFLICT", value: 2, fact: null };
  context.activeRequest = { lifecycle: "CLARIFYING", slots };
  expect(catalogue(context)?.allowedNumericFields).toEqual(["occurrenceCount"]);
  slots.occurrenceCount.value = null;
  expect(catalogue(context)?.allowedNumericFields).toEqual([]);
});
it("schema specialization never mutates another request and never leaves empty enums", () => {
  const family = JSON.stringify(googleLiteEuContextWireSchemaV3());
  const first = serializeContextRequest(input("Nhắc trước 2 ngày."));
  const snapshot = JSON.stringify(first);
  serializeContextRequest(input("Nhắc 2 ngày liên tiếp."));
  expect(JSON.stringify(first)).toBe(snapshot);
  expect(JSON.stringify(first.response_format)).not.toContain('"enum":[]');
  expect(fields(input("Nhắc trước 2 ngày."))).not.toContain("occurrenceCount");
  expect(JSON.stringify(googleLiteEuContextWireSchemaV3())).toBe(family);
});

function validator(context: ContextInput, ignoreUnsupportedConst = false) {
  const schema = typedSingletonSchemaFixture(deriveGenerationFieldCapability(context),context).schema;
  const inline = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(inline);
    if (!value || typeof value !== "object") return value;
    const node = value as Record<string, unknown>;
    if (typeof node.$ref === "string") {
      const target = node.$ref.slice(2).split("/").reduce((parent, key) => (parent as Record<string, unknown>)[key], schema as unknown);
      return inline(target);
    }
    return Object.fromEntries(Object.entries(node).filter(([key]) => key !== "$defs" && !(ignoreUnsupportedConst && key === "const")).map(([key, child]) => [key, inline(child)]));
  };
  const typed=z.fromJSONSchema(inline(schema) as Parameters<typeof z.fromJSONSchema>[0]);
  return {safeParse:(raw:unknown)=>typed.safeParse(unwrapSingletonAuthoringFixture(raw))};
}
it.each(["REPLACE", "CLEAR"] as const)("first R04 task cannot generate title %s without an occupied CURRENT title", operation => {
  const context = input("Tôi thi ngày 11/10 lúc 8h."), check = validator(context);
  const evidence = [{ kind: "USER_QUOTE" as const, turn: 0, quote: context.turns[0].text, occurrence: 1 }];
  const canonical = ConversationInterpretationV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence }, changes: [{ field: "title", operation, value: operation === "CLEAR" ? null : "đi thi", evidence }], query: null, uncertainties: [], conversationDirective: null, replyProposal: null });
  expect(check.safeParse(encodeGoogleLiteEuContextV3(canonical)).success).toBe(false);
  expect(fields(context)).not.toContain("title");
});
it.each(["PROPOSED", "RESOLVED", "CONFLICT"] as const)("occupied CURRENT title %s preserves correction availability", state => {
  const context=input("Đổi tiêu đề thành gọi mẹ."),slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];
  slots.title={state,value:"đi thi",fact:state==="RESOLVED"?"f1":null};context.activeRequest={lifecycle:"CLARIFYING",slots};
  expect(catalogue(context).titleCorrectionAllowed).toBe(true);
  const evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:context.turns[0].text,occurrence:1}];
  for(const operation of ["REPLACE","CLEAR"] as const){
    const proposal=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"title",operation,value:operation==="CLEAR"?null:"gọi mẹ",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
    expect(validator(context).safeParse(encodeGoogleLiteEuContextV3(proposal)).success).toBe(true);
  }
  slots.title={state:"MISSING",value:null,fact:null};
  expect(catalogue(context).titleCorrectionAllowed).toBe(false);
  expect(fields(context)).not.toContain("title");
});
it("historical title and unrelated facts cannot grant correction availability without CURRENT",()=>{
  const context=input("Tạo yêu cầu mới gọi mẹ.");
  context.turns.unshift({role:"USER",text:"nhắc đi thi"});context.currentTurn=1;
  context.facts=[{alias:"f1",scope:"REMINDER",field:"title",value:"đi thi",provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:"2026-09-28T03:00:00Z",dependencies:[]},{alias:"f2",scope:"QUERY",field:"queryRange",value:{kind:"LIST",period:{kind:"WEEK",offset:0},statusScope:"DEFAULT",evidence:[{kind:"USER_QUOTE",turn:0,quote:"nhắc đi thi",occurrence:1}]},provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:"2026-09-28T03:00:00Z",dependencies:[]}];
  expect(catalogue(context).titleCorrectionAllowed).toBe(false);
  expect(fields(context)).not.toContain("title");
  context.turns[context.currentTurn].text="Xem lịch tuần này.";
  expect(catalogue(context).titleCorrectionAllowed).toBe(false);
  expect(fields(context)).not.toContain("title");
});
it("R04 supported dialect still forbids ordinary title SET when unsupported const is ignored", () => {
  const context = input("Tôi thi ngày 11/10 lúc 8h."), check = validator(context, true);
  const evidence = [{ kind: "USER_QUOTE" as const, turn: 0, quote: context.turns[0].text, occurrence: 1 }];
  const canonical = ConversationInterpretationV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence }, changes: [{ field: "title", operation: "SET", value: "đi thi", evidence },{field:"eventTime",operation:"SET",value:{hour:8,minute:0,qualifier:"H24"},evidence}], query: null, uncertainties: [], conversationDirective: null, replyProposal: null });
  const wire = encodeGoogleLiteEuContextV3(canonical) as { titleChange: { change: unknown }; changes: unknown[] };
  expect(check.safeParse(wire).success).toBe(true);
  const duplicate = { ...wire, changes: [structuredClone(wire.titleChange.change)] };
  expect(check.safeParse(duplicate).success).toBe(false);
  for (const operation of ["REPLACE", "CLEAR"] as const) {
    const correction = ConversationInterpretationV3Schema.parse({ ...canonical, changes: [{ field: "title", operation, value: operation === "CLEAR" ? null : "họp", evidence }] });
    expect(check.safeParse(encodeGoogleLiteEuContextV3(correction)).success).toBe(false);
  }
});
it.each(["SET", "REPLACE", "CLEAR"] as const)("wire rejects absent clock %s while keeping clock MISSING expressible", operation => {
  const context = input("Đừng bỏ."), check = validator(context);
  const evidence = [{ kind: "USER_QUOTE", turn: 0, quote: context.turns[0].text, occurrence: 1 }];
  const value = operation === "CLEAR" ? null : { hour: 8, minute: 0, qualifier: "H24" };
  const raw = ConversationInterpretationV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence }, changes: [{ field: "reminderTime", operation, value, evidence }], query: null, uncertainties: [], conversationDirective: null, replyProposal: null });
  expect(check.safeParse(encodeGoogleLiteEuContextV3(raw)).success).toBe(false);
  expect(check.safeParse(encodeGoogleLiteEuContextV3({ ...raw, changes: [], uncertainties: [{ field: "reminderTime", reason: "MISSING", alternatives: [] }] })).success).toBe(true);
});
it("independent consumer requires exactly one model title carrier, never a retained NEW title",()=>{
  const context=input("Ngày 11/10 đi thi, nhắc tôi trước 2 ngày."),check=validator(context);
  const evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:context.turns[0].text,occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {titleChange:unknown;changes:unknown[]};
  expect(check.safeParse(wire).success).toBe(true);
  expect(check.safeParse({...wire,titleChange:null}).success).toBe(false);
  const absent={...wire} as Partial<typeof wire>;delete absent.titleChange;
  expect(check.safeParse(absent).success).toBe(false);
  expect(check.safeParse({...wire,changes:[canonical.changes[0]]}).success).toBe(false);
  const slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];
  slots.title={state:"RESOLVED",value:"đi thi",fact:"f1"};context.activeRequest={lifecycle:"CLARIFYING",slots};
  expect(catalogue(context).titlePresenceRequired).toBe(true);
});
it("non-obligated requests expose one title SET representation while preserving title REPLACE/CLEAR",()=>{
  const context=input("Đổi tiêu đề thành việc mới.");
  const slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<ContextInput["activeRequest"]>["slots"];
  slots.title={state:"PROPOSED",value:"việc cũ",fact:null};context.activeRequest={lifecycle:"CLARIFYING",slots};
  const check=validator(context),evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:context.turns[0].text,occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"title",operation:"SET",value:"việc mới",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {titleChange:{change:unknown};changes:unknown[]};
  expect(check.safeParse(wire).success).toBe(true);
  expect(check.safeParse({...wire,titleChange:null,changes:[wire.titleChange.change]}).success).toBe(false);
  for(const operation of ["REPLACE","CLEAR"] as const)expect(check.safeParse(encodeGoogleLiteEuContextV3({...canonical,changes:ConversationInterpretationV3Schema.parse({...canonical,changes:[{field:"title",operation,value:operation==="CLEAR"?null:"khác",evidence}]}).changes})).success).toBe(true);
});
it("specialized typed R02 admission schema exposes only reachable definitions before opaque mapping",()=>{
  const context=input("Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.");
  const schema=typedSingletonSchemaFixture(deriveGenerationFieldCapability(context),context).schema as unknown as {$defs:Record<string,unknown>};
  const reached=new Set<string>();
  const visit=(value:unknown)=>{
    if(!value||typeof value!=="object")return;
    const node=value as Record<string,unknown>;
    if(typeof node.$ref==="string"){
      const key=node.$ref.split("/").at(-1)!;
      if(!reached.has(key)){reached.add(key);visit(schema.$defs[key]);}
    }
    for(const [key,child]of Object.entries(node))if(key!=="$defs"){
      if(Array.isArray(child))child.forEach(visit);else visit(child);
    }
  };
  visit(schema);
  expect(Object.keys(schema.$defs).filter(key=>!reached.has(key))).toEqual([]);
});
it.each(["SET", "REPLACE", "CLEAR"] as const)("independent schema consumer rejects forbidden field carriers including %s", operation => {
  const context = input("Nhắc trước 2 ngày."), check = validator(context);
  const evidence = [{ kind: "USER_QUOTE", turn: 0, quote: context.turns[0].text, occurrence: 1 }];
  const encoded = (field: "frequency" | "occurrenceCount" | "leadOffsetDays", value: unknown) => encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence },
    changes: [{ field, operation, value: operation === "CLEAR" ? null : value, evidence }], query: null, uncertainties: [], conversationDirective: null, replyProposal: null }));
  expect(check.safeParse(encoded("leadOffsetDays", 2)).success).toBe(true);
  expect(check.safeParse(encoded("frequency", "DAILY")).success).toBe(false);
  expect(check.safeParse(encoded("occurrenceCount", 2)).success).toBe(false);
  const missing = encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence }, changes: [], query: null,
    uncertainties: [{ field: "occurrenceCount", reason: "MISSING", alternatives: [] }], conversationDirective: { kind: "ASK_FOR_FIELD", field: "occurrenceCount" }, replyProposal: null }));
  expect(check.safeParse(missing).success).toBe(true);
});
it("wire81 actual complete projection accepts coherent answer and preserves unrelated uncertainty bypass clarification",async()=>{
 for(const bypass of [false,true]){
  const h=await harness([proposal({title:"đi thi",eventDate:date(11,10,null),frequency:"DAILY",occurrenceCount:2}),proposal({eventRelation:"BEFORE_EVENT"},"CURRENT"),context=>{
   expect(capabilityModule.isBoundCompleteFiniteSeriesClockAnswer(context)).toBe(true);
   const uncertainty=serializeContextRequest(context).response_format.json_schema.schema.properties?.uncertainties;
   if(!uncertainty||typeof uncertainty!=="object")throw Error("uncertainty array schema required");expect(uncertainty.maxItems).toBe(0);
   return {...proposal({reminderTime:{hour:12,minute:0,qualifier:"H24"}},"CURRENT")(context) as Record<string,unknown>,uncertainties:bypass?[{field:"operation",reason:"MISSING",alternatives:[]},{field:"endDate",reason:"MISSING",alternatives:[]}]:[]};
  }]);
  let reads=0;const list=h.deps.list;h.deps.list=input=>{reads++;return list(input);};
  await h.turn(0,"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");await h.turn(1,"Nhắc trước 2 ngày.");await h.turn(2,"12h trưa.");
  expect(h.events.some(event=>event.event==="POST_CANONICAL_STAGE"&&event.diagnostic.stage==="MERGE"&&event.diagnostic.result==="CLARIFY")).toBe(bypass);
  expect(reads).toBe(0);expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminders").first<number>("n")).toBe(0);expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminder_series").first<number>("n")).toBe(0);
 }
});
it("wire80 typed ambiguous direct bypass still follows unchanged canonical/evidence/merge clarification",async()=>{
 const h=await harness([proposal({title:"đi thi",eventDate:date(11,10,null),frequency:"DAILY",occurrenceCount:2}),proposal({eventRelation:"BEFORE_EVENT"},"CURRENT"),context=>{
  const evidence=[{kind:"USER_QUOTE",turn:context.currentTurn,quote:context.turns[context.currentTurn].text,occurrence:1}],clock={hour:12,minute:0,qualifier:"H24"};
  return {...proposal({reminderTime:clock},"CURRENT")(context) as Record<string,unknown>,uncertainties:[{field:"reminderTime",reason:"AMBIGUOUS",alternatives:[{value:clock,evidence}]}]};
 }]);
 let listReads=0;const list=h.deps.list;h.deps.list=input=>{listReads++;return list(input);};
 await h.turn(0,"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");await h.turn(1,"Nhắc trước 2 ngày.");await h.turn(2,"12h trưa.");
 expect(h.events.some(event=>event.event==="POST_CANONICAL_STAGE"&&event.diagnostic.stage==="MERGE"&&event.diagnostic.result==="REJECTED")).toBe(false);
 expect((await h.read(3))?.slots.reminderTime.value).toEqual({hour:12,minute:0,qualifier:"H24"});
 expect(h.events.some(event=>event.event==="POST_CANONICAL_STAGE"&&event.diagnostic.stage==="TRANSITION"&&event.diagnostic.result==="CLARIFY")).toBe(true);
 expect(listReads).toBe(0);
 expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminders").first<number>("n")).toBe(0);
 expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminder_series").first<number>("n")).toBe(0);
});
it("wire79 actual service accepts coherent clock and still rejects contradictory bypass atomically",async()=>{
 for(const contradictory of [false,true]){
  const h=await harness([proposal({title:"đi thi",eventDate:date(11,10,null),frequency:"DAILY",occurrenceCount:2}),proposal({eventRelation:"BEFORE_EVENT"},"CURRENT"),context=>{
   const value=proposal({reminderTime:{hour:12,minute:0,qualifier:"H24"}},"CURRENT")(context) as Record<string,unknown>;
   return {...value,uncertainties:contradictory?[{field:"reminderTime",reason:"MISSING",alternatives:[]}]:[]};
  }]);
  await h.turn(0,"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");await h.turn(1,"Nhắc trước 2 ngày.");await h.turn(2,"12h trưa.");
  expect(h.events.some(event=>event.event==="POST_CANONICAL_STAGE"&&event.diagnostic.stage==="MERGE"&&event.diagnostic.result==="REJECTED"&&event.diagnostic.reason==="FACT_MISSING_CONTRADICTION")).toBe(contradictory);
  expect((await h.read(3))?.slots.reminderTime.value).toEqual(contradictory?null:{hour:12,minute:0,qualifier:"H24"});
 }
});
it("retained numeric schema branches grant no NEW request fact authority", async () => {
  let allowed: unknown;
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), frequency: "DAILY", occurrenceCount: 2 }), context => {
    allowed = catalogue(context)?.allowedNumericFields;
    const raw = proposal({ occurrenceCount: 2 }, "NEW")(context) as { changes: Array<{ evidence: unknown[] }> };
    const fact = context.facts.find(f => f.field === "occurrenceCount");
    if (!fact) throw Error("retained count fact missing");
    raw.changes[0].evidence = [{ kind: "CONTEXT_FACT", ref: fact.alias }];
    return raw;
  }]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");
  await h.turn(1, "Nhắc việc mới.");
  expect(allowed).toEqual(["frequency", "occurrenceCount"]);
  expect(h.events).toContainEqual(expect.objectContaining({ event: "POST_CANONICAL_STAGE", diagnostic: expect.objectContaining({ stage: "EVIDENCE", result: "REJECTED", reason: "EVIDENCE_INVALID" }) }));
  expect((await h.read(2))?.slots.occurrenceCount.value).toBe(2);
});
