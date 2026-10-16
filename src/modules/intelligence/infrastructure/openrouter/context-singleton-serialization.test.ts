// @vitest-environment node
import {expect,it} from "vitest";
import {createHash} from "node:crypto";
import {ContextInputSchema,ConversationInterpretationV3Schema} from "../../../conversation/context-contract/contracts";
import {CONTEXT_CONTRACT_PROMPT} from "../../../conversation/context-contract/prompt";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import {decodeGoogleLiteEuContextTransportV3} from "./context-provider-wire";
import {encodeFixtureV3} from "../../../../../tools/benchmark/context-pointer-fixtures";
import {primaryEvidenceSourceCodebook} from "./evidence-pointer";
import {wire91PromptFixture} from "../../../../../tools/benchmark/context-singleton-json.test-support";

it("producer serialization example survives both JSON layers and the unchanged source-bound decoder",()=>{
 const example=/^Serialization example \(syntax only\): (.+)$/m.exec(CONTEXT_CONTRACT_PROMPT);
 expect(example).not.toBeNull();
 const partial=JSON.parse(example![1]) as {eventRelationChange:{rank?:number;change:string}};
 const change=JSON.parse(partial.eventRelationChange.change);
 expect(change).toEqual({field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence:{primaryEvidence:"<available source code>",additionalEvidenceJson:"[]"}});
 expect(JSON.parse(change.evidence.additionalEvidenceJson)).toEqual([]);
 const input=ContextInputSchema.parse({schemaVersion:"calenote-context-input-2",reference:{instant:"2026-09-28T03:00:00Z",localDate:"2026-09-28",timezone:"Asia/Ho_Chi_Minh"},turns:Array.from({length:7},(_,index)=>({role:index%2?"ASSISTANT":"USER",text:"Nhắc trước sự kiện."})),currentTurn:6,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:"v1",supported:["ONCE","FINITE_DAILY"],unsupported:["YEARLY"],calendars:["GREGORIAN","LUNAR_VN"],limits:{dailyCount:30,horizonDays:366}}});
 const evidence=[{kind:"USER_QUOTE",turn:6,quote:"Nhắc trước sự kiện.",occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeFixtureV3(canonical,input) as Record<string,unknown>;
 wire.eventRelationChange=partial.eventRelationChange;
 expect(decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,undefined,input).status).toBe("REFUSED");
 partial.eventRelationChange.rank=10;
 expect(decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,undefined,input).status).toBe("REFUSED");
 delete partial.eventRelationChange.rank;
 change.evidence.primaryEvidence=primaryEvidenceSourceCodebook(input).entries.find(entry=>entry.kind==="USER_TURN"&&entry.turn===input.currentTurn)!.code;
 partial.eventRelationChange.change=JSON.stringify(change);
 expect(decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,undefined,input).status).toBe("REFUSED");
 partial.eventRelationChange.rank=10;
 expect(decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,undefined,input)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
 const diagnostics:unknown[]=[];
 wire.eventRelationChange={...partial.eventRelationChange,change:partial.eventRelationChange.change.slice(0,-1)};
 expect(decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d),input).status).toBe("REFUSED");
 expect((diagnostics[0] as {issues:unknown[]}).issues[0]).toMatchObject({singletonJson:{stage:"JSON_PARSE",reason:"INVALID_JSON"}});
});
it("serialization-only paragraph inverse preserves the immutable wire88 prompt",()=>{
 const inverse=wire91PromptFixture(CONTEXT_CONTRACT_PROMPT).replace(/\nSingleton serialization:[^\n]*\nSerialization example \(syntax only\):[^\n]*\nSerialization example boundary:[^\n]*\n/u,"");
 expect(createHash("sha256").update(inverse).digest("hex")).toBe("3f90c952df37db5898dafe329cd7a7c35003ea2638aa4cd9baac46a23bea4c14");
});
