// @vitest-environment node
import { expect, it } from "vitest";
import { createConversationGateway, type SemanticJsonRequest } from "../intelligence/infrastructure/openrouter/semantic-gateway";
import { ConversationModelJsonSchema } from "./contracts";
import { CONVERSATION_PROMPT } from "./prompt";

const route = { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true,
  promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 };
const config = { maxInputChars: 1800, maxInputTokens: 24000, maxOutputTokens: 512,
  maxResponseBytes: 20000, timeoutMs: 100, primary: route };
const input = { text: "chào bạn", referenceLocalDate: "2026-09-25", referenceLocalTime: "10:00",
  timezone: "Asia/Ho_Chi_Minh" as const };
const interpretation = { intent: "HELP", title: null, titleState: "NOT_APPLICABLE", targetIntent: null,
  dialogueAct: "GREET", continuation: "NO", capability: null };
const response = (value: unknown) => ({ status: 200, body: JSON.stringify({ choices: [{
  message: { content: JSON.stringify(value) }, finish_reason: "stop" } ] }) });

it("emits the exact reviewed V2 schema/prompt through the pinned one-shot transport", async () => {
  const requests: SemanticJsonRequest[] = [];
  const gateway = createConversationGateway(config, async request => { requests.push(request); return response(interpretation); });
  const attempt = gateway.prepare("PRIMARY", input);
  expect(attempt.status).toBe("READY");
  if (attempt.status !== "READY") throw new Error("not ready");
  expect(await attempt.dispatch()).toMatchObject({ status: "SUCCESS", interpretation });
  expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE" });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toEqual({ model: route.model, stream: false, max_tokens: 512,
    messages: [{ role: "system", content: CONVERSATION_PROMPT }, { role: "user", content: JSON.stringify(input) }],
    response_format: { type: "json_schema", json_schema: { name: "conversation_semantic_interpretation",
      strict: true, schema: ConversationModelJsonSchema } },
    provider: { only: ["google-vertex/eu"], allow_fallbacks: false, require_parameters: true,
      data_collection: "deny", zdr: true, max_price: { prompt: 0.1, completion: 0.4 } } });
});

it.each(["localDate", "time", "sql", "ownerId", "reply"])("rejects injected %s at the real response boundary", async field => {
  const attempt = createConversationGateway(config, async () => response({ ...interpretation, [field]: "forbidden" }))
    .prepare("PRIMARY", input);
  if (attempt.status !== "READY") throw new Error("not ready");
  expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
});

it("cannot dispatch fallback tiers or a non-ZDR conversation route", () => {
  const gateway = createConversationGateway(config, async () => { throw new Error("unexpected network"); });
  expect(gateway.prepare("FREE_PRIMARY", input).status).toBe("FAILURE");
  expect(gateway.prepare("CHEAP_PAID_FALLBACK", input).status).toBe("FAILURE");
  expect(() => createConversationGateway({ ...config, primary: { ...route, requireZdr: false } }, async () => response(interpretation))).toThrow();
});

it("rejects identity fields and secrets in retained user turns before dispatch", () => {
  const gateway = createConversationGateway(config, async () => { throw new Error("unexpected network"); });
  const context = { title: null, turns: [{ userText: "password=do-not-send", outcomeCode: "ASK_DATE" }] };
  expect(gateway.prepare("PRIMARY", { ...input, conversationContext: context }).status).toBe("FAILURE");
  expect(gateway.prepare("PRIMARY", { ...input, conversationContext: { title: null, ownerId: "private", turns: [] } }).status).toBe("FAILURE");
});

it("keeps safe bounded conversation context in user data only", async () => {
  const requests: SemanticJsonRequest[] = [];
  const conversationContext = { title: "ôn thi", turns: [{ userText: "thi ở Quang Trung", outcomeCode: "ASK_TIME" }] };
  const attempt = createConversationGateway(config, async request => { requests.push(request); return response(interpretation); })
    .prepare("PRIMARY", { ...input, conversationContext });
  if (attempt.status !== "READY") throw new Error("not ready");
  await attempt.dispatch();
  expect(JSON.parse(requests[0].messages[1].content)).toEqual({ ...input, conversationContext });
  expect(requests[0].messages[0].content).not.toContain("Quang Trung");
});
