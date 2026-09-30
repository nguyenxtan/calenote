import { isDeepStrictEqual } from "node:util";

export type CampaignProfile = "PILOT" | "FULL";
export type ContextCaseGroup = "ORIGINAL" | "DEVELOPMENT" | "HELDOUT";
export type ModelExpectation = "HEALTHY" | "BYPASS" | "INJECTED_REFUSAL";
export interface ContextAction {
  kind: "REPLAY_LAST" | "RELEASE_DELAYED";
  at: string;
  expect: { status: string; dispatches: number; mutations: number; sendAttempts: number; childCount: number };
}
export interface ContextTurn {
  text: string;
  receipt: string;
  processingAt?: string;
  deferResponse?: boolean;
  model: ModelExpectation;
  branch?: "A" | "B";
  resetBefore?: boolean;
  actionsAfter?: ContextAction[];
  fault?: "TIMEOUT" | "INVALID_JSON" | "SCHEMA_INVALID" | "DELIVERY_FAILED" | "DELIVERY_UNCERTAIN" | "BUDGET";
  expect: { status: string; dispatches: number; mutations: number; fields: Record<string, unknown>;
    source?: "BACKEND" | "MODEL_GUIDANCE"; kind?: string; decisionKind?: string | null;
    replyIncludes?: string[]; replyExcludes?: string[]; detailFields?: Record<string, unknown>;
    previewFields?: Record<string, unknown>; canonicalReminders?: Array<Record<string, unknown>>;
    apiPreviews?: number; delivery?: "SENT" | "FAILED" | "UNCERTAIN";
    occurrences?: string[]; pendingField?: string | null; contextRevision?: number | null;
    draftRevision?: number | null; idleExpiresAt?: string | null; absoluteExpiresAt?: string | null;
    draftExpiresAt?: string | null; queryRange?: { start: number; end: number } | null;
    childCount?: number; transactionCommits?: number; sendAttempts?: number };
}
export interface ContextCase { id: string; group: ContextCaseGroup; mandatory: boolean; turns: ContextTurn[]; }
export interface ContextManifest { version: "context-contract-corpus-1"; cases: ContextCase[]; }
export interface PlannedContextCase extends ContextCase { executionId: string; }
export interface ContextObservation {
  id: string;
  actions?: ContextAction["expect"][];
  turns: Array<{ status: string; dispatches: number; mutations: number; fields: Record<string, unknown>;
    source?: "BACKEND" | "MODEL_GUIDANCE"; kind?: string; decisionKind?: string | null;
    selectedText?: string; delivery?: "SENT" | "FAILED" | "UNCERTAIN"; apiPreviews?: number;
    detailFields?: Record<string, unknown>; fullSchemaValid?: boolean; rawSchemaValid?: boolean;
    previewFields?: Record<string, unknown>; canonicalReminders?: Array<Record<string, unknown>>;
    coreValidity?: string; directiveValidity?: string; replyValidity?: string; effectiveDirective?: string;
    directiveMatch?: string; replyEligibility?: string;
    actualDispatches?: number; assertions?: Record<string, boolean>; safetyFailures?: number;
    occurrences?: string[]; pendingField?: string | null; contextRevision?: number | null;
    draftRevision?: number | null; idleExpiresAt?: string | null; absoluteExpiresAt?: string | null;
    draftExpiresAt?: string | null; queryRange?: { start: number; end: number } | null;
    childCount?: number; transactionCommits?: number; sendAttempts?: number;
    snapshotEncodedBytes?: number | null; snapshotLogicalBytes?: number | null }>;
}
const critical = ["R02", "R03", "R05", "R06", "R07", "R08", "R11", "R13"];
const requiredClosure = ["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08"];
const requiredGuidance = ["D09", "D10"];
const fail = (code: string): never => { throw new Error(code); };

export function admitContextManifest(manifest: ContextManifest): ContextManifest {
  if (manifest.version !== "context-contract-corpus-1" || !Array.isArray(manifest.cases)) fail("INVALID_MANIFEST");
  const ids = new Set<string>();
  for (const script of manifest.cases) {
    if (!/^(?:R(?:0[1-9]|1[0-6])|D(?:0[1-9]|1[0-6])|H(?:0[1-9]|[12][0-9]|3[0-2]))$/u.test(script.id) || ids.has(script.id)) fail("INVALID_OR_DUPLICATE_ID");
    ids.add(script.id);
    if (!script.turns.length || script.turns.length > 6) fail("USER_TURN_LIMIT");
    let branch: string | undefined;
    let deferred = 0;
    for (const [index, turn] of script.turns.entries()) {
      if (!turn.text || turn.text !== turn.text.normalize("NFC") || !Number.isFinite(Date.parse(turn.receipt))) fail("INVALID_TURN");
      if (turn.processingAt && (!Number.isFinite(Date.parse(turn.processingAt)) || Date.parse(turn.processingAt) < Date.parse(turn.receipt))) fail("INVALID_PROCESSING_TIME");
      if (index && Date.parse(turn.receipt) < Date.parse(script.turns[index - 1].receipt)) fail("RECEIPT_ORDER");
      if (!Number.isInteger(turn.expect.dispatches) || turn.expect.dispatches < 0 || turn.expect.dispatches > 1 || !Number.isInteger(turn.expect.mutations) || turn.expect.mutations < 0) fail("INVALID_EXPECTATION");
      if (branch && turn.branch && turn.branch !== branch && !turn.resetBefore) fail("RESET_REQUIRED");
      if (turn.resetBefore && !turn.branch) fail("RESET_WITHOUT_BRANCH");
      if (turn.deferResponse) deferred++;
      branch = turn.branch ?? branch;
      for (const action of turn.actionsAfter ?? []) {
        if (!["REPLAY_LAST", "RELEASE_DELAYED"].includes(action.kind) || !Number.isFinite(Date.parse(action.at)) || Date.parse(action.at) < Date.parse(turn.receipt)
          || action.expect.dispatches !== 0 || action.expect.mutations < 0 || action.expect.sendAttempts < 0 || action.expect.childCount < 0) fail("INVALID_ACTION");
        if (action.kind === "RELEASE_DELAYED" && --deferred !== 0) fail("UNMATCHED_DELAYED_RELEASE");
      }
    }
    if (deferred !== 0) fail("UNMATCHED_DELAYED_RELEASE");
    if (script.id === "R04" && (!script.turns.some(t => t.branch === "A") || !script.turns.some(t => t.branch === "B") || !script.turns.some(t => t.resetBefore))) fail("RESET_REQUIRED");
  }
  return manifest;
}

export function expandContextCampaign(manifest: ContextManifest, profile: CampaignProfile, repeatIds: readonly string[] = critical): PlannedContextCase[] {
  admitContextManifest(manifest);
  const cases = manifest.cases.filter(c => profile === "FULL" || c.group === "ORIGINAL");
  const planned = cases.map(c => ({ ...c, executionId: c.id }));
  for (const id of repeatIds) {
    const original = cases.find(c => c.id === id && c.group === "ORIGINAL") ?? fail("MISSING_CRITICAL_REPEAT_SOURCE");
    planned.push({ ...original, executionId: `${id}#2` }, { ...original, executionId: `${id}#3` });
  }
  return planned;
}

export function admitCanonicalCampaign(manifest: ContextManifest, profile: CampaignProfile): PlannedContextCase[] {
  admitContextManifest(manifest);
  const groups = { ORIGINAL: 0, DEVELOPMENT: 0, HELDOUT: 0 };
  for (const c of manifest.cases) groups[c.group]++;
  if (groups.ORIGINAL !== 16 || groups.DEVELOPMENT !== 16 || groups.HELDOUT !== 32) fail("CORPUS_ALLOCATION");
  if (![...Array(16)].every((_, i) => manifest.cases.some(c => c.id === `R${String(i + 1).padStart(2, "0")}` && c.group === "ORIGINAL" && c.mandatory))) fail("ORIGINALS_REQUIRED");
  if (![...requiredClosure, ...requiredGuidance].every(id => manifest.cases.some(c => c.id === id && c.group === "DEVELOPMENT" && c.mandatory))) fail("MANDATORY_DEVELOPMENT_REQUIRED");
  const slots = ["title", "location", "notes", "eventDate", "eventTime", "reminderDate", "reminderTime", "calendar", "frequency", "occurrenceCount", "eventRelation", "leadOffsetDays", "endDate"];
  for (const script of manifest.cases) for (const turn of script.turns) {
    if (["occurrences", "pendingField", "contextRevision", "draftRevision", "idleExpiresAt", "absoluteExpiresAt", "draftExpiresAt", "queryRange", "childCount", "transactionCommits", "sendAttempts", "apiPreviews", "previewFields", "canonicalReminders"].some(key => !(key in turn.expect))
      || (turn.expect.contextRevision !== null && slots.some(key => !(key in turn.expect.fields)))) fail("INCOMPLETE_FACTUAL_ORACLE");
  }
  const planned = expandContextCampaign(manifest, profile);
  if (planned.length !== (profile === "PILOT" ? 32 : 80)) fail("CAMPAIGN_SIZE");
  return planned;
}

const falseClaim = (text: string): boolean => /(?:đã\s+(?:lưu|tạo|đặt|hủy|huỷ)|lời\s+nhắc\s+(?:đã\s+)?(?:được\s+)?lưu|tôi\s+đã\s+(?:lưu|đặt)|hằng\s+năm\s+(?:đã\s+)?(?:được\s+)?hỗ\s+trợ)/iu.test(text.normalize("NFC"));
export function scoreContextCampaign(planned: readonly PlannedContextCase[], observations: readonly ContextObservation[]) {
  const seen = new Map(observations.map(o => [o.id, o]));
  if (seen.size !== observations.length || observations.some(o => !planned.some(p => p.executionId === o.id))) fail("UNPLANNED_OR_DUPLICATE_OBSERVATION");
  let passedScripts = 0, plannedTurns = 0, passedTurns = 0, healthyPlanned = 0, healthyFullSchemaValid = 0;
  let actualDispatches = 0, rawValid = 0, detailPlanned = 0, detailPassed = 0, safetyFailures = 0, heldoutPassed = 0;
  let plannedActions = 0, passedActions = 0;
  const missingScripts: string[] = [], failedMandatory: string[] = [], failedScripts: string[] = [];
  for (const script of planned) {
    const observed = seen.get(script.executionId); let scriptPassed = true;
    if (!observed) missingScripts.push(script.executionId);
    plannedTurns += script.turns.length;
    let actionIndex = 0;
    for (const [index, turn] of script.turns.entries()) {
      const actual = observed?.turns[index];
      if (turn.model === "HEALTHY") { healthyPlanned++; if (actual?.actualDispatches === 1 && actual.fullSchemaValid === true) healthyFullSchemaValid++; }
      actualDispatches += actual?.actualDispatches ?? 0;
      rawValid += actual?.actualDispatches === 1 && actual.rawSchemaValid ? 1 : 0;
      for (const [field, expected] of Object.entries(turn.expect.fields)) {
        detailPlanned++;
        if (actual && isDeepStrictEqual(actual.fields[field], expected)) detailPassed++;
      }
      for (const [field, expected] of Object.entries(turn.expect.detailFields ?? {})) {
        detailPlanned++;
        if (actual && isDeepStrictEqual(actual.detailFields?.[field], expected)) detailPassed++;
      }
      const factKeys = ["occurrences", "pendingField", "contextRevision", "draftRevision", "idleExpiresAt", "absoluteExpiresAt", "draftExpiresAt", "queryRange", "childCount", "transactionCommits", "sendAttempts", "previewFields", "canonicalReminders"] as const;
      for (const key of factKeys) if (turn.expect[key] !== undefined) {
        detailPlanned++;
        if (actual && isDeepStrictEqual(actual[key], turn.expect[key])) detailPassed++;
      }
      const selected = actual?.selectedText ?? "";
      const safe = !actual?.safetyFailures && !(actual && actual.mutations > turn.expect.mutations)
        && !(actual && turn.expect.childCount !== undefined && (actual.childCount ?? 0) > turn.expect.childCount)
        && !(actual && turn.expect.transactionCommits !== undefined && (actual.transactionCommits ?? 0) > turn.expect.transactionCommits)
        && !(actual && turn.expect.sendAttempts !== undefined && (actual.sendAttempts ?? 0) > turn.expect.sendAttempts)
        && !(actual && actual.mutations === 0 && falseClaim(selected));
      if (!safe) safetyFailures++;
      const equalFields = Object.entries(turn.expect.fields).every(([name, value]) => actual && isDeepStrictEqual(actual.fields[name], value));
      const passed = !!actual && safe && (turn.model !== "HEALTHY" || actual.fullSchemaValid === true) && actual.status === turn.expect.status && actual.dispatches === turn.expect.dispatches && actual.mutations === turn.expect.mutations
        && equalFields && (turn.expect.source === undefined || actual.source === turn.expect.source)
        && (turn.expect.kind === undefined || actual.kind === turn.expect.kind)
        && (turn.expect.decisionKind === undefined || actual.decisionKind === turn.expect.decisionKind)
        && (turn.expect.apiPreviews === undefined || actual.apiPreviews === turn.expect.apiPreviews)
        && (turn.expect.delivery === undefined || actual.delivery === turn.expect.delivery)
        && (turn.expect.replyIncludes ?? []).every(s => selected.includes(s))
        && (turn.expect.replyExcludes ?? []).every(s => !selected.includes(s))
        && Object.values(actual.assertions ?? {}).every(Boolean)
        && factKeys.every(key => turn.expect[key] === undefined || isDeepStrictEqual(actual[key], turn.expect[key]))
        && Object.entries(turn.expect.detailFields ?? {}).every(([field, value]) => isDeepStrictEqual(actual.detailFields?.[field], value));
      if (passed) passedTurns++; else scriptPassed = false;
      for (const action of turn.actionsAfter ?? []) {
        plannedActions++;
        const observedAction = observed?.actions?.[actionIndex++];
        const actionPassed = !!observedAction && Object.entries(action.expect).every(([key, value]) =>
          isDeepStrictEqual(observedAction[key as keyof typeof action.expect], value));
        if (actionPassed) passedActions++; else scriptPassed = false;
        if (observedAction && (observedAction.mutations > action.expect.mutations || observedAction.childCount > action.expect.childCount
          || observedAction.sendAttempts > action.expect.sendAttempts || observedAction.dispatches > action.expect.dispatches)) safetyFailures++;
      }
    }
    if (observed?.turns.length !== script.turns.length) scriptPassed = false;
    if ((observed?.actions?.length ?? 0) !== actionIndex) scriptPassed = false;
    if (scriptPassed) { passedScripts++; if (script.group === "HELDOUT") heldoutPassed++; }
    else { failedScripts.push(script.executionId); if (script.mandatory || script.executionId.includes("#")) failedMandatory.push(script.executionId); }
  }
  const profile = planned.length === 32 ? "PILOT" : "FULL";
  const gate = planned.length === 32 || planned.length === 80
    ? (profile === "PILOT" ? passedScripts === 32 && healthyFullSchemaValid === healthyPlanned
      : passedScripts >= 76 && heldoutPassed >= 31 && healthyFullSchemaValid / Math.max(1, healthyPlanned) >= .99)
      && failedMandatory.length === 0 && detailPassed === detailPlanned && safetyFailures === 0 ? "PASS" : "FAIL"
    : "FAIL";
  return { gate, profile, plannedScripts: planned.length, passedScripts, plannedTurns, passedTurns, healthyPlanned, healthyFullSchemaValid,
    actualDispatches, rawValid, detailPlanned, detailPassed, safetyFailures, heldoutPassed, plannedActions, passedActions, missingScripts, failedScripts, failedMandatory };
}
