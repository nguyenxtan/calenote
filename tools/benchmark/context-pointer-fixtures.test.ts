// @vitest-environment node
import {expect,it} from "vitest";
import {ContextInputSchema,ConversationInterpretationV3Schema} from "../../src/modules/conversation/context-contract/contracts";
import {CONTEXT_PROTOCOL_V3} from "../../src/modules/conversation/context-contract/protocol";
import {decodeGoogleLiteEuContextTransportV3} from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";
import {encodeFixtureV3} from "./context-pointer-fixtures";
it("wire59 bound fixture authors exact alternative primary source and ordered extras without changing value",()=>{
 const input=ContextInputSchema.parse({schemaVersion:"calenote-context-input-2",reference:{instant:"2026-10-08T03:00:00Z",localDate:"2026-10-08",timezone:"Asia/Ho_Chi_Minh"},turns:[{role:"USER",text:" alpha [CONTROL] beta "},{role:"ASSISTANT",text:"question"},{role:"USER",text:"current"}],currentTurn:2,activeRequest:null,facts:[{alias:"f1",scope:"REMINDER",field:"notes",value:"fact",provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:"2026-10-08T03:00:00Z",dependencies:[]}],pendingQuestion:null,ambiguities:[],capabilities:{version:"v1",supported:["ONCE"],unsupported:[],calendars:["GREGORIAN"],limits:{dailyCount:30,horizonDays:366}}});
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:" beta ",occurrence:1},{kind:"CONTEXT_FACT",ref:"f1"},{kind:"USER_QUOTE",turn:2,quote:"current",occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"HELP",requestTarget:null,changes:[],query:null,uncertainties:[{field:"notes",reason:"UNSUPPORTED_COMBINATION",alternatives:[{value:"S0.1",evidence}]}],conversationDirective:null,replyProposal:null}),before=JSON.stringify(canonical);
 const raw=encodeFixtureV3(canonical,input) as {uncertainties:Array<{alternatives:string[]}>};
 expect(JSON.parse(raw.uncertainties[0].alternatives[0])).toEqual({value:"S0.1",evidence:{primaryEvidence:"S0.1",additionalEvidenceJson:JSON.stringify([{kind:"CONTEXT_FACT",ref:"f1"},{kind:"USER_TURN",turn:2}])}});
 expect(decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,input)).toMatchObject({status:"PARSED",value:{semantic:{uncertainties:canonical.uncertainties}}});expect(JSON.stringify(canonical)).toBe(before);
});
it("bound fixture transport preserves all ten authored catalogue positions and source codes with only eventDate typed",()=>{
 const input=ContextInputSchema.parse({schemaVersion:"calenote-context-input-2",reference:{instant:"2026-10-08T03:00:00Z",localDate:"2026-10-08",timezone:"Asia/Ho_Chi_Minh"},turns:[{role:"USER",text:"Ngày 11/10 đi thi."}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:"v1",supported:["ONCE"],unsupported:[],calendars:["GREGORIAN"],limits:{dailyCount:30,horizonDays:366}}});
 const date={kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null},clock={hour:8,minute:0,qualifier:"H24"},evidence=[{kind:"USER_QUOTE",turn:0,quote:input.turns[0].text,occurrence:1}];
 const values={location:"synthetic",endDate:date,occurrenceCount:2,frequency:"DAILY",eventRelation:"BEFORE_EVENT",eventTime:clock,eventDate:date,reminderTime:clock,reminderDate:date,title:"đi thi"};
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:Object.entries(values).map(([field,value])=>({field,operation:"SET",value,evidence})),query:null,uncertainties:[],conversationDirective:null,replyProposal:null}),before=JSON.stringify(canonical);
 const raw=encodeFixtureV3(canonical,input) as Record<string,{rank:string;change:{value:unknown;evidence:{primaryEvidence:string}}}>;
 expect(raw).not.toHaveProperty("changeOrder");
 for(const [rank,field] of Object.keys(values).entries()){expect(Object.keys(raw[field+"Change"])).toEqual(["rank","change"]);expect(raw[field+"Change"].rank).toBe(String(rank));expect(raw[field+"Change"]).not.toHaveProperty("index");expect(raw[field+"Change"].change.evidence.primaryEvidence).toBe("U0");}
 expect(raw.eventDateChange.change.value).toEqual(date);expect(raw.reminderDateChange.change.value).toBe(JSON.stringify(date));expect(raw.endDateChange.change.value).toBe(JSON.stringify(date));
 expect(decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,input)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
 expect(JSON.stringify(canonical)).toBe(before);
});
