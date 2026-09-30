// @vitest-environment node
import { expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { admitFutureLiveIntent, appendCampaignEvent, computeContextSourceFreeze, finishCampaignCall, markCampaignDispatched, preflightContextCampaign, readCampaignLedger, reserveCampaignCall } from "./context-contract-live";
import * as live from "./context-contract-live";

it("known actual charges release financial exposure while uncertain dispatches stop the observable campaign", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-observable-ledger-"));
  try {
    const begin = { event: "BEGIN" as const, runId: "one", sourceSha: "a".repeat(40), profile: "PILOT" as const,
      provenanceDigest: "b".repeat(64), cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, startedAt: 0, observableAdmission: true };
    appendCampaignEvent(dir, begin);
    const reserve = (n: number) => reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest: begin.provenanceDigest,
      reservationId: `r${n}`, maximumMicrounits: 105472, now: n, startedAt: 0 });
    expect(reserve(1).status).toBe("RESERVED"); markCampaignDispatched(dir, { runId: "one", reservationId: "r1", at: 1 });
    finishCampaignCall(dir, { runId: "one", reservationId: "r1", at: 1, observedMicrounits: 1000 });
    expect(live).toHaveProperty("settleCampaignCanary", expect.any(Function));
    live.settleCampaignCanary(dir, { runId: "one", at: 1, accepted: true });
    for (let n = 2; n <= 8; n++) {
      expect(reserve(n).status).toBe("RESERVED"); markCampaignDispatched(dir, { runId: "one", reservationId: `r${n}`, at: n });
      finishCampaignCall(dir, { runId: "one", reservationId: `r${n}`, at: n, observedMicrounits: n === 8 ? null : 1000 });
    }
    expect(() => reserve(9)).toThrow(/STOPPED|UNKNOWN/u);
    expect(readCampaignLedger(dir).at(-1)).toMatchObject({ event: "STOP", reason: "UNKNOWN_USAGE" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it.each(["in-flight", "failed"])("observable canary %s cannot authorize a second call or restart", state => {
  const dir = mkdtempSync(join(tmpdir(), "context-observable-ledger-"));
  try {
    const digest = "b".repeat(64);
    appendCampaignEvent(dir, { event: "BEGIN", runId: "one", sourceSha: "a".repeat(40), profile: "PILOT", provenanceDigest: digest,
      cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, startedAt: 0, observableAdmission: true });
    const r = { runId: "one", profile: "PILOT" as const, provenanceDigest: digest, reservationId: "r1", maximumMicrounits: 105472, now: 1, startedAt: 0 };
    reserveCampaignCall(dir, r); markCampaignDispatched(dir, { runId: "one", reservationId: "r1", at: 1 });
    if (state === "failed") {
      finishCampaignCall(dir, { runId: "one", reservationId: "r1", at: 2, observedMicrounits: 1000 });
      expect(live).toHaveProperty("settleCampaignCanary", expect.any(Function));
      live.settleCampaignCanary(dir, { runId: "one", at: 2, accepted: false });
    }
    expect(() => reserveCampaignCall(dir, { ...r, reservationId: "r2", now: 3 })).toThrow(/CANARY|STOPPED/u);
    expect(readCampaignLedger(dir).at(-1)?.event).toBe("STOP");
    expect(() => appendCampaignEvent(dir, { event: "BEGIN", runId: "new", sourceSha: "a".repeat(40), profile: "FULL", provenanceDigest: digest,
      cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, startedAt: 4 })).toThrow(/ALREADY_STARTED/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it("observed financial overflow is recorded exactly and stops instead of losing actual spend", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-observable-ledger-"));
  try {
    const digest = "b".repeat(64);
    appendCampaignEvent(dir, { event: "BEGIN", runId: "one", sourceSha: "a".repeat(40), profile: "PILOT", provenanceDigest: digest,
      cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, startedAt: 0, observableAdmission: true });
    reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest: digest, reservationId: "r1", maximumMicrounits: 105472, now: 1, startedAt: 0 });
    markCampaignDispatched(dir, { runId: "one", reservationId: "r1", at: 1 });
    expect(finishCampaignCall(dir, { runId: "one", reservationId: "r1", at: 2, observedMicrounits: 105473 })).toMatchObject({ observedMicrounits: 105473 });
    expect(readCampaignLedger(dir).at(-1)).toMatchObject({ event: "STOP", reason: "RESERVATION_EXCEEDED" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("default preflight reads neither credential nor network and refuses unverified route", () => {
  let reads = 0, requests = 0;
  const result = preflightContextCampaign({ root: process.cwd(), readSecret: () => { reads++; return "secret"; }, request: () => { requests++; } });
  expect(result.routeAdmission).toBe("UNVERIFIED");
  expect(result.liveEligible).toBe(false);
  expect(reads).toBe(0);
  expect(requests).toBe(0);
});
it("calendar data, all executed migrations, fixture and loader are frozen and a dirty dependency changes the digest", () => {
  const preflight = preflightContextCampaign({ root: process.cwd() });
  for (const path of ["src/modules/conversation/lunar-vn-months.json", "src/testing/sqlite-d1.test-support.ts",
    "src/modules/reminders/semantic-query.ts",
    "tools/benchmark/register-conversation-loader.mjs", ...Array.from({ length: 9 }, (_, i) => `migrations/${String(i + 1).padStart(4, "0")}_`)]) {
    expect(Object.keys(preflight.digests).some(name => name.startsWith(path)), path).toBe(true);
  }
  const dir = mkdtempSync(join(tmpdir(), "context-contract-freeze-"));
  try {
    const file = "src/modules/conversation/lunar-vn-months.json";
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "[1]");
    const clean = computeContextSourceFreeze(dir, [file]);
    writeFileSync(path, "[2]");
    const dirty = computeContextSourceFreeze(dir, [file]);
    expect(dirty.provenanceDigest).not.toBe(clean.provenanceDigest);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it("campaign reserves worst-case cost before dispatch and cannot cross-resume", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-contract-ledger-"));
  try {
    const basis = { sourceSha: "a".repeat(40), profile: "PILOT" as const, provenanceDigest: "b".repeat(64), cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, startedAt: 0 };
    appendCampaignEvent(dir, { event: "BEGIN", runId: "one", ...basis });
    expect(reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest: basis.provenanceDigest, reservationId: "r1", maximumMicrounits: 1815, now: 1, startedAt: 0 })).toMatchObject({ status: "RESERVED" });
    expect(readFileSync(join(dir, "campaign.jsonl"), "utf8")).toContain('"event":"RESERVE"');
    expect(() => reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest: basis.provenanceDigest, reservationId: "r-reset", maximumMicrounits: 1815, now: 2, startedAt: 2 })).toThrow(/CLOCK_ORIGIN_CHANGED/u);
    expect(() => markCampaignDispatched(dir, { runId: "one", reservationId: "r1", at: 1200000 })).toThrow(/DISPATCH_DEADLINE/u);
    expect(() => reserveCampaignCall(dir, { runId: "two", profile: "FULL", provenanceDigest: basis.provenanceDigest, reservationId: "r2", maximumMicrounits: 1815, now: 2, startedAt: 0 })).toThrow(/CROSS_RESUME/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it("corrupt provenance, crash lock and absent reservation stop dispatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-contract-ledger-"));
  try {
    const basis = { sourceSha: "a".repeat(40), profile: "PILOT" as const, provenanceDigest: "b".repeat(64), cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, startedAt: 0 };
    appendCampaignEvent(dir, { event: "BEGIN", runId: "one", ...basis });
    expect(() => markCampaignDispatched(dir, { runId: "one", reservationId: "missing", at: 1 })).toThrow(/MISSING_OR_DUPLICATE_RESERVATION/u);
    writeFileSync(join(dir, "campaign.lock"), "crashed");
    expect(() => reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest: basis.provenanceDigest, reservationId: "r1", maximumMicrounits: 1815, now: 1, startedAt: 0 })).toThrow(/EEXIST|LOCK/u);
    rmSync(join(dir, "campaign.lock"));
    writeFileSync(join(dir, "campaign.jsonl"), readFileSync(join(dir, "campaign.jsonl"), "utf8").replace('"runId":"one"', '"runId":"two"'));
    expect(() => reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest: basis.provenanceDigest, reservationId: "r1", maximumMicrounits: 1815, now: 1, startedAt: 0 })).toThrow(/LEDGER_PROVENANCE_CORRUPT/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it("pilot stops before 193rd call or cost overrun and never discounts uncertain reservations", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-contract-ledger-"));
  try {
    const digest = "b".repeat(64);
    appendCampaignEvent(dir, { event: "BEGIN", runId: "one", sourceSha: "a".repeat(40), profile: "PILOT", provenanceDigest: digest, cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, startedAt: 0 });
    expect(reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest: digest, reservationId: "r1", maximumMicrounits: 499000, now: 1, startedAt: 0 })).toMatchObject({ status: "RESERVED" });
    expect(reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest: digest, reservationId: "r2", maximumMicrounits: 1815, now: 2, startedAt: 0 })).toMatchObject({ status: "STOPPED", reason: "COST_CAP" });
    expect(() => reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest: digest, reservationId: "r3", maximumMicrounits: 1, now: 1200000, startedAt: 0 })).toThrow(/STOPPED/u);
    expect(readCampaignLedger(dir).at(-1)).toMatchObject({ event: "STOP", reason: "COST_CAP" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it("time cap appends a terminal STOP before any additional reservation", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-contract-ledger-"));
  try {
    const provenanceDigest = "b".repeat(64);
    appendCampaignEvent(dir, { event: "BEGIN", runId: "one", sourceSha: "a".repeat(40), profile: "PILOT", provenanceDigest,
      cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, startedAt: 0 });
    expect(reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest, reservationId: "late", maximumMicrounits: 1, now: 1200000, startedAt: 0 })).toMatchObject({ status: "STOPPED", reason: "TIME_OR_CALL_CAP" });
    expect(readCampaignLedger(dir).map(row => row.event)).toEqual(["BEGIN", "STOP"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it("cap rejection appends a durable terminal STOP and prevents cheaper retry or later dispatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-contract-ledger-"));
  try {
    const provenanceDigest = "b".repeat(64);
    appendCampaignEvent(dir, { event: "BEGIN", runId: "one", sourceSha: "a".repeat(40), profile: "PILOT", provenanceDigest,
      cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, startedAt: 0 });
    expect(reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest, reservationId: "r1", maximumMicrounits: 1, now: 1, startedAt: 0 })).toMatchObject({ status: "RESERVED" });
    markCampaignDispatched(dir, { runId: "one", reservationId: "r1", at: 1 });
    expect(reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest, reservationId: "too-large", maximumMicrounits: 500000, now: 2, startedAt: 0 })).toMatchObject({ status: "STOPPED", reason: "COST_CAP" });
    expect(readCampaignLedger(dir).map(row => row.event)).toEqual(["BEGIN", "RESERVE", "DISPATCH", "STOP"]);
    expect(() => reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest, reservationId: "cheap", maximumMicrounits: 1, now: 3, startedAt: 0 })).toThrow(/STOPPED/u);
    expect(() => markCampaignDispatched(dir, { runId: "one", reservationId: "r1", at: 3 })).toThrow();
    expect(finishCampaignCall(dir, { runId: "one", reservationId: "r1", at: 4, observedMicrounits: null }).event).toBe("FINISH");
    expect(readCampaignLedger(dir).map(row => row.event)).toEqual(["BEGIN", "RESERVE", "DISPATCH", "STOP", "FINISH"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it("one campaign cannot authorize over the combined USD 1.50 ceiling or bypass guarded transitions", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-contract-ledger-"));
  try {
    const begin = { event: "BEGIN" as const, runId: "one", sourceSha: "a".repeat(40), profile: "PILOT" as const,
      provenanceDigest: "b".repeat(64), cumulativeAuthorizedMicrounits: 1500001, cumulativeRetainedMicrounits: 0, startedAt: 0 };
    expect(() => appendCampaignEvent(dir, begin)).toThrow(/INVALID_CUMULATIVE_AUTHORITY/u);
    appendCampaignEvent(dir, { ...begin, cumulativeAuthorizedMicrounits: 1500000 });
    expect(() => appendCampaignEvent(dir, { event: "RESERVE", runId: "one", profile: "PILOT", provenanceDigest: begin.provenanceDigest,
      reservationId: "r1", maximumMicrounits: 1, at: 1 })).toThrow(/USE_GUARDED_CAMPAIGN_TRANSITION/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it("observable live intent requires explicit source-bound authority and a fixed campaign root", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-contract-authorization-"));
  try {
    const preflight = preflightContextCampaign({ root: process.cwd() });
    const authorizationPath = join(dir, "authorization.json");
    const authorization = { version: "context-contract-live-2", method: "OBSERVABLE_CANARY", campaignRoot: dir, pilotLedgerHash: null,
      sourceSha: preflight.sourceSha, provenanceDigest: preflight.provenanceDigest,
      profile: "PILOT", runId: "bounded-run", approvedAt: 1, expiresAt: 1000,
      cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0 };
    writeFileSync(authorizationPath, JSON.stringify(authorization));
    const input = { root: process.cwd(), enableLive: true, authorizationPath, profile: "PILOT" as const, runId: "bounded-run", now: 2 };
    expect(() => admitFutureLiveIntent({ ...input, enableLive: false })).toThrow(/EXPLICIT_ENABLE_REQUIRED/u);
    expect(() => admitFutureLiveIntent({ ...input, profile: "FULL" })).toThrow(/AUTHORIZATION_MISMATCH/u);
    expect(admitFutureLiveIntent(input)).toMatchObject({ campaignRoot: dir, method: "OBSERVABLE_CANARY" });
    writeFileSync(authorizationPath, JSON.stringify({ ...authorization, sourceSha: "a".repeat(40) }));
    expect(() => admitFutureLiveIntent(input)).toThrow(/AUTHORIZATION_MISMATCH/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
