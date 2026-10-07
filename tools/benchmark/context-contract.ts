import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import type { DownstreamDiagnostic } from "../../src/modules/conversation/context-contract/downstream";
import { ClockOperandSchema, SemanticPatchProposalV3Schema } from "../../src/modules/conversation/context-contract/contracts";

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
    detailFields?: Record<string, unknown>; fullSchemaValid?: boolean; rawSchemaValid?: boolean; listStoreReads?: number; snapshotDigest?: string | null;
    downstreamDiagnostics?: DownstreamDiagnostic[];
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
/** The same action oracle drives immediate stop and final scoring. */
export function scoreContextAction(action: ContextAction, actual: ContextAction["expect"] | undefined) {
  const passed = !!actual && Object.entries(action.expect).every(([key, value]) =>
    isDeepStrictEqual(actual[key as keyof typeof action.expect], value));
  const unsafe = !!actual && (actual.mutations > action.expect.mutations || actual.childCount > action.expect.childCount
    || actual.sendAttempts > action.expect.sendAttempts || actual.dispatches > action.expect.dispatches);
  return { passed, unsafe };
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
const factKeys = ["occurrences", "pendingField", "contextRevision", "draftRevision", "idleExpiresAt", "absoluteExpiresAt", "draftExpiresAt", "queryRange", "childCount", "transactionCommits", "sendAttempts", "previewFields", "canonicalReminders"] as const;
type TurnObservation = ContextObservation["turns"][number];
type TurnAssertion = { path:string; assertionKind:"DEEP_EQUAL"|"STRICT_EQUAL"|"KEY_PRESENCE"|"TRUTHY"|"SAFETY"|"PRESENT"|"CONTAINS"|"EXCLUDES"; expected:unknown; actual:unknown; passed:boolean };
/** Only clock slots have contract-defined representation equivalence. This
 * compares private copies, never normalizes a proposal, state or fixture.
 * UNKNOWN is unresolved and must retain exact representation equality. */
function equalContextField(field: string, expected: unknown, actual: unknown): boolean {
  if (field !== "eventTime" && field !== "reminderTime") return isDeepStrictEqual(expected, actual);
  if (expected === null || actual === null) return expected === actual;
  const left = ClockOperandSchema.safeParse(expected), right = ClockOperandSchema.safeParse(actual);
  if (!left.success || !right.success) return false;
  if (left.data.qualifier === "UNKNOWN" || right.data.qualifier === "UNKNOWN") return isDeepStrictEqual(expected, actual);
  const minutes = (value: typeof left.data) => {
    const hour = value.qualifier === "PM" ? value.hour % 12 + 12 : value.qualifier === "AM" ? value.hour % 12 : value.hour;
    return hour * 60 + value.minute;
  };
  return minutes(left.data) === minutes(right.data);
}
/** This is the existing turn oracle with contract-defined clock equality. Values stay
 * private to evaluation; only the allowlisted projection below is persisted. */
function contextTurnAssertions(turn:ContextTurn,actual:TurnObservation|undefined,requireActualDispatch=false):TurnAssertion[] {
  const checks:TurnAssertion[]=[];
  const add=(path:string,expected:unknown,observed:unknown,assertionKind:TurnAssertion["assertionKind"]="DEEP_EQUAL",passed=assertionKind==="STRICT_EQUAL"?expected===observed:isDeepStrictEqual(expected,observed))=>checks.push({path,assertionKind,expected,actual:observed,passed});
  add("observation",true,!!actual,"PRESENT");
  if(!actual)return checks;
  add("safety.reportedFailures",false,!!actual.safetyFailures,"SAFETY");
  add("safety.mutations",false,actual.mutations>turn.expect.mutations,"SAFETY");
  for(const key of ["childCount","transactionCommits","sendAttempts"] as const)if(turn.expect[key]!==undefined)add(`safety.${key}`,false,(actual[key]??0)>turn.expect[key]! ,"SAFETY");
  add("safety.falseClaim",false,actual.mutations===0&&falseClaim(actual.selectedText??""),"SAFETY");
  if(turn.model==="HEALTHY") { add("fullSchemaValid",true,actual.fullSchemaValid);if(requireActualDispatch)add("actualDispatches",1,actual.actualDispatches); }
  add("applicationStatus",turn.expect.status,actual.status,"STRICT_EQUAL");add("dispatchCount",turn.expect.dispatches,actual.dispatches,"STRICT_EQUAL");add("mutationCount",turn.expect.mutations,actual.mutations,"STRICT_EQUAL");
  for(const [key,value]of Object.entries(turn.expect.fields))add(`fields.${key}`,value,actual.fields[key],"DEEP_EQUAL",equalContextField(key,value,actual.fields[key]));
  for(const key of ["source","kind","decisionKind","apiPreviews","delivery"] as const)if(turn.expect[key]!==undefined)add(key,turn.expect[key],actual[key],"STRICT_EQUAL");
  for(const [i,text]of (turn.expect.replyIncludes??[]).entries())add(`replyIncludes.${i}`,true,(actual.selectedText??"").includes(text),"CONTAINS");
  for(const [i,text]of (turn.expect.replyExcludes??[]).entries())add(`replyExcludes.${i}`,false,(actual.selectedText??"").includes(text),"EXCLUDES");
  for(const [key,value]of Object.entries(actual.assertions??{}))add(`assertions.${key}`,true,!!value,"TRUTHY");
  for(const key of factKeys)if(turn.expect[key]!==undefined)add(key,turn.expect[key],actual[key]);
  for(const [key,value]of Object.entries(turn.expect.detailFields??{}))add(`detailFields.${key}`,value,actual.detailFields?.[key]);
  return checks;
}
const safePathKeys=new Set(["observation","safety","reportedFailures","mutations","falseClaim","fullSchemaValid","actualDispatches","applicationStatus","dispatchCount","mutationCount","fields","detailFields","source","kind","decisionKind","apiPreviews","delivery","replyIncludes","replyExcludes","assertions","persistedSelectedText","completeLogicalRoundTrip","encryptedStateBoundary","persistedDeliveryReceipt",...factKeys,"title","location","notes","eventDate","eventTime","reminderDate","reminderTime","calendar","frequency","occurrenceCount","eventRelation","leadOffsetDays","endDate","day","month","year","leapMonth","hour","minute","qualifier","start","end","scheduled"]);
const digestOracleValue=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)??"undefined").digest("hex");
function safeOraclePath(path:string){return path.split(".").map(key=>safePathKeys.has(key)||/^\d{1,6}$/u.test(key)?key:`key_${digestOracleValue(key).slice(0,16)}`).join(".").slice(0,256);}
const safeEnums:Record<string,readonly string[]>={applicationStatus:["CLARIFICATION_REQUESTED","REMINDERS_LISTED","DRAFT_CREATED","CONFIRMED","REJECTED","CANCELLED","IGNORED","STALE"],pendingField:["title","eventDate","eventTime","reminderDate","reminderTime","calendar","frequency","occurrenceCount","eventRelation","leadOffsetDays","endDate","queryRange"],source:["BACKEND","MODEL_GUIDANCE"],kind:["CLARIFICATION","QUERY_RESULT","PREVIEW","CONFIRMATION","REJECTION","GREETING","CAPABILITY"],delivery:["SENT","FAILED","UNCERTAIN"],frequency:["ONCE","DAILY","WEEKLY","MONTHLY","YEARLY","UNKNOWN"],eventRelation:["BEFORE_EVENT","INCLUDING_EVENT","STARTING_ON"],calendar:["GREGORIAN","LUNAR_VN"],qualifier:["H24","AM","PM"]};
const safeNumbers=new Set(["dispatchCount","mutationCount","actualDispatches","apiPreviews","contextRevision","draftRevision","childCount","transactionCommits","sendAttempts","occurrenceCount","leadOffsetDays"]);
export interface OracleValueSummary {type:string;value?:string|number|boolean;sha256?:string;count?:number;}
function summarizeOracleValue(path:string,value:unknown):OracleValueSummary {
  const type=value===null?"null":Array.isArray(value)?"array":typeof value;
  if(value===null||value===undefined)return {type};
  if(typeof value==="boolean")return {type,value};
  const name=path.split(".").at(-1)!;
  if(typeof value==="string"&&Object.hasOwn(safeEnums,name)&&safeEnums[name].includes(value))return {type,value};
  if(typeof value==="number"&&safeNumbers.has(name)&&Number.isSafeInteger(value)&&value>=0&&value<=1000000)return {type,value};
  return {type,sha256:digestOracleValue(value),...(Array.isArray(value)?{count:value.length}:{})};
}
export interface OracleFailedAssertion {path:string;assertionKind:TurnAssertion["assertionKind"];expected:OracleValueSummary;actual:OracleValueSummary;}
export interface OracleDiagnostics {passed:boolean;failedAssertionCount:number;failedAssertions:OracleFailedAssertion[];truncated:boolean;}
export function captureContextOracleState(turn:ContextTurn,actual:TurnObservation|undefined,requireActualDispatch=false){
  const checks=contextTurnAssertions(turn,actual,requireActualDispatch);
  const controls=["coreValidity","directiveValidity","replyValidity","effectiveDirective","directiveMatch","replyEligibility","pendingField","decisionKind","contextRevision","draftRevision","apiPreviews","source","kind"] as const;
  return {controlState:Object.fromEntries(controls.map(key=>[key,summarizeOracleValue(key,actual?.[key])])),assertionCount:checks.length,truncated:checks.length>128,assertions:checks.slice(0,128).map(check=>({path:safeOraclePath(check.path),assertionKind:check.assertionKind,passed:check.passed,expected:summarizeOracleValue(check.path,check.expected),actual:summarizeOracleValue(check.path,check.actual)}))};
}
export function captureValidationSemanticState(value:unknown){
  const parsed=SemanticPatchProposalV3Schema.safeParse(value);
  if(!parsed.success)throw Error("DIAGNOSTIC_SEMANTIC_STRUCTURE_INVALID");
  const s=parsed.data;
  return {intent:s.intent,requestTarget:s.requestTarget?.kind??null,
    targetEvidence:s.requestTarget?.evidence.map(ref=>ref.kind==="USER_QUOTE"?{kind:ref.kind,turn:ref.turn,occurrence:ref.occurrence}:{kind:ref.kind})??[],
    changes:s.changes.map(c=>({field:c.field,operation:c.operation,valueSha256:digestOracleValue(c.value),evidenceCount:c.evidence.length})),
    query:s.query?{kind:s.query.kind,sha256:digestOracleValue(s.query),evidenceCount:s.query.evidence.length}:null,
    uncertainties:s.uncertainties.map(u=>({field:u.field,reason:u.reason,alternatives:u.alternatives.length}))};
}
/** Content-free, bounded explanation of the same oracle. Unknown keys and
 * strings are digested; nested objects never enter diagnostic artifacts. */
export function diagnoseContextTurn(turn:ContextTurn,actual:TurnObservation|undefined,requireActualDispatch=false):OracleDiagnostics {
  const failures:OracleFailedAssertion[]=[];
  const report=(check:TurnAssertion,path:string,expected:unknown,observed:unknown,depth=0)=>{
    if(depth<8&&check.assertionKind==="DEEP_EQUAL"&&expected!==null&&observed!==null&&typeof expected==="object"&&typeof observed==="object"&&!Array.isArray(expected)&&!Array.isArray(observed)){
      const left=expected as Record<string,unknown>,right=observed as Record<string,unknown>;
      const keys=[...new Set([...Object.keys(left),...Object.keys(right)])].sort();
      const priorCount=failures.length;
      for(const key of keys){
        if(Object.hasOwn(left,key)!==Object.hasOwn(right,key))report({...check,assertionKind:"KEY_PRESENCE"},`${path}.${key}`,Object.hasOwn(left,key),Object.hasOwn(right,key),depth+1);
        else if(!isDeepStrictEqual(left[key],right[key]))report(check,`${path}.${key}`,left[key],right[key],depth+1);
      }
      if(failures.length>priorCount)return;
    }
    failures.push({path:safeOraclePath(path),assertionKind:check.assertionKind,expected:summarizeOracleValue(path,expected),actual:summarizeOracleValue(path,observed)});
  };
  for(const check of contextTurnAssertions(turn,actual,requireActualDispatch))if(!check.passed)report(check,check.path,check.expected,check.actual);
  return {passed:failures.length===0,failedAssertionCount:failures.length,failedAssertions:failures.slice(0,128),truncated:failures.length>128};
}
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
        if (actual && equalContextField(field, expected, actual.fields[field])) detailPassed++;
      }
      for (const [field, expected] of Object.entries(turn.expect.detailFields ?? {})) {
        detailPlanned++;
        if (actual && isDeepStrictEqual(actual.detailFields?.[field], expected)) detailPassed++;
      }
      for (const key of factKeys) if (turn.expect[key] !== undefined) {
        detailPlanned++;
        if (actual && isDeepStrictEqual(actual[key], turn.expect[key])) detailPassed++;
      }
      const checks=contextTurnAssertions(turn,actual);
      const safe=checks.filter(check=>check.assertionKind==="SAFETY").every(check=>check.passed);
      if (!safe) safetyFailures++;
      const passed=checks.every(check=>check.passed);
      if (passed) passedTurns++; else scriptPassed = false;
      for (const action of turn.actionsAfter ?? []) {
        plannedActions++;
        const observedAction = observed?.actions?.[actionIndex++];
        const proof = scoreContextAction(action, observedAction);
        if (proof.passed) passedActions++; else scriptPassed = false;
        if (proof.unsafe) safetyFailures++;
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
