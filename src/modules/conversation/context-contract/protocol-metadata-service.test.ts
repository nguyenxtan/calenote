// @vitest-environment node
import { expect, it } from "vitest";
import { harness, limits } from "./service-test-support";
import { D1SemanticBudgetStore } from "../../semantic/infrastructure/d1/budget-store";
import { createContextContractGateway } from "../../intelligence/infrastructure/openrouter/semantic-gateway";
import { encodeGoogleLiteEuContext } from "../../intelligence/infrastructure/openrouter/context-provider-wire";
import { frozenContextProposal } from "../../../../tools/benchmark/context-contract-fixtures";
import type { ContextInput } from "./contracts";

it("R02 wire without protocol metadata persists and observes only application-owned versions", async () => {
  const h = await harness([]);
  h.deps.budgetStore = new D1SemanticBudgetStore(h.f.db, { ...limits, reservationInputTokenExposure: 1048576 });
  let requests = 0;
  h.deps.gateway = createContextContractGateway({ maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
    primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true, promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } }, async request => {
    requests++;
    const input = JSON.parse(request.messages[1].content) as ContextInput;
    const proposal = encodeGoogleLiteEuContext(frozenContextProposal(input, "R02", 0));
    expect(proposal).not.toHaveProperty("schemaVersion");
    return { status: 200, body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", provider: "Google", id: "gen-synthetic-protocol",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(proposal) } }], usage: { cost: .0004, prompt_tokens: 2200, completion_tokens: 500 } }) };
  }, { status: "OBSERVABLE_CANARY", advertisedContextTokens: 1048576 });
  const outcome = await h.turn(0, "Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.");
  expect(outcome, JSON.stringify(h.events.map(e => ({ event: e.event, ...("reason" in e ? { reason: e.reason } : {}), ...("diagnostic" in e ? { diagnostic: e.diagnostic } : {}) })))).toEqual({ status: "CLARIFICATION_REQUESTED" });
  expect(requests).toBe(1);
  const state = await h.read(1);
  expect(state).toMatchObject({ schemaVersion: "calenote-context-state-1", modelAttemptBinding: { contractVersion: "calenote-context-2", status: "ACCEPTED" } });
  expect(state?.slots.title.value).toBe("đi thi");
  expect(state?.slots.location.value).toBe("Quang Trung");
  expect(state?.slots.occurrenceCount.value).toBe(2);
  for (const event of h.events) expect(event.contractVersion).toBe("calenote-context-2");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
