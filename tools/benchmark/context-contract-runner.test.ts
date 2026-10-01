// @vitest-environment node
import { expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import * as runner from "./context-contract-runner";
import { frozenContextProposal } from "./context-contract-fixtures";
import { readCampaignLedger } from "./context-contract-live";
import * as liveAuthority from "./context-contract-live";
import { preflightContextCampaign, admitFutureLiveIntent } from "./context-contract-live";
import type { ContextInput } from "../../src/modules/conversation/context-contract/contracts";
import { admitCanonicalCampaign, type ContextManifest } from "./context-contract";
import { createContextHttpTransport } from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway";
import { encodeGoogleLiteEuContext, parseGoogleLiteEuContextSections } from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";

it("source-bound R02 continuation preserves the stopped R01 ledger and dispatches R02 first", async () => {
  const previous = mkdtempSync(join(tmpdir(), "context-prefix-old-")), next = mkdtempSync(join(tmpdir(), "context-prefix-new-"));
  try {
    let priorCalls = 0;
    const source = preflightContextCampaign({ root: process.cwd() });
    const prior = await runner.executeObservableCampaign({ directory: previous, sourceSha: source.sourceSha, provenanceDigest: source.provenanceDigest, runId: "prefix",
      profile: "PILOT", cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, now: () => 100,
      transport: async request => {
        const n = priorCalls++;
        const context = JSON.parse(request.messages[1].content) as ContextInput;
        const proposal = n < 2 ? encodeGoogleLiteEuContext(frozenContextProposal(context, "R01", n)) : { schemaVersion: "wrong" };
        const body = JSON.stringify({ model: request.model, provider: "Google", id: "gen-synthetic-prefix", usage: { cost: .001, prompt_tokens: 100, completion_tokens: 100 },
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(proposal) } }] });
        return { status: 200, body, rawResponseBytes: new TextEncoder().encode(body).byteLength };
      } });
    expect(prior.applicationLlmCalls).toBe(3);
    expect(prior.applicationEvidence.slice(0, 2).map(t => t.oracle)).toEqual(["PASS", "PASS"]);
    expect(prior.applicationEvidence[1]).toMatchObject({ queryRange: { start: 1788195600000, end: 1790787600000 }, listStoreReads: 1 });
    expect(prior.responses[0]).toMatchObject({ fixtureId: "R01", turnIndex: 0, status: "SUCCESS", httpStatus: 200,
      provider: { model: "google/gemini-2.5-flash-lite", provider: "Google" }, usage: { promptTokens: 100, completionTokens: 100 }, rawResponseBytes: expect.any(Number) });
    expect(readCampaignLedger(previous).at(-1)).toMatchObject({ event: "STOP", reason: "PROVIDER_ADMISSION_FAILED" });
    expect(readCampaignLedger(previous).some(row => row.event === "CANARY_PASS")).toBe(true);
    const before = readFileSync(join(previous, "campaign.jsonl"), "utf8");
    const hash = (file: string) => createHash("sha256").update(readFileSync(join(previous, file))).digest("hex");
    const pilotPrefix = { directory: previous, ledgerHash: readCampaignLedger(previous).at(-1)!.hash,
      responseDigest: hash("responses.json"), applicationDigest: hash("application-evidence.json") };
    let calls = 0;
    const result = await runner.executeObservableCampaign({ directory: next, sourceSha: source.sourceSha, provenanceDigest: source.provenanceDigest, runId: "suffix",
      profile: "PILOT", cumulativeAuthorizedMicrounits: 1400000, cumulativeRetainedMicrounits: 0, now: () => 100,
      pilotPrefix,
      transport: async request => {
        calls++;
        expect(JSON.parse(request.messages[1].content).turns.at(-1).text).toBe("Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.");
        return { status: 400, body: "{}" };
      } });
    expect(calls).toBe(1);
    expect(result.responses[0]).toMatchObject({ fixtureId: "R02", turnIndex: 0 });
    expect(result).toMatchObject({ pilotPrefix: { scripts: 1, turns: 2, sourceSha: source.sourceSha }, status: "STOP" });
    expect(readFileSync(join(previous, "campaign.jsonl"), "utf8")).toBe(before);
    await expect(runner.executeObservableCampaign({ directory: mkdtempSync(join(next, "bad-")), sourceSha: source.sourceSha, provenanceDigest: source.provenanceDigest,
      runId: "bad", profile: "FULL", cumulativeAuthorizedMicrounits: 1000000, cumulativeRetainedMicrounits: 0, now: () => 100,
      pilotPrefix: { ...pilotPrefix, ledgerHash: "0".repeat(64) }, transport: async () => { throw new Error("MUST_NOT_DISPATCH"); } })).rejects.toThrow("INVALID_PILOT_PREFIX");
    for (const key of ["ledgerHash", "responseDigest", "applicationDigest"] as const) {
      await expect(runner.executeObservableCampaign({ directory: mkdtempSync(join(next, "tamper-")), sourceSha: source.sourceSha, provenanceDigest: source.provenanceDigest,
        runId: "tamper", profile: "PILOT", cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0,
        pilotPrefix: { ...pilotPrefix, [key]: "0".repeat(64) }, transport: async () => { throw new Error("MUST_NOT_DISPATCH"); } })).rejects.toThrow("INVALID_PILOT_PREFIX");
    }
    const responsePath = join(previous, "responses.json"), originalResponses = readFileSync(responsePath, "utf8");
    const relabelled = JSON.parse(originalResponses);
    for (const response of relabelled.slice(0, 2)) response.providerWireSchemaVersion = "wire-relabelled";
    writeFileSync(responsePath, JSON.stringify(relabelled));
    await expect(runner.executeObservableCampaign({ directory: mkdtempSync(join(next, "relabel-")), sourceSha: source.sourceSha,
      provenanceDigest: source.provenanceDigest, runId: "relabel", profile: "PILOT", cumulativeAuthorizedMicrounits: 1500000,
      cumulativeRetainedMicrounits: 0, now: () => 100, pilotPrefix: { ...pilotPrefix, responseDigest: hash("responses.json") },
      transport: async () => { throw new Error("MUST_NOT_DISPATCH"); } })).rejects.toThrow("INVALID_PILOT_PREFIX_RESPONSE");
    writeFileSync(responsePath, originalResponses);
    const manifest: ContextManifest = { version: "context-contract-corpus-1", cases: ["regressions", "development", "heldout"].flatMap(name =>
      (JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`, "utf8")) as ContextManifest).cases) };
    const healthy = admitCanonicalCampaign(manifest, "PILOT").slice(1).flatMap(script => script.turns.flatMap((turn, index) => turn.model === "HEALTHY" ? [{ id: script.executionId, index }] : []));
    let suffixCalls = 0;
    const completedDirectory = join(next, "PILOT"); mkdirSync(completedDirectory);
    const completed = await runner.executeObservableCampaign({ directory: completedDirectory, sourceSha: source.sourceSha,
      provenanceDigest: source.provenanceDigest, runId: "complete", profile: "PILOT", cumulativeAuthorizedMicrounits: 1500000,
      cumulativeRetainedMicrounits: 0, now: () => 100, pilotPrefix, transport: async request => {
        const item = healthy[suffixCalls++], context = JSON.parse(request.messages[1].content) as ContextInput;
        return { status: 200, body: JSON.stringify({ model: request.model, provider: "Google", id: `gen-suffix-${suffixCalls}`,
          usage: { cost: .001, prompt_tokens: 100, completion_tokens: 100 }, choices: [{ finish_reason: "stop",
            message: { content: JSON.stringify(encodeGoogleLiteEuContext(frozenContextProposal(context, item.id, item.index))) } }] }) };
      } });
    expect(completed).toMatchObject({ status: "PASS", measuredScope: "R02_ONWARD", compositePilotScripts: 32,
      applicationLlmCalls: 74, providerHttpRequests: 74, score: { gate: "PASS", plannedScripts: 31, passedScripts: 31, plannedTurns: 82 } });
    expect(completed.responses.map(r => `${r.fixtureId}:${r.turnIndex}`)).toEqual(healthy.map(t => `${t.id}:${t.index}`));
    expect(readFileSync(join(previous, "campaign.jsonl"), "utf8")).toBe(before);
    const complete = readCampaignLedger(completedDirectory).at(-1)!;
    const authorizationPath = join(next, "full-authority.json");
    writeFileSync(authorizationPath, JSON.stringify({ version: "context-contract-live-2", method: "OBSERVABLE_CANARY", campaignRoot: next,
      pilotLedgerHash: complete.hash, sourceSha: source.sourceSha, provenanceDigest: source.provenanceDigest, profile: "FULL", runId: "full",
      approvedAt: 100, expiresAt: 1000, cumulativeAuthorizedMicrounits: 1000000, cumulativeRetainedMicrounits: completed.retainedMicrounits }));
    const intent = { root: process.cwd(), enableLive: true, authorizationPath, profile: "FULL" as const, runId: "full", now: 101 };
    expect(admitFutureLiveIntent(intent)).toMatchObject({ profile: "FULL" });
    const prefixProofPath = join(completedDirectory, "pilot-prefix-proof.json");
    const proofText = readFileSync(prefixProofPath, "utf8");
    writeFileSync(prefixProofPath, "{}");
    expect(() => admitFutureLiveIntent(intent)).toThrow("PILOT_PREFIX_PROOF_CHANGED");
    writeFileSync(prefixProofPath, proofText);
  } finally { rmSync(previous, { recursive: true, force: true }); rmSync(next, { recursive: true, force: true }); }
});

it("discards inactive padding through R01 and persists actual reads/mutations before a later pilot stop", async () => {
  const directory = mkdtempSync(join(tmpdir(), "context-r01-turn-evidence-")); let calls = 0;
  try {
    const result = await runner.executeObservableCampaign({ directory, sourceSha: "a".repeat(40), provenanceDigest: "b".repeat(64), runId: "turn-evidence",
      profile: "PILOT", cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, now: () => 100,
      transport: async request => {
        const index = calls++;
        if (index >= 2) return { status: 400, body: '{"error":{"code":400}}' };
        const context = JSON.parse(request.messages[1].content) as ContextInput;
        const wire = encodeGoogleLiteEuContext(frozenContextProposal(context, "R01", index)) as { query: Record<string, unknown>; conversationDirective: Record<string, unknown> };
        wire.query.date = { calendar: "GREGORIAN", kind: "CONTEXT_FACT", ref: "f999" };
        wire.conversationDirective.topic = "PRIVATE_INACTIVE_PADDING_SENTINEL";
        if (wire.query.period) (wire.query.period as Record<string, unknown>).date = { calendar: "GREGORIAN" };
        return { status: 200, body: JSON.stringify({ model: request.model, provider: "Google", id: `gen-r01-${index}`, usage: { cost: .001, prompt_tokens: 100, completion_tokens: 100 },
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(wire) } }] }) };
      } });
    expect(result).toMatchObject({ status: "STOP", score: null, applicationLlmCalls: 3, providerHttpRequests: 3 });
    const text = readFileSync(join(directory, "application-evidence.json"), "utf8");
    const turns = JSON.parse(text);
    expect(turns.slice(0, 2)).toMatchObject([
      { fixtureId: "R01", turnIndex: 0, status: "CLARIFICATION_REQUESTED", fullSchemaValid: true, pendingField: "queryRange", listStoreReads: 0, mutations: 0, queryRange: null, oracle: "PASS" },
      { fixtureId: "R01", turnIndex: 1, status: "REMINDERS_LISTED", fullSchemaValid: true, pendingField: null, listStoreReads: 1, mutations: 0, queryRange: { start: Date.parse("2026-08-31T17:00:00Z"), end: Date.parse("2026-09-30T17:00:00Z") }, oracle: "PASS" },
    ]);
    expect(turns[0].downstreamDiagnostics.map((d: { stage: string }) => d.stage)).toEqual(["CANONICAL", "LIST_RANGE", "EVIDENCE", "PATCH", "MERGE", "QUERY_RESOLUTION", "QUERY_RANGE", "DIRECTIVE", "TRANSITION", "REPLY"]);
    expect(turns[0].downstreamDiagnostics).toContainEqual({ stage: "QUERY_RESOLUTION", result: "CLARIFY", reason: "MISSING_RANGE" });
    expect(turns[1].downstreamDiagnostics).toContainEqual({ stage: "LIST_RANGE", result: "SUPPORTED", reason: "NONE", candidateRange: "MONTH", field: "queryRange" });
    expect(text.length).toBeLessThan(8000);
    for (const privateText of ["Có lịch nào ko?", "Tháng này có lịch gì ko?", "selectedText", "replyProposal", "evidence", "quote", "SYNTHETIC_CREDENTIAL"]) expect(text).not.toContain(privateText);
    expect(JSON.parse(readFileSync(join(directory, "report.json"), "utf8")).applicationEvidence).toEqual(turns);
    for (const response of result.responses.slice(0, 2)) expect(response).not.toHaveProperty("canonicalValidationDiagnostics");
    expect(readFileSync(join(directory, "responses.json"), "utf8")).not.toContain("PRIVATE_INACTIVE_PADDING_SENTINEL");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.each([
  ["title", "INVALID", "operation"], ["location", "INVALID", "operation"], ["notes", undefined, "operation"],
  ["INVALID", "SET", "field"], [undefined, "SET", "field"], ["title", "CLEAR_BAD", "operation"],
] as const)("wire discriminant failure uses closest schema branch for field=%s operation=%s", (field, operation, expectedPath) => {
  const raw = encodeGoogleLiteEuContext({ schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", dialogueAct: "NEW_REQUEST", continuation: "NO",
    query: null, uncertainties: [], controlEvidence: [], conversationDirective: { kind: "ASK_FOR_FIELD", field: "reminderTime" }, replyProposal: null,
    changes: [{ field: "title", operation: "SET", value: "synthetic", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "synthetic", occurrence: 1 }] }] }) as { changes: Array<Record<string, unknown>> };
  if (field === undefined) delete raw.changes[0].field; else raw.changes[0].field = field;
  if (operation === undefined) delete raw.changes[0].operation; else raw.changes[0].operation = operation;
  let diagnostics: unknown;
  expect(parseGoogleLiteEuContextSections(raw, undefined, value => { diagnostics = value; }).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject({ issues: [expect.objectContaining({ path: ["changes", 0, expectedPath], expected: "CONTROL_ENUM" })] });
});

it.each(["operation-invalid", "operation-missing", "missing", "primitive", "unexpected-key", "nested-evidence", "guidance", "core", "oversized"])("canonical %s diagnostics survive gateway and strict runner without payload leaks", async mode => {
  const directory = mkdtempSync(join(tmpdir(), "context-canonical-diagnostics-"));
  const sentinel = "PRIVATE_MODEL_KEY_AND_VALUE_SENTINEL";
  try {
    const result = await runner.executeObservableCampaign({ directory, sourceSha: "a".repeat(40), provenanceDigest: "b".repeat(64), runId: "test",
      profile: "PILOT", cumulativeAuthorizedMicrounits: 650000, cumulativeRetainedMicrounits: 0, now: () => 100,
      transport: async request => {
        const input = JSON.parse(request.messages[1].content) as ContextInput;
        const wire = encodeGoogleLiteEuContext(frozenContextProposal(input, "R01", 0)) as Record<string, unknown>;
        if (mode.startsWith("operation-")) {
          const changed = encodeGoogleLiteEuContext({ ...frozenContextProposal(input, "R01", 0) as object, intent: "CREATE_REMINDER", query: null, uncertainties: [], changes: [{ field: "title", operation: "SET", value: "synthetic", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: input.turns[0].text, occurrence: 1 }] }] }) as { changes: Array<Record<string, unknown>> };
          wire.changes = changed.changes;
          if (mode === "operation-invalid") changed.changes[0].operation = sentinel; else delete changed.changes[0].operation;
        }
        else if (mode === "guidance") wire.replyProposal = { text: sentinel, [sentinel]: sentinel };
        else if (mode === "missing") delete wire.intent;
        else if (mode === "unexpected-key") wire[sentinel] = sentinel;
        else if (mode === "nested-evidence") ((wire.query as { evidence: Array<Record<string, unknown>> }).evidence[0]).occurrence = sentinel;
        else wire.intent = sentinel;
        return { status: 200, ...(mode === "oversized" ? { oversized: true } : {}), body: mode === "oversized" ? sentinel.repeat(4000) : JSON.stringify({ model: request.model, provider: "Google", id: "gen-canonical-test",
          usage: { cost: .001, prompt_tokens: 100, completion_tokens: 100 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(mode === "primitive" ? 42 : wire) } }] }) };
      } });
    expect(result).toMatchObject({ status: "STOP", applicationLlmCalls: 1, providerHttpRequests: 1 });
    expect(result.responses[0]).toHaveProperty("canonicalValidationDiagnostics");
    const artifact = readFileSync(join(directory, "responses.json"), "utf8");
    expect(artifact).not.toContain(sentinel);
    expect(artifact.length).toBeLessThan(14000);
    if (mode !== "oversized") expect(artifact).toMatch(/payloadSha256/);
    if (mode === "missing") expect(result.responses[0].canonicalValidationDiagnostics).toMatchObject({ validation: { issues: [expect.objectContaining({ path: ["intent"], classification: "missing" })] } });
    if (mode === "unexpected-key") expect(result.responses[0].canonicalValidationDiagnostics).toMatchObject({ validation: { issues: [expect.objectContaining({ classification: "extra", extraKeyCount: 1 })], unknownTopLevelKeyCount: 1 } });
    if (mode === "primitive") expect(result.responses[0].canonicalValidationDiagnostics).toMatchObject({ validation: { issues: [expect.objectContaining({ path: [], expected: "object", actualType: "number" })] } });
    if (mode.startsWith("operation-")) expect(result.responses[0].canonicalValidationDiagnostics).toMatchObject({ validation: { issues: [expect.objectContaining({ path: ["changes", 0, "operation"], expected: "CONTROL_ENUM", classification: mode === "operation-missing" ? "missing" : "value" })] } });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("isolated R01 replay seeds encrypted pending LIST offline and dispatches turn two once", async () => {
  expect(runner).toHaveProperty("executeObservableR01Replay", expect.any(Function));
  const directory = mkdtempSync(join(tmpdir(), "context-r01-replay-")); let calls = 0;
  try {
    const result = await runner.executeObservableR01Replay({ directory, sourceSha: "a".repeat(40), provenanceDigest: "b".repeat(64), runId: "replay-test",
      profile: "PILOT", cumulativeAuthorizedMicrounits: 650000, cumulativeRetainedMicrounits: 528605, now: () => 100,
      transport: async request => {
        calls++; const context = JSON.parse(request.messages[1].content) as ContextInput;
        expect(context.currentTurn).toBe(2);
        expect(context.pendingQuestion).toMatchObject({ scope: "QUERY", field: "queryRange" });
        expect(context.turns.filter(turn => turn.role === "USER")).toHaveLength(2);
        expect(context.turns.filter(turn => turn.role === "USER").map(turn => turn.text)).toEqual(["Có lịch nào ko?", "Tháng này có lịch gì ko?"]);
        return { status: 200, body: JSON.stringify({ model: request.model, provider: "Google", id: "gen-replay-test", usage: { cost: .000512, prompt_tokens: 100, completion_tokens: 100 },
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(encodeGoogleLiteEuContext(frozenContextProposal(context, "R01", 1))) } }] }) };
      } });
    expect(result.seedFailure).toBeNull();
    expect(result.seed).toMatchObject({ oracle: "PASS" });
    expect(calls).toBe(1);
    expect(result).toMatchObject({ status: "PASS", replayOnly: true, applicationLlmCalls: 1, providerHttpRequests: 1, offlineSeedExecutions: 1,
      seed: { mode: "OFFLINE_FIXTURE", oracle: "PASS" }, applicationFacts: { listStoreReads: 1, canonicalReminderCount: 0 } });
    const artifact = readFileSync(join(directory, "report.json"), "utf8");
    expect(artifact).not.toContain("tháng này"); expect(artifact).not.toContain("Có những");
    expect(readCampaignLedger(directory).filter(event => event.event === "RESERVE")).toHaveLength(1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it("replay authority rejects missing or changed historical ledger before reading a credential", async () => {
  expect(runner).toHaveProperty("runAuthorizedR01Replay", expect.any(Function));
  expect(liveAuthority).toHaveProperty("admitR01ReplayIntent", expect.any(Function));
  let reads = 0;
  await expect(runner.runAuthorizedR01Replay({ root: process.cwd(), enableLive: true, profile: "PILOT", runId: "test", authorizationPath: "/nonexistent/replay-authority.json", now: 100 }, () => { reads++; return "NEVER_READ"; })).rejects.toThrow();
  expect(reads).toBe(0);
});
it("hash-bound replay authority retains historical FINISH-null holds and rejects accounting or proof drift", () => {
  const root = mkdtempSync(join(tmpdir(), "context-replay-authority-"));
  try {
    const historicalLedgers = [null, null, null, null, null, 6, 4, 366, 357, 512].map((cost, index) => {
      const directory = join(root, `historical-${index}`); mkdirSync(directory);
      liveAuthority.appendCampaignEvent(directory, { event: "BEGIN", runId: "historical", sourceSha: "a".repeat(40), profile: "PILOT", provenanceDigest: "b".repeat(64), cumulativeAuthorizedMicrounits: 650000, cumulativeRetainedMicrounits: 0, startedAt: 10, observableAdmission: true });
      liveAuthority.reserveCampaignCall(directory, { runId: "historical", profile: "PILOT", provenanceDigest: "b".repeat(64), reservationId: "call-1", maximumMicrounits: 105472, now: 10, startedAt: 10 });
      liveAuthority.markCampaignDispatched(directory, { runId: "historical", reservationId: "call-1", at: 10 });
      liveAuthority.finishCampaignCall(directory, { runId: "historical", reservationId: "call-1", at: 11, observedMicrounits: cost });
      if (index === 9) { liveAuthority.settleCampaignCanary(directory, { runId: "historical", at: 12, accepted: true }); liveAuthority.appendCampaignEvent(directory, { event: "STOP", runId: "historical", at: 13, reason: "LATER_APPLICATION_FAILURE" }); }
      return { directory, finalHash: readCampaignLedger(directory).at(-1)!.hash };
    });
    const preflight = preflightContextCampaign({ root: process.cwd() });
    const authorizationPath = join(root, "authorization.json");
    const authorization = { version: "context-contract-r01-replay-1", method: "OBSERVABLE_CANARY", campaignRoot: join(root, "new-replay"),
      sourceSha: preflight.sourceSha, provenanceDigest: preflight.provenanceDigest, profile: "PILOT", runId: "replay", approvedAt: 50, expiresAt: 200,
      cumulativeAuthorizedMicrounits: 650000, cumulativeRetainedMicrounits: 528605, historicalLedgers };
    const intent = { root: process.cwd(), enableLive: true, profile: "PILOT" as const, runId: "replay", now: 100, authorizationPath };
    writeFileSync(authorizationPath, JSON.stringify(authorization));
    expect(liveAuthority.admitR01ReplayIntent(intent)).toMatchObject({ cumulativeRetainedMicrounits: 528605 });
    writeFileSync(authorizationPath, JSON.stringify({ ...authorization, cumulativeRetainedMicrounits: 1245 }));
    expect(() => liveAuthority.admitR01ReplayIntent(intent)).toThrow("INVALID_REPLAY_AUTHORIZATION");
    writeFileSync(authorizationPath, JSON.stringify({ ...authorization, historicalLedgers: historicalLedgers.map((proof, index) => index === 0 ? { ...proof, finalHash: "0".repeat(64) } : proof) }));
    expect(() => liveAuthority.admitR01ReplayIntent(intent)).toThrow("HISTORICAL_LEDGER_MISMATCH");
    writeFileSync(authorizationPath, JSON.stringify({ ...authorization, historicalLedgers: [...historicalLedgers.slice(0, 9), historicalLedgers[0]] }));
    expect(() => liveAuthority.admitR01ReplayIntent(intent)).toThrow("INVALID_HISTORICAL_PROOF");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it("a replay COMPLETE ledger never admits ordinary FULL authority", async () => {
  const root = mkdtempSync(join(tmpdir(), "context-replay-full-fence-")), directory = join(root, "PILOT"); mkdirSync(directory);
  try {
    const preflight = preflightContextCampaign({ root: process.cwd() });
    const replay = await runner.executeObservableR01Replay({ directory, root: process.cwd(), sourceSha: preflight.sourceSha, provenanceDigest: preflight.provenanceDigest, runId: "replay", profile: "PILOT",
      cumulativeAuthorizedMicrounits: 650000, cumulativeRetainedMicrounits: 528605, now: () => 100,
      transport: async request => ({ status: 200, body: JSON.stringify({ model: request.model, provider: "Google", usage: { cost: .000512, prompt_tokens: 100, completion_tokens: 100 },
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(encodeGoogleLiteEuContext(frozenContextProposal(JSON.parse(request.messages[1].content), "R01", 1))) } }] }) }) });
    expect(replay.status).toBe("PASS");
    const authorizationPath = join(root, "full.json");
    writeFileSync(authorizationPath, JSON.stringify({ version: "context-contract-live-2", method: "OBSERVABLE_CANARY", campaignRoot: root, pilotLedgerHash: readCampaignLedger(directory).at(-1)!.hash,
      sourceSha: preflight.sourceSha, provenanceDigest: preflight.provenanceDigest, profile: "FULL", runId: "full", approvedAt: 50, expiresAt: 200, cumulativeAuthorizedMicrounits: 1650000, cumulativeRetainedMicrounits: 512 }));
    expect(() => admitFutureLiveIntent({ root: process.cwd(), enableLive: true, authorizationPath, profile: "FULL", runId: "full", now: 100 })).toThrow("PILOT_PASS_REQUIRED");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it("offline seed oracle failure stops before any replay transport or secret callback", async () => {
  const root = mkdtempSync(join(tmpdir(), "context-replay-seed-fail-")), directory = join(root, "output"); mkdirSync(directory);
  let reads = 0;
  try {
    const target = join(root, "src/modules/conversation/context-contract/benchmark"); mkdirSync(target, { recursive: true });
    for (const name of ["regressions", "development", "heldout"]) {
      const manifest = JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`, "utf8")) as ContextManifest;
      if (name === "regressions") manifest.cases[0].turns[0].expect.contextRevision = 999;
      writeFileSync(join(target, `${name}.json`), JSON.stringify(manifest));
    }
    const result = await runner.executeObservableR01Replay({ directory, root, sourceSha: "a".repeat(40), provenanceDigest: "b".repeat(64), runId: "replay", profile: "PILOT", cumulativeAuthorizedMicrounits: 650000, cumulativeRetainedMicrounits: 528605,
      now: () => 100, transport: async () => { reads++; throw new Error("SECRET_OR_HTTP_MUST_NOT_RUN"); } });
    expect(reads).toBe(0);
    expect(result).toMatchObject({ status: "STOP", applicationLlmCalls: 0, providerHttpRequests: 0, offlineSeedExecutions: 1, seedFailure: { oracle: "FAIL" } });
    expect(readCampaignLedger(directory).some(row => row.event === "RESERVE")).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("runner artifacts exclude reversible known credential and user-text header echoes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "context-runner-encoded-privacy-"));
  try {
    let echoed: string[] = [];
    const result = await runner.executeObservableCampaign({ directory, sourceSha: "a".repeat(40), provenanceDigest: "b".repeat(64), runId: "test",
      profile: "PILOT", cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, now: () => 100,
      transport: createContextHttpTransport("SYNTHETIC_CREDENTIAL", async (_url, init) => {
        const request = JSON.parse(String(init.body)), user = JSON.parse(request.messages[1].content).turns[0].text;
        const hex = Buffer.from(user, "utf8").toString("hex");
        echoed = ["req-53594e5448455449435f43524544454e5449414c", hex];
        return new Response('{"error":{"code":400}}', { status: 400, headers: { "content-type": "application/json",
          "x-request-id": echoed[0], "traceparent": `00-${hex.slice(0, 32).padEnd(32, "0")}-${hex.slice(32).padEnd(16, "0")}-01` } });
      }) });
    expect(result.status).toBe("STOP"); expect(result.applicationLlmCalls).toBe(1);
    for (const file of ["responses.json", "report.json"]) {
      const artifact = readFileSync(join(directory, file), "utf8");
      for (const value of echoed) expect(artifact).not.toContain(value);
      expect(JSON.parse(artifact)[0]?.failureDiagnostics?.traceId ?? JSON.parse(artifact).responses?.[0]?.failureDiagnostics?.traceId).toBeUndefined();
      expect(artifact).not.toContain("SYNTHETIC_CREDENTIAL");
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("persists only sanitized HTTP failure diagnostics and stops after one synthetic transport call", async () => {
  const directory = mkdtempSync(join(tmpdir(), "context-runner-diagnostics-")); let calls = 0;
  try {
    const result = await runner.executeObservableCampaign({ directory, sourceSha: "a".repeat(40), provenanceDigest: "b".repeat(64), runId: "test",
      profile: "PILOT", cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, now: () => 100,
      transport: createContextHttpTransport("SYNTHETIC_CREDENTIAL", async (_url, init) => {
        calls++; const request = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ error: { code: 400, message: request.messages[1].content,
          metadata: { raw: JSON.stringify({ error: { code: "invalid_argument", param: "response_format.json_schema", message: "Authorization: Bearer SYNTHETIC_CREDENTIAL SYNTHETIC_OWNER_ID" } }) } } }), { status: 400, headers: { "content-type": "application/json" } });
      }) });
    expect(calls).toBe(1); expect(result.status).toBe("STOP");
    expect(result.responses[0]).toMatchObject({ category: "PROVIDER_FAILURE", failureDiagnostics: { httpStatus: 400, errorCode: 400 },
      canonicalSchemaDigest: "8f1b868f606fd39972adc8984666f62960bf6c6f5ad38ff64774997b8765ba2d",
      providerWireSchemaDigest: "5d23f1dae10bb34bf4bfd5e43cec5d5932afe5d4b97511eba2734ff6d8fc3df5",
      providerWireSchemaVersion: "google-gemini-2.5-flash-lite-vertex-eu-context-application-metadata-7" });
    for (const file of ["responses.json", "report.json"]) {
      const artifact = readFileSync(join(directory, file), "utf8");
      expect(artifact).toContain("invalid_argument");
      for (const sentinel of ["SYNTHETIC_CREDENTIAL", "SYNTHETIC_OWNER_ID", "calenote-context-input-1", "turns", "Authorization"]) expect(artifact).not.toContain(sentinel);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.each(["PILOT", "FULL"] as const)("entire %s runner preserves all frozen cases and synthetic R15 without faking HTTP", async profile => {
  const directory = mkdtempSync(join(tmpdir(), "context-runner-")); let calls = 0;
  try {
    const manifest: ContextManifest = { version: "context-contract-corpus-1", cases: ["regressions", "development", "heldout"].flatMap(name =>
      (JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`, "utf8")) as ContextManifest).cases) };
    const healthy = admitCanonicalCampaign(manifest, profile).flatMap(script => script.turns.flatMap((turn, index) => turn.model === "HEALTHY" ? [{ id: script.executionId, index }] : []));
    const result = await runner.executeObservableCampaign({ directory, sourceSha: "a".repeat(40), provenanceDigest: "b".repeat(64), runId: "test",
      profile, cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, now: () => 100,
      transport: async request => {
        const item = healthy[calls++]; const context = JSON.parse(request.messages[1].content) as ContextInput;
        return { status: 200, body: JSON.stringify({ model: request.model, provider: "Google", id: `gen-mock-${calls}`,
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(encodeGoogleLiteEuContext(frozenContextProposal(context, item.id, item.index))) } }],
          usage: { cost: .001, prompt_tokens: 100, completion_tokens: 100 } }) };
      } });
    expect(result.status).toBe("PASS"); expect(result.score?.gate).toBe("PASS");
    expect(result.score?.plannedTurns).toBe(profile === "PILOT" ? 84 : 158);
    expect(calls).toBe(profile === "PILOT" ? 76 : 144);
    expect(result.score?.actualDispatches).toBe(calls); expect(result.providerHttpRequests).toBe(calls);
    expect(result.syntheticFaultControlsPlanned).toBe(1);
    expect(readCampaignLedger(directory).at(-1)).toMatchObject({ event: "COMPLETE", retainedMicrounits: calls * 1000 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 20000);

it.each(["next-fails", "deadline", "application-fails", "counter-fails", "guidance-fails"])("first canary is the actual first case, durably fenced: %s", async mode => {
  const directory = mkdtempSync(join(tmpdir(), "context-runner-")); let calls = 0, clock = 100;
  try {
    const result = await runner.executeObservableCampaign({ directory, sourceSha: "a".repeat(40), provenanceDigest: "b".repeat(64),
      runId: "test", profile: "PILOT", cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, now: () => clock,
      ...(mode === "counter-fails" ? { httpRequestCount: () => 0 } : {}),
      transport: async request => {
        calls++;
        if (calls === 2) expect(readCampaignLedger(directory).some(r => r.event === "CANARY_PASS")).toBe(true);
        const context = JSON.parse(request.messages[1].content) as ContextInput;
        const proposal = frozenContextProposal(context, "R01", 0);
        if (mode === "deadline") clock = 1200100;
        return { status: 200, body: JSON.stringify({ model: calls > 1 ? "wrong" : "google/gemini-2.5-flash-lite", provider: "Google",
          usage: { cost: .001, prompt_tokens: 100, completion_tokens: 100 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(
            mode === "application-fails" ? encodeGoogleLiteEuContext({ ...(proposal as object), query: { ...((proposal as { query: object }).query),
              evidence: [{ kind: "USER_QUOTE", turn: context.currentTurn, quote: "not present in receipt", occurrence: 1 }] } })
              : mode === "guidance-fails" ? { ...(encodeGoogleLiteEuContext(proposal) as object), conversationDirective: { kind: "SAVE" } } : encodeGoogleLiteEuContext(proposal)) } }] }) };
      } });
    expect(result.status).toBe("STOP"); expect(calls).toBe(mode === "next-fails" ? 2 : 1);
    expect(result.routeAdmission).toBe(mode === "next-fails" ? "PASS" : "STOP");
    expect(readCampaignLedger(directory).at(-1)?.event).toBe("STOP");
    if (mode === "guidance-fails") expect(result.responses[0]).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID", usage: { reportedCostUsd: .001, costMicrounits: 1000 } });
    await expect(runner.executeObservableCampaign({ directory, sourceSha: "a".repeat(40), provenanceDigest: "b".repeat(64), runId: "other",
      profile: "PILOT", cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, transport: async () => { throw new Error("restart dispatch"); } })).rejects.toThrow(/ALREADY_STARTED/u);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("offers an isolated observable executor, not a default credentialed path", () => {
  expect(runner).toHaveProperty("executeObservableCampaign", expect.any(Function));
});
it("missing HTTP authority has zero actual fetch count and unknown spend retained", async () => {
  const directory = mkdtempSync(join(tmpdir(), "context-runner-"));
  try {
    const result = await runner.executeObservableCampaign({ directory, sourceSha: "a".repeat(40), provenanceDigest: "b".repeat(64), runId: "test",
      profile: "PILOT", cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, httpRequestCount: () => 0,
      transport: async () => { throw new Error("invalid synthetic credential before fetch"); } });
    expect(result.applicationLlmCalls).toBe(1); expect(result.providerHttpRequests).toBe(0); expect(result.retainedMicrounits).toBe(105472);
    expect(result.status).toBe("STOP");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it("FULL cannot bypass retained pilot proof, and invalid authority never reads credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "context-runner-")); let reads = 0;
  try {
    const preflight = preflightContextCampaign({ root: process.cwd() }), authorizationPath = join(directory, "auth.json");
    writeFileSync(authorizationPath, JSON.stringify({ version: "context-contract-live-2", method: "OBSERVABLE_CANARY", campaignRoot: directory,
      pilotLedgerHash: "b".repeat(64), sourceSha: preflight.sourceSha, provenanceDigest: preflight.provenanceDigest, profile: "FULL", runId: "full",
      approvedAt: 1, expiresAt: 1000, cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 76000 }));
    const intent = { root: process.cwd(), enableLive: true, profile: "FULL" as const, runId: "full", now: 2, authorizationPath };
    expect(() => admitFutureLiveIntent(intent)).toThrow(/PILOT_PASS_REQUIRED/u);
    await expect(runner.runAuthorizedContextCampaign(intent, () => { reads++; return "synthetic"; })).rejects.toThrow(/PILOT_PASS_REQUIRED/u);
    expect(reads).toBe(0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it("owner expiry fences a dispatch independently of frozen receipt clocks", async () => {
  const directory = mkdtempSync(join(tmpdir(), "context-runner-")); let calls = 0;
  try {
    const result = await runner.executeObservableCampaign({ directory, sourceSha: "a".repeat(40), provenanceDigest: "b".repeat(64), runId: "test",
      profile: "PILOT", cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, expiresAt: 100, now: () => 100,
      transport: async () => { calls++; return { status: 500, body: "" }; } });
    expect(calls).toBe(0); expect(result.applicationLlmCalls).toBe(0); expect(result.providerHttpRequests).toBe(0);
    expect(readCampaignLedger(directory).at(-1)).toMatchObject({ event: "STOP", reason: "AUTHORIZATION_EXPIRED" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it("rejects a first failed real response before a second request and retains exact numeric charge", async () => {
  const directory = mkdtempSync(join(tmpdir(), "context-runner-")); let calls = 0;
  try {
    expect(runner).toHaveProperty("executeObservableCampaign", expect.any(Function));
    const result = await runner.executeObservableCampaign({ directory, sourceSha: "a".repeat(40), provenanceDigest: "b".repeat(64),
      runId: "test", profile: "PILOT", cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0,
      now: () => 100, transport: async () => { calls++; return { status: 200, body: JSON.stringify({ model: "wrong", provider: "Google",
        usage: { cost: .0000011, prompt_tokens: 10, completion_tokens: 10 } }), rawResponseBytes: 123 }; } });
    expect(calls).toBe(1); expect(result.status).toBe("STOP");
    expect(result.applicationLlmCalls).toBe(1); expect(result.providerHttpRequests).toBe(1);
    expect(result.responses[0].usage).toMatchObject({ reportedCostUsd: .0000011, costMicrounits: 2 });
    expect(result.responses[0].rawResponseBytes).toBe(123);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
