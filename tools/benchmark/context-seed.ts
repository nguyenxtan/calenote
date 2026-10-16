import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ContextSnapshotV2Schema } from "../../src/modules/conversation/context-contract/state";
import type { ContextCase } from "./context-contract";

export const CONTEXT_SEED_VERSION = "trusted-application-context-seed-1";
export const CONTEXT_SEED_BASELINE = "25cdd6dc0e590e6ad04ff032a6587804f9803845";
export const CONTEXT_CHECKPOINT_SOURCE_REVISION = "d861b9bbffdd73d6d1251805538c404fd56c7a44";
export type CheckpointState = { snapshot: import("../../src/modules/conversation/context-contract/state").ContextSnapshotV2 | null;
  inbounds: Array<Record<string, string | number | null>>; contexts: Array<Record<string, string | number | null>>;
  outcomes: Array<Record<string, string | number | null>>; ownership: Array<Record<string, string | number | null>>; completedTurns: number };
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
/** Object insertion order is not an identity. Arrays preserve semantic order. */
export function normalizedSeedJson(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, normalize(x)])) : v;
  return JSON.stringify(normalize(value));
}
export function deriveContextSeed(root: string, script: ContextCase & {executionId?:string}, turn: number) {
  if (!Number.isSafeInteger(turn) || turn < 0 || !script.turns[turn]) throw Error("CONTEXT_SEED_TARGET_INVALID");
  const prerequisite = script.turns.slice(0, turn);
  const fixture = script.executionId ?? script.id;
  const prerequisiteSha256 = hash(JSON.stringify(prerequisite));
  let state: CheckpointState | null = null;
  let accepted: Array<{ turn: number; status: string; pendingField: string | null; contextRevision: number | null }> = [];
  if (turn > 0) {
    const registry = JSON.parse(readFileSync(join(root, "tools/benchmark/fixtures/trusted-context-checkpoints.json"), "utf8"));
    if (registry.version !== "trusted-context-checkpoints-1" || registry.semanticBaselineSha !== CONTEXT_SEED_BASELINE) throw Error("CONTEXT_SEED_REGISTRY_VERSION");
    const entries = registry.checkpoints.filter((c: { fixture: string; turn: number }) => c.fixture === fixture && c.turn === turn);
    if (entries.length !== 1) throw Error("CONTEXT_SEED_CHECKPOINT_UNAVAILABLE");
    const checkpoint = entries[0];
    if (checkpoint.sourceRevision !== CONTEXT_CHECKPOINT_SOURCE_REVISION) throw Error("CONTEXT_SEED_SOURCE_REVISION_INVALID");
    if (checkpoint.prerequisiteSha256 !== prerequisiteSha256 || checkpoint.fixtureSourceSha256 !== hash(readFileSync(join(root, "tools/benchmark/context-contract-fixtures.ts"), "utf8"))) throw Error("CONTEXT_SEED_PREREQUISITE_CHANGED");
    state = checkpoint.state;
    accepted = checkpoint.accepted;
    if (!state || state.completedTurns !== turn || accepted.length !== turn) throw Error("CONTEXT_SEED_PREFIX_INVALID");
    for (const [index, prior] of prerequisite.entries()) {
      const result = accepted[index];
      if (result.turn !== index || result.status !== prior.expect.status || result.pendingField !== (prior.expect.pendingField ?? null) || result.contextRevision !== (prior.expect.contextRevision ?? null)) throw Error("CONTEXT_SEED_PRIOR_ORACLE_INVALID");
      if ((prior.actionsAfter?.length ?? 0) > 0 || prior.deferResponse || prior.resetBefore) throw Error("CONTEXT_SEED_ACTION_UNSUPPORTED");
    }
    if (state.snapshot) {
      state.snapshot = ContextSnapshotV2Schema.parse(state.snapshot);
      if (state.snapshot.pendingDecision || state.snapshot.previewReceipt || state.snapshot.pendingSemanticCandidate) throw Error("CONTEXT_SEED_DEPENDENCY_UNSUPPORTED");
      const prior = prerequisite.at(-1)!;
      if (state.snapshot.contextRevision !== prior.expect.contextRevision || (state.snapshot.pendingQueryQuestion?.field ?? state.snapshot.pendingReminderQuestion?.field ?? null) !== prior.expect.pendingField) throw Error("CONTEXT_SEED_PRIOR_STATE_INVALID");
      if (state.snapshot.transcript.some(t => Date.parse(t.receivedAt) > Date.parse(prior.receipt))) throw Error("CONTEXT_SEED_FUTURE_STATE");
    }
  }
  const contextSeed = { version: CONTEXT_SEED_VERSION, semanticBaselineSha: CONTEXT_SEED_BASELINE, checkpointSourceRevision: CONTEXT_CHECKPOINT_SOURCE_REVISION, fixture, turn, prerequisiteSha256, accepted, state,
    snapshot: state?.snapshot ?? null };
  return { contextSeed, contextSeedDigest: hash(normalizedSeedJson(contextSeed)) };
}
