// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as diagnostic from "./context-schema-diagnostics";

const directories: string[] = [];
const fresh = () => { const path = mkdtempSync(join(tmpdir(), "calenote-diagnostic-")); directories.push(path); return path; };
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
const source = { sourceSha: "a".repeat(40), sourceDigest: "b".repeat(64) };
const prices = { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4, verifiedAt: "2026-09-30T00:00:00Z", evidenceUrl: "https://openrouter.ai/google/gemini-2.5-flash-lite" };
const envelope = (schema: unknown, output = 64) => ({ model: "google/gemini-2.5-flash-lite", max_tokens: output, messages: [{ role: "user", content: "Return a synthetic object." }], response_format: { type: "json_schema", json_schema: { name: "probe", strict: true, schema } } });
const setup = () => { const directory = fresh(); diagnostic.beginDiagnosticLedger(directory, { ...source, prices }); return directory; };

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
    expect(() => diagnostic.reserveDiagnosticProbe(directory, { probe, serializedEnvelope: JSON.stringify({ ...envelope(probe.schema), padding: "x".repeat(700000) }), maxOutputTokens: 64, ...source })).toThrow("DIAGNOSTIC_CAP");
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
