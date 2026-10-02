import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmdirSync, writeSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { z } from "zod";

type Schema = Record<string, unknown>;
export interface DiagnosticProbe { id: string; parentId: string | null; difference: string; schema: Schema; schemaDigest: string; }
export interface DiagnosticPrices { inputUsdPerMillion: number; outputUsdPerMillion: number; verifiedAt: string; evidenceUrl: string; }
interface Source { sourceSha: string; sourceDigest: string; }
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export const DIAGNOSTIC_CAP_MICROUNITS = 250000;
/** Historical generic cap; new admission requires the named owner record. */
const authorizationRecordSchema = z.strictObject({ authorizationId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u), account: z.literal("DIAGNOSTIC"), capMicrounits: z.literal(300000),
  priorLedgers: z.array(z.strictObject({ directory: z.string().min(1).max(4096), finalHash: z.string().regex(/^[a-f0-9]{64}$/u) })).max(256) });
const diagnosticAuthorizationBrand: unique symbol = Symbol("DiagnosticAuthorization");
export interface DiagnosticAuthorization { readonly [diagnosticAuthorizationBrand]: true; }
type Grant = { record: z.infer<typeof authorizationRecordSchema>; sha256: string; root: string; directory: string; priorRetainedMicrounits: number; priorUnknownReservations: number };
const diagnosticAuthorizations = new WeakMap<object, Grant>();
const activeGrants = new Map<string, Grant>();
function accountInventory(root: string, excluded: string): string[] {
  const result: string[] = [];
  const visit = (path: string) => {
    if (path !== excluded && existsSync(join(path, "diagnostic.jsonl"))) result.push(realpathSync(path));
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("PRIOR_LEDGER_ALIAS");
      if (entry.isDirectory() && entry.name !== "diagnostic.lock") visit(join(path, entry.name));
    }
  };
  visit(root); return result.sort();
}
function validateInventory(grant: Pick<Grant, "root" | "directory" | "record">) {
  const paths = grant.record.priorLedgers.map(binding => {
    const path = realpathSync(binding.directory), rel = relative(grant.root, path);
    if (path !== binding.directory || rel.startsWith("..") || isAbsolute(rel) || path === grant.directory) throw new Error("PRIOR_LEDGER_ALIAS");
    return path;
  });
  if (new Set(paths).size !== paths.length) throw new Error("PRIOR_LEDGER_ALIAS");
  if (JSON.stringify([...paths].sort()) !== JSON.stringify(accountInventory(grant.root, grant.directory))) throw new Error("PRIOR_LEDGER_INVENTORY");
  let retained = 0n, unknown = 0;
  // Count each ledger's own reservations once; BEGIN's inherited totals are
  // observations of ancestors, not new charges to count again.
  for (const binding of grant.record.priorLedgers) {
    const rows = readDiagnosticLedger(binding.directory);
    if (!rows.length || rows.at(-1)!.hash !== binding.finalHash) throw new Error("PRIOR_LEDGER_BINDING");
    const state = reduceDiagnosticHistory(rows);
    retained += state.localRetainedMicrounits; unknown += state.localUnknownReservations;
  }
  if (retained > BigInt(grant.record.capMicrounits)) throw new Error("DIAGNOSTIC_CAP");
  return { priorRetainedMicrounits: Number(retained), priorUnknownReservations: unknown };
}
/** Trusted orchestration supplies the reviewed owner-record pin and complete
 * account namespace. No live entry point configures this loader in this task.
 * The pin is approval provenance; recomputing a raw record hash is not approval. */
export function createDiagnosticAuthorizationLoader(trusted: { reviewedOwnerRecordSha256: string; accountRoot: string }) {
  if (!/^[a-f0-9]{64}$/u.test(trusted.reviewedOwnerRecordSha256)) throw new Error("AUTHORIZATION_NOT_CONFIGURED");
  const root = realpathSync(trusted.accountRoot), pin = trusted.reviewedOwnerRecordSha256;
  return { load(rawRecord: unknown, targetDirectory: string): DiagnosticAuthorization {
    const parsed = authorizationRecordSchema.safeParse(rawRecord);
    if (!parsed.success || digest(JSON.stringify(rawRecord)) !== pin) throw new Error("DIAGNOSTIC_AUTHORIZATION");
    const directory = realpathSync(targetDirectory), rel = relative(root, directory);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("PRIOR_LEDGER_ALIAS");
    const existing = readDiagnosticLedger(directory);
    if (existing.length && existing[0].authorizationSha256 !== pin) throw new Error("DIAGNOSTIC_AUTHORIZATION");
    const grant = { record: parsed.data, sha256: pin, root, directory, ...validateInventory({ root, directory, record: parsed.data }) };
    const token = Object.freeze({ [diagnosticAuthorizationBrand]: true as const });
    diagnosticAuthorizations.set(token, grant); return token;
  } };
}
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
const natural = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hashValue = z.string().regex(/^[a-f0-9]{64}$/u), probeIdValue = z.string().regex(/^[a-z0-9-]{1,100}$/u);
const sourceFields = { sourceSha: z.string().regex(/^[a-f0-9]{40}$/u), sourceDigest: hashValue };
const priceSchema = z.strictObject({ inputUsdPerMillion: z.literal(0.1), outputUsdPerMillion: z.literal(0.4), verifiedAt: z.string().refine(value => Number.isFinite(Date.parse(value))), evidenceUrl: z.string().regex(/^https:\/\//u) });
const historyEventSchema = z.discriminatedUnion("event", [
  z.strictObject({ event: z.literal("BEGIN"), ...sourceFields, prices: priceSchema, capMicrounits: z.union([z.literal(250000), z.literal(300000)]), financialEstimate: z.literal("UTF8_BYTES_X4_PLUS_8192_NOT_CERTIFIED_PROVIDER_BOUND"),
    authorizationId: z.string().optional(), authorizationSha256: hashValue.optional(), authorizationRecord: authorizationRecordSchema.optional(), priorLedgers: authorizationRecordSchema.shape.priorLedgers.optional(), priorRetainedMicrounits: natural.optional(), priorUnknownReservations: natural.optional() }),
  z.strictObject({ event: z.literal("RESERVE"), ...sourceFields, probeId: probeIdValue, schemaDigest: hashValue, parentId: probeIdValue.nullable(), difference: z.string().min(1), envelopeDigest: hashValue, envelopeBytes: natural, inputFinancialBound: natural, maxOutputTokens: natural.min(1).max(1536), reservedMicrounits: natural.min(1) }),
  z.strictObject({ event: z.literal("DISPATCH"), probeId: probeIdValue }),
  z.strictObject({ event: z.literal("FINISH"), probeId: probeIdValue, httpStatus: natural.min(100).max(599).nullable(), upstreamCategory: z.string().regex(/^[A-Z_]{1,64}$/u), usage: z.strictObject({ inputTokens: natural, outputTokens: natural }).nullable(), tokenUsageStatus: z.enum(["UNKNOWN", "VALID", "INVALID"]), reportedCostUsd: z.number().finite().nonnegative().nullable().optional(), observedMicrounits: natural.nullable().optional(), tokenEstimatedMicrounits: natural.nullable().optional() }),
  z.strictObject({ event: z.literal("STOP"), reason: z.enum(["DIAGNOSTIC_CAP", "RESERVATION_OVERRUN"]), probeId: probeIdValue }),
]);
type HistoryEvent = z.infer<typeof historyEventSchema>;
type ReservationState = { reserve: Extract<HistoryEvent, { event: "RESERVE" }>; dispatched: boolean; finish?: Extract<HistoryEvent, { event: "FINISH" }> };
/** One closed sequential financial grammar for authority, mutation and reports.
 * Settlement is never capped at the estimate: real overspend remains debt. */
function reduceDiagnosticHistory(rows: Row[]) {
  const invalid: () => never = () => { throw new Error("DIAGNOSTIC_HISTORY_INVALID"); };
  let begin: Extract<HistoryEvent, { event: "BEGIN" }> | undefined, stopped = false, requests = 0;
  const reservations = new Map<string, ReservationState>(), stops = new Set<string>();
  // Exact internal totals preserve individually valid settlements even when
  // their aggregate cannot be represented by a public safe-integer number.
  let reservedMicrounits = 0n, observedMicrounits = 0n, localRetainedMicrounits = 0n, localUnknownReservations = 0;
  for (const [index, row] of rows.entries()) {
    const body = Object.fromEntries(Object.entries(row).filter(([key]) => !["sequence", "previousHash", "hash", "accountingClass"].includes(key)));
    const parsed = historyEventSchema.safeParse(body); if (!parsed.success) invalid();
    const event = parsed.data;
    if (event.event === "BEGIN") {
      if (index !== 0 || begin) invalid(); begin = event;
      const named = event.authorizationRecord;
      if (event.capMicrounits === 250000 ? Object.keys(body).some(key => key.startsWith("authorization") || key.startsWith("prior"))
        : !named || event.authorizationId !== named.authorizationId || event.authorizationSha256 !== digest(JSON.stringify(named)) || JSON.stringify(event.priorLedgers) !== JSON.stringify(named.priorLedgers) || event.priorRetainedMicrounits === undefined || event.priorUnknownReservations === undefined) invalid();
      continue;
    }
    if (!begin) invalid();
    if (event.event === "RESERVE") {
      if (stopped || reservations.has(event.probeId) || [...reservations.values()].some(value => !value.finish)
        || event.sourceSha !== begin.sourceSha || event.sourceDigest !== begin.sourceDigest
        || event.inputFinancialBound !== event.envelopeBytes * 4 + DIAGNOSTIC_FINANCIAL_FRAMING_TOKENS
        || event.reservedMicrounits !== charge(event.inputFinancialBound, event.maxOutputTokens)
        || BigInt(begin.priorRetainedMicrounits ?? 0) + localRetainedMicrounits + BigInt(event.reservedMicrounits) > BigInt(begin.capMicrounits)) invalid();
      reservations.set(event.probeId, { reserve: event, dispatched: false }); reservedMicrounits += BigInt(event.reservedMicrounits); localRetainedMicrounits += BigInt(event.reservedMicrounits); localUnknownReservations++;
    } else if (event.event === "DISPATCH") {
      const state = reservations.get(event.probeId);
      if (stopped || !state || state.dispatched || state.finish) invalid();
      state.dispatched = true; requests++;
    } else if (event.event === "FINISH") {
      const state = reservations.get(event.probeId);
      if (!state || !state.dispatched || state.finish) invalid();
      const cost = event.reportedCostUsd == null ? null : Math.ceil(event.reportedCostUsd * 1000000);
      const estimated = event.usage === null ? null : charge(event.usage.inputTokens, event.usage.outputTokens);
      if (cost !== null && !integer(cost) || estimated !== null && !integer(estimated)
        || (event.observedMicrounits ?? null) !== cost || (event.tokenEstimatedMicrounits ?? null) !== estimated
        || (event.tokenUsageStatus === "VALID") !== (event.usage !== null)) invalid();
      state.finish = event;
      if (cost !== null) { localRetainedMicrounits += BigInt(cost) - BigInt(state.reserve.reservedMicrounits); observedMicrounits += BigInt(cost); localUnknownReservations--; }
      if (cost !== null && cost > state.reserve.reservedMicrounits || estimated !== null && estimated > state.reserve.reservedMicrounits) stopped = true;
    } else {
      const identity = event.reason + ":" + event.probeId, state = reservations.get(event.probeId);
      if (stops.has(identity) || event.reason === "RESERVATION_OVERRUN" && (!state?.finish || ![state.finish.observedMicrounits, state.finish.tokenEstimatedMicrounits].some(value => typeof value === "number" && value > state.reserve.reservedMicrounits))) invalid();
      stops.add(identity); stopped = true;
    }
    if (!integer(localUnknownReservations) || localRetainedMicrounits < 0n) invalid();
  }
  const retainedMicrounits = BigInt(begin?.priorRetainedMicrounits ?? 0) + localRetainedMicrounits, unknownReservations = (begin?.priorUnknownReservations ?? 0) + localUnknownReservations;
  if (!integer(unknownReservations)) invalid();
  if (begin && retainedMicrounits > BigInt(begin.capMicrounits)) stopped = true;
  return { begin, reservations, localRetainedMicrounits, localUnknownReservations, reservedMicrounits, observedMicrounits, retainedMicrounits, unknownReservations, totalSpendKnown: unknownReservations === 0, requests, stopped };
}
export function readDiagnosticLedger(directory: string): Row[] { return readValidatedHistory(directory, new Set(), new Map()); }
function readValidatedHistory(directory: string, ancestors: Set<string>, validated: Map<string, Row[]>): Row[] {
  const canonical = realpathSync(directory);
  if (ancestors.has(canonical)) throw new Error("DIAGNOSTIC_HISTORY_INVALID");
  const cached = validated.get(canonical); if (cached) return cached;
  const nextAncestors = new Set(ancestors).add(canonical);
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
  const state = reduceDiagnosticHistory(rows);
  if (state.begin?.authorizationRecord) {
    const paths = new Set<string>(); let retained = 0n, unknown = 0;
    for (const binding of state.begin.authorizationRecord.priorLedgers) {
      const path = realpathSync(binding.directory);
      if (path !== binding.directory || paths.has(path)) throw new Error("DIAGNOSTIC_HISTORY_INVALID"); paths.add(path);
      const prior = readValidatedHistory(path, nextAncestors, validated);
      if (!prior.length || prior.at(-1)!.hash !== binding.finalHash) throw new Error("PRIOR_LEDGER_BINDING");
      const priorState = reduceDiagnosticHistory(prior); retained += priorState.localRetainedMicrounits; unknown += priorState.localUnknownReservations;
    }
    if (retained !== BigInt(state.begin.priorRetainedMicrounits!) || unknown !== state.begin.priorUnknownReservations) throw new Error("DIAGNOSTIC_HISTORY_INVALID");
  }
  validated.set(canonical, rows); return rows;
}
function locked<T>(directory: string, operation: (rows: Row[]) => T): T {
  const path = join(directory, "diagnostic.lock");
  mkdirSync(path, { mode: 0o700 });
  try { return operation(readDiagnosticLedger(directory)); } finally { rmdirSync(path); }
}
function append(directory: string, rows: Row[], event: Record<string, unknown>) {
  const body = { ...event, accountingClass: "DIAGNOSTIC_PROBE", sequence: rows.length + 1, previousHash: rows.at(-1)?.hash ?? "0".repeat(64) };
  const row = { ...body, hash: digest(JSON.stringify(body)) } as Row;
  reduceDiagnosticHistory([...rows, row]);
  const fd = openSync(join(directory, "diagnostic.jsonl"), "a", 0o600);
  try { writeSync(fd, JSON.stringify(row) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  rows.push(row);
  return row;
}
function summary(rows: Row[]) {
  const { reservedMicrounits, observedMicrounits, retainedMicrounits, unknownReservations, totalSpendKnown, requests, stopped } = reduceDiagnosticHistory(rows);
  const number = (value: bigint) => {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("DIAGNOSTIC_ACCOUNTING_OVERFLOW");
    return Number(value);
  };
  return { reservedMicrounits: number(reservedMicrounits), observedMicrounits: number(observedMicrounits), retainedMicrounits: number(retainedMicrounits), unknownReservations, totalSpendKnown, requests, stopped };
}
export function diagnosticSummary(directory: string) { return summary(readDiagnosticLedger(directory)); }
export function beginDiagnosticLedger(directory: string, input: Source & { prices: DiagnosticPrices; authorization?: unknown }) {
  validatePrices(input.prices);
  if (!/^[a-f0-9]{40}$/u.test(input.sourceSha) || !/^[a-f0-9]{64}$/u.test(input.sourceDigest)) throw new Error("SOURCE_BINDING");
  const grant = input.authorization && typeof input.authorization === "object" ? diagnosticAuthorizations.get(input.authorization) : undefined;
  if (!grant || grant.directory !== realpathSync(directory)) throw new Error("AUTHORIZATION_NOT_CONFIGURED");
  const authorization = grant.record, { priorRetainedMicrounits, priorUnknownReservations } = validateInventory(grant);
  return locked(directory, rows => {
    if (rows.length) throw new Error("LEDGER_ALREADY_STARTED");
    activeGrants.set(grant.directory, grant);
    return append(directory, rows, { event: "BEGIN", sourceSha: input.sourceSha, sourceDigest: input.sourceDigest,
      prices: { inputUsdPerMillion: input.prices.inputUsdPerMillion, outputUsdPerMillion: input.prices.outputUsdPerMillion, verifiedAt: input.prices.verifiedAt, evidenceUrl: input.prices.evidenceUrl },
      capMicrounits: authorization.capMicrounits, authorizationId: authorization.authorizationId, authorizationSha256: grant.sha256,
      authorizationRecord: authorization,
      priorLedgers: authorization.priorLedgers, priorRetainedMicrounits, priorUnknownReservations,
      financialEstimate: "UTF8_BYTES_X4_PLUS_8192_NOT_CERTIFIED_PROVIDER_BOUND" });
  });
}
export function reserveDiagnosticProbe(directory: string, input: Source & { probe: DiagnosticProbe; serializedEnvelope: string; maxOutputTokens: number; authorization?: unknown }) {
  const path = realpathSync(directory);
  const grant = input.authorization !== undefined ? input.authorization && typeof input.authorization === "object" ? diagnosticAuthorizations.get(input.authorization) : undefined : activeGrants.get(path);
  if (!grant || grant.directory !== path) throw new Error("AUTHORIZATION_NOT_CONFIGURED");
  validateInventory(grant);
  return locked(directory, rows => {
    const begin = rows[0];
    if (!begin || begin.event !== "BEGIN" || reduceDiagnosticHistory(rows).stopped) throw new Error("DIAGNOSTIC_STOPPED");
    if (begin.authorizationSha256 !== grant.sha256) throw new Error("DIAGNOSTIC_AUTHORIZATION");
    if (input.sourceSha !== begin.sourceSha || input.sourceDigest !== begin.sourceDigest) throw new Error("SOURCE_BINDING");
    const probe = input.probe;
    if (!/^[a-z0-9-]{1,100}$/u.test(probe.id) || !probe.difference || digest(JSON.stringify(probe.schema)) !== probe.schemaDigest) throw new Error("SCHEMA_BINDING");
    if (rows.some(row => row.event === "RESERVE" && row.probeId === probe.id)) throw new Error("DUPLICATE_PROBE");
    if (rows.some(row => row.event === "RESERVE" && !rows.some(finish => finish.event === "FINISH" && finish.probeId === row.probeId))) throw new Error("UNKNOWN_OR_IN_FLIGHT");
    const envelope = JSON.parse(input.serializedEnvelope);
    if (digest(JSON.stringify(envelope.response_format?.json_schema?.schema)) !== probe.schemaDigest || envelope.max_tokens !== input.maxOutputTokens) throw new Error("SCHEMA_BINDING");
    const estimate = estimateDiagnosticReservation(input.serializedEnvelope, input.maxOutputTokens, begin.prices as DiagnosticPrices);
    const cap = begin.capMicrounits;
    if (typeof cap !== "number" || !integer(cap) || ![DIAGNOSTIC_CAP_MICROUNITS, 300000].includes(cap)) throw new Error("DIAGNOSTIC_AUTHORIZATION");
    if (reduceDiagnosticHistory(rows).retainedMicrounits + BigInt(estimate.reservedMicrounits) > BigInt(cap)) {
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
    if (reduceDiagnosticHistory(rows).stopped) throw new Error("DIAGNOSTIC_STOPPED");
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
