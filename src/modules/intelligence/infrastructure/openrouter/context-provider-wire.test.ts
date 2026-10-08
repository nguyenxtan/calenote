// @vitest-environment node
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { ContextInputSchema, ConversationInterpretationSchema, ConversationInterpretationV3Schema, parseInterpretationSections } from "../../../conversation/context-contract/contracts";
import { CONTEXT_PROTOCOL_V3 } from "../../../conversation/context-contract/protocol";
import { createContextContractGateway, createContextHttpTransport, type SemanticJsonRequest } from "./semantic-gateway";
import { encodeGoogleLiteEuContextV3, googleLiteEuContextWireSchemaV3 as googleLiteEuContextWireSchema, parseGoogleLiteEuContextSectionsV3 } from "./context-provider-wire";
import * as wireModule from "./context-provider-wire";
import { serializeContextRequest } from "../../../conversation/context-contract/wire";

it.each([undefined, {version:"generation-field-capability-4" as const,allowedNumericFields:[],allowedClockFields:["eventTime" as const,"reminderTime" as const],titlePresenceRequired:false,titleCorrectionAllowed:false}, {version:"generation-field-capability-4" as const,allowedNumericFields:[],allowedClockFields:[],titlePresenceRequired:true,titleCorrectionAllowed:false}])("outgoing string controls use supported enums without exposing encoded date tags (%#)", capability => {
  const schema=googleLiteEuContextWireSchema(capability).schema;
  let constants=0;const singletonValues:string[]=[];
  const walk=(value:unknown)=>{if(!value||typeof value!=="object")return;
    if(Array.isArray(value)){value.forEach(walk);return;}
    const node=value as Record<string,unknown>;
    if(typeof node.const==="string")constants++;
    if(Array.isArray(node.enum)&&node.enum.length===1&&typeof node.enum[0]==="string")singletonValues.push(node.enum[0]);
    Object.values(node).forEach(walk);
  };walk(schema);
  expect(constants).toBe(0);
  expect(singletonValues).toEqual(expect.arrayContaining(["title", "SET", "CLEAR"]));
  if (!capability) expect(singletonValues).toContain("REPLACE");
  for (const tag of ["CIVIL_DATE", "RELATIVE_DAY", "WEEKDAY"]) expect(singletonValues).not.toContain(tag);
});
it("encoded canonical date round trip preserves strict active payload authority", () => {
  const canonical = ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}]},changes:[{field:"reminderDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:2},evidence:[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}]}]});
  const encoded=encodeGoogleLiteEuContextV3(canonical) as {reminderDateChange:{change:{value:unknown}}};
  expect(encoded.reminderDateChange.change.value).toBe('{"kind":"RELATIVE_DAY","offsetDays":2}');
  expect(parseGoogleLiteEuContextSectionsV3(encoded,CONTEXT_PROTOCOL_V3).status).toBe("PARSED");
  for(const value of ['{"kind":"RELATIVE_DAY","offsetDays":null}','{"kind":"INVALID","offsetDays":2}','{"kind":"RELATIVE_DAY","offsetDays":2,"day":2}',"{",{kind:"RELATIVE_DAY",offsetDays:2}]) {
    const raw=structuredClone(encoded);raw.reminderDateChange.change.value=value;
    expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
  }
  const decoded=parseGoogleLiteEuContextSectionsV3(encoded,CONTEXT_PROTOCOL_V3);
  expect(decoded).toMatchObject({status:"PARSED",value:{semantic:{changes:[{value:{kind:"RELATIVE_DAY",offsetDays:2}}]}}});
});
it("compact date mapping never inspects inactive query date padding", () => {
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"LIST_REMINDERS",requestTarget:null,changes:[],query:{kind:"LIST",period:{kind:"MONTH",offset:0},statusScope:"DEFAULT",evidence:[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}]}});
  const raw=encodeGoogleLiteEuContextV3(canonical) as {query:{date:unknown;period:Record<string,unknown>}};
  raw.query.date={kind:"PRIVATE_PADDING",payload:"PRIVATE_SENTINEL"};raw.query.period.date={kind:"PRIVATE_PADDING"};raw.query.period.from={kind:"PRIVATE_PADDING"};raw.query.period.through={kind:"PRIVATE_PADDING"};
  const parsed=parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3);
  expect(parsed).toMatchObject({status:"PARSED",value:{semantic:{query:{kind:"LIST",period:{kind:"MONTH",offset:0}}}}});
  expect(JSON.stringify(parsed)).not.toContain("PRIVATE_");
});
import {isUnreconciledListInterpretation,readListTransport} from "../../../conversation/context-contract/list-period-transport";

const config = { protocol: CONTEXT_PROTOCOL_V3, maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
  primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true, promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } };
const input = ContextInputSchema.parse({ schemaVersion: "calenote-context-input-2", reference: { instant: "2026-09-28T03:00:00.000Z", localDate: "2026-09-28", timezone: "Asia/Ho_Chi_Minh" }, turns: [{ role: "USER", text: "synthetic" }], currentTurn: 0, activeRequest: null, facts: [], pendingQuestion: null, ambiguities: [], capabilities: { version: "context-capabilities-1", supported: ["ONCE"], unsupported: ["YEARLY"], calendars: ["GREGORIAN"], limits: { dailyCount: 30, horizonDays: 366 } } });
const minimal = { schemaVersion: "calenote-context-3", intent: "HELP", requestTarget: null, changes: [], query: null, uncertainties: [], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: null };
it("pointer throw metadata survives indexed restoration without inferring shifted raw operands",()=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_QUOTE_SENTINEL",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"notes",operation:"SET",value:"PRIVATE_VALUE_SENTINEL",evidence},{field:"reminderTime",operation:"REPLACE",value:{hour:9,minute:0,qualifier:"H24"},evidence}]});
  const raw=encodeGoogleLiteEuContextV3(canonical) as {requestTarget:{evidence:{primaryEvidence:string}};changes:Array<{evidence:{primaryEvidence:string}}>};
  raw.requestTarget.evidence.primaryEvidence=JSON.stringify({kind:"USER_TURN",turn:0});raw.changes[0].evidence.primaryEvidence=JSON.stringify({kind:"USER_TURN",turn:0});
  const diagnostics:unknown[]=[],before=JSON.stringify(raw);
  expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value),input).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{issues:[{path:["changes",1,"evidence","primaryEvidence"],expected:"EVIDENCE_SOURCE_POINTER",evidencePointer:{reason:"STRICT_USER_QUOTE",pointerKind:"USER_QUOTE",requestedTurn:0,sourceRole:"USER"}}]}]);
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");expect(JSON.stringify(raw)).toBe(before);
});
it.each([
  [{kind:"USER_TURN",turn:0},"BOUNDED_JSON_OBJECT"],
  ["{PRIVATE_EVIDENCE_SENTINEL", "JSON_OBJECT"],
  [JSON.stringify({kind:"USER_TURN",turn:11}),"EVIDENCE_SOURCE_POINTER"]
] as const)("actual evidence decode distinguishes finite primary failure %#",(primaryEvidence,expected)=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"notes",operation:"SET",value:"PRIVATE_VALUE_SENTINEL",evidence}]});
  const raw=encodeGoogleLiteEuContextV3(canonical) as {requestTarget:{evidence:{primaryEvidence:string}};changes:Array<{evidence:{primaryEvidence:unknown}}>};
  raw.requestTarget.evidence.primaryEvidence=JSON.stringify({kind:"USER_TURN",turn:0});
  raw.changes[0].evidence.primaryEvidence=primaryEvidence;
  const diagnostics:unknown[]=[],before=JSON.stringify(raw);
  expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value),input).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{issues:[{path:["changes",0,"evidence","primaryEvidence"],expected}]}]);
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");expect(JSON.stringify(raw)).toBe(before);
});
it.each(["NEW","CURRENT"])("three indexed carriers restore original global positions for %s",kind=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind,evidence},changes:[
    {field:"reminderTime",operation:"SET",value:{hour:8,minute:30,qualifier:"H24"},evidence},
    {field:"notes",operation:"SET",value:"literal",evidence},
    {field:"title",operation:"SET",value:"literal",evidence},
    {field:"reminderDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:2},evidence}
  ]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {reminderTimeChange:unknown;titleChange:{index:number};reminderDateChange:{index:number};changes:unknown[]};
  expect(wire.reminderTimeChange).toMatchObject({index:0,change:{field:"reminderTime",operation:"SET"}});
  expect(wire.titleChange.index).toBe(2);expect(wire.reminderDateChange.index).toBe(3);
  expect(wire.changes).toHaveLength(1);
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
});
it.each(["SET","REPLACE","CLEAR"])("reminder singleton %s preserves literal values and rejects carrier bypass without mutation",operation=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[
    {field:"reminderDate",operation,value:operation==="CLEAR"?null:{kind:"RELATIVE_DAY",offsetDays:2},evidence},
    {field:"reminderTime",operation,value:operation==="CLEAR"?null:{hour:8,minute:30,qualifier:"H24"},evidence}
  ]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>;
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
  for(const root of ["reminderDateChange","reminderTimeChange"]){
    const carrier=wire[root] as {index:number;change:unknown};
    const variants=[{...wire,[root]:null,changes:[carrier.change]}, {...wire,changes:[carrier.change]}, {...wire,[root]:{...carrier,index:null}}, {...wire,[root]:{...carrier,index:2}}, {...wire,[root]:{...carrier,index:0.5}}, {...wire,[root]:{...carrier,index:-1}}];
    const missing={...wire};delete missing[root];variants.push(missing);
    for(const raw of variants){const before=JSON.stringify(raw);expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");expect(JSON.stringify(raw)).toBe(before);}
  }
  const collision={...wire,reminderTimeChange:{...(wire.reminderTimeChange as object),index:0}};
  expect(parseGoogleLiteEuContextSectionsV3(collision,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("reminder singleton roots exclude every ordinary reminder field branch",()=>{
  type Node={required:string[];properties:Record<string,Node>;anyOf:Node[];enum:string[];$ref:string;$defs:Record<string,Node>;items:Node};
  const schema=googleLiteEuContextWireSchema().schema as unknown as Node;
  expect(schema.required).toEqual(expect.arrayContaining(["reminderDateChange","reminderTimeChange"]));
  for(const field of ["reminderDate","reminderTime"]){
    expect(schema.properties[field+"Change"].anyOf).toHaveLength(2);
    const walk=(value:unknown):string[]=>{if(!value||typeof value!=="object")return [];const node=value as Node;return [...(node.properties?.field?.enum??[]),...Object.values(value).flatMap(walk)];};
    const item=schema.properties.changes.items;
    expect(walk(item.$ref?schema.$defs[item.$ref.split("/").pop()!]:item)).not.toContain(field);
  }
});
it.each([[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]])("global original positions preserve carrier permutation %j and nullable combinations",(...order)=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
  const carriers=[{field:"title",operation:"SET",value:"literal",evidence},{field:"reminderDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:2},evidence},{field:"reminderTime",operation:"SET",value:{hour:8,minute:30,qualifier:"H24"},evidence}];
  for(let mask=0;mask<8;mask++){
    const changes=[{field:"notes",operation:"SET",value:"first",evidence},...order.filter(index=>mask&(1<<index)).map(index=>carriers[index]),{field:"location",operation:"SET",value:"last",evidence}];
    const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes});
    const wire=encodeGoogleLiteEuContextV3(canonical);
    expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
  }
});
it("reminder clock carrier is null-only when no clock capability exists",()=>{
  const schema=googleLiteEuContextWireSchema({version:"generation-field-capability-4",allowedNumericFields:[],allowedClockFields:[],titlePresenceRequired:false,titleCorrectionAllowed:false}).schema as unknown as {properties:{reminderTimeChange:unknown;reminderDateChange:unknown}};
  expect(schema.properties.reminderTimeChange).toEqual({type:"null"});
  expect(schema.properties.reminderDateChange).toHaveProperty("anyOf");
});
it.each([[0,"COLLISION"],[2,"OUT_OF_RANGE"]] as const)("actual decoder preserves refusal and projects carrier %s/%s structure",(index,reason)=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_EVIDENCE",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"reminderDate",operation:"CLEAR",value:null,evidence},{field:"reminderTime",operation:"CLEAR",value:null,evidence}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>;
  wire.reminderTimeChange={...(wire.reminderTimeChange as object),index};
  const before=JSON.stringify(wire),diagnostics:unknown[]=[];
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{issues:[{path:["reminderTimeChange","index"],expected:"CHANGE_POSITION",carrierPosition:{reason,actualIndex:index,ordinaryCount:0,carrierCount:2,combinedCount:2,minIndex:0,maxIndex:1,collisionRoots:reason==="COLLISION"?["reminderDateChange"]:[]}}]}]);
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");expect(JSON.stringify(wire)).toBe(before);
});
it.each(["reminderDate","reminderTime"])("malformed %s carrier diagnostics expose known paths, not private authored values",field=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field,operation:"CLEAR",value:null,evidence}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>,root=field+"Change";
  wire[root]={...(wire[root] as object),change:{field:"PRIVATE_FIELD_SENTINEL",operation:"PRIVATE_OPERATION_SENTINEL",value:"PRIVATE_VALUE_SENTINEL",evidence:"PRIVATE_EVIDENCE_SENTINEL"}};
  const diagnostics:unknown[]=[];
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{issues:[{path:[root,"change","field"],classification:"value",unknownPathSegments:0}]}]);
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");
});
it("indexed title carrier preserves literal evidence and original change order",()=>{
  const ref={kind:"USER_QUOTE",turn:0,quote:"đi thi",occurrence:1};
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[ref]},changes:[{field:"notes",operation:"SET",value:"literal",evidence:[ref]},{field:"title",operation:"SET",value:"đi thi",evidence:[ref]}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {titleChange:{index:number;change:unknown};changes:unknown[]};
  expect(wire.titleChange).toMatchObject({index:1,change:{field:"title",operation:"SET",value:"đi thi"}});
  expect(wire.changes).toHaveLength(1);
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
  for(const index of [-1,3,0.5]) expect(parseGoogleLiteEuContextSectionsV3({...wire,titleChange:{...wire.titleChange,index}},CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
  expect(parseGoogleLiteEuContextSectionsV3({...wire,changes:[...wire.changes,wire.titleChange.change]},CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
  const absent:Partial<typeof wire>={...wire};delete absent.titleChange;
  expect(parseGoogleLiteEuContextSectionsV3(absent,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("duplicate title ownership reproduces the sanitized live root-object failure without repair",()=>{
  const ref={kind:"USER_QUOTE",turn:0,quote:"đi thi",occurrence:1};
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[ref]},changes:[{field:"title",operation:"SET",value:"đi thi",evidence:[ref]}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {titleChange:{change:unknown};changes:unknown[]};
  wire.changes.push(wire.titleChange.change);
  const before=JSON.stringify(wire),diagnostics:unknown[]=[];
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{issues:[{path:["titleChange"],code:"WIRE_SHAPE_INVALID",actualType:"object",classification:"value",unknownPathSegments:0}]}]);
  expect(JSON.stringify(wire)).toBe(before);
});
it("title SET cannot bypass its carrier on a non-obligated turn",()=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"literal",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"literal",evidence}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {titleChange:{change:unknown}|null;changes:unknown[]};
  const authored=wire.titleChange!.change;wire.titleChange=null;wire.changes=[authored];
  const before=JSON.stringify(wire);
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
  expect(JSON.stringify(wire)).toBe(before);
});
it.each(["SET","REPLACE","CLEAR",undefined,"PRIVATE_OPERATION_SENTINEL"])("duplicate-title diagnostics preserve safe independent operation metadata: %s",operation=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_EVIDENCE_SENTINEL",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"PRIVATE_VALUE_SENTINEL",evidence}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {titleChange:{change:Record<string,unknown>};changes:unknown[]};
  wire.changes.push({...wire.titleChange.change,operation});
  const before=JSON.stringify(wire),diagnostics:unknown[]=[];
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{issues:[{expected:"UNIQUE_TITLE_OWNER",titleOwnership:{ordinaryCount:1,carrierOperation:{actualSafeToken:"SET"},ordinaryOperations:[{index:0,actualType:operation===undefined?"undefined":"string",...(operation&&["SET","REPLACE","CLEAR"].includes(operation)?{actualSafeToken:operation}:{})}],truncated:false}}]}]);
  if(operation==="PRIVATE_OPERATION_SENTINEL")expect(diagnostics).toMatchObject([{issues:[{titleOwnership:{ordinaryOperations:[{actualDigest:createHash("sha256").update(operation).digest("hex"),actualLength:operation.length}]}}]}]);
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");
  expect(JSON.stringify(wire)).toBe(before);
});
it("duplicate title metadata is bounded independently of hostile ordinary change cardinality",()=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_EVIDENCE_SENTINEL",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"PRIVATE_VALUE_SENTINEL",evidence}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {titleChange:{change:unknown};changes:unknown[]};
  wire.changes=Array.from({length:20},()=>wire.titleChange.change);
  const diagnostics:unknown[]=[];
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{issues:[{titleOwnership:{ordinaryCount:20,ordinaryOperations:Array.from({length:8},(_,index)=>({index,actualSafeToken:"SET"})),truncated:true}}]}]);
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");
});
it.each(["REPLACE","CLEAR"] as const)("non-obligated title %s remains exactly reversible",operation=>{
  const evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:"sửa tiêu đề",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"title",operation,value:operation==="CLEAR"?null:"khác",evidence}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {titleChange:unknown};
  expect(wire.titleChange).toBeNull();
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
});
it.each([
  [JSON.stringify({ evidence: { ref: "PRIVATE_TARGET" } }), "object"],
  ["PRIVATE_TARGET", "INVALID_JSON"],
  ["null", "null"],
] as const)("rejects string requestTarget without materializing it while retaining safe type (%#)", (target, embeddedJsonType) => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", conversationDirective: null, requestTarget: { kind: "CURRENT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "synthetic", occurrence: 1 }] } };
  const wire = encodeGoogleLiteEuContextV3(canonical as never) as Record<string, unknown>;
  const diagnostics: unknown[] = [];
  wire.requestTarget = target;
  expect(parseGoogleLiteEuContextSectionsV3(wire, CONTEXT_PROTOCOL_V3, undefined, value => diagnostics.push(value))).toEqual({ status: "REFUSED", reason: "SEMANTIC_PATCH_INVALID" });
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["requestTarget"], expected: "object", actualType: "string", embeddedJsonType }] }]);
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_TARGET");
});
it.each(["CURRENT", "NEW", "UNRESOLVED"])("misplaced finite target %s is diagnosed but never accepted", target => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", conversationDirective: null, requestTarget: { kind: "CURRENT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "synthetic", occurrence: 1 }] } };
  const wire = encodeGoogleLiteEuContextV3(canonical as never) as Record<string, unknown>;
  wire.requestTarget = target;
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, CONTEXT_PROTOCOL_V3, undefined, value => diagnostics.push(value))).toEqual({ status: "REFUSED", reason: "SEMANTIC_PATCH_INVALID" });
  expect(diagnostics).toMatchObject([{ issues: [{ expected: "object", actualType: "string", actualSafeToken: target }] }]);
});
it("a properly encoded CURRENT evidence carrier round-trips without a target string", () => {
  const canonical = ConversationInterpretationV3Schema.parse({ ...minimal, intent: "CREATE_REMINDER", conversationDirective: null, requestTarget: { kind: "CURRENT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "synthetic", occurrence: 1 }] } });
  const wire = encodeGoogleLiteEuContextV3(canonical) as Record<string, unknown>;
  expect(wire.requestTarget).toEqual({ evidence: { primaryEvidence: '{"kind":"USER_QUOTE","turn":0,"quote":"synthetic","occurrence":1}', additionalEvidenceJson: "[]" } });
  expect(wire.operationCode).toBe("0");
  expect(parseGoogleLiteEuContextSectionsV3(wire, CONTEXT_PROTOCOL_V3)).toMatchObject({ status: "PARSED", value: { semantic: { requestTarget: canonical.requestTarget } } });
});
const successorWire = wireModule;
const selectedV3 = CONTEXT_PROTOCOL_V3;
const v3Help = { schemaVersion: "calenote-context-3", intent: "HELP", requestTarget: null, changes: [], query: null, uncertainties: [], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: null };
it.each([["reason", "MISSING"], ["field", "INVALID_FIELD"]])("diagnoses invalid %s in the selected valid directive branch, not its valid kind", (key, token) => {
  const wire = encodeGoogleLiteEuContextV3({ ...v3Help, conversationDirective: {kind:"ASK_FOR_DISAMBIGUATION",field:"title",reason:"AMBIGUOUS"} } as never) as {conversationDirective:Record<string,unknown>};
  wire.conversationDirective[key] = token;
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value=>diagnostics.push(value)).status).toBe("PARSED");
  expect(diagnostics).toMatchObject([{issues:[{path:["conversationDirective",key],constraint:"CONTROL_ENUM",actualDigest:createHash("sha256").update(token).digest("hex") }]}]);
});
it.each(["THIS_MONTH", "private title location secret", "A".repeat(1000)])("retains only safe finite-control diagnostics (%#)", token => {
  const canonical = { ...v3Help, intent: "LIST_REMINDERS", conversationDirective: null, query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "private", occurrence: 1 }] } };
  const wire = encodeGoogleLiteEuContextV3(canonical as never) as { query: { period: { kind: string } } };
  wire.query.period.kind = token;
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["query", "period", "kind"], constraint: "CONTROL_ENUM", acceptedDomainId: expect.stringMatching(/^CONTROL_DOMAIN_SHA256:/), acceptedValueCount: 8, actualType: "string", actualLength: token.length, actualDigest: createHash("sha256").update(token).digest("hex") }] }]);
  if (token === "THIS_MONTH") expect(diagnostics).toMatchObject([{ issues: [{ actualSafeToken: token }] }]);
  else { expect(JSON.stringify(diagnostics)).not.toContain(token); expect(diagnostics).toMatchObject([{ issues: [expect.not.objectContaining({ actualSafeToken: expect.anything() })] }]); }
});
it("diagnoses another finite control domain without changing valid decoding", () => {
  const wire = encodeGoogleLiteEuContextV3(v3Help as never) as Record<string, unknown>;
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("PARSED");
  expect(diagnostics).toEqual([]);
  wire.operationCode = 12;
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["operationCode"], constraint: "CONTROL_ENUM", acceptedValueCount: 12 }] }]);
});
it("accepts valid MONTH without diagnostic capture", () => {
  const canonical = { ...v3Help, intent: "LIST_REMINDERS", conversationDirective: null, query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "private", occurrence: 1 }] } };
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(encodeGoogleLiteEuContextV3(canonical as never), selectedV3, undefined, value => diagnostics.push(value)).status).toBe("PARSED");
  expect(diagnostics).toEqual([]);
});
it.each(["SECRET VALUE", "SECRET\nVALUE", "âm_lịch", "TOKEN@EMAIL.COM", "x".repeat(49)])("does not retain unsafe control strings in scalar enums (%#)", token => {
  const wire = encodeGoogleLiteEuContextV3(v3Help as never) as Record<string, unknown>;
  wire.operationCode = token;
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("REFUSED");
  expect(JSON.stringify(diagnostics)).not.toContain(token);
  expect(diagnostics).toMatchObject([{ issues: [{ constraint: "CONTROL_ENUM", actualLength: token.length, actualDigest: createHash("sha256").update(token).digest("hex") }] }]);
});
it("diagnoses invalid compact control code without retaining arbitrary values", () => {
  const wire = encodeGoogleLiteEuContextV3(v3Help as never) as Record<string, unknown>;
  wire.uncertainties = [{ fieldCode: "BAD_CODE", reason: "private reason", alternatives: [] }];
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["uncertainties", 0, "fieldCode"], constraint: "CONTROL_ENUM", actualSafeToken: "BAD_CODE", acceptedValueCount: 16 }] }]);
  expect(JSON.stringify(diagnostics)).not.toContain("private reason");
});
it.each(["primaryEvidence", "additionalEvidenceJson"] as const)("retains decoded control type and structural path inside %s", slot => {
  const canonical = { ...v3Help, intent: "LIST_REMINDERS", conversationDirective: null, query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "private", occurrence: 1 }] } };
  const wire = encodeGoogleLiteEuContextV3(canonical as never) as { query: { evidence: { primaryEvidence: string; additionalEvidenceJson: string } } };
  if (slot === "primaryEvidence") wire.query.evidence.primaryEvidence = JSON.stringify({...JSON.parse(wire.query.evidence.primaryEvidence),kind:"BAD_EVIDENCE_KIND"});
  else wire.query.evidence.additionalEvidenceJson = JSON.stringify([{ kind: "BAD_EVIDENCE_KIND", turn: 0, quote: "private", occurrence: 1, ref: null }]);
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["query", "evidence", slot, ...(slot === "additionalEvidenceJson" ? [0] : []), "kind"], classification: "value", actualType: "string", actualSafeToken: "BAD_EVIDENCE_KIND" }] }]);
  expect(JSON.stringify(diagnostics)).not.toContain("private");
});
it("observes decoded canonical target before a conditional constraint rejects the envelope", () => {
  const canonical = { ...v3Help, intent: "AMBIGUOUS", requestTarget:{kind:"CURRENT",evidence:[{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_QUERY",occurrence:1}]},conversationDirective:null,uncertainties:[{field:"operation",reason:"AMBIGUOUS",alternatives:[]}] };
  const wire = encodeGoogleLiteEuContextV3(canonical as never) as Record<string, unknown>;
  wire.uncertainties = [];
  let observed: unknown;
  const parse = parseGoogleLiteEuContextSectionsV3 as unknown as (raw: unknown, protocol: typeof CONTEXT_PROTOCOL_V3, invalid: undefined, wireInvalid: undefined, decoded: (value: unknown) => void) => { status: string };
  expect(parse(wire, CONTEXT_PROTOCOL_V3, undefined, undefined, value => { observed = value; }).status).toBe("REFUSED");
  expect(observed).toMatchObject({ intent: "AMBIGUOUS", requestTarget: {kind:"CURRENT"},uncertainties:[] });
  expect(parse(wire, CONTEXT_PROTOCOL_V3, undefined, undefined, () => { throw Error("diagnostic observer failure"); }).status).toBe("REFUSED");
  expect(parse(wire, CONTEXT_PROTOCOL_V3, undefined, undefined, value => { (value as { intent: string }).intent = "CREATE_REMINDER"; }).status).toBe("REFUSED");
});
it.each([
  [42, "number"], [null, "null"], [["SENSITIVE_PRIVATE_VALUE"], "array"], ["SENSITIVE_PRIVATE_VALUE".repeat(10000), "string"], [false, "boolean"],
] as const)("selected primitive envelope diagnostics remain bounded and private (case %#)", (raw, actualType) => {
  const diagnostics: unknown[] = [], canonical: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(raw, CONTEXT_PROTOCOL_V3, value => canonical.push(value), value => diagnostics.push(value))).toEqual({ status: "REFUSED", reason: "ENVELOPE_INVALID" });
  expect(canonical).toEqual([]);
  expect(diagnostics).toEqual([{ schemaVersion: "calenote-context-3", issues: [{ path: [], code: "WIRE_SHAPE_INVALID", expected: "object", actualType, classification: "value", unknownPathSegments: 0 }], topLevelKeys: [], unknownTopLevelKeyCount: 0, truncated: false }]);
  expect(JSON.stringify(diagnostics)).not.toContain("SENSITIVE_PRIVATE_VALUE");
  expect(JSON.stringify(diagnostics).length).toBeLessThan(400);
});
it("invalid application protocol selection does not produce raw-envelope diagnostics", () => {
  const diagnostics: unknown[] = [];
  const wrong = { ...CONTEXT_PROTOCOL_V3, canonicalVersion: "calenote-context-2" } as unknown as typeof CONTEXT_PROTOCOL_V3;
  expect(parseGoogleLiteEuContextSectionsV3(42, wrong, value => diagnostics.push(value), value => diagnostics.push(value))).toEqual({ status: "REFUSED", reason: "ENVELOPE_INVALID" });
  expect(diagnostics).toEqual([]);
});
function v3Wire() { expect(successorWire.googleLiteEuContextWireSchemaV3).toBeDefined(); return successorWire.googleLiteEuContextWireSchemaV3(); }
it("new_wire_has_no_dialogue_or_owned_metadata", () => {
  const schema = v3Wire().schema;
  const text = JSON.stringify(schema);
  for (const key of ["dialogueAct", "continuation", "controlEvidence", "schemaVersion", "PRESENT_PREVIEW", "ANSWER_QUERY"]) expect(text).not.toContain(`\"${key}\"`);
  expect(schema.properties).toHaveProperty("requestTarget");
});
it("invalid_active_discriminator_rejects", () => {
  v3Wire();
  const wire = successorWire.encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(v3Help)) as Record<string, unknown>;
  expect(successorWire.parseGoogleLiteEuContextSectionsV3({ ...wire, intent: "INVALID" }, selectedV3)).toMatchObject({ status: "REFUSED" });
  expect(successorWire.parseGoogleLiteEuContextSectionsV3(wire, { ...selectedV3, canonicalVersion: "calenote-context-2" } as unknown as typeof selectedV3)).toMatchObject({ status: "REFUSED" });
});
it("encoded_date_contains_only_canonical_active_keys", () => {
  v3Wire();
  const value = { ...v3Help, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "new", occurrence: 1 }] }, changes: [{ field: "eventDate", operation: "SET", value: { kind: "RELATIVE_DAY", offsetDays: 1 }, evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "new", occurrence: 1 }] }] };
  const wire = successorWire.encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(value)) as { changes: Array<{ value: string }> };
  expect(successorWire.parseGoogleLiteEuContextSectionsV3(wire, selectedV3)).toMatchObject({ status: "PARSED", value: { semantic: { changes: value.changes } } });
  wire.changes[0].value=JSON.stringify({...value.changes[0].value,year:{malicious:true}});
  expect(successorWire.parseGoogleLiteEuContextSectionsV3(wire, selectedV3)).toMatchObject({ status: "REFUSED" });
  wire.changes[0].value=JSON.stringify({...value.changes[0].value,unknown:true});
  expect(successorWire.parseGoogleLiteEuContextSectionsV3(wire, selectedV3)).toMatchObject({ status: "REFUSED" });
});
it("isolated_wire_guidance_failure_keeps_core_and_reports_full_failure", () => {
  const wire = successorWire.encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(v3Help)) as Record<string, unknown>;
  expect(successorWire.parseGoogleLiteEuContextSectionsV3({ ...wire, conversationDirective: { kind: "HELP", topic: "GENERAL" } }, selectedV3)).toMatchObject({ status: "PARSED", value: { directive: { status: "INVALID" }, fullSchemaValid: false } });
  const withoutGuidance = Object.fromEntries(Object.entries(wire).filter(([key]) => !["conversationDirective", "replyProposal"].includes(key)));
  expect(successorWire.parseGoogleLiteEuContextSectionsV3(withoutGuidance, selectedV3)).toMatchObject({ status: "PARSED", value: { directive: { status: "INVALID" }, reply: { status: "INVALID" }, fullSchemaValid: false } });
  expect(successorWire.parseGoogleLiteEuContextSectionsV3({ ...wire, conversationDirective: { kind: "INVALID" }, replyProposal: { text: "valid independent wording" } }, selectedV3)).toMatchObject({ status: "PARSED", value: { directive: { status: "INVALID" }, reply: { status: "VALID" }, fullSchemaValid: false } });
  expect(successorWire.parseGoogleLiteEuContextSectionsV3({ ...wire, extra: true }, selectedV3)).toMatchObject({ status: "REFUSED" });
});
const quote = { kind: "USER_QUOTE", turn: 0, quote: "synthetic", occurrence: 1 };
const evidence = [quote, { kind: "CONTEXT_FACT", ref: "f1" }, quote];
const civil = { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 31, month: 12, year: 9999, leapMonth: null };
const clock = { hour: 23, minute: 59, qualifier: "H24" };
const values = { title: "t".repeat(1800), location: "l".repeat(300), notes: "n".repeat(2000), eventDate: civil, eventTime: clock, reminderDate: { kind: "RELATIVE_DAY", offsetDays: -366 }, reminderTime: clock, calendar: "LUNAR_VN", frequency: "DAILY", occurrenceCount: Number.MAX_SAFE_INTEGER, eventRelation: "BEFORE_EVENT", leadOffsetDays: Number.MAX_SAFE_INTEGER, endDate: { kind: "WEEKDAY", weekday: 7, qualifier: "NEXT_WEEK" } };
// Independent, hand-specified wire layout; never calls a production encoder.
const pads: Record<string, string[]> = { USER_QUOTE: ["ref"], CONTEXT_FACT: ["turn", "quote", "occurrence"], CIVIL_DATE: ["offsetDays", "weekday", "qualifier"], RELATIVE_DAY: ["calendar", "day", "month", "year", "leapMonth", "weekday", "qualifier"], WEEKDAY: ["calendar", "day", "month", "year", "leapMonth", "offsetDays"], DAY: ["offset", "from", "through"], WEEK: ["date", "from", "through"], MONTH: ["date", "from", "through"], WEEKEND: ["date", "from", "through"], UPCOMING: ["date", "offset", "from", "through"], DATE_BOUNDS: ["date", "offset"], LIST: ["date", "outputCalendar", "topic"], CALENDAR_DATE: ["period", "topic"], CAPABILITY: ["period", "date", "outputCalendar"], HELP: ["field", "reason", "issue"], ASK_FOR_FIELD: ["reason", "issue", "topic"], ASK_FOR_DISAMBIGUATION: ["issue", "topic"], EXPLAIN_UNSUPPORTED: ["field", "reason", "topic"], PRESENT_PREVIEW: ["field", "reason", "issue", "topic"], ANSWER_QUERY: ["field", "reason", "issue", "topic"] };
function wireFixture(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wireFixture);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>, result = Object.fromEntries(Object.entries(object).map(([key, child]) => [key, key === "uncertainties" && Array.isArray(child)
    ? child.map((item: { field: unknown; reason: unknown; alternatives: unknown[] }) => ({ fieldCode: ["title", "location", "notes", "eventDate", "eventTime", "reminderDate", "reminderTime", "calendar", "frequency", "occurrenceCount", "eventRelation", "leadOffsetDays", "endDate", "intent", "queryRange", "operation"].indexOf(String(item.field)), reason: item.reason, alternatives: item.alternatives.map(alternative => JSON.stringify(alternative)) }))
    : wireFixture(child)]));
  if (Object.hasOwn(object, "schemaVersion")) {
    delete result.schemaVersion;
    const target=object.requestTarget as Record<string,unknown>|null;
    const query=object.query as Record<string,unknown>|null;
    const tuples=[["CREATE_REMINDER","CURRENT",null],["CREATE_REMINDER","NEW",null],["CREATE_REMINDER","UNRESOLVED",null],["LIST_REMINDERS",null,"LIST"],["CALENDAR_QUERY",null,"CALENDAR_DATE"],["CAPABILITY_QUERY",null,"CAPABILITY"],["HELP",null,null],["UNSUPPORTED",null,null],["AMBIGUOUS",null,null],["AMBIGUOUS","CURRENT",null],["AMBIGUOUS","NEW",null],["AMBIGUOUS","UNRESOLVED",null]];
    result.operationCode=String(tuples.findIndex(([intent,targetKind,queryKind])=>intent===object.intent&&targetKind===(target?.kind??null)&&queryKind===(query?.kind??null)));
    delete result.intent;
    for(const key of ["requestTarget","query"])if(result[key])delete (result[key] as Record<string,unknown>).kind;
    const changes=result.changes as Array<Record<string,unknown>>;
    const removed=new Set<number>();
    for(const field of ["title","reminderDate","reminderTime"]){
      const index=changes.findIndex(change=>change.field===field&&(field!=="title"||change.operation==="SET"));
      result[field+"Change"]=index<0?null:{index,change:changes[index]};
      if(index>=0)removed.add(index);
    }
    result.changes=changes.filter((_,position)=>!removed.has(position));
  }
  if (Array.isArray(object.evidence)) {
    result.evidence = { primaryEvidence: JSON.stringify(object.evidence[0]), additionalEvidenceJson: JSON.stringify(object.evidence.slice(1)) };
  }
  if (object.kind === "LIST") delete result.statusScope;
  if (typeof object.kind === "string") for (const key of pads[object.kind] ?? []) result[key] = null;
  if (["CIVIL_DATE","RELATIVE_DAY","WEEKDAY"].includes(String(object.kind))) return JSON.stringify(object);
  return result;
}
async function dispatch(payload: unknown, requests: SemanticJsonRequest[] = []) {
  // Current provider specimens select sources; the historical encoder parity
  // specimens above remain literal quotes and use the context-free parser.
  const pointer=(value:unknown):unknown=>{
    if(Array.isArray(value))return value.map(pointer);
    if(!value||typeof value!=="object")return value;
    const v=value as Record<string,unknown>;
    if(v.kind==="USER_QUOTE"&&v.quote==="synthetic"&&v.turn===0&&v.occurrence===1&&Object.keys(v).length===4)return {kind:"USER_TURN",turn:0};
    return Object.fromEntries(Object.entries(v).map(([key,child])=>[key,["primaryEvidence","additionalEvidenceJson"].includes(key)&&typeof child==="string"?JSON.stringify(pointer(JSON.parse(child))):key==="alternatives"&&Array.isArray(child)?child.map(text=>typeof text==="string"?JSON.stringify(pointer(JSON.parse(text))):text):pointer(child)]));
  };
  payload=pointer(payload);
  const transport = createContextHttpTransport("SYNTHETIC_CREDENTIAL", async (_url, init) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ model: "google/gemini-2.5-flash-lite", provider: "Google", id: "gen-wire-test", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }], usage: { cost: .001, prompt_tokens: 100, completion_tokens: 100 } }), { headers: { "content-type": "application/json" } });
  });
  const attempt = createContextContractGateway(config, transport, { status: "OBSERVABLE_CANARY", advertisedContextTokens: 1048576 }).prepare("PRIMARY", input);
  if (attempt.status !== "READY") throw new Error("Expected ready");
  const result = await attempt.dispatch();
  expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE" });
  expect(requests).toHaveLength(1);
  return result;
}
it("emits the reviewed scalar-normalized schema through the actual HTTP boundary", async () => {
  const requests: SemanticJsonRequest[] = [];
  await dispatch(wireFixture(minimal), requests);
  expect(requests[0].response_format).toEqual(serializeContextRequest(input).response_format);
  expect(requests[0].provider).toEqual({ only: ["google-vertex/eu"], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true, max_price: { prompt: .1, completion: .4 } });
  expect(requests[0].stream).toBe(false);
});
it("reconstructs the exact minimal canonical fixture from required inactive null padding", async () => {
  expect(await dispatch(wireFixture(minimal))).toMatchObject({ status: "SUCCESS", interpretation: { fullSchemaValid: true, directive: { status: "VALID", value: minimal.conversationDirective } } });
});
it.each(Object.entries(values).flatMap(([field, value]) => ["SET", "CLEAR"].map(operation => ({ field, operation, value: operation === "SET" ? value : null, evidence }))))("preserves typed SET/CLEAR and evidence order for $field/$operation", async change => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: [change] };
  expect(ConversationInterpretationSchema.safeParse(canonical).success).toBe(true);
  expect(await dispatch(wireFixture(canonical))).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { changes: [change] }, fullSchemaValid: true } });
});
it("preserves full changes/uncertainties/evidence capacities and ordered alternatives", async () => {
  const changes = Object.entries(values).map(([field, value]) => ({ field, operation: "SET", value, evidence }));
  const uncertainties = Array.from({ length: 4 }, () => ({ field: "title", reason: "AMBIGUOUS", alternatives: [{ value: "first", evidence }, { value: "second", evidence: [...evidence].reverse() }] }));
  expect(await dispatch(wireFixture({ ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes, uncertainties }))).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { changes, uncertainties }, fullSchemaValid: true } });
});
it.each(Object.entries({ ...values, intent: "HELP", operation: "CURRENT", queryRange: { kind: "DATE_BOUNDS", from: civil, through: civil } }))("preserves uncertainty field association for %s", async (field, value) => {
  const uncertainties = [{ field, reason: "AMBIGUOUS", alternatives: [{ value, evidence }, { value, evidence }] }];
  expect(await dispatch(wireFixture({ ...minimal, uncertainties }))).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { uncertainties }, fullSchemaValid: true } });
});
it.each([
  ["LIST_REMINDERS", { kind: "LIST", period: { kind: "DATE_BOUNDS", from: civil, through: civil }, statusScope: "DEFAULT", evidence }],
  ["CALENDAR_QUERY", { kind: "CALENDAR_DATE", date: civil, outputCalendar: "LUNAR_VN", evidence }],
  ["CAPABILITY_QUERY", { kind: "CAPABILITY", topic: "LUNAR", evidence }],
])("reconstructs query ownership for %s", async (intent, query) => {
  const result=await dispatch(wireFixture({ ...minimal, intent, query }));
  if(intent==="LIST_REMINDERS") {
    if(!("period" in query))throw Error("fixture query ownership");
    expect(result.status).toBe("SUCCESS");if(result.status!=="SUCCESS")throw Error(result.category);
    expect(isUnreconciledListInterpretation(result.interpretation)).toBe(true);
    const staged=readListTransport(result.interpretation);
    expect(staged.core).toMatchObject({intent,query:{kind:"LIST",statusScope:query.statusScope,evidence:query.evidence}});
    expect(staged.period).toEqual({status:"KNOWN",value:query.period});
  } else expect(result).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { intent, query }, fullSchemaValid: true } });
});
it("versioned encoder matches independent fixtures and reconstructs every typed canonical field", () => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: Object.entries(values).map(([field, value]) => ({ field, operation: "SET", value, evidence })) };
  const before = JSON.stringify(canonical), encoded = encodeGoogleLiteEuContext(canonical);
  expect(encoded).toEqual(wireFixture(canonical));
  expect(parseGoogleLiteEuContextSections(encoded)).toEqual(parseInterpretationSections(canonical));
  expect(JSON.stringify(canonical)).toBe(before);
  for (const directive of [{ kind: "ASK_FOR_FIELD", field: "title" }, { kind: "ASK_FOR_DISAMBIGUATION", field: "title", reason: "AMBIGUOUS" }, { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" }, { kind: "HELP", topic: "GENERAL" }, null]) {
    const fixture = { ...minimal, conversationDirective: directive, replyProposal: { text: "x".repeat(400) } };
    expect(encodeGoogleLiteEuContext(fixture)).toEqual(wireFixture(fixture));
    expect(parseGoogleLiteEuContextSections(encodeGoogleLiteEuContext(fixture))).toEqual(parseInterpretationSections(fixture));
  }
  expect(() => encodeGoogleLiteEuContext({ ...canonical, changes: [...canonical.changes, canonical.changes[0]] })).toThrow();
  const schema = googleLiteEuContextWireSchema();
  expect(schema.version).toBe("google-gemini-2.5-flash-lite-vertex-eu-context-title-presence-36");
  expect(createHash("sha256").update(JSON.stringify(schema.schema)).digest("hex")).toBe("de60cabe9eed5aeefa8350e7402a44796c660a1addee937626a9f54dcf87a2ed");
  schema.schema.required = [];
  expect(googleLiteEuContextWireSchema().schema.required).not.toEqual([]);
});
it.each([
  ["numeric safe integer", { field: "occurrenceCount", operation: "SET", value: Number.MAX_SAFE_INTEGER + 1, evidence }],
  ["positive numeric minimum", { field: "leadOffsetDays", operation: "SET", value: 0, evidence }],
  ["Gregorian leap refinement", { field: "eventDate", operation: "SET", value: { ...civil, leapMonth: false }, evidence }],
  ["civil range", { field: "eventDate", operation: "SET", value: { ...civil, day: 32 }, evidence }],
  ["clock refinement", { field: "eventTime", operation: "SET", value: { hour: 0, minute: 0, qualifier: "AM" }, evidence }],
  ["non-NFC text", { field: "title", operation: "SET", value: "e\u0301", evidence }],
  ["blank text", { field: "title", operation: "SET", value: " ", evidence }],
  ["quote safe integer", { field: "title", operation: "SET", value: "synthetic", evidence: [{ ...quote, occurrence: Number.MAX_SAFE_INTEGER + 1 }] }],
  ["evidence string cap", { field: "title", operation: "SET", value: "synthetic", evidence: [{ ...quote, quote: "x".repeat(2001) }] }],
  ["fact reference pattern", { field: "title", operation: "SET", value: "synthetic", evidence: [{ kind: "CONTEXT_FACT", ref: "f0" }] }],
])("retains canonical omitted-bound/refinement authority: %s", async (_label, change) => {
  expect(await dispatch(wireFixture({ ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: [change] }))).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
});
it.each([
  { ...minimal, uncertainties: Array.from({ length: 5 }, () => ({ field: "title", reason: "MISSING", alternatives: [] })) },
  { ...minimal, uncertainties: [{ field: "title", reason: "AMBIGUOUS", alternatives: Array.from({ length: 3 }, () => ({ value: "synthetic", evidence })) }] },
  { ...minimal, uncertainties: [{ field: "title", reason: "AMBIGUOUS", alternatives: [{ value: "synthetic", evidence }, { value: 2, evidence }] }] },
  { ...minimal, requestTarget: { kind: "NEW", evidence: [...evidence, quote] } },
  { ...minimal, query: { kind: "CAPABILITY", topic: "LUNAR", evidence } },
])("rejects array caps, mixed field alternatives and query/intent mismatch %#", async canonical => {
  expect(await dispatch(wireFixture(canonical))).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
});
it("retains active nullable date values and rejects missing envelope/core keys", () => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: [{ field: "eventDate", operation: "SET", value: { ...civil, year: null }, evidence }] };
  expect(parseGoogleLiteEuContextSections(encodeGoogleLiteEuContext(canonical))).toEqual(parseInterpretationSections(canonical));
  for (const raw of [null, [], "invalid", {}, { ...wireFixture(minimal) as object, extra: null }]) expect(parseGoogleLiteEuContextSections(raw).status).toBe("REFUSED");
});
it.each([
  ["unknown directive", (raw: Record<string, unknown>) => { raw.conversationDirective = { kind: "SAVE" }; }, { directive: { status: "INVALID" }, reply: { status: "VALID", value: null } }],
  ["missing directive padding", (raw: Record<string, unknown>) => { delete (raw.conversationDirective as Record<string, unknown>).field; }, { directive: { status: "INVALID" }, reply: { status: "VALID", value: null } }],
  ["overlong reply", (raw: Record<string, unknown>) => { raw.replyProposal = { text: "x".repeat(401) }; }, { directive: { status: "VALID" }, reply: { status: "INVALID", reason: "REPLY_TOO_LONG" } }],
  ["missing guidance", (raw: Record<string, unknown>) => { delete raw.conversationDirective; delete raw.replyProposal; }, { directive: { status: "INVALID" }, reply: { status: "INVALID", reason: "REPLY_INVALID" } }],
] as const)("quarantines %s independently without losing valid core", async (_label, mutate, expected) => {
  const raw = wireFixture(minimal) as Record<string, unknown>; mutate(raw);
  expect(await dispatch(raw)).toMatchObject({ status: "SUCCESS", interpretation: { ...expected, semantic: { changes: [] }, fullSchemaValid: false } });
});
it.each([
  ["wrong field value", (raw: Record<string, unknown>) => { (raw.titleChange as {change:Record<string,unknown>}).change.value = 2; }],
  ["overlong title", (raw: Record<string, unknown>) => { (raw.titleChange as {change:Record<string,unknown>}).change.value = "x".repeat(1801); }],
  ["empty evidence", (raw: Record<string, unknown>) => { (raw.titleChange as {change:Record<string,unknown>}).change.evidence = []; }],
  ["four evidence", (raw: Record<string, unknown>) => { ((raw.titleChange as {change:Record<string,unknown>}).change.evidence as Record<string, unknown>).additionalEvidenceJson = JSON.stringify([wireFixture(quote), wireFixture(quote), wireFixture(quote)]); }],
  ["duplicate field", (raw: Record<string, unknown>) => { (raw.changes as unknown[]).push(structuredClone((raw.titleChange as {change:unknown}).change)); }],
  ["unknown root", (raw: Record<string, unknown>) => { raw.extra = null; }],
  ["missing core", (raw: Record<string, unknown>) => { delete raw.operationCode; }],
] as const)("rejects invalid core atomically: %s", async (_label, mutate) => {
  const raw = wireFixture({ ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: [{ field: "title", operation: "SET", value: "synthetic", evidence }] }) as Record<string, unknown>; mutate(raw);
  expect(await dispatch(raw)).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
});
it("current pointer transport rejects quote-authored evidence padding at the HTTP boundary", async () => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: [{ field: "title", operation: "SET", value: "synthetic", evidence }] };
  const raw = wireFixture(canonical) as Record<string, unknown>;
  (raw.conversationDirective as Record<string, unknown>).field = "title";
  const changedEvidence=(raw.titleChange as {change:{evidence:{primaryEvidence:string}}}).change.evidence;
  changedEvidence.primaryEvidence=JSON.stringify({...JSON.parse(changedEvidence.primaryEvidence),ref:"f999"});
  expect(await dispatch(raw)).toMatchObject({ status: "FAILURE",category:"SCHEMA_INVALID" });
});

function encodeGoogleLiteEuContext(value: unknown) { return encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(value)); }
function parseGoogleLiteEuContextSections(value: unknown) { return parseGoogleLiteEuContextSectionsV3(value, CONTEXT_PROTOCOL_V3); }
