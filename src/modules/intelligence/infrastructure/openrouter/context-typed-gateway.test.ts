// @vitest-environment node
import { expect, it, vi } from "vitest";
import { ContextInputSchema, ConversationInterpretationV3Schema } from "../../../conversation/context-contract/contracts";
import { CONTEXT_PROTOCOL_V3 } from "../../../conversation/context-contract/protocol";
import { CONTEXT_TYPED_PROTOCOL_V3 } from "../../../conversation/context-contract/typed-protocol";
import { serializeTypedContextRequest } from "../../../conversation/context-contract/typed-wire";
import { createContextContractGateway, createTypedContextContractGateway, type SemanticJsonRequest } from "./semantic-gateway";
import { encodeGoogleLiteEuTypedContextV3 } from "./context-provider-typed-wire";

const config = {protocol:CONTEXT_TYPED_PROTOCOL_V3,maxInputChars:1800,maxInputTokens:12000,maxOutputTokens:1536,maxResponseBytes:32768,timeoutMs:30000,
  primary:{model:"google/gemini-2.5-flash-lite",provider:"google-vertex/eu",requireZdr:true,promptPriceMicrounitsPerMillionTokens:100000,completionPriceMicrounitsPerMillionTokens:400000}};
const input = ContextInputSchema.parse({schemaVersion:"calenote-context-input-2",reference:{instant:"2026-09-28T03:00:00.000Z",localDate:"2026-09-28",timezone:"Asia/Ho_Chi_Minh"},turns:[{role:"USER",text:"Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi."}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:"context-capabilities-1",supported:["ONCE","FINITE_DAILY"],unsupported:["YEARLY"],calendars:["GREGORIAN"],limits:{dailyCount:30,horizonDays:366}}});
const evidence=[{kind:"USER_QUOTE",turn:0,quote:input.turns[0].text,occurrence:1}];
const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence},{field:"eventDate",operation:"SET",value:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null},evidence},{field:"location",operation:"SET",value:"Quang Trung",evidence},{field:"frequency",operation:"SET",value:"DAILY",evidence},{field:"occurrenceCount",operation:"SET",value:2,evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
const route={only:["google-vertex/eu"],allow_fallbacks:false,require_parameters:true,data_collection:"deny",zdr:true,max_price:{prompt:.1,completion:.4}};
function response(payload:unknown) {return {status:200,body:JSON.stringify({model:config.primary.model,provider:"Google",id:"gen-offline-typed105",choices:[{finish_reason:"stop",message:{content:JSON.stringify(payload)}}],usage:{cost:.001,prompt_tokens:100,completion_tokens:100}})};}

it("pairs input-selected typed105 schema and decoder for observable and offline paths, preserving route and one dispatch",async()=>{
 const payload=encodeGoogleLiteEuTypedContextV3(canonical,input);
 const expected={model:config.primary.model,...serializeTypedContextRequest(input),provider:route};
 const calls:SemanticJsonRequest[]=[];
 const mock=vi.fn(async(request:SemanticJsonRequest)=>{calls.push(structuredClone(request));return response(payload);});
 const observable=createTypedContextContractGateway(config,mock,{status:"OBSERVABLE_CANARY",advertisedContextTokens:1048576});
 const offline=createTypedContextContractGateway(config,{kind:"OFFLINE_FIXTURE",exchanges:[{requestJson:JSON.stringify(expected),admission:{fullInputTokens:12000,billableOverheadMicrounits:0},response:response(payload)}]});
 for(const gateway of [observable,offline]){
  const attempt=gateway.prepare("PRIMARY",input);expect(attempt.status).toBe("READY");
  if(attempt.status!=="READY")throw Error("Expected offline readiness");
  expect(await attempt.dispatch()).toMatchObject({status:"SUCCESS",interpretation:{semantic:{changes:canonical.changes},fullSchemaValid:true}});
  expect(await attempt.dispatch()).toMatchObject({status:"FAILURE",category:"UNAVAILABLE"});
 }
 expect(calls).toEqual([expected]);expect(mock).toHaveBeenCalledTimes(1);
 expect(expected.response_format.json_schema.name).toBe("calenote_context_typed_105");
});

it("rejects cross-version selection and performs no dispatch when route admission is unverified",()=>{
 const transport=vi.fn(async()=>response({}));
 expect(()=>createTypedContextContractGateway({...config,protocol:CONTEXT_PROTOCOL_V3} as unknown as Parameters<typeof createTypedContextContractGateway>[0],transport)).toThrow();
 expect(()=>createContextContractGateway({...config,protocol:CONTEXT_TYPED_PROTOCOL_V3} as unknown as Parameters<typeof createContextContractGateway>[0],transport)).toThrow();
 expect(createTypedContextContractGateway(config,transport).prepare("PRIMARY",input)).toEqual({status:"FAILURE",category:"ROUTE_ADMISSION_UNVERIFIED"});
 expect(transport).not.toHaveBeenCalled();
});

it("reports typed105 wire rejection when model returns a JSON string in a typed date operand",async()=>{
 const payload=encodeGoogleLiteEuTypedContextV3(canonical,input) as {eventDateChange:{change:{value:unknown}}};
 payload.eventDateChange.change.value=JSON.stringify(payload.eventDateChange.change.value);
 const attempt=createTypedContextContractGateway(config,async()=>response(payload),{status:"OBSERVABLE_CANARY",advertisedContextTokens:1048576}).prepare("PRIMARY",input);
 if(attempt.status!=="READY")throw Error("Expected ready");
 expect(await attempt.dispatch()).toMatchObject({status:"FAILURE",category:"SCHEMA_INVALID",canonicalValidationDiagnostics:{state:"WIRE_DECODE_FAILED",providerWireSchemaVersion:CONTEXT_TYPED_PROTOCOL_V3.wireVersion}});
});
