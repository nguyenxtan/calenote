import { afterEach, expect } from "vitest";
import { fixture } from "./infrastructure/d1/test-support";
import { createD1ContextRuntimeStoreV3 } from "./runtime-store";
import { createContextContractService, type ContextContractServiceDependencies } from "./service";
import { createContextContractGateway } from "@/modules/intelligence/infrastructure/openrouter/semantic-gateway";
import { D1SemanticBudgetStore } from "@/modules/semantic/infrastructure/d1/budget-store";
import { D1SemanticReminderQueryStore } from "@/modules/reminders/infrastructure/d1/semantic-query-store";
import { lunarCalendar } from "../lunar-calendar";
import { serializeContextRequest } from "./wire";
import { chat, message } from "./context-test-fixtures";
import { date, time } from "./resolution-test-support";
import type { ContextInput } from "./contracts";
import type { ReadyReplyPlan, ReplyReceipt } from "./responses";
import type { ContextObservationEvent } from "./observability";
import { CONTEXT_PROTOCOL_V3 } from "./protocol";
import { createD1ContextContractStoreV3 } from "./infrastructure/d1/store";
import { encodeFixtureV3 } from "../../../../tools/benchmark/context-pointer-fixtures";
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(() => fixtures.splice(0).forEach(f => f.close()));
export async function setup() { const f = await fixture(); fixtures.push(f); return f; }
const gatewayConfig = { protocol: CONTEXT_PROTOCOL_V3, maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
  primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true, promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } };
export const limits = { ownerDailyFallbackLimit: 50, ownerMonthlyCostMicrounits: 500000, globalDailyCostMicrounits: 2000000, maxInputTokens: 12000, maxOutputTokens: 1536,
  promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000, reservationTtlMs: 300000 };
export type Proposal = (input: ContextInput) => unknown;
// Test-only fixture assembly copies the actual projected request into T6's
// declarative script. It never evaluates a domain result or calls a transport.
export function scriptedGateway(proposals: Proposal[], inputs: ContextInput[], transformWire?: (wire:unknown)=>unknown) {
  return { prepare(tier: "PRIMARY" | "FREE_PRIMARY" | "CHEAP_PAID_FALLBACK", input: ContextInput) {
    inputs.push(structuredClone(input));
    const value = proposals.shift()?.(input);
    const request = { model: gatewayConfig.primary.model, ...serializeContextRequest(input), provider: {
      only: [gatewayConfig.primary.provider], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true, max_price: { prompt: 0.1, completion: 0.4 } } };
    return createContextContractGateway(gatewayConfig, { kind: "OFFLINE_FIXTURE", exchanges: [{ requestJson: JSON.stringify(request),
      admission: { fullInputTokens: 12000, billableOverheadMicrounits: 0 }, response: { status: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(transformWire?transformWire(encodeFixtureV3(value,input)):encodeFixtureV3(value,input)) }, finish_reason: "stop" }] }) } }] }).prepare(tier, input);
  } };
}
export function proposal(values: Record<string, unknown>, target: "NEW" | "CURRENT" = "NEW", guidance: unknown = null, reply: unknown = null, replacements: string[] = []): Proposal {
  return input => ({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: target, evidence: [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }] },
    changes: Object.entries(values).map(([field, value]) => ({ field, value, operation: replacements.includes(field) ? "REPLACE" : "SET", evidence: [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }] })),
    query: null, uncertainties: [], conversationDirective: guidance, replyProposal: reply });
}
export async function harness(proposals: Proposal[], transformWire?: (wire:unknown)=>unknown) {
  const original = await setup(), f = { ...original, store: { ...createD1ContextContractStoreV3({ db: original.db, keyring: original.keyring, protocol: CONTEXT_PROTOCOL_V3 }) } }, inputs: ContextInput[] = [], events: ContextObservationEvent[] = [], replies: ReadyReplyPlan[] = [];
  let index = 0, delivery: ReplyReceipt = { status: "SENT", messageRef: "provider-ref" };
  const deps: ContextContractServiceDependencies = { store: f.store, runtimeStore: createD1ContextRuntimeStoreV3({ db: f.db, keyring: f.keyring, protocol: CONTEXT_PROTOCOL_V3 }), gateway: scriptedGateway(proposals, inputs, transformWire),
    budgetStore: new D1SemanticBudgetStore(f.db, limits), keyring: f.keyring, calendar: lunarCalendar, now: () => f.scope(index).now,
    channel: "TELEGRAM", mode: "OFFLINE_FIXTURE", sourceSha: "3cc856535dcdc8da4bf21cd27b9f7958b3c458d9",
    list: input => new D1SemanticReminderQueryStore(f.db).listContext(input), observe: e => events.push(e),
    reply: async plan => {
      if (plan.status !== "READY") throw new Error("unrenderable");
      const state = await f.db.prepare("SELECT state FROM inbound_updates WHERE id=?").bind(f.scope(index).sourceInboundId).first("state");
      expect(state).toBe("PROCESSED");
      replies.push(plan); return delivery;
    } };
  const service = createContextContractService(deps);
  const turn = async (i: number, text = "nhắc đi thi ngày 11/10/2026 lúc 8h ở Quang Trung nhớ giấy tờ") => {
    index = i; const scope = f.scope(i);
    const rowid = await f.db.prepare("SELECT rowid FROM inbound_updates WHERE id=?").bind(scope.sourceInboundId).first<number>("rowid");
    return service.handle({ ...message(text), id: scope.sourceInboundId, receivedAt: scope.now, claimMarker: scope.claimMarker }, { ...chat, inboundRowId: rowid! });
  };
  const read = async (i: number) => { const observed = await f.store.observe(f.scope(i)); if ("failure" in observed) throw new Error(observed.failure); return observed.snapshot; };
  return { f, deps, inputs, events, replies, service, turn, read, setIndex: (i: number) => { index = i; }, setDelivery: (receipt: ReplyReceipt) => { delivery = receipt; } };
}
export const complete = { title: "đi thi", reminderDate: date(8, 10, 2026), reminderTime: time() };
// Authored independently from the proposal: complete reminder date is 8/10;
// the generic harness default remains 11/10 for explicit event-date fixtures.
export const completeText = "nhắc đi thi ngày 8/10/2026 lúc 8h ở Quang Trung nhớ giấy tờ";
