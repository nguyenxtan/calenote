// @vitest-environment node
import {expect,it} from "vitest";
import {createHash} from "node:crypto";
import {ContextInputSchema,ConversationInterpretationV3Schema} from "../../../conversation/context-contract/contracts";
import {CONTEXT_CONTRACT_PROMPT} from "../../../conversation/context-contract/prompt";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import {decodeGoogleLiteEuContextTransportV3,UNCERTAINTY_FIELD_WIRE_CODE_V1} from "./context-provider-wire";
import {encodeFixtureV3} from "../../../../../tools/benchmark/context-pointer-fixtures";
import {primaryEvidenceSourceCodebook} from "./evidence-pointer";

it("numeric alternative example preserves number inside both JSON layers and never supplies source authority",()=>{
 const match=/^Alternative example \(syntax only\): (.+)$/m.exec(CONTEXT_CONTRACT_PROMPT);expect(match).not.toBeNull();
 const partial=JSON.parse(match![1]) as {uncertainties:Array<{fieldCode:number;reason:string;alternatives:string[]}>};
 expect(partial.uncertainties[0].fieldCode).toBe(UNCERTAINTY_FIELD_WIRE_CODE_V1.leadOffsetDays);
 const alternative=JSON.parse(partial.uncertainties[0].alternatives[0]);
 expect(alternative).toEqual({value:2,evidence:{primaryEvidence:"<available source code>",additionalEvidenceJson:"[]"}});
 const input=ContextInputSchema.parse({schemaVersion:"calenote-context-input-2",reference:{instant:"2026-09-28T03:00:00Z",localDate:"2026-09-28",timezone:"Asia/Ho_Chi_Minh"},turns:[{role:"USER",text:"Nhắc trước sự kiện 2 ngày."}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:"v1",supported:["ONCE","FINITE_DAILY"],unsupported:["YEARLY"],calendars:["GREGORIAN","LUNAR_VN"],limits:{dailyCount:30,horizonDays:366}}});
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:input.turns[0].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[],query:null,uncertainties:[{field:"leadOffsetDays",reason:"AMBIGUOUS",alternatives:[{value:2,evidence}]}],conversationDirective:null,replyProposal:null});
 const wire=encodeFixtureV3(canonical,input) as Record<string,unknown>;wire.uncertainties=partial.uncertainties;
 expect(decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,undefined,input).status).toBe("REFUSED");
 alternative.evidence.primaryEvidence=primaryEvidenceSourceCodebook(input).entries.find(entry=>entry.kind==="USER_TURN"&&entry.turn===0)!.code;
 partial.uncertainties[0].alternatives[0]=JSON.stringify(alternative);
 expect(decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,undefined,input)).toMatchObject({status:"PARSED",value:{semantic:{uncertainties:canonical.uncertainties}}});
 for(const value of ["2","two",null,0,1.5]){
  partial.uncertainties[0].alternatives[0]=JSON.stringify({...alternative,value});
  expect(decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,undefined,input).status).toBe("REFUSED");
 }
});
it("alternative-only paragraph inverse preserves immutable wire91 prompt",()=>{
 const inverse=CONTEXT_CONTRACT_PROMPT.replace(/\nAlternative serialization:[^\n]*\nAlternative example \(syntax only\):[^\n]*\nAlternative example boundary:[^\n]*\n/u,"");
 expect(createHash("sha256").update(inverse).digest("hex")).toBe("60d9fa3ccb7ef9a07466a93ae66168e6fd170f8ab7f02f3c65e4394eed4ac153");
});
