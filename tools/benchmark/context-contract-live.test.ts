// @vitest-environment node
import { expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { admitHistoricalV2IntentReference as admitFutureLiveIntent, appendCampaignEvent, computeContextSourceFreeze, finishCampaignCall, markCampaignDispatched, preflightContextCampaign, readCampaignLedger, reserveCampaignCall } from "./context-contract-live";
import * as live from "./context-contract-live";

function trustedAccount(count = 2, maximum = 500, account: "PILOT" | "FULL" = "PILOT") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "context-trusted-account-"))), old = join(root, "old", account), target = join(root, "fresh", "PILOT");
  mkdirSync(old, { recursive: true }); mkdirSync(target, { recursive: true });
  const provenanceDigest = "b".repeat(64);
  appendCampaignEvent(old, { event: "BEGIN", runId: "old", sourceSha: "a".repeat(40), profile: account, provenanceDigest,
    cumulativeAuthorizedMicrounits: 2500000, cumulativeRetainedMicrounits: 1000, startedAt: 0 });
  for (let i = 0; i < count; i++) {
    reserveCampaignCall(old, { runId: "old", profile: account, provenanceDigest, reservationId: `old-${i}`, maximumMicrounits: maximum, now: i + 1, startedAt: 0 });
    if (count === 2 && i === 1) { markCampaignDispatched(old, { runId: "old", reservationId: `old-${i}`, at: i + 1 }); finishCampaignCall(old, { runId: "old", reservationId: `old-${i}`, at: i + 1, observedMicrounits: 7 }); }
  }
  const preflight = preflightContextCampaign({ root: process.cwd() });
  const record = { version: "context-contract-live-3", method: "OBSERVABLE_CANARY", authorizationId: "synthetic-reviewed-owner", account: "PILOT",
    sourceSha: preflight.sourceSha, provenanceDigest: preflight.provenanceDigest, protocolDigest: preflight.protocolDigest, corpusDigest: preflight.corpusDigest,
    runId: "fresh", approvedAt: 1, startedAt: 2, expiresAt: 2000000,
    priorLedgers: [{ directory: old, finalHash: readCampaignLedger(old).at(-1)!.hash }], pilotLedger: null };
  const authorizationPath = join(root, "owner.json");
  const pin = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const load = (value: unknown = record) => { writeFileSync(authorizationPath, JSON.stringify(value)); return live.createCampaignAuthorizationLoader({ reviewedOwnerRecordSha256: pin(value), accountRoot: root }).load(value, target); };
  const intent = { root: process.cwd(), enableLive: true, authorizationPath, profile: "PILOT" as const, runId: "fresh", now: 3 };
  return { root, old, target, record, intent, load, pin };
}

it("trusted fresh account derives UNKNOWN, known costs and calls without counting inherited BEGIN debt", () => {
  const f = trustedAccount();
  try {
    const capability = f.load(), admitted = live.admitFutureLiveIntent({ ...f.intent, authorizationCapability: capability });
    expect(admitted).toMatchObject({ cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 507, historicalCalls: 2, historicalUnknownReservations: 1, startedAt: 2 });
    appendCampaignEvent(f.target, { ...admitted, event: "BEGIN", observableAdmission: true, expiresAt: 1200002 });
    expect(reserveCampaignCall(f.target, { runId: "fresh", profile: "PILOT", provenanceDigest: admitted.provenanceDigest,
      reservationId: "first", maximumMicrounits: 100, now: 3, startedAt: 2 })).toMatchObject({ status: "RESERVED" });
    expect(() => reserveCampaignCall(f.target, { runId: "fresh", profile: "PILOT", provenanceDigest: admitted.provenanceDigest,
      reservationId: "reset-clock", maximumMicrounits: 1, now: 3, startedAt: 3 })).toThrow("CLOCK_ORIGIN_CHANGED");
    reserveCampaignCall(f.old, { runId: "old", profile: "PILOT", provenanceDigest: "b".repeat(64), reservationId: "late", maximumMicrounits: 1, now: 4, startedAt: 0 });
    expect(() => reserveCampaignCall(f.target, { runId: "fresh", profile: "PILOT", provenanceDigest: admitted.provenanceDigest,
      reservationId: "inventory-changed", maximumMicrounits: 1, now: 4, startedAt: 2 })).toThrow("PRIOR_LEDGER_BINDING");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

it.each(["omitted", "duplicate", "alias", "foreign-profile", "pin", "forged-capability", "corpus", "protocol", "deadline"])("trusted admission fails closed for %s", mode => {
  const f = trustedAccount(2, 500, mode === "foreign-profile" ? "FULL" : "PILOT");
  try {
    if (mode === "omitted") expect(() => f.load({ ...f.record, priorLedgers: [] })).toThrow("PRIOR_LEDGER_INVENTORY");
    else if (mode === "duplicate") expect(() => f.load({ ...f.record, priorLedgers: [...f.record.priorLedgers, ...f.record.priorLedgers] })).toThrow("PRIOR_LEDGER_ALIAS");
    else if (mode === "alias") { symlinkSync(f.old, join(f.root, "alias")); expect(() => f.load()).toThrow("PRIOR_LEDGER_ALIAS"); }
    else if (mode === "foreign-profile") expect(() => f.load()).toThrow("PRIOR_LEDGER_BINDING");
    else if (mode === "pin") expect(() => live.createCampaignAuthorizationLoader({ reviewedOwnerRecordSha256: "a".repeat(64), accountRoot: f.root }).load(f.record, f.target)).toThrow("OWNER_AUTHORIZATION_MISMATCH");
    else if (mode === "forged-capability") expect(() => live.admitFutureLiveIntent({ ...f.intent, authorizationCapability: {} as live.CampaignAuthorization })).toThrow("AUTHORIZATION_NOT_CONFIGURED");
    else {
      const record = { ...f.record, ...(mode === "corpus" ? { corpusDigest: "0".repeat(64) } : mode === "protocol" ? { protocolDigest: "0".repeat(64) } : {}) };
      const capability = f.load(record);
      expect(() => live.admitFutureLiveIntent({ ...f.intent, now: mode === "deadline" ? 1200002 : 3, authorizationCapability: capability })).toThrow("AUTHORIZATION_MISMATCH");
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

it("historical account reservations cannot reset the 192-call ceiling", () => {
  const f = trustedAccount(191, 1);
  try {
    const admitted = live.admitFutureLiveIntent({ ...f.intent, authorizationCapability: f.load() });
    appendCampaignEvent(f.target, { ...admitted, event: "BEGIN", expiresAt: 1200002 });
    const reserve = (reservationId: string) => reserveCampaignCall(f.target, { runId: "fresh", profile: "PILOT", provenanceDigest: admitted.provenanceDigest, reservationId, maximumMicrounits: 1, now: 3, startedAt: 2 });
    expect(reserve("192").status).toBe("RESERVED"); expect(reserve("193")).toMatchObject({ status: "STOPPED", reason: "TIME_OR_CALL_CAP" });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

it("trusted retained costs consume the same account cap in a fresh attempt", () => {
  const f = trustedAccount(1, 1499000);
  try {
    const admitted = live.admitFutureLiveIntent({ ...f.intent, authorizationCapability: f.load() });
    appendCampaignEvent(f.target, { ...admitted, event: "BEGIN", expiresAt: 1200002 });
    expect(reserveCampaignCall(f.target, { runId: "fresh", profile: "PILOT", provenanceDigest: admitted.provenanceDigest,
      reservationId: "over-cap", maximumMicrounits: 1001, now: 3, startedAt: 2 })).toMatchObject({ status: "STOPPED", reason: "COST_CAP" });
    expect(readCampaignLedger(f.target).filter(r => r.event === "RESERVE")).toHaveLength(0);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

it.each(["duplicate-dispatch", "finish-without-dispatch", "foreign-provenance", "dispatch-clock"])("malformed historical %s cannot release UNKNOWN authority even with a valid hash chain", mode => {
  const f = trustedAccount();
  try {
    const rows = JSON.parse(JSON.stringify(readCampaignLedger(f.old))) as Array<Record<string, unknown>>;
    const dispatch = rows.find(row => row.event === "DISPATCH")!;
    if (mode === "duplicate-dispatch") rows.splice(rows.indexOf(dispatch) + 1, 0, { ...dispatch });
    else if (mode === "finish-without-dispatch") rows.splice(rows.indexOf(dispatch), 1);
    else if (mode === "foreign-provenance") rows.find(row => row.event === "RESERVE")!.provenanceDigest = "c".repeat(64);
    else dispatch.at = -1;
    let previousHash = "0".repeat(64);
    const rebound = rows.map((row, i) => {
      const event = { ...row }; delete event.hash; delete event.sequence; delete event.previousHash;
      const body = { ...event, sequence: i + 1, previousHash }, hash = f.pin(body); previousHash = hash; return { ...body, hash };
    });
    writeFileSync(join(f.old, "campaign.jsonl"), rebound.map(row => JSON.stringify(row)).join("\n") + "\n");
    const record = { ...f.record, priorLedgers: [{ directory: f.old, finalHash: previousHash }] };
    expect(() => f.load(record)).toThrow("PRIOR_LEDGER_BINDING");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

it("mixed profile namespace cannot masquerade as a reviewed account-specific root", () => {
  const f = trustedAccount();
  try {
    const other = join(f.root, "foreign", "FULL"); mkdirSync(other, { recursive: true });
    appendCampaignEvent(other, { event: "BEGIN", runId: "foreign", sourceSha: "a".repeat(40), profile: "FULL", provenanceDigest: "b".repeat(64),
      cumulativeAuthorizedMicrounits: 1000000, cumulativeRetainedMicrounits: 0, startedAt: 0 });
    expect(() => f.load({ ...f.record, priorLedgers: [...f.record.priorLedgers, { directory: other, finalHash: readCampaignLedger(other).at(-1)!.hash }] })).toThrow("PRIOR_LEDGER_BINDING");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

it("revised_heldout_data_requires_replacement without modifying original corpus or denominator", () => {
  const manifests = ["regressions", "development", "heldout"].map(name => JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`, "utf8")));
  expect(() => live.validateFrozenContextCorpus(process.cwd(), manifests)).not.toThrow();
  const revised = structuredClone(manifests); revised[2].cases[0].turns[0].text += " changed";
  expect(() => live.validateFrozenContextCorpus(process.cwd(), revised)).toThrow("HELDOUT_REPLACEMENT_REQUIRED");
  const changedOracle = structuredClone(manifests); changedOracle[0].cases[0].turns[0].expect.mutations = 1;
  expect(() => live.validateFrozenContextCorpus(process.cwd(), changedOracle)).toThrow("FROZEN_ORACLES_CHANGED");
});

it("fresh_run_cannot_reset_budget_or_unknown_reservations without trusted owner authority", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-untrusted-fresh-"));
  try {
    const preflight = preflightContextCampaign({ root: process.cwd() });
    const authorizationPath = join(dir, "authorization.json");
    writeFileSync(authorizationPath, JSON.stringify({ version: "context-contract-live-2", method: "OBSERVABLE_CANARY", campaignRoot: dir, pilotLedgerHash: null,
      sourceSha: preflight.sourceSha, provenanceDigest: preflight.provenanceDigest, profile: "PILOT", runId: "fresh", approvedAt: 1, expiresAt: 1000,
      cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0 }));
    expect(() => live.admitFutureLiveIntent({ root: process.cwd(), enableLive: true, authorizationPath, profile: "PILOT", runId: "fresh", now: 2 })).toThrow("AUTHORIZATION_NOT_CONFIGURED");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("prior one-dollar pilot authority retains its own lower boundary after the cap amendment", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-amended-pilot-"));
  try {
    const provenanceDigest = "b".repeat(64);
    appendCampaignEvent(dir, { event: "BEGIN", runId: "amended", sourceSha: "a".repeat(40), profile: "PILOT", provenanceDigest,
      cumulativeAuthorizedMicrounits: 1000000, cumulativeRetainedMicrounits: 0, startedAt: 0 });
    const reserve = (reservationId: string, maximumMicrounits: number) => reserveCampaignCall(dir, {
      runId: "amended", profile: "PILOT", provenanceDigest, reservationId, maximumMicrounits, now: 1, startedAt: 0 });
    expect(reserve("historical-unknown", 634584)).toMatchObject({ status: "RESERVED" });
    expect(reserve("new-authority", 365416)).toMatchObject({ status: "RESERVED" });
    expect(reserve("over-cap", 1)).toMatchObject({ status: "STOPPED", reason: "COST_CAP" });
    expect(readCampaignLedger(dir).filter(row => row.event === "RESERVE")).toHaveLength(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

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
  expect(result.pilot).toMatchObject({ maxMicrounits: 1500000, maxCalls: 192, maxMs: 1200000 });
  expect(result.full).toMatchObject({ maxMicrounits: 1000000, maxCalls: 480, maxMs: 2700000 });
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
    expect(reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest: digest, reservationId: "r1", maximumMicrounits: 1499000, now: 1, startedAt: 0 })).toMatchObject({ status: "RESERVED" });
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
    expect(reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest, reservationId: "too-large", maximumMicrounits: 1500000, now: 2, startedAt: 0 })).toMatchObject({ status: "STOPPED", reason: "COST_CAP" });
    expect(readCampaignLedger(dir).map(row => row.event)).toEqual(["BEGIN", "RESERVE", "DISPATCH", "STOP"]);
    expect(() => reserveCampaignCall(dir, { runId: "one", profile: "PILOT", provenanceDigest, reservationId: "cheap", maximumMicrounits: 1, now: 3, startedAt: 0 })).toThrow(/STOPPED/u);
    expect(() => markCampaignDispatched(dir, { runId: "one", reservationId: "r1", at: 3 })).toThrow();
    expect(finishCampaignCall(dir, { runId: "one", reservationId: "r1", at: 4, observedMicrounits: null }).event).toBe("FINISH");
    expect(readCampaignLedger(dir).map(row => row.event)).toEqual(["BEGIN", "RESERVE", "DISPATCH", "STOP", "FINISH"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it("one campaign cannot authorize over the combined USD 2.50 ceiling or bypass guarded transitions", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-contract-ledger-"));
  try {
    const begin = { event: "BEGIN" as const, runId: "one", sourceSha: "a".repeat(40), profile: "PILOT" as const,
      provenanceDigest: "b".repeat(64), cumulativeAuthorizedMicrounits: 2500001, cumulativeRetainedMicrounits: 0, startedAt: 0 };
    expect(() => appendCampaignEvent(dir, begin)).toThrow(/INVALID_CUMULATIVE_AUTHORITY/u);
    appendCampaignEvent(dir, { ...begin, cumulativeAuthorizedMicrounits: 2500000 });
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
      cumulativeAuthorizedMicrounits: 2500000, cumulativeRetainedMicrounits: 0 };
    writeFileSync(authorizationPath, JSON.stringify(authorization));
    const input = { root: process.cwd(), enableLive: true, authorizationPath, profile: "PILOT" as const, runId: "bounded-run", now: 2 };
    expect(() => admitFutureLiveIntent({ ...input, enableLive: false })).toThrow(/EXPLICIT_ENABLE_REQUIRED/u);
    expect(() => admitFutureLiveIntent({ ...input, profile: "FULL" })).toThrow(/AUTHORIZATION_MISMATCH/u);
    expect(admitFutureLiveIntent(input)).toMatchObject({ campaignRoot: dir, method: "OBSERVABLE_CANARY" });
    writeFileSync(authorizationPath, JSON.stringify({ ...authorization, cumulativeAuthorizedMicrounits: 2500001 }));
    expect(() => admitFutureLiveIntent(input)).toThrow(/INVALID_AUTHORIZATION/u);
    writeFileSync(authorizationPath, JSON.stringify({ ...authorization, cumulativeRetainedMicrounits: 421898 }));
    expect(() => admitFutureLiveIntent(input)).toThrow(/INVALID_PILOT_AUTHORITY/u);
    writeFileSync(authorizationPath, JSON.stringify({ ...authorization, sourceSha: "a".repeat(40) }));
    expect(() => admitFutureLiveIntent(input)).toThrow(/AUTHORIZATION_MISMATCH/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("pilot retains 951000 unknown exposure and admits 105472 within the USD 1.50 ceiling", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-contract-ledger-"));
  try {
    const provenanceDigest = "b".repeat(64);
    appendCampaignEvent(dir, { event: "BEGIN", runId: "one", sourceSha: "a".repeat(40), profile: "PILOT", provenanceDigest,
      cumulativeAuthorizedMicrounits: 2500000, cumulativeRetainedMicrounits: 0, startedAt: 0 });
    const reserve = (reservationId: string, maximumMicrounits: number, now: number) => reserveCampaignCall(dir,
      { runId: "one", profile: "PILOT", provenanceDigest, reservationId, maximumMicrounits, now, startedAt: 0 });
    expect(reserve("historical", 951000, 1).status).toBe("RESERVED");
    markCampaignDispatched(dir, { runId: "one", reservationId: "historical", at: 1 });
    finishCampaignCall(dir, { runId: "one", reservationId: "historical", at: 2, observedMicrounits: null });
    expect(reserve("normal", 105472, 3).status).toBe("RESERVED");
    expect(reserve("remaining", 443528, 4).status).toBe("RESERVED");
    expect(reserve("over", 1, 5)).toMatchObject({ status: "STOPPED", reason: "COST_CAP" });
    expect(readCampaignLedger(dir).find(row => row.event === "FINISH")).toMatchObject({ observedMicrounits: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("new pilot authority carries only the USD 1.50 remainder after 951000 immutable historical reservations", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-contract-ledger-"));
  try {
    const provenanceDigest = "b".repeat(64);
    appendCampaignEvent(dir, { event: "BEGIN", runId: "new", sourceSha: "a".repeat(40), profile: "PILOT", provenanceDigest,
      cumulativeAuthorizedMicrounits: 549000, cumulativeRetainedMicrounits: 0, startedAt: 0, observableAdmission: true });
    const reserve = (reservationId: string, maximumMicrounits: number, now: number) => reserveCampaignCall(dir,
      { runId: "new", profile: "PILOT", provenanceDigest, reservationId, maximumMicrounits, now, startedAt: 0 });
    expect(reserve("canary", 105472, 1).status).toBe("RESERVED");
    expect(reserve("remaining", 443528, 2).status).toBe("RESERVED");
    expect(reserve("over", 1, 3)).toMatchObject({ status: "STOPPED", reason: "COST_CAP" });
    expect(readCampaignLedger(dir)[0]).toMatchObject({ cumulativeAuthorizedMicrounits: 549000, cumulativeRetainedMicrounits: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it.each([951000, 1500000])("full retains its USD 1.00 ceiling under combined authority with %i prior microunits", retained => {
  const dir = mkdtempSync(join(tmpdir(), "context-contract-ledger-"));
  try {
    const provenanceDigest = "b".repeat(64);
    appendCampaignEvent(dir, { event: "BEGIN", runId: "full", sourceSha: "a".repeat(40), profile: "FULL", provenanceDigest,
      cumulativeAuthorizedMicrounits: 2500000, cumulativeRetainedMicrounits: retained, startedAt: 0 });
    const reserve = (reservationId: string, maximumMicrounits: number, now: number) => reserveCampaignCall(dir,
      { runId: "full", profile: "FULL", provenanceDigest, reservationId, maximumMicrounits, now, startedAt: 0 });
    expect(reserve("ceiling", 1000000, 1).status).toBe("RESERVED");
    expect(reserve("over", 1, 2)).toMatchObject({ status: "STOPPED", reason: "COST_CAP" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
