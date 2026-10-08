import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ContextInputSchema, SLOT_NAMES, type ContextInput } from "./contracts";
import { CONTROL_PLACEHOLDER } from "./projection";
import { serializeContextRequest } from "./wire";
import { z } from "zod";
import { ConversationInterpretationV3Schema } from "./contracts";
import { encodeGoogleLiteEuContextV3, googleLiteEuContextWireSchemaV3 } from "../../intelligence/infrastructure/openrouter/context-provider-wire";
import { harness, proposal } from "./service-test-support";
import { date } from "./resolution-test-support";

function input(text: string): ContextInput {
  return ContextInputSchema.parse({ schemaVersion: "calenote-context-input-2", reference: { instant: "2026-10-08T03:00:00Z", localDate: "2026-10-08", timezone: "Asia/Ho_Chi_Minh" }, turns: [{ role: "USER", text }], currentTurn: 0, activeRequest: null, facts: [], pendingQuestion: null, ambiguities: [], capabilities: { version: "v1", supported: ["ONCE", "FINITE_DAILY"], unsupported: ["WEEKLY", "MONTHLY", "YEARLY"], calendars: ["GREGORIAN"], limits: { dailyCount: 30, horizonDays: 366 } } });
}
function catalogue(context: ContextInput) {
  return JSON.parse(serializeContextRequest(context).messages[1].content).fieldCapability;
}
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
  expect(catalogue(context)).toEqual({version:"generation-field-capability-1",allowedNumericFields:["frequency","occurrenceCount"],allowedClockFields:[],titlePresenceRequired:true});
  expect(createHash("sha256").update(JSON.stringify(request.response_format.json_schema.schema)).digest("hex")).toBe("49f808930f2582ea6841d3e33e4931d902ab6f873be421e54718c9f69bc2f67e");
  expect(fields(context)).not.toContain("title");
});
it.each(["Tiếp tục bản nháp đi thi.","xem lịch đi thi","giúp tôi xem đi thi","không đi thi","nếu đi thi","\"đi thi\"","đi thi [CONTROL]","nhắc trước 2 ngày","giải thích đi thi"])("unasserted exam mention does not force a title: %s",text=>expect(catalogue(input(text)).titlePresenceRequired).toBe(false));
it.each(["Ngày 11/10 đi thi ở Quang Trung, nhắc tôi chuẩn bị giấy tờ.","Đổi tiêu đề thành đi thi","Sửa title thành đi thi","Thay tên thành đi thi"])("different reminder subject or correction establishes no SET obligation: %s",text=>expect(catalogue(input(text)).titlePresenceRequired).toBe(false));
it.each(["Bạn nghĩ sao về đi thi","bao giờ đi thi","dịch đi thi"])("unknown or interrogative discourse remains outside bounded title assertion: %s",text=>expect(catalogue(input(text)).titlePresenceRequired).toBe(false));
it.each(["Ngày 11/10 đi thi, nhắc tôi uống thuốc lúc 8h.","Ngày 11/10 đi thi, nhắc tôi đóng tiền trước 2 ngày.","đi thi ở đâu","đi thi rồi uống thuốc","đi thi, điều này nghĩa là gì"])("unknown continuation or competing subject cannot force exam title: %s",text=>expect(catalogue(input(text)).titlePresenceRequired).toBe(false));
function fields(context: ContextInput) {
  const schema = serializeContextRequest(context).response_format.json_schema.schema as unknown as { properties: { changes: { items: { $ref: string } } }; $defs: Record<string, { anyOf: Array<{ properties: { field: { enum?: string[]; const?: string } } }> }> };
  return schema.$defs[schema.properties.changes.items.$ref.split("/").at(-1)!].anyOf.flatMap(b => b.properties.field.enum ?? [b.properties.field.const!]);
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
  expect(catalogue(context)).toMatchObject({ version: "generation-field-capability-1", allowedNumericFields: allowed });
  const domain = fields(context);
  for (const field of ["frequency", "occurrenceCount", "leadOffsetDays"]) expect(domain.includes(field)).toBe((allowed as readonly string[]).includes(field));
  expect(domain).toContain("title");
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
  const schema = serializeContextRequest(context).response_format.json_schema.schema;
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
  return z.fromJSONSchema(inline(schema) as Parameters<typeof z.fromJSONSchema>[0]);
}
it("R04 supported dialect still forbids ordinary title SET when unsupported const is ignored", () => {
  const context = input("Tôi thi ngày 11/10 lúc 8h."), check = validator(context, true);
  const evidence = [{ kind: "USER_QUOTE" as const, turn: 0, quote: context.turns[0].text, occurrence: 1 }];
  const canonical = ConversationInterpretationV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence }, changes: [{ field: "title", operation: "SET", value: "đi thi", evidence }], query: null, uncertainties: [], conversationDirective: null, replyProposal: null });
  const wire = encodeGoogleLiteEuContextV3(canonical) as { titleChange: { change: unknown }; changes: unknown[] };
  expect(check.safeParse(wire).success).toBe(true);
  const duplicate = { ...wire, changes: [structuredClone(wire.titleChange.change)] };
  expect(check.safeParse(duplicate).success).toBe(false);
  for (const operation of ["REPLACE", "CLEAR"] as const) {
    const correction = ConversationInterpretationV3Schema.parse({ ...canonical, changes: [{ field: "title", operation, value: operation === "CLEAR" ? null : "họp", evidence }] });
    expect(check.safeParse(encodeGoogleLiteEuContextV3(correction)).success).toBe(true);
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
  slots.title={state:"RESOLVED",value:"đi thi",fact:null};context.activeRequest={lifecycle:"CLARIFYING",slots};
  expect(catalogue(context).titlePresenceRequired).toBe(true);
});
it("non-obligated requests expose one title SET representation while preserving title REPLACE/CLEAR",()=>{
  const context=input("Nhắc việc mới."),check=validator(context),evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:context.turns[0].text,occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"việc mới",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {titleChange:{change:unknown};changes:unknown[]};
  expect(check.safeParse(wire).success).toBe(true);
  expect(check.safeParse({...wire,titleChange:null,changes:[wire.titleChange.change]}).success).toBe(false);
  for(const operation of ["REPLACE","CLEAR"] as const)expect(check.safeParse(encodeGoogleLiteEuContextV3({...canonical,changes:ConversationInterpretationV3Schema.parse({...canonical,changes:[{field:"title",operation,value:operation==="CLEAR"?null:"khác",evidence}]}).changes})).success).toBe(true);
});
it("specialized R02 schema exposes only reachable definitions",()=>{
  const schema=serializeContextRequest(input("Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.")).response_format.json_schema.schema as unknown as {$defs:Record<string,unknown>};
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
