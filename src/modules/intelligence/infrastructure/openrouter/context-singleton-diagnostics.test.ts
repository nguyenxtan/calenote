// @vitest-environment node
import {expect,it} from "vitest";
import {ConversationInterpretationV3Schema,ContextInputSchema} from "../../../conversation/context-contract/contracts";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import {encodeGoogleLiteEuContextV3,decodeGoogleLiteEuContextTransportV3} from "./context-provider-wire";

function specimen(){
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_SOURCE",occurrence:1}];
 return encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"eventRelation",operation:"CLEAR",value:null,evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null})) as Record<string,unknown>;
}
const cases=[
 ["{","JSON_PARSE","INVALID_JSON"],
 ['{"PRIVATE_KEY":"PRIVATE_VALUE","PRIVATE_KEY":0}',"JSON_SCAN","DUPLICATE_KEY"],
 ['{"x":'+"[".repeat(9)+'0'+"]".repeat(9)+'}',"JSON_SCAN","DEPTH_LIMIT"],
 ['{"x":['+Array.from({length:256},()=>0).join(",")+']}',"JSON_SCAN","NODE_LIMIT"],
 ['[]',"JSON_PARSE","NON_OBJECT"],
 ['{"field":"eventRelation","operation":"CLEAR","value":"PRIVATE_VALUE","evidence":{"primaryEvidence":"{}","additionalEvidenceJson":"[]"}}',"TYPED_PREDICATE","INVALID_TYPED_ROOT"],
 [" ".repeat(32769),"WIRE_VALUE","OVERSIZED"],
 [42,"WIRE_VALUE","WRONG_WIRE_TYPE"],
] as const;
it.each(cases)("singleton refusal has bounded structural stage %s",(change,stage,reason)=>{
 const raw=specimen(),carrier=raw.eventRelationChange as object;
 raw.eventRelationChange={...carrier,change};const before=JSON.stringify(raw),diagnostics:unknown[]=[];
 expect(decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d))).toEqual({status:"REFUSED",reason:"SEMANTIC_PATCH_INVALID"});
 expect((diagnostics[0] as {issues:unknown[]}).issues[0]).toMatchObject({path:["eventRelationChange","change"],singletonJson:{stage,reason}});
 expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE_SOURCE|PRIVATE_KEY|PRIVATE_VALUE/);
 expect(JSON.stringify(raw)).toBe(before);
 expect(decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,()=>{throw Error("PRIVATE_OBSERVER")})).toEqual({status:"REFUSED",reason:"SEMANTIC_PATCH_INVALID"});
});
it("source-bound typed projection refusal is separate from the generic typed predicate",()=>{
 const input=ContextInputSchema.parse({schemaVersion:"calenote-context-input-2",reference:{instant:"2026-09-28T03:00:00Z",localDate:"2026-09-28",timezone:"Asia/Ho_Chi_Minh"},turns:[{role:"USER",text:"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h."}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:"v1",supported:["ONCE","FINITE_DAILY"],unsupported:["YEARLY"],calendars:["GREGORIAN","LUNAR_VN"],limits:{dailyCount:30,horizonDays:366}}});
 const raw=specimen(),carrier=raw.eventRelationChange as {rank:number;change:string};
 raw.eventRelationChange={...carrier,rank:1};raw.titleChange={rank:0,change:JSON.stringify({...JSON.parse(carrier.change),field:"title",operation:"SET",value:"literal"})};
 expect(decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("PARSED");
 const diagnostics:unknown[]=[];expect(decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d),input).status).toBe("REFUSED");
 expect((diagnostics[0] as {issues:unknown[]}).issues[0]).toMatchObject({singletonJson:{stage:"TYPED_PROJECTION",reason:"INVALID_TYPED_ROOT"}});
});
it("valid singleton transport remains accepted without refusal telemetry",()=>{
 const raw=specimen(),before=JSON.stringify(raw),diagnostics:unknown[]=[];
 expect(decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("PARSED");
 expect(diagnostics).toEqual([]);expect(JSON.stringify(raw)).toBe(before);
});
