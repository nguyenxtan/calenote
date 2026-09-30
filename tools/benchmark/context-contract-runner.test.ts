// @vitest-environment node
import { expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as runner from "./context-contract-runner";
import { frozenContextProposal } from "./context-contract-fixtures";
import { readCampaignLedger } from "./context-contract-live";
import { preflightContextCampaign, admitFutureLiveIntent } from "./context-contract-live";
import type { ContextInput } from "../../src/modules/conversation/context-contract/contracts";
import { admitCanonicalCampaign, type ContextManifest } from "./context-contract";
import { createContextHttpTransport } from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway";
import { encodeGoogleLiteEuContext } from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";

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
      providerWireSchemaDigest: "34a2db96789c895f297b935d760f80a3ff5c4746ef8cc4e98feafcc7a88655b9",
      providerWireSchemaVersion: "google-gemini-2.5-flash-lite-vertex-eu-context-flat-2" });
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
