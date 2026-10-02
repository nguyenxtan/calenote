// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as diagnostic from "./context-schema-diagnostics";
import { createHash } from "node:crypto";

const directories: string[] = [];
const fresh = () => { const path = realpathSync(mkdtempSync(join(tmpdir(), "calenote-diagnostic-"))); directories.push(path); return path; };
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
const source = { sourceSha: "a".repeat(40), sourceDigest: "b".repeat(64) };
const prices = { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4, verifiedAt: "2026-09-30T00:00:00Z", evidenceUrl: "https://openrouter.ai/google/gemini-2.5-flash-lite" };
const envelope = (schema: unknown, output = 64) => ({ model: "google/gemini-2.5-flash-lite", max_tokens: output, messages: [{ role: "user", content: "Return a synthetic object." }], response_format: { type: "json_schema", json_schema: { name: "probe", strict: true, schema } } });
it("raw diagnostic record and self-computed hash cannot mint owner authority", () => {
  const directory = fresh(), record = { authorizationId: "owner-diagnostic-300000", account: "DIAGNOSTIC", capMicrounits: 300000, priorLedgers: [] };
  expect(() => diagnostic.beginDiagnosticLedger(directory, { ...source, prices, authorization: { record, sha256: createHash("sha256").update(JSON.stringify(record)).digest("hex") } })).toThrow("AUTHORIZATION_NOT_CONFIGURED");
  const probe = diagnostic.buildDiagnosticProbeMatrix()[0];
  expect(() => diagnostic.reserveDiagnosticProbe(directory, { ...source, probe, serializedEnvelope: JSON.stringify(envelope(probe.schema)), maxOutputTokens: 64, authorization: { record, sha256: hashRecord(record) } })).toThrow("AUTHORIZATION_NOT_CONFIGURED");
});
const hashRecord = (record: unknown) => createHash("sha256").update(JSON.stringify(record)).digest("hex");
// Synthetic histories only: regenerate integrity hashes to exercise financial
// grammar, not the independent hash-tamper fence.
function writeHistory(directory: string, events: Array<Record<string, unknown>>) {
  let previousHash = "0".repeat(64);
  const rows = events.map((event, index) => {
    const body = { ...event, accountingClass: "DIAGNOSTIC_PROBE", sequence: index + 1, previousHash };
    const row = { ...body, hash: hashRecord(body) }; previousHash = row.hash; return row;
  });
  writeFileSync(join(directory, "diagnostic.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  return rows;
}
const legacyBegin = () => ({ event: "BEGIN", ...source, prices, capMicrounits: 250000, financialEstimate: "UTF8_BYTES_X4_PLUS_8192_NOT_CERTIFIED_PROVIDER_BOUND" });
const legacyReserve = () => ({ event: "RESERVE", ...source, probeId: "probe", schemaDigest: "d".repeat(64), parentId: null, difference: "synthetic", envelopeDigest: "e".repeat(64), envelopeBytes: 100, inputFinancialBound: 8592, maxOutputTokens: 64, reservedMicrounits: 885 });
const legacyFinish = () => ({ event: "FINISH", probeId: "probe", httpStatus: 200, upstreamCategory: "SUCCESS", usage: null, tokenUsageStatus: "UNKNOWN", reportedCostUsd: 0, observedMicrounits: 0, tokenEstimatedMicrounits: null });
it.each(["null", "absent", "unsettled"])("valid legacy250000 %s UNKNOWN survives named300000 loading without history rewrite", mode => {
  const root = fresh(), prior = join(root, "prior"), next = join(root, "next"); mkdirSync(prior); mkdirSync(next);
  const finish: Record<string, unknown> = { ...legacyFinish(), reportedCostUsd: null, observedMicrounits: null };
  if (mode === "absent") { delete finish.reportedCostUsd; delete finish.observedMicrounits; delete finish.tokenEstimatedMicrounits; }
  const rows = writeHistory(prior, [legacyBegin(), legacyReserve(), { event: "DISPATCH", probeId: "probe" }, ...(mode === "unsettled" ? [] : [finish])]);
  const original = readFileSync(join(prior, "diagnostic.jsonl"), "utf8");
  expect(diagnostic.diagnosticSummary(prior)).toMatchObject({ retainedMicrounits: 885, unknownReservations: 1, totalSpendKnown: false });
  const record = { authorizationId: "owner-diagnostic-300000", account: "DIAGNOSTIC", capMicrounits: 300000, priorLedgers: [{ directory: prior, finalHash: rows.at(-1)!.hash }] };
  diagnostic.beginDiagnosticLedger(next, { ...source, prices, authorization: trustedGrant(record, next, root) });
  expect(diagnostic.diagnosticSummary(next)).toMatchObject({ retainedMicrounits: 885, unknownReservations: 1 });
  expect(readFileSync(join(prior, "diagnostic.jsonl"), "utf8")).toBe(original);
});
it("terminal STOP permits late settlement and retains authoritative overspend above reservation and cap", () => {
  const legacy = fresh();
  writeHistory(legacy, [legacyBegin(), legacyReserve(), { event: "DISPATCH", probeId: "probe" }, { event: "STOP", reason: "DIAGNOSTIC_CAP", probeId: "next" }]);
  diagnostic.finishDiagnosticProbe(legacy, "probe", { httpStatus: 200, upstreamCategory: "SUCCESS", usage: null, reportedCostUsd: .4 });
  expect(diagnostic.diagnosticSummary(legacy)).toMatchObject({ retainedMicrounits: 400000, observedMicrounits: 400000, unknownReservations: 0, totalSpendKnown: true, stopped: true });
  expect(diagnostic.readDiagnosticLedger(legacy).at(-1)).toMatchObject({ event: "STOP", reason: "RESERVATION_OVERRUN" });
  expect(() => diagnostic.dispatchDiagnosticProbe(legacy, "new", "{}")).toThrow();
});
it("overspend FINISH before STOP crash boundary still retains actual debt and stops admission", () => {
  const directory = fresh();
  writeHistory(directory, [legacyBegin(), legacyReserve(), { event: "DISPATCH", probeId: "probe" }, { ...legacyFinish(), reportedCostUsd: .4, observedMicrounits: 400000 }]);
  expect(diagnostic.diagnosticSummary(directory)).toMatchObject({ observedMicrounits: 400000, retainedMicrounits: 400000, stopped: true });
  expect(() => diagnostic.dispatchDiagnosticProbe(directory, "probe", "{}")).toThrow();
  expect(() => diagnostic.finishDiagnosticProbe(directory, "probe", { httpStatus: 200, upstreamCategory: "SUCCESS", usage: null, reportedCostUsd: 0 })).toThrow();
});
it.each(["ordinary", "late", "finish-crash", "inherited"])("safe actual diagnostic overflow remains durable with explicit summary refusal: %s", mode => {
  const root = fresh(), directory = join(root, "attempt"), prior = join(root, "prior"), next = join(root, "next");
  mkdirSync(directory); mkdirSync(next);
  const known = { ...legacyFinish(), reportedCostUsd: .000007, observedMicrounits: 7 };
  const own: Array<Record<string, unknown>> = [legacyBegin(), legacyReserve(), { event: "DISPATCH", probeId: "probe" }, known,
    { ...legacyReserve(), probeId: "second" }, { event: "DISPATCH", probeId: "second" }];
  if (mode === "inherited") {
    mkdirSync(prior); const priorRows = writeHistory(prior, [legacyBegin(), legacyReserve(), { event: "DISPATCH", probeId: "probe" }, known]);
    const record = { authorizationId: "synthetic-overflow", account: "DIAGNOSTIC", capMicrounits: 300000,
      priorLedgers: [{ directory: prior, finalHash: priorRows.at(-1)!.hash }] };
    diagnostic.beginDiagnosticLedger(directory, { ...source, prices, authorization: trustedGrant(record, directory, root) });
    const begin = diagnostic.readDiagnosticLedger(directory)[0];
    own.splice(0, own.length, Object.fromEntries(Object.entries(begin).filter(([key]) => !["sequence", "previousHash", "hash", "accountingClass"].includes(key))),
      { ...legacyReserve(), probeId: "second" }, { event: "DISPATCH", probeId: "second" });
  }
  if (mode === "late") own.push({ event: "STOP", reason: "DIAGNOSTIC_CAP", probeId: "later" });
  writeHistory(directory, own);
  const result = { httpStatus: 200, upstreamCategory: "SUCCESS", usage: null, reportedCostUsd: 9007199254.74099 };
  expect(diagnostic.finishDiagnosticProbe(directory, "second", result)).toMatchObject({ event: "FINISH", observedMicrounits: 9007199254740990 });
  expect(diagnostic.readDiagnosticLedger(directory).at(-1)).toMatchObject({ event: "STOP", reason: "RESERVATION_OVERRUN" });
  if (mode === "finish-crash") {
    const events = diagnostic.readDiagnosticLedger(directory).slice(0, -1).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !["sequence", "previousHash", "hash", "accountingClass"].includes(key))));
    writeHistory(directory, events);
  }
  const bytes = readFileSync(join(directory, "diagnostic.jsonl"), "utf8");
  expect(() => diagnostic.diagnosticSummary(directory)).toThrow("DIAGNOSTIC_ACCOUNTING_OVERFLOW");
  expect(() => diagnostic.dispatchDiagnosticProbe(directory, "second", "{}")).toThrow();
  const record = { authorizationId: "synthetic-next", account: "DIAGNOSTIC", capMicrounits: 300000,
    priorLedgers: [...(mode === "inherited" ? [{ directory: prior, finalHash: diagnostic.readDiagnosticLedger(prior).at(-1)!.hash }] : []),
      { directory, finalHash: diagnostic.readDiagnosticLedger(directory).at(-1)!.hash }] };
  expect(() => trustedGrant(record, next, root)).toThrow("DIAGNOSTIC_CAP");
  expect(readFileSync(join(directory, "diagnostic.jsonl"), "utf8")).toBe(bytes);
});
it("resumed named capability cannot append after hash-valid financial corruption", () => {
  const directory = setup(), begin = diagnostic.readDiagnosticLedger(directory)[0];
  const body = Object.fromEntries(Object.entries(begin).filter(([key]) => !["sequence", "previousHash", "hash", "accountingClass"].includes(key)));
  writeHistory(directory, [body, legacyFinish()]);
  const before = readFileSync(join(directory, "diagnostic.jsonl"), "utf8"), probe = diagnostic.buildDiagnosticProbeMatrix()[0];
  expect(() => diagnostic.reserveDiagnosticProbe(directory, { ...source, probe, serializedEnvelope: JSON.stringify(envelope(probe.schema)), maxOutputTokens: 64 })).toThrow("DIAGNOSTIC_HISTORY_INVALID");
  expect(readFileSync(join(directory, "diagnostic.jsonl"), "utf8")).toBe(before);
});
it.each([
  ["finish-before-reserve", () => [legacyBegin(), legacyFinish(), legacyReserve()]],
  ["missing-dispatch", () => [legacyBegin(), legacyReserve(), legacyFinish()]],
  ["duplicate-finish", () => [legacyBegin(), legacyReserve(), { event: "DISPATCH", probeId: "probe" }, legacyFinish(), legacyFinish()]],
  ["duplicate-reserve", () => [legacyBegin(), legacyReserve(), legacyReserve()]],
  ["orphan-finish", () => [legacyBegin(), legacyFinish()]],
  ["missing-begin", () => [legacyReserve()]],
  ["duplicate-begin", () => [legacyBegin(), legacyBegin()]],
  ["bad-begin-cap", () => [{ ...legacyBegin(), capMicrounits: 999999 }]],
  ["invalid-event", () => [legacyBegin(), { event: "BORROW", amount: 0 }]],
  ["invalid-finance", () => [legacyBegin(), { ...legacyReserve(), reservedMicrounits: -1 }]],
  ["source-substitution", () => [legacyBegin(), { ...legacyReserve(), sourceSha: "c".repeat(40) }]],
  ["orphan-dispatch", () => [legacyBegin(), { event: "DISPATCH", probeId: "probe" }]],
  ["duplicate-dispatch", () => [legacyBegin(), legacyReserve(), { event: "DISPATCH", probeId: "probe" }, { event: "DISPATCH", probeId: "probe" }]],
  ["settlement-substitution", () => [legacyBegin(), legacyReserve(), { event: "DISPATCH", probeId: "probe" }, { ...legacyFinish(), reportedCostUsd: null }]],
  ["unknown-field", () => [{ ...legacyBegin(), capOverride: 0 }]],
  ["reservation-bound-substitution", () => [legacyBegin(), { ...legacyReserve(), reservedMicrounits: 1 }]],
  ["invalid-begin-source", () => [{ ...legacyBegin(), sourceSha: "invalid" }]],
  ["invalid-probe", () => [legacyBegin(), { ...legacyReserve(), probeId: "UPPERCASE" }]],
  ["invalid-settlement-usage", () => [legacyBegin(), legacyReserve(), { event: "DISPATCH", probeId: "probe" }, { ...legacyFinish(), usage: { inputTokens: -1, outputTokens: 0 }, tokenUsageStatus: "VALID" }]],
  ["orphan-overrun-stop", () => [legacyBegin(), { event: "STOP", reason: "RESERVATION_OVERRUN", probeId: "probe" }]],
  ["named-begin-missing-provenance", () => [{ ...legacyBegin(), capMicrounits: 300000 }]],
  ["named-inherited-debt-substitution", () => {
    const record = { authorizationId: "owner-diagnostic-300000", account: "DIAGNOSTIC", capMicrounits: 300000, priorLedgers: [] };
    return [{ ...legacyBegin(), capMicrounits: 300000, authorizationRecord: record, authorizationId: record.authorizationId, authorizationSha256: hashRecord(record), priorLedgers: [], priorRetainedMicrounits: 1, priorUnknownReservations: 0 }];
  }],
  ["invalid-result-status", () => [legacyBegin(), legacyReserve(), { event: "DISPATCH", probeId: "probe" }, { ...legacyFinish(), httpStatus: 42 }]],
] as const)("hash-valid malformed history cannot grant diagnostic authority: %s", (_label, events) => {
  const root = fresh(), prior = join(root, "prior"), next = join(root, "next"); mkdirSync(prior); mkdirSync(next);
  const rows = writeHistory(prior, events()), original = readFileSync(join(prior, "diagnostic.jsonl"), "utf8");
  const record = { authorizationId: "owner-diagnostic-300000", account: "DIAGNOSTIC", capMicrounits: 300000, priorLedgers: [{ directory: prior, finalHash: rows.at(-1)!.hash }] };
  expect(() => trustedGrant(record, next, root)).toThrow();
  expect(() => diagnostic.diagnosticSummary(prior)).toThrow();
  expect(() => diagnostic.dispatchDiagnosticProbe(prior, "probe", "{}" )).toThrow();
  expect(() => diagnostic.finishDiagnosticProbe(prior, "probe", { httpStatus: 200, upstreamCategory: "SUCCESS", usage: null, reportedCostUsd: 0 })).toThrow();
  expect(readFileSync(join(prior, "diagnostic.jsonl"), "utf8")).toBe(original);
  expect(() => readFileSync(join(next, "diagnostic.jsonl"))).toThrow();
});
// Synthetic trust injection only; no production owner pin or live entry point.
const trustedGrant = (record: unknown, directory: string, accountRoot = directory) => diagnostic.createDiagnosticAuthorizationLoader({ reviewedOwnerRecordSha256: hashRecord(record), accountRoot }).load(record, directory);
const setup = (directory = fresh(), accountRoot = directory) => {
  const record = { authorizationId: "owner-diagnostic-300000", account: "DIAGNOSTIC", capMicrounits: 300000, priorLedgers: [] };
  diagnostic.beginDiagnosticLedger(directory, { ...source, prices, authorization: trustedGrant(record, directory, accountRoot) });
  return directory;
};

it("diagnostic_cap_uses_authorization_provenance", () => {
  const directory = fresh();
  const record = { authorizationId: "owner-diagnostic-300000", account: "DIAGNOSTIC", capMicrounits: 300000, priorLedgers: [] };
  const authorization = trustedGrant(record, directory);
  diagnostic.beginDiagnosticLedger(directory, { ...source, prices, authorization });
  expect(diagnostic.readDiagnosticLedger(directory)[0]).toMatchObject({ capMicrounits: 300000, authorizationId: "owner-diagnostic-300000", authorizationSha256: hashRecord(record), priorRetainedMicrounits: 0 });
  const changed = { ...record, capMicrounits: 400000 };
  expect(() => diagnostic.createDiagnosticAuthorizationLoader({ reviewedOwnerRecordSha256: hashRecord(record), accountRoot: directory }).load(changed, directory)).toThrow("DIAGNOSTIC_AUTHORIZATION");
});

it("new_source_retains_all_unknown_reservations with validated prior hash chains", () => {
  const root = fresh(), originalPath = join(root, "old"), next = join(root, "new"); mkdirSync(originalPath); mkdirSync(next);
  const original = setup(originalPath, root), probe = diagnostic.buildDiagnosticProbeMatrix()[0], body = JSON.stringify(envelope(probe.schema));
  diagnostic.reserveDiagnosticProbe(original, { ...source, probe, serializedEnvelope: body, maxOutputTokens: 64 });
  diagnostic.dispatchDiagnosticProbe(original, probe.id, body);
  diagnostic.finishDiagnosticProbe(original, probe.id, { httpStatus: 408, upstreamCategory: "TIMEOUT", usage: null });
  const held = diagnostic.diagnosticSummary(original), oldRows = diagnostic.readDiagnosticLedger(original);
  const record = { authorizationId: "owner-diagnostic-300000", account: "DIAGNOSTIC", capMicrounits: 300000, priorLedgers: [{ directory: original, finalHash: oldRows.at(-1)!.hash }] };
  const authorization = trustedGrant(record, next, root);
  diagnostic.beginDiagnosticLedger(next, { ...source, sourceSha: "c".repeat(40), prices, authorization });
  expect(diagnostic.diagnosticSummary(next)).toMatchObject({ retainedMicrounits: held.retainedMicrounits, unknownReservations: 1, totalSpendKnown: false });
  expect(diagnostic.readDiagnosticLedger(original)).toEqual(oldRows);
  const corrupt = { ...record, priorLedgers: [{ directory: original, finalHash: "0".repeat(64) }] };
  expect(() => trustedGrant(corrupt, next, root)).toThrow("DIAGNOSTIC_AUTHORIZATION");
  const third = join(root, "third"); mkdirSync(third);
  const bound = { ...record, priorLedgers: [...record.priorLedgers, { directory: next, finalHash: diagnostic.readDiagnosticLedger(next).at(-1)!.hash }] };
  diagnostic.beginDiagnosticLedger(third, { ...source, prices, authorization: trustedGrant(bound, third, root) });
  expect(diagnostic.diagnosticSummary(third)).toMatchObject({ retainedMicrounits: held.retainedMicrounits, unknownReservations: 1 });
  const fourth = join(root, "fourth"); mkdirSync(fourth);
  expect(() => trustedGrant({ ...bound, priorLedgers: [{ directory: original, finalHash: "0".repeat(64) }, ...bound.priorLedgers.slice(1), { directory: third, finalHash: diagnostic.readDiagnosticLedger(third).at(-1)!.hash }] }, fourth, root)).toThrow("PRIOR_LEDGER_BINDING");
  expect(() => trustedGrant({ ...record, priorLedgers: [] }, fourth, root)).toThrow("PRIOR_LEDGER_INVENTORY");
  expect(() => trustedGrant({ ...bound, priorLedgers: [...bound.priorLedgers, bound.priorLedgers[0]] }, fourth, root)).toThrow("PRIOR_LEDGER_ALIAS");
});

describe("isolated diagnostic accounting", () => {
  it("estimates the full serialized UTF8 envelope and holds conservative financial framing", () => {
    expect(diagnostic.estimateDiagnosticReservation("é", 64, prices)).toEqual({ envelopeBytes: 2, inputFinancialBound: 8200, maxOutputTokens: 64, reservedMicrounits: 846 });
  });
  it("reserves before dispatch, blocks duplicates and retains unknown across resume", () => {
    const directory = setup(), probe = diagnostic.buildDiagnosticProbeMatrix()[0], body = JSON.stringify(envelope(probe.schema));
    expect(() => diagnostic.dispatchDiagnosticProbe(directory, probe.id, body)).toThrow("RESERVATION_REQUIRED");
    diagnostic.reserveDiagnosticProbe(directory, { probe, serializedEnvelope: body, maxOutputTokens: 64, ...source });
    expect(diagnostic.readDiagnosticLedger(directory)[1]).toMatchObject({ event: "RESERVE", accountingClass: "DIAGNOSTIC_PROBE", probeId: "minimal-object", parentId: null });
    diagnostic.dispatchDiagnosticProbe(directory, probe.id, body);
    expect(() => diagnostic.dispatchDiagnosticProbe(directory, probe.id, body)).toThrow("ALREADY_DISPATCHED");
    const next = diagnostic.buildDiagnosticProbeMatrix()[1];
    expect(() => diagnostic.reserveDiagnosticProbe(directory, { probe: next, serializedEnvelope: JSON.stringify(envelope(next.schema)), maxOutputTokens: 64, ...source })).toThrow("UNKNOWN_OR_IN_FLIGHT");
    diagnostic.finishDiagnosticProbe(directory, probe.id, { httpStatus: 400, upstreamCategory: "INVALID_ARGUMENT", usage: null });
    expect(diagnostic.diagnosticSummary(directory)).toMatchObject({ requests: 1, observedMicrounits: 0, unknownReservations: 1, totalSpendKnown: false });
    diagnostic.reserveDiagnosticProbe(directory, { probe: next, serializedEnvelope: JSON.stringify(envelope(next.schema)), maxOutputTokens: 64, ...source });
    expect(diagnostic.diagnosticSummary(directory)).toMatchObject({ unknownReservations: 2 });
    expect(() => diagnostic.reserveDiagnosticProbe(directory, { probe, serializedEnvelope: body, maxOutputTokens: 64, ...source })).toThrow("DUPLICATE_PROBE");
  });
  it("records numerical actual charge and stops after a reservation overrun", () => {
    const directory = setup(), probe = diagnostic.buildDiagnosticProbeMatrix()[0], body = JSON.stringify(envelope(probe.schema));
    diagnostic.reserveDiagnosticProbe(directory, { probe, serializedEnvelope: body, maxOutputTokens: 64, ...source });
    diagnostic.dispatchDiagnosticProbe(directory, probe.id, body);
    diagnostic.finishDiagnosticProbe(directory, probe.id, { httpStatus: 200, upstreamCategory: "SUCCESS", usage: { inputTokens: 30000, outputTokens: 100 }, reportedCostUsd: 0.00304 });
    expect(diagnostic.diagnosticSummary(directory)).toMatchObject({ observedMicrounits: 3040, retainedMicrounits: 3040, stopped: true });
    expect(diagnostic.readDiagnosticLedger(directory).at(-1)).toMatchObject({ event: "STOP", reason: "RESERVATION_OVERRUN" });
  });
  it("blocks excessive reservations, schema or source substitution, and concurrent lock owners", () => {
    const directory = setup(), probe = diagnostic.buildDiagnosticProbeMatrix()[0], body = JSON.stringify(envelope(probe.schema));
    expect(() => diagnostic.reserveDiagnosticProbe(directory, { probe, serializedEnvelope: JSON.stringify(envelope({ type: "string" })), maxOutputTokens: 64, ...source })).toThrow("SCHEMA_BINDING");
    expect(() => diagnostic.reserveDiagnosticProbe(directory, { probe, serializedEnvelope: body, maxOutputTokens: 64, ...source, sourceSha: "c".repeat(40) })).toThrow("SOURCE_BINDING");
    expect(() => diagnostic.reserveDiagnosticProbe(directory, { probe, serializedEnvelope: JSON.stringify({ ...envelope(probe.schema), padding: "x".repeat(800000) }), maxOutputTokens: 64, ...source })).toThrow("DIAGNOSTIC_CAP");
    expect(diagnostic.diagnosticSummary(directory)).toMatchObject({ stopped: true, retainedMicrounits: 0 });
    expect(diagnostic.readDiagnosticLedger(directory).at(-1)).toMatchObject({ event: "STOP", reason: "DIAGNOSTIC_CAP" });
    mkdirSync(join(directory, "diagnostic.lock"));
    expect(() => diagnostic.reserveDiagnosticProbe(directory, { probe, serializedEnvelope: body, maxOutputTokens: 64, ...source })).toThrow();
  });
  it("binds dispatch envelope, permits one finish, and rejects truncated or tampered ledgers", () => {
    const directory = setup(), probe = diagnostic.buildDiagnosticProbeMatrix()[0], body = JSON.stringify(envelope(probe.schema));
    diagnostic.reserveDiagnosticProbe(directory, { probe, serializedEnvelope: body, maxOutputTokens: 64, ...source });
    expect(() => diagnostic.dispatchDiagnosticProbe(directory, probe.id, body + " ")).toThrow("ENVELOPE_BINDING");
    diagnostic.dispatchDiagnosticProbe(directory, probe.id, body);
    diagnostic.finishDiagnosticProbe(directory, probe.id, { httpStatus: 200, upstreamCategory: "SUCCESS", usage: { inputTokens: 10, outputTokens: 10 }, reportedCostUsd: 0.000005 });
    expect(diagnostic.diagnosticSummary(directory)).toMatchObject({ observedMicrounits: 5, retainedMicrounits: 5, unknownReservations: 0 });
    expect(() => diagnostic.finishDiagnosticProbe(directory, probe.id, { httpStatus: 200, upstreamCategory: "SUCCESS", usage: null })).toThrow("FINISH_STATE");
    const path = join(directory, "diagnostic.jsonl"), original = readFileSync(path, "utf8");
    expect(original).not.toContain("Return a synthetic object");
    writeFileSync(path, original.replace('"SUCCESS"', '"ERROR"'));
    expect(() => diagnostic.readDiagnosticLedger(directory)).toThrow("LEDGER_TAMPER");
    writeFileSync(path, original.trimEnd());
    expect(() => diagnostic.readDiagnosticLedger(directory)).toThrow("LEDGER_TRUNCATED");
  });
  it("holds unknown cost despite numerical token usage and stops on authoritative cost without tokens", () => {
    const directory = setup(), probes = diagnostic.buildDiagnosticProbeMatrix();
    const first = probes[0], body = JSON.stringify(envelope(first.schema));
    diagnostic.reserveDiagnosticProbe(directory, { probe: first, serializedEnvelope: body, maxOutputTokens: 64, ...source });
    diagnostic.dispatchDiagnosticProbe(directory, first.id, body);
    diagnostic.finishDiagnosticProbe(directory, first.id, { httpStatus: 200, upstreamCategory: "SUCCESS", usage: { inputTokens: 10, outputTokens: 10 } });
    expect(diagnostic.readDiagnosticLedger(directory).at(-1)).toMatchObject({ observedMicrounits: null, tokenEstimatedMicrounits: 5 });
    expect(diagnostic.diagnosticSummary(directory)).toMatchObject({ totalSpendKnown: false, unknownReservations: 1 });
    const next = probes[1], nextBody = JSON.stringify(envelope(next.schema));
    diagnostic.reserveDiagnosticProbe(directory, { probe: next, serializedEnvelope: nextBody, maxOutputTokens: 64, ...source });
    diagnostic.dispatchDiagnosticProbe(directory, next.id, nextBody);
    diagnostic.finishDiagnosticProbe(directory, next.id, { httpStatus: 200, upstreamCategory: "SUCCESS", usage: null, reportedCostUsd: 0.26 });
    expect(diagnostic.diagnosticSummary(directory)).toMatchObject({ observedMicrounits: 260000, stopped: true });
  });
  it("records authoritative cost even when token usage is malformed", () => {
    const directory = setup(), probe = diagnostic.buildDiagnosticProbeMatrix()[0], body = JSON.stringify(envelope(probe.schema));
    diagnostic.reserveDiagnosticProbe(directory, { probe, serializedEnvelope: body, maxOutputTokens: 64, ...source });
    diagnostic.dispatchDiagnosticProbe(directory, probe.id, body);
    diagnostic.finishDiagnosticProbe(directory, probe.id, { httpStatus: 200, upstreamCategory: "SUCCESS", usage: { inputTokens: -1, outputTokens: 10 }, reportedCostUsd: 0.01 });
    expect(diagnostic.readDiagnosticLedger(directory).find(row => row.event === "FINISH")).toMatchObject({ observedMicrounits: 10000, usage: null, tokenUsageStatus: "INVALID" });
    expect(diagnostic.diagnosticSummary(directory)).toMatchObject({ observedMicrounits: 10000, stopped: true });
  });
});

describe("controlled synthetic probe graph", () => {
  it("isolates schema families from admitted baselines with literal controlled pairs", () => {
    const probes = diagnostic.buildDiagnosticProbeMatrix();
    const get = (id: string) => probes.find(probe => probe.id === id)!;
    expect(get("minimal-object").schema).toEqual({ type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false });
    expect(get("string-baseline").parentId).toBe("minimal-object");
    expect(get("string-min-length").schema).toEqual({ type: "object", properties: { ok: { type: "string", minLength: 1 } }, required: ["ok"], additionalProperties: false });
    expect(get("string-max-length").schema).toEqual({ type: "object", properties: { ok: { type: "string", maxLength: 16 } }, required: ["ok"], additionalProperties: false });
    expect(get("local-definitions").schema).toEqual({ type: "object", properties: { ok: { $ref: "#/definitions/Flag" } }, required: ["ok"], additionalProperties: false, definitions: { Flag: { type: "boolean" } } });
    expect(get("local-defs").schema).toEqual({ type: "object", properties: { ok: { $ref: "#/$defs/Flag" } }, required: ["ok"], additionalProperties: false, $defs: { Flag: { type: "boolean" } } });
    expect(get("local-defs").parentId).toBe("local-definitions");
    expect(get("string-const").parentId).toBe("string-baseline");
    expect(get("string-pattern").parentId).toBe("string-baseline");
    expect(get("one-of").schema).toMatchObject({ properties: { ok: { oneOf: [{ type: "boolean" }, { type: "string" }] } } });
    expect(get("nested-union-ref").parentId).toBe("nested-ref");
    expect(get("shared-reference").parentId).toBe("two-independent-references");
    expect(get("recursive-reference").parentId).toBe("acyclic-reference");
    expect(get("size-16").parentId).toBe("size-4");
    expect(get("depth-4").parentId).toBe("depth-2");
    expect(new Set(probes.map(probe => probe.id)).size).toBe(probes.length);
    expect(new Set(probes.map(probe => probe.schemaDigest)).size).toBe(probes.length);
  });
});
