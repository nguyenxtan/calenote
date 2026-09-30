import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, rmdirSync, writeSync } from "node:fs";
import { join } from "node:path";

type Schema = Record<string, unknown>;
export interface DiagnosticProbe { id: string; parentId: string | null; difference: string; schema: Schema; schemaDigest: string; }
export interface DiagnosticPrices { inputUsdPerMillion: number; outputUsdPerMillion: number; verifiedAt: string; evidenceUrl: string; }
interface Source { sourceSha: string; sourceDigest: string; }
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export const DIAGNOSTIC_CAP_MICROUNITS = 250000;
export const DIAGNOSTIC_FINANCIAL_FRAMING_TOKENS = 8192;
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
function validatePrices(prices: DiagnosticPrices) {
  if (prices.inputUsdPerMillion !== 0.1 || prices.outputUsdPerMillion !== 0.4
    || !Number.isFinite(Date.parse(prices.verifiedAt)) || !/^https:\/\//u.test(prices.evidenceUrl)) throw new Error("VERIFIED_PRICE_REQUIRED");
}
function charge(input: number, output: number) { return Math.ceil((input + output * 4) / 10); }
/** Financial estimate only: UTF8 bytes × 4 + allowance is not a certified
 * bound on the provider's transformed input or framing. Actual usage is separate. */
export function estimateDiagnosticReservation(serializedEnvelope: string, maxOutputTokens: number, prices: DiagnosticPrices) {
  validatePrices(prices);
  if (!integer(maxOutputTokens) || maxOutputTokens === 0 || maxOutputTokens > 1536) throw new Error("INVALID_OUTPUT_BOUND");
  const envelopeBytes = Buffer.byteLength(serializedEnvelope, "utf8");
  const inputFinancialBound = envelopeBytes * 4 + DIAGNOSTIC_FINANCIAL_FRAMING_TOKENS;
  return { envelopeBytes, inputFinancialBound, maxOutputTokens, reservedMicrounits: charge(inputFinancialBound, maxOutputTokens) };
}

export function buildDiagnosticProbeMatrix(): DiagnosticProbe[] {
  const probes: DiagnosticProbe[] = [];
  const object = (ok: Schema): Schema => ({ type: "object", properties: { ok }, required: ["ok"], additionalProperties: false });
  const add = (id: string, parentId: string | null, difference: string, schema: Schema) => {
    probes.push({ id, parentId, difference, schema, schemaDigest: digest(JSON.stringify(schema)) });
  };
  add("minimal-object", null, "minimal strict object baseline", object({ type: "boolean" }));
  add("local-definitions", "minimal-object", "inline boolean to local definitions/$ref", { ...object({ $ref: "#/definitions/Flag" }), definitions: { Flag: { type: "boolean" } } });
  add("local-defs", "local-definitions", "definitions to $defs with corresponding ref pointer", { ...object({ $ref: "#/$defs/Flag" }), $defs: { Flag: { type: "boolean" } } });
  add("any-of", "minimal-object", "anyOf boolean/string union", object({ anyOf: [{ type: "boolean" }, { type: "string" }] }));
  add("one-of", "any-of", "anyOf to oneOf only", object({ oneOf: [{ type: "boolean" }, { type: "string" }] }));
  add("string-baseline", "minimal-object", "boolean to string baseline", object({ type: "string" }));
  add("string-const", "string-baseline", "string const", object({ type: "string", const: "synthetic" }));
  add("string-pattern", "string-baseline", "string pattern", object({ type: "string", pattern: "^[a-z]+$" }));
  add("string-min-length", "string-baseline", "string minLength", object({ type: "string", minLength: 1 }));
  add("string-max-length", "string-baseline", "string maxLength", object({ type: "string", maxLength: 16 }));
  add("additional-properties", "minimal-object", "additionalProperties false to true", { ...object({ type: "boolean" }), additionalProperties: true });
  add("nested-ref", "local-defs", "nest referenced value in strict object", { ...object(object({ $ref: "#/$defs/Flag" })), $defs: { Flag: { type: "boolean" } } });
  add("nested-union-ref", "nested-ref", "nested reference wrapped in anyOf", { ...object(object({ anyOf: [{ $ref: "#/$defs/Flag" }, { type: "string" }] })), $defs: { Flag: { type: "boolean" } } });
  const pair = (second: string, defs: Schema): Schema => ({ type: "object", properties: { first: { $ref: "#/$defs/A" }, second: { $ref: second } }, required: ["first", "second"], additionalProperties: false, $defs: defs });
  add("two-independent-references", "local-defs", "two independent synthetic reference nodes", pair("#/$defs/B", { A: { type: "boolean" }, B: { type: "boolean" } }));
  add("shared-reference", "two-independent-references", "second reference targets shared A", pair("#/$defs/A", { A: { type: "boolean" }, B: { type: "boolean" } }));
  const graph = (target: string): Schema => ({ ...object({ $ref: "#/$defs/Node" }), $defs: { Node: object({ anyOf: [{ type: "null" }, { $ref: target }] }), Leaf: { type: "boolean" } } });
  add("acyclic-reference", "local-defs", "acyclic node graph baseline", graph("#/$defs/Leaf"));
  add("recursive-reference", "acyclic-reference", "leaf pointer to self recursion (diagnostic only)", graph("#/$defs/Node"));
  const width = (count: number): Schema => ({ type: "object", properties: Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}`, { type: "boolean" }])), required: Array.from({ length: count }, (_, i) => `p${i}`), additionalProperties: false });
  add("size-4", "minimal-object", "synthetic width four", width(4));
  add("size-16", "size-4", "synthetic width sixteen", width(16));
  add("depth-2", "minimal-object", "synthetic depth two", object(object({ type: "boolean" })));
  add("depth-4", "depth-2", "synthetic depth four", object(object(object(object({ type: "boolean" })))));
  return probes;
}

interface Row { event: "BEGIN" | "RESERVE" | "DISPATCH" | "FINISH" | "STOP"; accountingClass: "DIAGNOSTIC_PROBE"; sequence: number; previousHash: string; hash: string; [key: string]: unknown; }
export function readDiagnosticLedger(directory: string): Row[] {
  const path = join(directory, "diagnostic.jsonl");
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  if (text && !text.endsWith("\n")) throw new Error("LEDGER_TRUNCATED");
  const rows: Row[] = text.trim() ? text.trim().split("\n").map(line => JSON.parse(line)) : [];
  let previous = "0".repeat(64);
  for (const [index, row] of rows.entries()) {
    const { hash, ...body } = row;
    if (row.sequence !== index + 1 || row.previousHash !== previous || row.accountingClass !== "DIAGNOSTIC_PROBE" || digest(JSON.stringify(body)) !== hash) throw new Error("LEDGER_TAMPER");
    previous = hash;
  }
  return rows;
}
function locked<T>(directory: string, operation: (rows: Row[]) => T): T {
  const path = join(directory, "diagnostic.lock");
  mkdirSync(path, { mode: 0o700 });
  try { return operation(readDiagnosticLedger(directory)); } finally { rmdirSync(path); }
}
function append(directory: string, rows: Row[], event: Record<string, unknown>) {
  const body = { ...event, accountingClass: "DIAGNOSTIC_PROBE", sequence: rows.length + 1, previousHash: rows.at(-1)?.hash ?? "0".repeat(64) };
  const row = { ...body, hash: digest(JSON.stringify(body)) } as Row;
  const fd = openSync(join(directory, "diagnostic.jsonl"), "a", 0o600);
  try { writeSync(fd, JSON.stringify(row) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  rows.push(row);
  return row;
}
function summary(rows: Row[]) {
  let reservedMicrounits = 0, observedMicrounits = 0, retainedMicrounits = 0, unknownReservations = 0;
  for (const reserve of rows.filter(row => row.event === "RESERVE")) {
    const amount = reserve.reservedMicrounits as number;
    reservedMicrounits += amount;
    const finish = rows.find(row => row.event === "FINISH" && row.probeId === reserve.probeId);
    if (finish && typeof finish.observedMicrounits === "number") { observedMicrounits += finish.observedMicrounits; retainedMicrounits += finish.observedMicrounits; }
    else { retainedMicrounits += amount; unknownReservations++; }
  }
  return { reservedMicrounits, observedMicrounits, retainedMicrounits, unknownReservations, totalSpendKnown: unknownReservations === 0, requests: rows.filter(row => row.event === "DISPATCH").length, stopped: rows.some(row => row.event === "STOP") };
}
export function diagnosticSummary(directory: string) { return summary(readDiagnosticLedger(directory)); }
export function beginDiagnosticLedger(directory: string, input: Source & { prices: DiagnosticPrices }) {
  validatePrices(input.prices);
  if (!/^[a-f0-9]{40}$/u.test(input.sourceSha) || !/^[a-f0-9]{64}$/u.test(input.sourceDigest)) throw new Error("SOURCE_BINDING");
  return locked(directory, rows => {
    if (rows.length) throw new Error("LEDGER_ALREADY_STARTED");
    return append(directory, rows, { event: "BEGIN", sourceSha: input.sourceSha, sourceDigest: input.sourceDigest,
      prices: { inputUsdPerMillion: input.prices.inputUsdPerMillion, outputUsdPerMillion: input.prices.outputUsdPerMillion, verifiedAt: input.prices.verifiedAt, evidenceUrl: input.prices.evidenceUrl },
      capMicrounits: DIAGNOSTIC_CAP_MICROUNITS, financialEstimate: "UTF8_BYTES_X4_PLUS_8192_NOT_CERTIFIED_PROVIDER_BOUND" });
  });
}
export function reserveDiagnosticProbe(directory: string, input: Source & { probe: DiagnosticProbe; serializedEnvelope: string; maxOutputTokens: number }) {
  return locked(directory, rows => {
    const begin = rows[0];
    if (!begin || begin.event !== "BEGIN" || summary(rows).stopped) throw new Error("DIAGNOSTIC_STOPPED");
    if (input.sourceSha !== begin.sourceSha || input.sourceDigest !== begin.sourceDigest) throw new Error("SOURCE_BINDING");
    const probe = input.probe;
    if (!/^[a-z0-9-]{1,100}$/u.test(probe.id) || !probe.difference || digest(JSON.stringify(probe.schema)) !== probe.schemaDigest) throw new Error("SCHEMA_BINDING");
    if (rows.some(row => row.event === "RESERVE" && row.probeId === probe.id)) throw new Error("DUPLICATE_PROBE");
    if (rows.some(row => row.event === "RESERVE" && !rows.some(finish => finish.event === "FINISH" && finish.probeId === row.probeId))) throw new Error("UNKNOWN_OR_IN_FLIGHT");
    const envelope = JSON.parse(input.serializedEnvelope);
    if (digest(JSON.stringify(envelope.response_format?.json_schema?.schema)) !== probe.schemaDigest || envelope.max_tokens !== input.maxOutputTokens) throw new Error("SCHEMA_BINDING");
    const estimate = estimateDiagnosticReservation(input.serializedEnvelope, input.maxOutputTokens, begin.prices as DiagnosticPrices);
    if (summary(rows).retainedMicrounits + estimate.reservedMicrounits > DIAGNOSTIC_CAP_MICROUNITS) {
      append(directory, rows, { event: "STOP", reason: "DIAGNOSTIC_CAP", probeId: probe.id });
      throw new Error("DIAGNOSTIC_CAP");
    }
    return append(directory, rows, { event: "RESERVE", sourceSha: input.sourceSha, sourceDigest: input.sourceDigest, probeId: probe.id, schemaDigest: probe.schemaDigest, parentId: probe.parentId, difference: probe.difference, envelopeDigest: digest(input.serializedEnvelope), ...estimate });
  });
}
export function dispatchDiagnosticProbe(directory: string, probeId: string, serializedEnvelope: string) {
  return locked(directory, rows => {
    const reserve = rows.find(row => row.event === "RESERVE" && row.probeId === probeId);
    if (!reserve) throw new Error("RESERVATION_REQUIRED");
    if (rows.some(row => row.event === "DISPATCH" && row.probeId === probeId)) throw new Error("ALREADY_DISPATCHED");
    if (summary(rows).stopped) throw new Error("DIAGNOSTIC_STOPPED");
    if (digest(serializedEnvelope) !== reserve.envelopeDigest) throw new Error("ENVELOPE_BINDING");
    return append(directory, rows, { event: "DISPATCH", probeId });
  });
}
export interface DiagnosticResult { httpStatus: number | null; upstreamCategory: string; usage: { inputTokens: number; outputTokens: number } | null; reportedCostUsd?: number | null; }
export function finishDiagnosticProbe(directory: string, probeId: string, result: DiagnosticResult) {
  return locked(directory, rows => {
    const reserve = rows.find(row => row.event === "RESERVE" && row.probeId === probeId);
    if (!reserve || !rows.some(row => row.event === "DISPATCH" && row.probeId === probeId) || rows.some(row => row.event === "FINISH" && row.probeId === probeId)) throw new Error("FINISH_STATE");
    if ((result.httpStatus !== null && (!integer(result.httpStatus) || result.httpStatus < 100 || result.httpStatus > 599)) || !/^[A-Z_]{1,64}$/u.test(result.upstreamCategory)
      || (result.reportedCostUsd != null && (!Number.isFinite(result.reportedCostUsd) || result.reportedCostUsd < 0 || !Number.isSafeInteger(Math.ceil(result.reportedCostUsd * 1000000))))) throw new Error("INVALID_RESULT");
    const observedMicrounits = result.reportedCostUsd == null ? null : Math.ceil(result.reportedCostUsd * 1000000);
    const tokenUsageStatus = result.usage === null ? "UNKNOWN" : integer(result.usage.inputTokens) && integer(result.usage.outputTokens) ? "VALID" : "INVALID";
    const usage = tokenUsageStatus === "VALID" ? { inputTokens: result.usage!.inputTokens, outputTokens: result.usage!.outputTokens } : null;
    const tokenEstimatedMicrounits = usage === null ? null : charge(usage.inputTokens, usage.outputTokens);
    const row = append(directory, rows, { event: "FINISH", probeId, httpStatus: result.httpStatus, upstreamCategory: result.upstreamCategory, usage, tokenUsageStatus, reportedCostUsd: result.reportedCostUsd ?? null, observedMicrounits, tokenEstimatedMicrounits });
    if ((observedMicrounits !== null && observedMicrounits > (reserve.reservedMicrounits as number))
      || (tokenEstimatedMicrounits !== null && tokenEstimatedMicrounits > (reserve.reservedMicrounits as number))) append(directory, rows, { event: "STOP", reason: "RESERVATION_OVERRUN", probeId });
    return row;
  });
}
