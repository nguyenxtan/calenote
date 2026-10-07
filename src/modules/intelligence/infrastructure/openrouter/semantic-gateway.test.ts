// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createSemanticGateway, type SemanticJsonRequest } from "./semantic-gateway";
import { CANONICAL_SEMANTIC_PROMPT, semanticReferenceWallClock, type SemanticInput } from "../../semantic-gateway";
import { ModelSemanticInterpretationJsonSchema } from "../../../semantic/contracts";
import * as gateways from "./semantic-gateway";
import { ContextInputSchema, InterpretationJsonSchema } from "../../../conversation/context-contract/contracts";
import { googleLiteEuContextWireSchemaV3 } from "./context-provider-wire";
import { encodeFixtureV3 } from "../../../../../tools/benchmark/context-pointer-fixtures";
import { CONTEXT_PROTOCOL_V3 } from "../../../conversation/context-contract/protocol";
import { CONTEXT_CONTRACT_PROMPT } from "../../../conversation/context-contract/prompt";
import { numericOwnershipCatalogue } from "../../../conversation/context-contract/wire";
import { readBoundedSemanticResponse } from "../../../../worker/composition-root";

const input = { text: "nhắc mình", referenceLocalDate: "2026-09-16", referenceLocalTime: "12:00", timezone: "Asia/Ho_Chi_Minh" as const };
const route = { model: "fixture/model", provider: "fixture-provider", requireZdr: true,
  promptPriceMicrounitsPerMillionTokens: 500_000, completionPriceMicrounitsPerMillionTokens: 500_000 };
const freeRoute = { ...route, promptPriceMicrounitsPerMillionTokens: 0, completionPriceMicrounitsPerMillionTokens: 0 };
const config = { maxInputChars: 1_800, maxInputTokens: 12_000, maxOutputTokens: 256,
  maxResponseBytes: 20_000, timeoutMs: 100, freePrimary: freeRoute, paidFallback: route };
const modelHelp = { intent: "HELP", title: null, titleState: "NOT_APPLICABLE", targetIntent: null };
const success = { status: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelHelp) }, finish_reason: "stop" }] }) };

afterEach(() => vi.useRealTimers());

const contextInput = ContextInputSchema.parse({ schemaVersion: "calenote-context-input-2",
  reference: { instant: "2026-09-28T03:00:00.000Z", localDate: "2026-09-28", timezone: "Asia/Ho_Chi_Minh" },
  turns: [{ role: "USER", text: "nhắc gọi mẹ" }], currentTurn: 0, activeRequest: null, facts: [], pendingQuestion: null, ambiguities: [],
  capabilities: { version: "context-capabilities-1", supported: ["ONCE"], unsupported: ["YEARLY"], calendars: ["GREGORIAN"], limits: { dailyCount: 30, horizonDays: 366 } } });
const contextConfig = { protocol: CONTEXT_PROTOCOL_V3, maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
  primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true,
    promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } };
const contextOutput = { schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "nhắc gọi mẹ", occurrence: 1 }] },
  changes: [{ field: "title", operation: "SET", value: "gọi mẹ", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "gọi mẹ", occurrence: 1 }] }],
  query: null, uncertainties: [{ field: "reminderTime", reason: "MISSING", alternatives: [] }],
  conversationDirective: { kind: "ASK_FOR_FIELD", field: "reminderTime" }, replyProposal: { text: "Bạn muốn được nhắc lúc nào?" } };
const materializedChanges=contextOutput.changes.map(change=>({...change,evidence:[{kind:"USER_QUOTE",turn:0,quote:contextInput.turns[0].text,occurrence:1}]}));
const contextRequest = (value = contextInput): SemanticJsonRequest => ({ model: "google/gemini-2.5-flash-lite",
  messages: [{ role: "system", content: CONTEXT_CONTRACT_PROMPT }, { role: "user", content: JSON.stringify({ ...value, numericOwnership: numericOwnershipCatalogue(value) }) }],
  response_format: { type: "json_schema", json_schema: { name: "calenote_context_3", strict: true, schema: googleLiteEuContextWireSchemaV3().schema } },
  stream: false, max_tokens: 1536,
  provider: { only: ["google-vertex/eu"], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true, max_price: { prompt: 0.1, completion: 0.4 } } });
const contextResponse = (payload: unknown = contextOutput, finish = "stop") => ({ status: 200, body: JSON.stringify({
  choices: [{ message: { content: JSON.stringify(encodeFixtureV3(payload,contextInput)) }, finish_reason: finish }] }) });
const exchange = (value = contextInput) => ({ requestJson: JSON.stringify(contextRequest(value)),
  admission: { fullInputTokens: 12000, billableOverheadMicrounits: 0 }, response: contextResponse() });

describe("observable successor route", () => {
  const admission = { status: "OBSERVABLE_CANARY" as const, advertisedContextTokens: 1048576 as const };
  it("materializes source pointers from the validated dispatch snapshot, not mutable caller input",async()=>{
    const original=structuredClone(contextInput);
    const payload=encodeFixtureV3(contextOutput) as {requestTarget:{evidence:{primaryEvidence:string}},changes:Array<{evidence:{primaryEvidence:string}}>};
    payload.requestTarget.evidence.primaryEvidence=JSON.stringify({kind:"USER_TURN",turn:0});
    payload.changes[0].evidence.primaryEvidence=JSON.stringify({kind:"USER_TURN",turn:0});
    const body=JSON.stringify({model:"google/gemini-2.5-flash-lite",provider:"Google",id:"gen-pointer",usage:{cost:0,prompt_tokens:100,completion_tokens:100},choices:[{message:{content:JSON.stringify(payload)},finish_reason:"stop"}]});
    const attempt=gateways.createContextContractGateway(contextConfig,async()=>({status:200,body}),admission).prepare("PRIMARY",original);
    if(attempt.status!=="READY")throw Error("not ready");
    original.turns[0].text="caller changed this after prepare";
    const result=await attempt.dispatch();
    expect(result).toMatchObject({status:"SUCCESS",interpretation:{semantic:{requestTarget:{evidence:[{kind:"USER_QUOTE",turn:0,quote:"nhắc gọi mẹ",occurrence:1}]},changes:[{evidence:[{quote:"nhắc gọi mẹ"}]}]}}});
    expect(await attempt.dispatch()).toMatchObject({status:"FAILURE",category:"UNAVAILABLE"});
  });
  it.each([
    [null,"stop",["choices",0,"message","content"],"invalid_type","null"],
    ["SYNTHETIC_PRIVATE_CONTENT","error",["choices",0,"finish_reason"],"invalid_value","string"],
  ])("retains sanitized rejected provider-envelope structure without content", async (content,finish,path,code,actualType) => {
    const body=JSON.stringify({model:"google/gemini-2.5-flash-lite",provider:"Google",id:"gen-synthetic",usage:{cost:0,prompt_tokens:0,completion_tokens:0},choices:[{message:{content},finish_reason:finish}]});
    const attempt=gateways.createContextContractGateway(contextConfig,async()=>({status:200,body}),admission).prepare("PRIMARY",contextInput);
    if(attempt.status!=="READY")throw Error("not ready");
    const result=await attempt.dispatch();
    expect(result).toMatchObject({status:"FAILURE",category:"SCHEMA_INVALID",usage:{costMicrounits:0},canonicalValidationDiagnostics:{state:"PROVIDER_ENVELOPE_FAILED",inputRepresentation:"PROVIDER_ENVELOPE",payloadByteCount:Buffer.byteLength(body),validation:{issues:[expect.objectContaining({path,code,actualType})]}}});
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_CONTENT");
    expect(await attempt.dispatch()).toMatchObject({status:"FAILURE",category:"UNAVAILABLE"});
  });
  it.each([
    ["x-request-id", "req-53594e5448455449435f43524544454e5449414c", "SYNTHETIC_CREDENTIAL"],
    ["traceparent", "00-53594e5448455449435f534543524554-0123456789abcdef-01", "SYNTHETIC_SECRET"],
    ["traceparent", "00-0123456789abcdef0123456789abcdef-53594e54484b4559-01", "SYNTHKEY"],
    ["traceparent", "00-53594e5448455449435f43524544454e-5449414c00000000-01", "SYNTHETIC_CREDENTIAL"],
    ["cf-ray", "53594e54484b4559-SIN", "SYNTHKEY"],
    ["x-request-id", "req-6e68e1baaf632067e1bb8d69206de1bab9", "synthetic"],
    ["traceparent", "00-6e68e1baaf632067e1bb8d69206de1ba-b900000000000000-01", "synthetic"],
  ])("denies reversible known-sensitive payloads in %s before transport return", async (header, value, credential) => {
    const transport = gateways.createContextHttpTransport(credential, async () => new Response('{"error":{"code":400}}', { status: 400,
      headers: { "content-type": "application/json", [header]: value } }));
    const result = await transport(contextRequest(), { signal: new AbortController().signal });
    expect(result.failureDiagnostics).toBeDefined();
    expect(result.failureDiagnostics?.requestId).toBeUndefined(); expect(result.failureDiagnostics?.traceId).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(value);
  });
  it("preserves format-valid unrelated request and trace IDs", async () => {
    const transport = gateways.createContextHttpTransport("SYNTHETIC_CREDENTIAL", async () => new Response('{"error":{"code":400}}', { status: 400,
      headers: { "content-type": "application/json", "x-request-id": "req-0123456789abcdef", "traceparent": "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" } }));
    expect((await transport(contextRequest(), { signal: new AbortController().signal })).failureDiagnostics)
      .toMatchObject({ requestId: "req-0123456789abcdef", traceId: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" });
  });
  it.each(["param", "path", "details", "message"])("projects safe root and nested %s causes through the same bounded rules", async shape => {
    const structuralPath = "response_format.json_schema.schema.properties.changes.items";
    const root = shape === "message" ? { message: 'Invalid JSON payload received. Unknown name "const" at "generation_config.response_schema": Cannot find field.' }
      : shape === "details" ? { details: [{ param: structuralPath, message: "SYNTHETIC_PRIVATE_PROSE" }] } : { [shape]: structuralPath };
    for (const error of [{ code: 400, ...root }, { code: 400, metadata: root }, { code: 400, metadata: { raw: JSON.stringify({ error: root }) } }]) {
      const transport = gateways.createContextHttpTransport("synthetic", async () => new Response(JSON.stringify({ error }), { status: 400, headers: { "content-type": "application/json" } }));
      const result = await transport(contextRequest(), { signal: new AbortController().signal });
      const encoded = JSON.stringify(result.failureDiagnostics?.errorMetadataSanitized ?? null);
      expect(encoded).toContain(shape === "message" ? "generation_config.response_schema" : structuralPath);
      expect(encoded).not.toContain("SYNTHETIC_PRIVATE_PROSE");
      if (shape === "message") expect(encoded).toContain("Unsupported schema construct: const");
    }
  });
  it.each([
    ["normal JSON", JSON.stringify({ error: { code: 400, message: "Invalid schema for response_format", metadata: { provider_name: "Google", raw: JSON.stringify({ error: { code: "invalid_argument", message: "Invalid schema for response_format", param: "response_format.json_schema.schema.properties.changes.items" } }) } } }), "application/json", "JSON"],
    ["malformed JSON", '{"error":', "application/json", "MALFORMED_JSON"],
    ["non JSON", "SYNTHETIC_PRIVATE_BODY", "text/html", "NON_JSON"],
    ["missing headers", "SYNTHETIC_PRIVATE_BODY", "", "NON_JSON"],
    ["missing body", null, "application/json", "EMPTY"],
    ["oversized", "x".repeat(32769), "application/json", "OVERSIZED"],
  ])("retains bounded sanitized %s HTTP400 evidence through actual boundary", async (_name, body, media, bodyState) => {
    const transport = gateways.createContextHttpTransport("SYNTHETIC_CREDENTIAL", async () => new Response(body, { status: 400, headers: media ? { "content-type": media } : {} }));
    const attempt = gateways.createContextContractGateway(contextConfig, transport, admission).prepare("PRIMARY", contextInput);
    if (attempt.status !== "READY") throw new Error("prepare failed");
    const result = await attempt.dispatch();
    expect(result).toMatchObject({ status: "FAILURE", category: "PROVIDER_FAILURE", failureDiagnostics: { version: "provider-failure-1", httpStatus: 400, bodyState } });
    const encoded = JSON.stringify(result);
    expect(encoded).not.toContain("SYNTHETIC_PRIVATE_BODY");
    expect(new TextEncoder().encode(encoded).byteLength).toBeLessThan(4400);
    if (_name === "normal JSON") {
      expect(encoded).toContain("invalid_argument");
      expect(encoded).toContain("response_format.json_schema.schema.properties.changes.items");
    }
  });
  it("redacts synthetic secrets, request echoes and arbitrary Unicode prose in every projected position, reads body and explicit headers once", async () => {
    const sentinels = ["SYNTHETIC_CREDENTIAL", "SYNTHETIC_OWNER_ID", "SYNTHETIC_CHAT_ID", "SYNTHETIC_SECRET", "nhắc gọi mẹ", "私密文本"];
    const body = JSON.stringify({ error: { code: "SYNTHETIC_SECRET", message: "Authorization: Bearer SYNTHETIC_CREDENTIAL nhắc gọi mẹ 私密文本", metadata: {
      code: "SYNTHETIC_OWNER_ID", param: "SYNTHETIC_CHAT_ID", errors: [{ message: "nhắc gọi mẹ", type: "私密文本" }],
      raw: JSON.stringify({ error: { message: "api_key=SYNTHETIC_SECRET", code: "invalid_argument", param: "response_format.json_schema" } }),
    } }, id: "gen-SYNTHETIC_OWNER_ID" });
    const response = new Response(body, { status: 400, headers: { "content-type": "application/json", "x-request-id": "req-0123456789abcdef", "cf-ray": "0123456789abcdef-SIN", "traceparent": "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01", "x-generation-id": "gen-SYNTHETIC_SECRET", "x-owner": "SYNTHETIC_OWNER_ID" } });
    const getReader = vi.spyOn(response.body!, "getReader"), headers = vi.spyOn(response.headers, "get");
    const transport = gateways.createContextHttpTransport(sentinels[0], async () => response);
    const result = await transport(contextRequest(), { signal: new AbortController().signal });
    expect(result).toHaveProperty("failureDiagnostics");
    const encoded = JSON.stringify(result);
    for (const sentinel of sentinels) expect(encoded).not.toContain(sentinel);
    expect(encoded).toContain("req-0123456789abcdef"); expect(encoded).toContain("00-0123456789abcdef0123456789abcdef-0123456789abcdef-01");
    expect(encoded).toContain("invalid_argument");
    expect(getReader).toHaveBeenCalledOnce();
    const names = headers.mock.calls.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length); expect(names).not.toContain("x-owner");
  });
  it("retains synthetic nested Google unsupported construct and structural path with independent known cost", async () => {
    const transport = gateways.createContextHttpTransport("synthetic-credential", async () => new Response(JSON.stringify({
      error: { code: 400, message: "Provider returned error", metadata: { provider_name: "Google", raw: JSON.stringify({ error: {
        code: "INVALID_ARGUMENT", message: 'Invalid JSON payload received. Unknown name "const" at "generation_config.response_schema": Cannot find field.' } }) } },
      usage: { cost: .105473, prompt_tokens: 12001, completion_tokens: 100 },
    }), { status: 400, headers: { "content-type": "application/json" } }));
    const attempt = gateways.createContextContractGateway(contextConfig, transport, admission).prepare("PRIMARY", contextInput);
    if (attempt.status !== "READY") throw new Error("prepare failed");
    const result = await attempt.dispatch(), encoded = JSON.stringify(result);
    expect(result).toMatchObject({ status: "FAILURE", category: "PROVIDER_FAILURE", usage: { costMicrounits: 105473, reportedCostUsd: .105473, promptTokens: 12001 } });
    expect(encoded).toContain("Unsupported schema construct: const"); expect(encoded).toContain("generation_config.response_schema");
  });
  it.each(["read-error", "invalid-utf8", "invalid-length", "hostile-metadata", "unsafe-headers", "known-echo"])("contains %s failure safely without another body read", async mode => {
    let reads = 0;
    const sensitive = "req-0123456789abcdef";
    const metadata = { errors: Array.from({ length: 40 }, () => ({ param: "response_format.json_schema.schema.properties.changes.items", message: "Invalid schema" })) };
    const headers = { "content-type": "application/json", "x-request-id": mode === "unsafe-headers" ? "Authorization: Bearer SYNTHETIC_PRIVATE" : sensitive,
      "cf-ray": mode === "unsafe-headers" ? "SYNTHETIC_PRIVATE" : "0123456789abcdef-SIN", ...(mode === "invalid-length" ? { "content-length": "invalid" } : {}) };
    const body = mode === "read-error" ? new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.error(new Error("SYNTHETIC_PRIVATE")); } })
      : mode === "invalid-utf8" ? new Uint8Array([255]) : JSON.stringify({ error: { code: 400, message: "SYNTHETIC_PRIVATE", metadata } });
    const transport = gateways.createContextHttpTransport(mode === "known-echo" ? sensitive : "synthetic", async () => new Response(body, { status: 400, headers }));
    const result = await transport(contextRequest(), { signal: new AbortController().signal });
    expect(result.failureDiagnostics).toBeDefined();
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE");
    expect(new TextEncoder().encode(JSON.stringify(result.failureDiagnostics)).byteLength).toBeLessThanOrEqual(4096);
    if (mode === "read-error") { expect(reads).toBe(1); expect(result.failureDiagnostics?.bodyState).toBe("READ_ERROR"); }
    if (mode === "invalid-utf8") expect(result.failureDiagnostics?.bodyState).toBe("INVALID_UTF8");
    if (mode === "invalid-length") expect(result.failureDiagnostics?.bodyState).toBe("INVALID_LENGTH");
    if (mode === "known-echo" || mode === "unsafe-headers") expect(result.failureDiagnostics?.requestId).toBeUndefined();
  });
  it("retains known HTTP failure cost when sibling token accounting is unknown", async () => {
    const transport = gateways.createContextHttpTransport("synthetic", async () => new Response(JSON.stringify({ error: { code: 400 },
      usage: { cost: .001, prompt_tokens: 12001, completion_tokens: null } }), { status: 400, headers: { "content-type": "application/json" } }));
    const attempt = gateways.createContextContractGateway(contextConfig, transport, admission).prepare("PRIMARY", contextInput);
    if (attempt.status !== "READY") throw new Error("prepare failed");
    expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE", category: "PROVIDER_FAILURE", usage: { costMicrounits: 1000, reportedCostUsd: .001 } });
  });
  const providerPayload = (payload:unknown) => encodeFixtureV3(payload,contextInput);
  const response = (overrides: Record<string, unknown> = {}, payload: unknown = contextOutput) => ({ status: 200, body: JSON.stringify({
    id: "gen-test-123", model: "google/gemini-2.5-flash-lite", provider: "Google", ...JSON.parse(contextResponse(providerPayload(payload)).body),
    usage: { cost: .001, prompt_tokens: 12000, completion_tokens: 1536 }, ...overrides,
  }) });
  it("reserves full financial exposure and emits versioned provider schema exactly once", async () => {
    const requests: SemanticJsonRequest[] = [];
    const gateway = gateways.createContextContractGateway(contextConfig, async request => { requests.push(request); return response(); }, admission);
    const attempt = gateway.prepare("PRIMARY", contextInput);
    expect(attempt.status).toBe("READY");
    if (attempt.status !== "READY") return;
    expect(attempt.maximumCostMicrounits).toBe(105472);
    expect(requests).toHaveLength(0);
    expect(await attempt.dispatch()).toMatchObject({ status: "SUCCESS", interpretation: { fullSchemaValid: true },
      usage: { costMicrounits: 1000, promptTokens: 12000, completionTokens: 1536 },
      providerEvidence: { model: "google/gemini-2.5-flash-lite", provider: "Google", location: "UNEXPOSED", generationId: "gen-test-123" } });
    expect(createHash("sha256").update(JSON.stringify(requests[0].response_format.json_schema.schema)).digest("hex"))
      .toBe("c2ea900a4882c3620cdaa8e1fff1ee242f85194f23b093701e81d2314cd469a0");
    expect(requests).toEqual([{ ...contextRequest(), response_format: { type: "json_schema", json_schema: {
      name: "calenote_context_3", strict: true, schema: expect.any(Object) } } }]);
    expect(createHash("sha256").update(JSON.stringify(InterpretationJsonSchema)).digest("hex"))
      .toBe("43b6689ce9c4874c4d532652ea212b52aa7d7f222cddd55377e59d483f5c444b");
    expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE" });
    expect(requests).toHaveLength(1);
  });
  it.each([
    { usage: { cost: .001, prompt_tokens: 12001, completion_tokens: null } },
    { usage: { cost: .001, prompt_tokens: null, completion_tokens: 1537 } },
    { usage: { cost: .001, prompt_tokens: 12000 } }, { usage: { prompt_tokens: 100, completion_tokens: 100 } },
    { usage: { cost: .001, prompt_tokens: 1.5, completion_tokens: 100 } },
    { usage: { cost: .105473, prompt_tokens: 100, completion_tokens: 100 } },
    { model: "other/model" }, { model: undefined }, { provider: "Google AI Studio" },
    { provider: undefined }, { choices: [{ message: { content: "{}" }, finish_reason: "length" }] },
  ])("rejects observable limit/route/unknown violations before acceptance %j", async override => {
    const attempt = gateways.createContextContractGateway(contextConfig, async () => response(override), admission).prepare("PRIMARY", contextInput);
    expect(attempt.status).toBe("READY");
    if (attempt.status === "READY") expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE" });
  });
  it("retains known cost on token overflow", async () => {
    for (const wire of [response({ usage: { cost: .001, prompt_tokens: 12001, completion_tokens: null } })]) {
      const attempt = gateways.createContextContractGateway(contextConfig, async () => wire, admission).prepare("PRIMARY", contextInput);
      expect(attempt.status).toBe("READY");
      if (attempt.status === "READY") expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE", usage: { costMicrounits: 1000 } });
    }
  });
  it("preserves valid core while quarantining bad guidance for production backend fallback", async () => {
    const attempt = gateways.createContextContractGateway(contextConfig, async () => response({}, { ...contextOutput, conversationDirective: { kind: "SAVE" } }), admission)
      .prepare("PRIMARY", contextInput);
    if (attempt.status !== "READY") throw new Error("not ready");
    expect(await attempt.dispatch()).toMatchObject({ status: "SUCCESS", interpretation: { fullSchemaValid: false, directive: { status: "INVALID" },
      semantic: { changes: materializedChanges } }, usage: { costMicrounits: 1000, reportedCostUsd: .001 } });
  });
  it("reports actual known charge even when it exceeds the financial reservation", async () => {
    const attempt = gateways.createContextContractGateway(contextConfig, async () => response({ usage: { cost: .105473, prompt_tokens: 100, completion_tokens: 100 } }), admission).prepare("PRIMARY", contextInput);
    if (attempt.status !== "READY") throw new Error("not ready");
    expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE", usage: { costMicrounits: 105473 } });
  });
  it("aborts a stalled real transport at the original deadline without retry", async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined, calls = 0;
    const attempt = gateways.createContextContractGateway(contextConfig, async (_request, options) => {
      calls++; signal = options.signal; return new Promise(() => {});
    }, admission).prepare("PRIMARY", contextInput);
    expect(attempt.status).toBe("READY");
    if (attempt.status !== "READY") return;
    const pending = attempt.dispatch(); await vi.advanceTimersByTimeAsync(30000);
    expect(await pending).toMatchObject({ status: "FAILURE", category: "TIMEOUT" });
    expect(signal?.aborted).toBe(true); expect(calls).toBe(1);
  });
  it("HTTP factory separates credential headers and emits the adapted provider body", async () => {
    expect(gateways).toHaveProperty("createContextHttpTransport", expect.any(Function));
    let seen: { url: string; init: RequestInit } | undefined;
    const transport = gateways.createContextHttpTransport("synthetic-test-secret", async (url, init) => {
      seen = { url, init }; return new Response(response().body, { headers: { "content-type": "application/json" } });
    });
    const attempt = gateways.createContextContractGateway(contextConfig, transport, admission).prepare("PRIMARY", contextInput);
    if (attempt.status !== "READY") throw new Error("prepare failed");
    expect(await attempt.dispatch()).toMatchObject({ status: "SUCCESS", rawResponseBytes: new TextEncoder().encode(response().body).byteLength });
    expect(seen?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(seen?.init).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: "Bearer synthetic-test-secret", "Content-Type": "application/json" } });
    const emitted = JSON.parse(String(seen?.init.body));
    expect(createHash("sha256").update(JSON.stringify(emitted.response_format.json_schema.schema)).digest("hex"))
      .toBe("c2ea900a4882c3620cdaa8e1fff1ee242f85194f23b093701e81d2314cd469a0");
    expect(emitted).toEqual({ ...contextRequest(), response_format: { type: "json_schema", json_schema: {
      name: "calenote_context_3", strict: true, schema: expect.any(Object) } } });
    expect(seen?.init.body).not.toContain("synthetic-test-secret");
  });
  it("raw byte evidence measures original HTTP chunks, including BOM, not decoded text or Content-Length", async () => {
    const transport = gateways.createContextHttpTransport("synthetic", async () => new Response(new Uint8Array([239, 187, 191, 123, 125]),
      { headers: { "content-type": "application/json", "content-length": "1" } }));
    expect(await transport(contextRequest(), { signal: new AbortController().signal })).toMatchObject({ body: "{}", rawResponseBytes: 5 });
  });
  it("HTTP reader cancels oversized or stalled bodies and rejects non-JSON/invalid UTF8", async () => {
    expect(gateways).toHaveProperty("createContextHttpTransport", expect.any(Function));
    const cancel = vi.fn();
    const transport = gateways.createContextHttpTransport("synthetic", async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(32769)); }, cancel,
    }), { headers: { "content-type": "application/json" } }));
    const result = await transport(contextRequest(), { signal: new AbortController().signal });
    expect(result.oversized).toBe(true); expect(cancel).toHaveBeenCalledOnce();
    const invalid = gateways.createContextHttpTransport("synthetic", async () => new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } }));
    await expect(invalid(contextRequest(), { signal: new AbortController().signal })).rejects.toThrow();
    const html = gateways.createContextHttpTransport("synthetic", async () => new Response("{}", { headers: { "content-type": "text/html" } }));
    await expect(html(contextRequest(), { signal: new AbortController().signal })).rejects.toThrow();
    const abort = new AbortController(), stalledCancel = vi.fn();
    const stalled = gateways.createContextHttpTransport("synthetic", async () => new Response(new ReadableStream({ cancel: stalledCancel }), { headers: { "content-type": "application/json" } }));
    const pending = stalled(contextRequest(), { signal: abort.signal });
    await Promise.resolve(); abort.abort();
    await expect(pending).rejects.toThrow(); expect(stalledCancel).toHaveBeenCalledOnce();
  });
});
function contextGateway(exchanges = [exchange()], cfg = contextConfig) {
  expect(gateways).toHaveProperty("createContextContractGateway", expect.any(Function));
  return gateways.createContextContractGateway(cfg, { kind: "OFFLINE_FIXTURE", exchanges });
}

describe("dormant successor context gateway", () => {
  it("context_gateway_uses_exact_prompt_schema_and_route", async () => {
    const attempt = contextGateway().prepare("PRIMARY", contextInput);
    expect(attempt.status).toBe("READY");
    if (attempt.status !== "READY") throw new Error("not ready");
    expect(attempt.maximumCostMicrounits).toBe(1815);
    expect(await attempt.dispatch()).toMatchObject({ status: "SUCCESS", interpretation: { fullSchemaValid: true,
      semantic: { changes: materializedChanges, uncertainties: contextOutput.uncertainties },
      directive: { status: "VALID", value: contextOutput.conversationDirective }, reply: { status: "VALID", value: contextOutput.replyProposal } }, usage: { costMicrounits: null } });
  });
  it("prepared_is_not_dispatched_and_dispatch_is_one_shot", async () => {
    const attempt = contextGateway([{ ...exchange(), response: { status: 429, body: "" } }]).prepare("PRIMARY", contextInput);
    expect(attempt.status).toBe("READY");
    if (attempt.status !== "READY") throw new Error("not ready");
    expect(await attempt.dispatch()).toEqual({ status: "FAILURE", category: "RATE_LIMITED" });
    expect(await attempt.dispatch()).toEqual({ status: "FAILURE", category: "UNAVAILABLE" });
  });
  it("real_route_refuses_even_with_forged_fixture_admission_and_never_calls_transport", () => {
    expect(gateways).toHaveProperty("createContextContractGateway", expect.any(Function));
    const network = vi.fn(async () => contextResponse());
    Object.assign(network, { kind: "OFFLINE_FIXTURE", exchanges: [exchange()] });
    expect(gateways.createContextContractGateway(contextConfig, network).prepare("PRIMARY", contextInput))
      .toEqual({ status: "FAILURE", category: "ROUTE_ADMISSION_UNVERIFIED" });
    expect(network).not.toHaveBeenCalled();
  });
  it.each([12001, -1, NaN, 1.5])("full_request_bound_checked_before_prepare_ready %s", (fullInputTokens) => {
    expect(contextGateway([{ ...exchange(), admission: { fullInputTokens, billableOverheadMicrounits: 0 } }]).prepare("PRIMARY", contextInput).status).toBe("FAILURE");
  });
  it("exact_request_binding_and_billable_overhead_are_required", () => {
    expect(contextGateway([{ ...exchange(), requestJson: JSON.stringify({ ...contextRequest(), tools: [] }) }]).prepare("PRIMARY", contextInput).status).toBe("FAILURE");
    expect(contextGateway([{ ...exchange(), admission: { fullInputTokens: 12000, billableOverheadMicrounits: 23 } }]).prepare("PRIMARY", contextInput))
      .toMatchObject({ status: "READY", maximumCostMicrounits: 1838 });
  });
  it.each(["CN-scoped-control", "%43%4e-secret", "authorization: bearer secret", "password=secret", "/connect code"])("no_control_or_secret_in_body %s", text => {
    const value = { ...contextInput, turns: [{ role: "USER" as const, text }] };
    expect(contextGateway([exchange(value)]).prepare("PRIMARY", value)).toEqual({ status: "FAILURE", category: "INVALID_INPUT" });
  });
  it.each([1800, 1801])("NFC_UTF16_current_gate %s", size => {
    const value = { ...contextInput, turns: [{ role: "USER" as const, text: "😀".repeat(899) + "ế".repeat(size - 1798) }] };
    expect(contextGateway([exchange(value)]).prepare("PRIMARY", value).status).toBe(size === 1800 ? "READY" : "FAILURE");
  });
  it("guidance_failure_never_redispatches", async () => {
    const raw = { ...contextOutput, conversationDirective: { kind: "SAVE" }, replyProposal: { text: "😀".repeat(401) } };
    const attempt = contextGateway([{ ...exchange(), response: contextResponse(raw) }]).prepare("PRIMARY", contextInput);
    if (attempt.status !== "READY") throw new Error("not ready");
    expect(await attempt.dispatch()).toMatchObject({ status: "SUCCESS", interpretation: { fullSchemaValid: false,
      semantic: { changes: materializedChanges }, directive: { status: "INVALID" }, reply: { status: "INVALID", reason: "REPLY_TOO_LONG" } } });
    expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE" });
  });
  it.each([
    contextResponse(contextOutput, "length"), { status: 200, body: '{"choices":[' },
    { status: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(contextOutput).slice(0, -1) }, finish_reason: "stop" }] }) },
    contextResponse({ ...contextOutput, schemaVersion: "calenote-context-1" }),
    contextResponse({ ...contextOutput, changes: [...contextOutput.changes, ...contextOutput.changes] }),
    contextResponse({ ...contextOutput, ownerId: "secret" }),
    { ...contextResponse(), oversized: true }, { status: 200, body: "ế".repeat(10923) },
  ])("truncated_json_never_salvaged_and_invalid_core_atomic %#", async response => {
    const attempt = contextGateway([{ ...exchange(), response }]).prepare("PRIMARY", contextInput);
    if (attempt.status !== "READY") throw new Error("not ready");
    expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE" });
  });
  it("offline_script_supports_distinct_turns_and_copies_fixture_state", async () => {
    const second = { ...contextInput, turns: [{ role: "USER" as const, text: "mai" }] };
    const script = [exchange(), exchange(second)]; const gateway = contextGateway(script);
    script[0].response.body = "corrupted";
    for (const value of [contextInput, second]) {
      const attempt = gateway.prepare("PRIMARY", value);
      if (attempt.status !== "READY") throw new Error("not ready");
      expect((await attempt.dispatch()).status).toBe("SUCCESS");
    }
    expect(gateway.prepare("PRIMARY", second).status).toBe("FAILURE");
  });
  it.each([{ completion_tokens: 1537 }, { prompt_tokens: 12001 }])("reported_token_overflow_rejects_context_output %j", usage => {
    const body = JSON.parse(contextResponse().body); body.usage = { cost: 0.001, ...usage };
    const attempt = contextGateway([{ ...exchange(), response: { status: 200, body: JSON.stringify(body) } }]).prepare("PRIMARY", contextInput);
    if (attempt.status !== "READY") throw new Error("not ready");
    return expect(attempt.dispatch()).resolves.toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
  });
  it.each([null, "unknown", {}, false].flatMap(unknown => [
    { prompt_tokens: 12001, completion_tokens: unknown }, { prompt_tokens: unknown, completion_tokens: 1537 },
  ]))("unknown_sibling_cannot_hide_known_token_overflow %j", async usage => {
    const body = JSON.parse(contextResponse().body); body.usage = { cost: 0.001, ...usage };
    const attempt = contextGateway([{ ...exchange(), response: { status: 200, body: JSON.stringify(body) } }]).prepare("PRIMARY", contextInput);
    if (attempt.status !== "READY") throw new Error("not ready");
    expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
  });
  it("unknown_usage_without_known_overflow_remains_unknown", async () => {
    for (const usage of [{ prompt_tokens: 12000, completion_tokens: null }, { prompt_tokens: null, completion_tokens: 1536 }]) {
      const body = JSON.parse(contextResponse().body); body.usage = { cost: 0.001, ...usage };
      const attempt = contextGateway([{ ...exchange(), response: { status: 200, body: JSON.stringify(body) } }]).prepare("PRIMARY", contextInput);
      if (attempt.status !== "READY") throw new Error("not ready");
      expect(await attempt.dispatch()).toMatchObject({ status: "SUCCESS", usage: { costMicrounits: null } });
    }
  });
  it.each([{ maxOutputTokens: 256 }, { maxInputTokens: 12001 }, { maxResponseBytes: 32769 }, { timeoutMs: 1 },
    { primary: { ...contextConfig.primary, model: "other/model" } }, { primary: { ...contextConfig.primary, requireZdr: false } },
    { primary: { ...contextConfig.primary, promptPriceMicrounitsPerMillionTokens: 99999 } },
  ])("successor_rejects_route_or_wire_changes_before_any_preparation %j", override => {
    expect(() => contextGateway([exchange()], { ...contextConfig, ...override })).toThrow("Invalid context gateway configuration");
  });
  it("bounded_stream_reader_cancels_above_32768_without_content_length", async () => {
    const cancel = vi.fn(); const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(32768)); controller.enqueue(new Uint8Array(1));
    }, cancel }));
    expect(await readBoundedSemanticResponse(response, 32768)).toEqual({ body: "", oversized: true });
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("injected strict semantic gateway", () => {
  it("legacy_malformed_usage_does_not_change_semantic_success", async () => {
    const body = JSON.parse(success.body); body.usage = { cost: 0.001, prompt_tokens: 12001, completion_tokens: null };
    const attempt = createSemanticGateway(config, async () => ({ status: 200, body: JSON.stringify(body) })).prepare("FREE_PRIMARY", input);
    if (attempt.status !== "READY") throw new Error("not ready");
    expect(await attempt.dispatch()).toMatchObject({ status: "SUCCESS", usage: { costMicrounits: null } });
  });
  it("derives the authoritative Vietnamese wall clock instead of sending an epoch to the model", () => {
    expect(semanticReferenceWallClock(Date.parse("2026-09-16T09:00:00+07:00"))).toEqual({
      referenceLocalDate: "2026-09-16", referenceLocalTime: "09:00", timezone: "Asia/Ho_Chi_Minh",
    });
  });

  it("pins an explicit provider/model with privacy, strict schema, no streaming and bounded output", async () => {
    const requests: SemanticJsonRequest[] = [];
    const gateway = createSemanticGateway(config, async (request) => { requests.push(request); return success; });
    const attempt = gateway.prepare("FREE_PRIMARY", input);
    expect(attempt.status).toBe("READY");
    if (attempt.status !== "READY") throw new Error("Expected prepared attempt");
    expect(await attempt.dispatch()).toMatchObject({ status: "SUCCESS", interpretation: { intent: "HELP" } });
    expect(requests[0]).toEqual({ model: "fixture/model", stream: false, max_tokens: 256,
      messages: [{ role: "system", content: CANONICAL_SEMANTIC_PROMPT }, { role: "user", content: JSON.stringify(input) }],
      response_format: { type: "json_schema", json_schema: { name: "model_semantic_interpretation", strict: true, schema: ModelSemanticInterpretationJsonSchema } },
      provider: { only: ["fixture-provider"], require_parameters: true, data_collection: "deny", zdr: true,
        allow_fallbacks: false, max_price: { prompt: 0, completion: 0 } } });
    expect(requests[0].response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(requests[0]).not.toHaveProperty("tools");
    expect(requests[0]).not.toHaveProperty("models");
    expect(requests[0]).not.toHaveProperty("functions");
    expect(requests[0]).not.toHaveProperty("api_key");
    expect(requests[0].messages).toHaveLength(2);
    expect(JSON.parse(requests[0].messages[1].content)).toEqual(input);
    expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE", category: "UNAVAILABLE" });
    expect(requests).toHaveLength(1);
  });

  it.each([
    { intent: "CREATE_REMINDER", title: "Call", localDate: "2026-09-17", localTime: "09:00", timezone: "Asia/Ho_Chi_Minh", needsClarification: false },
    { intent: "LIST_REMINDERS", rangeKind: "TODAY", localDate: null },
    { intent: "NEEDS_CLARIFICATION", targetIntent: "CREATE_REMINDER", missingFields: ["time"], question: "When?" },
    ...["localDate", "localTime", "rangeKind", "timezone", "epoch", "scheduledAt", "question"].map((field) => ({ ...modelHelp, [field]: "forbidden" })),
    { ...modelHelp, title: "Not applicable" },
  ])("rejects temporal authority and invalid model combinations at decode %#", async (payload) => {
    const attempt = createSemanticGateway(config, async () => ({ status: 200,
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }] }),
    })).prepare("FREE_PRIMARY", input);
    if (attempt.status !== "READY") throw new Error("Expected prepared attempt");
    expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
  });

  it("omits optional ZDR only when the explicit route does not require it", async () => {
    const transport = vi.fn<import("./semantic-gateway").SemanticTransport>(async () => success);
    const attempt = createSemanticGateway({ ...config, freePrimary: { ...freeRoute, requireZdr: false } }, transport)
      .prepare("FREE_PRIMARY", input);
    if (attempt.status !== "READY") throw new Error("Expected prepared attempt");
    await attempt.dispatch();
    expect(transport.mock.calls[0][0].provider).not.toHaveProperty("zdr");
  });

  it("returns unavailable without substituting any implicit model or provider", () => {
    const transport = vi.fn(async () => success);
    const gateway = createSemanticGateway({ ...config, freePrimary: undefined, paidFallback: undefined }, transport);
    expect(gateway.prepare("FREE_PRIMARY", input)).toEqual({ status: "FAILURE", category: "UNAVAILABLE" });
    expect(gateway.prepare("CHEAP_PAID_FALLBACK", input)).toEqual({ status: "FAILURE", category: "UNAVAILABLE" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    { maxInputTokens: 0 }, { timeoutMs: 30_001 }, { maxOutputTokens: 0 }, { maxResponseBytes: 1_000_001 },
    { freePrimary: { ...route, model: "openrouter/auto" } },
    { paidFallback: { ...route, provider: "" } },
    { paidFallback: { ...route, promptPriceMicrounitsPerMillionTokens: -1 } },
    { freePrimary: route },
  ])("rejects invalid and implicit route configuration %j", (override) => {
    expect(() => createSemanticGateway({ ...config, ...override }, async () => success)).toThrow("Invalid semantic gateway configuration");
  });

  it.each([
    { ...input, text: "a".repeat(1_801) },
    { ...input, text: "password=secret" },
    { ...input, text: "/connect connection-code" },
    { ...input, ownerId: "do-not-send" },
    { ...input, referenceLocalDate: "not-a-date" },
    { ...input, previousContext: { transcript: "do-not-send" } },
  ])("rejects invalid or sensitive semantic input before preparing dispatch %#", (badInput) => {
    const transport = vi.fn(async () => success);
    expect(createSemanticGateway(config, transport).prepare("FREE_PRIMARY", badInput as SemanticInput))
      .toMatchObject({ status: "FAILURE", category: "INVALID_INPUT" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("bounds serialized context, prompt and schema together against the input token ceiling", () => {
    expect(createSemanticGateway({ ...config, maxInputTokens: 100 }, async () => success)
      .prepare("FREE_PRIMARY", input)).toMatchObject({ status: "FAILURE", category: "INVALID_INPUT" });
  });

  it("uses only bounded prior semantic slots and keeps receipt time intact", async () => {
    const requests: SemanticJsonRequest[] = [];
    const previousContext = { targetIntent: "CREATE_REMINDER" as const, title: "Việc", localDate: "2026-09-16",
      localTime: null, missingFields: ["time" as const] };
    const attempt = createSemanticGateway(config, async (request) => { requests.push(request); return success; })
      .prepare("FREE_PRIMARY", { ...input, previousContext });
    if (attempt.status !== "READY") throw new Error("Expected prepared attempt");
    await attempt.dispatch();
    expect(JSON.parse(requests[0].messages[1].content)).toEqual({ ...input, previousContext });
  });

  it("aborts and returns timeout even if the injected transport ignores cancellation", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const transport = vi.fn((_request: SemanticJsonRequest, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise<never>(() => {});
    });
    const attempt = createSemanticGateway(config, transport).prepare("FREE_PRIMARY", input);
    if (attempt.status !== "READY") throw new Error("Expected prepared attempt");
    const pending = attempt.dispatch();
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ status: "FAILURE", category: "TIMEOUT" });
    expect(signal?.aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ status: 200, body: "", oversized: true }, "SCHEMA_INVALID"],
    [{ status: 200, body: "a".repeat(20_001) }, "SCHEMA_INVALID"],
    [{ status: 200, body: "{}" }, "SCHEMA_INVALID"],
    [{ status: 200, body: JSON.stringify({ choices: [{ message: { content: "not JSON" }, finish_reason: "stop" }] }) }, "INVALID_JSON"],
    [{ status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"intent":"HELP"}', tool_calls: [{}] }, finish_reason: "stop" }] }) }, "SCHEMA_INVALID"],
    [{ status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"intent":"HELP"}' }, finish_reason: "length" }] }) }, "SCHEMA_INVALID"],
  ])("rejects malformed, excessive or tool output with a safe category %#", async (providerResponse, category) => {
    const attempt = createSemanticGateway(config, async () => providerResponse).prepare("FREE_PRIMARY", input);
    if (attempt.status !== "READY") throw new Error("Expected prepared attempt");
    expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE", category });
  });

  it.each([-1, NaN, 1, "0.00005"]) ("ignores unsafe or above-reservation provider cost %j", async (cost) => {
    const attempt = createSemanticGateway(config, async () => ({ status: 200, body: JSON.stringify({
      choices: [{ message: { content: JSON.stringify(modelHelp) }, finish_reason: "stop" }],
      usage: { cost, prompt_tokens: 100, completion_tokens: 20 },
    }) })).prepare("CHEAP_PAID_FALLBACK", input);
    if (attempt.status !== "READY") throw new Error("Expected prepared attempt");
    expect(await attempt.dispatch()).toMatchObject({ status: "SUCCESS", usage: { costMicrounits: null } });
  });
});
