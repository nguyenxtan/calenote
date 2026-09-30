import { createHash } from "node:crypto";
import { readFileSync, openSync, closeSync, writeSync, existsSync, fsyncSync, unlinkSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { CampaignProfile } from "./context-contract";
import { admitCanonicalCampaign, type ContextManifest } from "./context-contract";

const files = [
  "src/modules/conversation/context-contract/prompt.ts", "src/modules/conversation/context-contract/contracts.ts",
  "src/modules/conversation/context-contract/context.ts", "src/modules/conversation/context-contract/resolve.ts",
  "src/modules/conversation/context-contract/merge.ts", "src/modules/conversation/context-contract/transition.ts",
  "src/modules/conversation/context-contract/service.ts", "src/modules/conversation/context-contract/guidance.ts",
  "src/modules/conversation/context-contract/admission.ts", "src/modules/conversation/context-contract/confirmation.ts",
  "src/modules/conversation/context-contract/control-proof.ts", "src/modules/conversation/context-contract/decisions.ts",
  "src/modules/conversation/context-contract/evidence.ts", "src/modules/conversation/context-contract/observability.ts",
  "src/modules/conversation/context-contract/preview-control.ts", "src/modules/conversation/context-contract/projection.ts",
  "src/modules/conversation/context-contract/query.ts", "src/modules/conversation/context-contract/responses.ts",
  "src/modules/conversation/context-contract/runtime-store.ts", "src/modules/conversation/context-contract/state.ts",
  "src/modules/conversation/context-contract/store.ts", "src/modules/conversation/context-contract/wire.ts",
  "src/modules/conversation/context-contract/infrastructure/d1/store.ts", "src/modules/conversation/lunar-calendar.ts",
  "src/modules/conversation/lunar-vn-months.json", "src/modules/security/keyring.ts",
  "src/modules/conversation/calendar-presentation.ts", "src/modules/intelligence/infrastructure/openrouter/semantic-gateway.ts",
  "src/modules/reminders/detail-presentation.ts", "src/modules/reminders/details-api-service.ts",
  "src/modules/reminders/infrastructure/d1/api-store.ts", "src/modules/reminders/infrastructure/d1/semantic-query-store.ts",
  "src/modules/semantic/infrastructure/d1/budget-store.ts", "src/testing/sqlite-d1.test-support.ts",
  "migrations/0001_production_mvp.sql", "migrations/0002_onboarding_transition_marker.sql",
  "migrations/0003_source_action_foundation.sql", "migrations/0004_user_preferences.sql",
  "migrations/0005_semantic_context_and_budget.sql", "migrations/0006_semantic_budget_dispatch_fence.sql",
  "migrations/0007_conversation_context_v2.sql", "migrations/0008_finite_reminder_series.sql",
  "migrations/0009_llm_context_contract.sql", "wrangler.jsonc",
  "tools/benchmark/context-contract.ts", "tools/benchmark/context-contract-probe.ts", "tools/benchmark/context-contract-live.ts",
  "tools/benchmark/context-contract-fixtures.ts", "tools/benchmark/context-contract.test.ts", "tools/benchmark/context-contract-live.test.ts",
  "tools/benchmark/run-context-contract-live.mjs", "tools/benchmark/register-conversation-loader.mjs",
  "tools/calendar/reference-vectors.json", "package.json", "pnpm-lock.yaml",
  "src/modules/conversation/context-contract/benchmark/regressions.json",
  "src/modules/conversation/context-contract/benchmark/development.json", "src/modules/conversation/context-contract/benchmark/heldout.json",
] as const;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const CONTEXT_ROUTE_ADMISSION = "UNVERIFIED" as const;
export interface PreflightOptions { root: string; readSecret?: () => string; request?: () => unknown; }
function frozenSourcePaths(root: string): string[] {
  const paths = new Set<string>(files);
  const walk = (relative: string, allowed: RegExp) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) walk(path, allowed);
      else if (entry.isFile() && allowed.test(entry.name)) paths.add(path);
    }
  };
  walk("src", /\.(?:ts|tsx|js|mjs|json)$/u);
  walk("migrations", /\.sql$/u);
  return [...paths].sort();
}
export function computeContextSourceFreeze(root: string, paths?: readonly string[]) {
  const digests = Object.fromEntries((paths ?? frozenSourcePaths(root)).map(file => [file, hash(readFileSync(join(root, file)))]));
  return { provenanceDigest: hash(JSON.stringify(digests)), digests };
}
export function preflightContextCampaign({ root }: PreflightOptions) {
  const sourceSha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const { provenanceDigest, digests } = computeContextSourceFreeze(root);
  const manifests = ["regressions", "development", "heldout"].map(name => JSON.parse(readFileSync(join(root, `src/modules/conversation/context-contract/benchmark/${name}.json`), "utf8")) as ContextManifest);
  const corpus: ContextManifest = { version: "context-contract-corpus-1", cases: manifests.flatMap(m => m.cases) };
  const pilot = admitCanonicalCampaign(corpus, "PILOT"), full = admitCanonicalCampaign(corpus, "FULL");
  return { sourceSha, routeAdmission: CONTEXT_ROUTE_ADMISSION, liveEligible: false, networkRequests: 0, secretReads: 0,
    pilot: { scripts: pilot.length, turns: pilot.reduce((n, c) => n + c.turns.length, 0), maxCalls: 192, maxMicrounits: 500000, maxMs: 1200000 },
    full: { scripts: full.length, turns: full.reduce((n, c) => n + c.turns.length, 0), maxCalls: 480, maxMicrounits: 1000000, maxMs: 2700000 },
    provenanceDigest, digests };
}

export interface FutureLiveIntent { root: string; enableLive: boolean; authorizationPath: string; profile: CampaignProfile; runId: string; now: number; }
/** This validates the explicit, source-frozen authorization shape. It never
 * admits a route while Route B lacks independent transport verification. */
export function admitFutureLiveIntent(input: FutureLiveIntent) {
  if (!input.enableLive) throw new Error("EXPLICIT_ENABLE_REQUIRED");
  if (!isAbsolute(input.authorizationPath) || !Number.isSafeInteger(input.now) || input.now < 0
    || !/^[A-Za-z0-9_-]{1,100}$/u.test(input.runId) || !["PILOT", "FULL"].includes(input.profile)) throw new Error("INVALID_LIVE_INTENT");
  const preflight = preflightContextCampaign({ root: input.root });
  const authorization: unknown = JSON.parse(readFileSync(input.authorizationPath, "utf8"));
  if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) throw new Error("INVALID_AUTHORIZATION");
  const record = authorization as Record<string, unknown>;
  const keys = ["version", "sourceSha", "provenanceDigest", "profile", "runId", "approvedAt", "expiresAt",
    "cumulativeAuthorizedMicrounits", "cumulativeRetainedMicrounits"];
  if (Object.keys(record).sort().join("|") !== [...keys].sort().join("|")
    || record.version !== "context-contract-live-1"
    || !Number.isSafeInteger(record.approvedAt) || !Number.isSafeInteger(record.expiresAt)
    || (record.approvedAt as number) < 0 || (record.approvedAt as number) > input.now
    || (record.expiresAt as number) <= input.now
    || !Number.isSafeInteger(record.cumulativeAuthorizedMicrounits)
    || (record.cumulativeAuthorizedMicrounits as number) <= 0 || (record.cumulativeAuthorizedMicrounits as number) > 1500000
    || !Number.isSafeInteger(record.cumulativeRetainedMicrounits)
    || (record.cumulativeRetainedMicrounits as number) < 0
    || (record.cumulativeRetainedMicrounits as number) > (record.cumulativeAuthorizedMicrounits as number)) throw new Error("INVALID_AUTHORIZATION");
  if (record.sourceSha !== preflight.sourceSha || record.provenanceDigest !== preflight.provenanceDigest
    || record.profile !== input.profile || record.runId !== input.runId) throw new Error("AUTHORIZATION_MISMATCH");
  if (preflight.routeAdmission === "UNVERIFIED") throw new Error("ROUTE_ADMISSION_UNVERIFIED");
  throw new Error("LIVE_TRANSPORT_UNIMPLEMENTED");
}

type Begin = { event: "BEGIN"; runId: string; sourceSha: string; profile: CampaignProfile; provenanceDigest: string;
  cumulativeAuthorizedMicrounits: number; cumulativeRetainedMicrounits: number; startedAt: number };
type Reserve = { event: "RESERVE"; runId: string; profile: CampaignProfile; provenanceDigest: string;
  reservationId: string; maximumMicrounits: number; at: number };
type Dispatch = { event: "DISPATCH"; runId: string; reservationId: string; at: number };
type Finish = { event: "FINISH"; runId: string; reservationId: string; at: number; observedMicrounits: number | null };
type Stop = { event: "STOP"; runId: string; at: number; reason: string };
export type CampaignEvent = Begin | Reserve | Dispatch | Finish | Stop;
type Stored = CampaignEvent & { sequence: number; previousHash: string; hash: string };

function ledger(directory: string): Stored[] {
  const path = join(resolve(directory), "campaign.jsonl");
  if (!existsSync(path)) return [];
  const body = readFileSync(path, "utf8");
  if (body && !body.endsWith("\n")) throw new Error("LEDGER_TRUNCATED");
  const rows = body.trim() ? body.trim().split("\n").map(line => JSON.parse(line) as Stored) : [];
  let previousHash = "0".repeat(64);
  for (const [index, row] of rows.entries()) {
    const { hash: actual, ...withoutHash } = row;
    if (row.sequence !== index + 1 || row.previousHash !== previousHash || hash(JSON.stringify(withoutHash)) !== actual) throw new Error("LEDGER_PROVENANCE_CORRUPT");
    previousHash = actual;
  }
  return rows;
}
export function readCampaignLedger(directory: string): readonly Stored[] { return ledger(directory); }
function withLedgerLock<T>(directory: string, operation: () => T): T {
  const path = join(resolve(directory), "campaign.lock");
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeSync(descriptor, `${process.pid}\n`);
    fsyncSync(descriptor);
    return operation();
  } finally {
    closeSync(descriptor);
    unlinkSync(path);
  }
}
function appendUnlocked(directory: string, event: CampaignEvent): Stored {
  const rows = ledger(directory), begin = rows[0];
  if (event.event === "BEGIN") {
    if (rows.length) throw new Error("CAMPAIGN_ALREADY_STARTED");
    if (!/^[0-9a-f]{40}$/u.test(event.sourceSha) || !/^[0-9a-f]{64}$/u.test(event.provenanceDigest)
      || !Number.isSafeInteger(event.cumulativeAuthorizedMicrounits) || event.cumulativeAuthorizedMicrounits <= 0
      || event.cumulativeAuthorizedMicrounits > 1500000
      || !Number.isSafeInteger(event.cumulativeRetainedMicrounits) || event.cumulativeRetainedMicrounits < 0
      || event.cumulativeRetainedMicrounits > event.cumulativeAuthorizedMicrounits
      || !Number.isSafeInteger(event.startedAt) || event.startedAt < 0) throw new Error("INVALID_CUMULATIVE_AUTHORITY");
  } else if (!begin || begin.event !== "BEGIN" || event.runId !== begin.runId
    || (event.event !== "FINISH" && rows.some(r => r.event === "STOP"))) throw new Error("CAMPAIGN_STATE");
  const previousHash = rows.at(-1)?.hash ?? "0".repeat(64);
  const withoutHash = { ...event, sequence: rows.length + 1, previousHash };
  const row: Stored = { ...withoutHash, hash: hash(JSON.stringify(withoutHash)) };
  const descriptor = openSync(join(resolve(directory), "campaign.jsonl"), "a", 0o600);
  try { writeSync(descriptor, JSON.stringify(row) + "\n"); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  return row;
}
export function appendCampaignEvent(directory: string, event: CampaignEvent): Stored {
  if (event.event !== "BEGIN" && event.event !== "STOP") throw new Error("USE_GUARDED_CAMPAIGN_TRANSITION");
  return withLedgerLock(directory, () => appendUnlocked(directory, event));
}
export function reserveCampaignCall(directory: string, input: { runId: string; profile: CampaignProfile; provenanceDigest: string;
  reservationId: string; maximumMicrounits: number; now: number; startedAt: number }) {
  return withLedgerLock(directory, () => reserveUnlocked(directory, input));
}
function reserveUnlocked(directory: string, input: { runId: string; profile: CampaignProfile; provenanceDigest: string;
  reservationId: string; maximumMicrounits: number; now: number; startedAt: number }) {
  const rows = ledger(directory), begin = rows[0];
  if (!begin || begin.event !== "BEGIN" || begin.runId !== input.runId || begin.profile !== input.profile) throw new Error("CROSS_RESUME");
  if (begin.provenanceDigest !== input.provenanceDigest) throw new Error("PROVENANCE_CHANGED");
  if (begin.startedAt !== input.startedAt) throw new Error("CLOCK_ORIGIN_CHANGED");
  if (rows.some(r => r.event === "STOP") || !Number.isSafeInteger(input.now) || input.now < input.startedAt) throw new Error("STOPPED_OR_INVALID_CLOCK");
  const cap = input.profile === "PILOT" ? { calls: 192, cost: 500000, ms: 1200000 } : { calls: 480, cost: 1000000, ms: 2700000 };
  const reservations = rows.filter((r): r is Stored & Reserve => r.event === "RESERVE");
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(input.reservationId) || reservations.some(r => r.reservationId === input.reservationId)
    || !Number.isSafeInteger(input.maximumMicrounits) || input.maximumMicrounits <= 0) throw new Error("INVALID_RESERVATION");
  if (input.now - input.startedAt >= cap.ms || reservations.length >= cap.calls) {
    appendUnlocked(directory, { event: "STOP", runId: input.runId, at: input.now, reason: "TIME_OR_CALL_CAP" });
    return { status: "STOPPED", reason: "TIME_OR_CALL_CAP" } as const;
  }
  const reserved = reservations.reduce((n, r) => n + r.maximumMicrounits, 0);
  if (reserved + input.maximumMicrounits > cap.cost || begin.cumulativeRetainedMicrounits + reserved + input.maximumMicrounits > begin.cumulativeAuthorizedMicrounits) {
    appendUnlocked(directory, { event: "STOP", runId: input.runId, at: input.now, reason: "COST_CAP" });
    return { status: "STOPPED", reason: "COST_CAP" } as const;
  }
  appendUnlocked(directory, { event: "RESERVE", runId: input.runId, profile: input.profile, provenanceDigest: input.provenanceDigest,
    reservationId: input.reservationId, maximumMicrounits: input.maximumMicrounits, at: input.now });
  return { status: "RESERVED" } as const;
}
export function markCampaignDispatched(directory: string, input: { runId: string; reservationId: string; at: number }) {
  return withLedgerLock(directory, () => markDispatchedUnlocked(directory, input));
}
function markDispatchedUnlocked(directory: string, input: { runId: string; reservationId: string; at: number }) {
  const rows = ledger(directory);
  const begin = rows[0] as Begin | undefined;
  const reservation = rows.find((r): r is Stored & Reserve => r.event === "RESERVE" && r.runId === input.runId && r.reservationId === input.reservationId);
  if (!reservation
    || rows.some(r => r.event === "DISPATCH" && r.reservationId === input.reservationId)) throw new Error("MISSING_OR_DUPLICATE_RESERVATION");
  const maximumMs = begin?.profile === "PILOT" ? 1200000 : 2700000;
  if (!begin || begin.event !== "BEGIN" || !Number.isSafeInteger(input.at) || input.at < reservation.at
    || input.at - begin.startedAt >= maximumMs) throw new Error("DISPATCH_DEADLINE");
  return appendUnlocked(directory, { event: "DISPATCH", ...input });
}
export function finishCampaignCall(directory: string, input: { runId: string; reservationId: string; at: number; observedMicrounits: number | null }) {
  return withLedgerLock(directory, () => finishUnlocked(directory, input));
}
function finishUnlocked(directory: string, input: { runId: string; reservationId: string; at: number; observedMicrounits: number | null }) {
  const rows = ledger(directory);
  if (!rows.some(r => r.event === "DISPATCH" && r.runId === input.runId && r.reservationId === input.reservationId)
    || rows.some(r => r.event === "FINISH" && r.reservationId === input.reservationId)) throw new Error("MISSING_OR_DUPLICATE_DISPATCH");
  const maximum = (rows.find(r => r.event === "RESERVE" && r.reservationId === input.reservationId) as Reserve).maximumMicrounits;
  if (input.observedMicrounits !== null && (!Number.isSafeInteger(input.observedMicrounits) || input.observedMicrounits < 0 || input.observedMicrounits > maximum)) throw new Error("INVALID_USAGE");
  return appendUnlocked(directory, { event: "FINISH", ...input });
}
