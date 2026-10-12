// @vitest-environment node
import {expect,it} from "vitest";
import {createHash} from "node:crypto";
import {ContextInputSchema,ConversationInterpretationV3Schema,SlotValueSchemas} from "../../../conversation/context-contract/contracts";
import {CONTEXT_CONTRACT_PROMPT} from "../../../conversation/context-contract/prompt";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import {decodeGoogleLiteEuContextTransportV3,UNCERTAINTY_FIELD_WIRE_CODE_V1} from "./context-provider-wire";
import {encodeFixtureV3} from "../../../../../tools/benchmark/context-pointer-fixtures";

it("producer alternative enum guidance binds code10 to every exact canonical relation without authoring candidates",()=>{
 const sentence=/^Alternative relation enum: (.+)$/m.exec(CONTEXT_CONTRACT_PROMPT);expect(sentence).not.toBeNull();
 expect(sentence![1]).toContain(`fieldCode${UNCERTAINTY_FIELD_WIRE_CODE_V1.eventRelation} eventRelation`);
 expect(sentence![1]).toContain(SlotValueSchemas.eventRelation.options.join("/"));
 expect(sentence![1]).toContain("No alias, lowercase, translated phrase, number or object");
 expect(sentence![1]).toContain("Do not manufacture alternatives");
});
it.each(SlotValueSchemas.eventRelation.options)("unchanged codec preserves exact %s and rejects non-enum alternatives",value=>{
 const text={BEFORE_EVENT:"Nhắc trước sự kiện.",INCLUDING_EVENT:"Nhắc cả ngày sự kiện.",STARTING_ON:"Nhắc bắt đầu từ ngày sự kiện."}[value];
 const input=ContextInputSchema.parse({schemaVersion:"calenote-context-input-2",reference:{instant:"2026-09-28T03:00:00Z",localDate:"2026-09-28",timezone:"Asia/Ho_Chi_Minh"},turns:[{role:"USER",text}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:"v1",supported:["ONCE","FINITE_DAILY"],unsupported:["YEARLY"],calendars:["GREGORIAN","LUNAR_VN"],limits:{dailyCount:30,horizonDays:366}}});
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[],query:null,uncertainties:[{field:"eventRelation",reason:"AMBIGUOUS",alternatives:[{value,evidence}]}],conversationDirective:null,replyProposal:null});
 const wire=encodeFixtureV3(canonical,input) as {uncertainties:Array<{fieldCode:number;alternatives:string[]}>};
 expect(wire.uncertainties[0].fieldCode).toBe(UNCERTAINTY_FIELD_WIRE_CODE_V1.eventRelation);
 expect(decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,undefined,input)).toMatchObject({status:"PARSED",value:{semantic:{uncertainties:canonical.uncertainties}}});
 const alternative=JSON.parse(wire.uncertainties[0].alternatives[0]);
 for(const invalid of ["BEFORE","before_event","trước sự kiện",10,{relation:value},null]){
  wire.uncertainties[0].alternatives[0]=JSON.stringify({...alternative,value:invalid});
  expect(decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,undefined,input).status).toBe("REFUSED");
 }
});
it("relation-only inverse preserves immutable wire92 numeric prompt",()=>{
 const inverse=CONTEXT_CONTRACT_PROMPT.replace(/^Alternative relation enum: [^\n]*\n/mu,"");
 expect(createHash("sha256").update(inverse).digest("hex")).toBe("ef9857d2ea81741698714f5705b49074ac2a770a8027da649bf9dc9af35b071e");
});
