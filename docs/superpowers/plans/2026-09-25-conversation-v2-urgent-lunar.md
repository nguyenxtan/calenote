# Conversation V2, Urgent Reminders and Lunar Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make short reminder conversations contextual and responsive, including confirmed finite daily reminder series and explicit Vietnamese lunar dates.

**Architecture:** Keep model output semantic-only and backend temporal evidence authoritative. Add an encrypted, revision-fenced conversation store and finite-series persistence around existing reminder/delivery machinery. Build modules behind a default-off capability gate, then compose and test the complete path without enabling production.

**Tech Stack:** TypeScript, Zod, Vitest, local Miniflare/D1, existing keyring, Next.js 16 and Cloudflare Workers; Astronomy Engine 2.1.19 as an offline data-generation dependency only.

**Spec:** `docs/superpowers/specs/2026-09-25-conversation-v2-urgent-lunar-design.md`

**Status:** IMPLEMENTATION_AUTHORIZED — user approved whole-package execution
and UAT review on 2026-09-25. Execute inline with automated task gates and final
independent whole-branch review; no task-by-task human approval. Provider calls,
remote migrations and deployment retain their separate safety gates.

## Global Constraints

- Default calendar is Gregorian. Only an explicit lunar request activates `LUNAR_VN` for the active request.
- Keep `AI_MODE=privacy`, `google/gemini-2.5-flash-lite`, `google-vertex/eu`, ZDR, and no model/provider fallback.
- Keep 50 owner calls/day, 500000 owner monthly cost microunits, and 2000000 global daily cost microunits.
- The model must not supply dates, times, timezone, epochs, SQL, internal IDs, ownership, persistence decisions, or confirmed status.
- At most six user turns, each at most 2000 Unicode characters, and at most 16 KiB UTF-8 total context payload. Existing stricter inbound limits remain in force.
- Idle TTL is 30 minutes, with a two-hour absolute lifetime. Retain the existing shorter draft confirmation lifetime.
- Finite daily series: 2–30 occurrences, one explicit reminder time per day, all within 366 days of confirmation. One occurrence uses the existing one-off flow.
- Lunar years 1900–2100 require deterministic conformance evidence; uncertainty blocks release, not a silent range reduction.
- No AI call merely for wording. Reuse existing encryption and claim/budget fences.
- No burst grouping, debounce, parallel inbound processing, or Queue/cron configuration change. Continuous-message work stays after admin; admin is not in this plan.
- No production credentials, live model calls, remote migrations, master merge, or deploy during implementation. A new exact-master authorization is required for deployment.
- Preserve the current worktree and prior accepted evidence; never reset/stash/delete it to simplify execution.

## Review Focus

1. Greeting mixed with a real request must not swallow the request; test in Tasks 1 and 6.
2. Midnight between receipt, clarification, and confirmation must not move an event date or silently drop past occurrences; test in Tasks 2, 4 and 5.
3. Lunar normal/leap months and Vietnamese-versus-Chinese day boundaries must not be guessed; test in Task 2 against external reference facts.
4. Concurrent edit/confirm/cancel and expired context must not resurrect an old proposal or cross owners; test in Tasks 3, 5 and 6, without implementing burst handling.
5. Lost delivery acknowledgement and rollback to the old Worker must not resend a cancelled/uncertain occurrence; test in Tasks 5 and 9.

## Workspace, dependencies and review contract

Reuse `/Users/bichtuyen/code/calenote/.worktrees/product-experience-v2`, branch
`codex/conversation-v2-urgent-lunar`. Inspected runtime base is
`9018344f1f8b1e0adf4d7905d3e7e6550f9ee5ad`; docs checkpoint is `9f51e42`.
Recheck branch, HEAD, status and worktrees before executing. Do not edit the
older root checkout or create another worktree automatically.

Each task ends with focused tests, `pnpm typecheck`, `git diff --check`, a
selective commit, and task-level independent acceptance with zero Critical and
Important findings before the next task. Save RED command/output, GREEN
command/output, commit and review evidence in
`docs/implementation/conversation-v2-progress.md`. An expected assertion or
missing-export failure is RED evidence; a broken test runner is not.

Read local Next guides before Task 8 code:
`node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
and `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`.
Read Cloudflare Workers best-practices and Wrangler skills before Worker config
work or Wrangler commands. Do not invoke the `deploy` package script: its
non-dry-run form changes production.

## File and interface map

New cohesive modules under `src/modules/conversation/`:

- `contracts.ts`: versioned application state, semantic dialogue schema, limits.
- `temporal.ts`: calendar/cadence evidence extraction, no provider or persistence.
- `lunar-calendar.ts`: table-backed pure lunar adapter.
- `lunar-vn-months.json`: generated month starts, version and checksum.
- `context-store.ts`, `infrastructure/d1/context-store.ts`: scoped encrypted CAS lifecycle.
- `reconcile.ts`: pure state transition with no storage/network calls.
- `responses.ts`: deterministic contextual language from validated outcomes.
- `service.ts`: orchestrates prepared provider attempt, context and proposals.
- `processing-feedback.ts`: managed bounded feedback independent of inference.

New `src/modules/reminders/series.ts` and
`src/modules/reminders/infrastructure/d1/series-store.ts` own finite-series
proposal/confirmation/cancellation. Do not turn `command-service.ts` into a
second conversation engine; keep its deterministic controls and delegate V2.

Existing integration points: `src/modules/inbound/processor.ts`,
`src/worker/composition-root.ts`, `src/worker/index.ts`,
`src/modules/intelligence/semantic-gateway.ts`,
`src/modules/intelligence/infrastructure/openrouter/semantic-gateway.ts`,
`src/modules/security/keyring.ts`, reminder API contracts/routes and
`src/features/core-screens/CoreScreenExperience.tsx`.

Migration numbers available at inspection: `0007` and `0008`. Recheck the
migrations directory before creating them; if another reviewed branch has used
a number, stop to reconcile numbering rather than modifying an old migration.

## Task 1 — Versioned domain and semantic dialogue contract

**Files:** Create `src/modules/conversation/contracts.ts`, `contracts.test.ts`;
modify `src/modules/intelligence/semantic-gateway.ts` and its OpenRouter adapter
and tests; create `src/modules/conversation/prompt.ts`, `prompt.test.ts`.

**Consumes:** existing `ModelSemanticInterpretationSchema`, strict provider
envelope, budget preparation and immutable attempt fencing.

**Produces:** the following shared application interfaces (all strings carrying
dates/times are validated by strict runtime schemas, not TypeScript alone):

```ts
export type CalendarKind = "GREGORIAN" | "LUNAR_VN";
export type DialogueAct = "GREET" | "CAPABILITY" | "CONTINUE" | "EDIT"
  | "ABANDON" | "NEW_REQUEST" | "AMBIGUOUS";
export type MissingField = "title" | "eventDate" | "date" | "time"
  | "year" | "leapMonth" | "seriesCount" | "seriesRelation" | "intent";
export interface LunarDate {
  year: number; month: number; day: number; leap: boolean;
}
export interface DateFact {
  solarDate: string; calendar: CalendarKind;
  lunar: LunarDate | null; conversionVersion: string | null;
  sourceInboundId: string;
}
export type SeriesRelation = "STARTING_ON" | "BEFORE_EVENT" | "INCLUDING_EVENT";
export interface PendingRequest {
  title: string | null;
  calendar: CalendarKind;
  eventDate: DateFact | null;
  reminderDate: DateFact | null;
  reminderTime: string | null;
  count: number | null;
  relation: SeriesRelation | null;
  missing: MissingField[];
}
export interface ConversationScope {
  ownerId: string; chatIdentityId: string;
  sourceInboundId: string; claimMarker: string; now: number;
}
export type ConversationStatus = "CLARIFYING" | "DRAFT_READY"
  | "COMPLETED" | "CANCELLED" | "EXPIRED" | "INVALID";
export interface ConversationSnapshot {
  id: string; revision: number; status: ConversationStatus;
  createdAt: number; expiresAt: number;
  request: PendingRequest;
  turns: { userText: string; receivedAt: number; outcomeCode: string }[];
}
```

- [ ] Write RED tests for the strict V2 provider object: original semantic
  fields plus `dialogueAct`, `continuation` (`YES|NO|UNCERTAIN`) and
  `capability` (`LUNAR|null`). Reject dates, aliases, IDs, raw reply prose,
  `CONFIRM` and unknown properties. Keep V1 schema unchanged for disabled V2.

```ts
it("rejects a temporal authority smuggled into dialogue", () => {
  const semantic = { intent: "CREATE_REMINDER", title: "ôn thi",
    titleState: "RESOLVED", targetIntent: null, dialogueAct: "NEW_REQUEST",
    continuation: "NO", capability: null };
  expect(ConversationModelSchema.safeParse(semantic).success).toBe(true);
  for (const field of ["localDate", "localTime", "rangeKind", "epoch", "ownerId"]) {
    expect(ConversationModelSchema.safeParse({ ...semantic, [field]: "invented" }).success).toBe(false);
  }
});
```

- [ ] Run `pnpm exec vitest run src/modules/conversation/contracts.test.ts`
  and capture expected missing schema/export failure.
- [ ] Define strict Zod schemas and derive types; compose the existing semantic
  schema with new bounded dialogue fields. CAPABILITY requires HELP and a
  non-null capability; greet/abandon cannot confirm or mutate. Mixed greeting
  plus reminder keeps CREATE semantics, not GREET-only behavior.
  Export `ConversationModelSchema` and
  `type ConversationModel = z.infer<typeof ConversationModelSchema>` from
  `src/modules/conversation/contracts.ts` for all subsequent tasks.
- [ ] Define `CONVERSATION_PROMPT_VERSION` and canonical prompt prohibiting
  temporal/mutation authority. Provider input contains current text and only
  authorized bounded context; structured state is application data, never
  instructions. Allow at most one prepared model attempt per V2 inbound.
- [ ] Refactor the gateway's strict-schema/prompt selection into a reviewed V1
  or V2 contract parameter, default V1; retain identical pinned transport,
  reasoning policy, caps, Authorization separation and fallback prohibition.
  Do not add a second provider transport.
- [ ] Run contract/prompt and existing OpenRouter request-shape tests. Verify
  disabled V2 emits the exact old schema and enabled V2 emits the exact new one.
- [ ] Validate, selectively commit `feat(conversation): define semantic-only dialogue contract`, then independent review.

## Task 2 — Deterministic calendar, event and cadence evidence

**Files:** Create `src/modules/conversation/temporal.ts`, `temporal.test.ts`,
`lunar-calendar.ts`, `lunar-calendar.test.ts`, `lunar-vn-months.json`;
`tools/calendar/generate-lunar-vn.ts`, `tools/calendar/reference-vectors.json`,
`docs/architecture/lunar-vn-conversion.md`; modify `package.json`/lockfile only
for the pinned offline generation dependency. Preserve the accepted scanner.

**Consumes:** existing `TemporalEvidence` and immutable receipt-time reference.
**Produces:**

```ts
export type Evidence<T> = { state: "MISSING" }
  | { state: "RESOLVED"; value: T }
  | { state: "AMBIGUOUS"; reason: string };
export interface ConversationTemporalEvidence {
  calendar: Evidence<CalendarKind>;
  eventDate: Evidence<DateFact>; reminderDate: Evidence<DateFact>;
  time: Evidence<string>; count: Evidence<number>;
  relation: Evidence<SeriesRelation>;
  missing: MissingField[];
}
export interface LunarCalendarAdapter {
  version: string;
  toSolar(input: LunarDate): { status: "RESOLVED"; solarDate: string }
    | { status: "INVALID" | "OUT_OF_RANGE" };
  toLunar(solarDate: string): LunarDate | null;
  hasLeapMonth(year: number, month: number): boolean;
}
export function extractConversationTemporalEvidence(input: {
  text: string; receivedAt: number; sourceInboundId: string;
  currentCalendar: CalendarKind;
}, calendar: LunarCalendarAdapter): ConversationTemporalEvidence;
```

- [ ] Write RED tests: known event date versus reminder time; two conflicting
  dates; missing year/leap distinction; `12h trưa, nhắc liên tục 3 ngày` resolves
  time/count but not relation; greeting/capability alone produces no date or
  calendar-mode change. Add generated separator/order regressions to retain
  Temporal Island dimension ownership, never prefix/suffix literal patches.

```ts
it("requires the anchor relation instead of inventing three dates", () => {
  const e = extractConversationTemporalEvidence({
    text: "12h trưa, nhắc liên tục 3 ngày",
    receivedAt: Date.parse("2026-10-01T02:00:00Z"),
    sourceInboundId: "synthetic-1", currentCalendar: "GREGORIAN",
  }, lunarCalendar);
  expect(e.time).toEqual({ state: "RESOLVED", value: "12:00" });
  expect(e.count).toEqual({ state: "RESOLVED", value: 3 });
  expect(e.relation.state).toBe("MISSING");
});
```

- [ ] Run the new temporal/calendar tests; capture RED. Implement bounded
  token-role parsing around the accepted scanner; preserve malformed ownership
  and reject conflicting calendar markers. Explicit lunar spans must not also
  escape as clean Gregorian candidates. Capability-only text never switches mode.
- [ ] Use **Astronomy Engine 2.1.19, MIT**, in an offline generator, not the
  Worker/browser bundle. Generate new-moon civil days and major-solar-term
  boundaries in fixed UTC+07:00, derive month numbering/leap months according
  to the Vietnamese calendar rules, and emit reviewed month-start data covering
  lunar 1900–2100 plus boundary guard months. Pin generator/library/dataset
  checksums; refuse non-monotonic starts or months other than 29/30 days.
- [ ] Implement table-backed conversion and reverse conversion; never use
  `Intl` Chinese-calendar output as the Vietnamese oracle. Retain independent
  reference vectors with source URLs, publication/access dates and expected
  values; never generate expected results with the code under test.
  Export `lunarCalendar: LunarCalendarAdapter` from `lunar-calendar.ts`; tests
  import this exact adapter, not a second test-only implementation.

```ts
it("matches independent Vietnamese leap-month reference facts", () => {
  expect(lunarCalendar.toSolar({ year: 1984, month: 1, day: 1, leap: false }))
    .toEqual({ status: "RESOLVED", solarDate: "1984-02-02" });
  expect(lunarCalendar.toSolar({ year: 2004, month: 2, day: 1, leap: true }))
    .toEqual({ status: "RESOLVED", solarDate: "2004-03-21" });
});
```

  Source selection inspected 2026-09-25:
  [Astronomy Engine license](https://github.com/cosinekitty/astronomy/blob/master/LICENSE),
  [pinned package version source](https://github.com/cosinekitty/astronomy/blob/master/source/js/package.json),
  [Hồ Ngọc Đức's calendar rules and reference examples](https://www.xemamlich.uhm.vn/calrules.html).
  Use published rules/reference facts, not copied third-party calendar code of
  uncertain licensing. The ephemeris library is not by itself proof of calendar
  correctness. Triangulate century boundaries, leap years, and near-midnight
  conjunctions against independently published Vietnamese reference data;
  unresolved discrepancies block this task and lunar release, not a local exception.
- [ ] Exhaustively round-trip every supported day, verify duplicate normal/leap
  months, out-of-range and invalid dates, and deterministic regeneration. Preserve
  license attribution. Measure scanner P50/P95/P99 with P95 ≤5 ms/P99 ≤10 ms;
  calendar conversion must perform zero runtime network/DB/model calls.
- [ ] Run `pnpm exec vitest run src/modules/conversation/temporal.test.ts src/modules/conversation/lunar-calendar.test.ts src/modules/semantic/temporal-evidence.test.ts`.
- [ ] Validate, commit `feat(conversation): add deterministic cadence and explicit lunar evidence`, independent review.

## Task 3 — Encrypted revision-fenced context storage

**Files:** Create `migrations/0007_conversation_context_v2.sql`,
`src/modules/conversation/context-store.ts`,
`src/modules/conversation/infrastructure/d1/context-store.ts`,
`context-store.integration.test.ts`, `test-support.ts` in the same D1 directory;
modify `src/modules/security/keyring.ts` and its test for new purpose labels.

**Consumes:** Task 1 schemas, existing `newerConversationOutcomeSql`, keyring,
`persistedD1Blob`, local `semanticRuntime` and `seedSemanticRuntime` helpers.
**Produces:**

```ts
export interface ConversationStore {
  load(scope: ConversationScope): Promise<ConversationSnapshot | null>;
  save(scope: ConversationScope, expectedRevision: number | null,
    next: ConversationSnapshot): Promise<"SAVED" | "STALE" | "INVALID">;
  finish(scope: ConversationScope, id: string, expectedRevision: number,
    status: "COMPLETED" | "CANCELLED" | "INVALID"): Promise<boolean>;
  purgeExpired(now: number, limit: number): Promise<number>;
}
```

- [ ] Write local-D1 RED tests: encrypted round-trip, wrong owner/chat/key/AAD,
  UTF-8 limits (including Vietnamese/emoji), sixth/seventh turn, idle/absolute
  expiry, stale claim and revision race, same-inbound retry, terminal ciphertext
  removal, bounded indexed expiry cleanup. Seed synthetic owners only.

```ts
// makeContextHarness(): synthetic Miniflare DB, fixed clock, test keyring,
// store, ownerOne/ownerTwo scopes and valid initial ConversationSnapshot.
it("rejects cross-owner context creation and reads", async () => {
  const h = await makeContextHarness();
  try {
    const results = await Promise.all([
      h.store.save(h.ownerOne, null, h.initial),
      h.store.save(h.ownerTwo, null, h.initial),
    ]);
    expect(results.filter(x => x === "SAVED")).toHaveLength(1);
    expect(await h.store.load(h.ownerTwo)).toBeNull();
  } finally { await h.dispose(); }
});
```

  Add a separate same-owner race: first save revision 1, then submit two
  different eligible inbound updates with expectedRevision 1 and next revision
  2; assert exactly one SAVED result and one STALE result. A replay of the winning
  source inbound must not create a third revision. The cross-owner test above
  does not substitute for that compare-and-set test.

- [ ] Run `pnpm exec vitest run src/modules/conversation/infrastructure/d1/context-store.integration.test.ts`; capture RED.
- [ ] Add a separate versioned context table, not changes to historical 0005.
  Store owner/chat/inbound claim, monotonic revision/order, status, creation,
  activity/expiry timestamps, encrypted payload/IV/key version. Use partial
  uniqueness for one active context per chat; constrain ciphertext to plaintext
  maximum plus encryption tag. Terminal rows have nullable ciphertext metadata.
- [ ] Reuse keyring with purpose `conversation-context`, entity ID and version
  AAD. `save` encrypts before the CAS write and revalidates owner/binding/claim
  in SQL; `load` checks scope and expiry before decrypting. Distinguish stale,
  corrupt and absent internally without revealing another owner's existence.
- [ ] Preserve idempotency by source inbound and revision, and do not permit an
  old context create after a newer conversation outcome. Use the existing SQL
  claim/ordering pattern, not a select-then-unconditional-update race.
- [ ] Implement terminal purge and index-based `purgeExpired` capped at 100
  rows per call. Track only safe purge count/failure category. Integrate the
  call into the existing scheduled work in Task 6, with no cron change.
- [ ] Test legacy migration + new migration from empty and populated databases;
  legacy contexts remain readable by legacy code. V2 takeover must invalidate
  its own predecessor proposal atomically, not leave two confirmable drafts.
- [ ] Validate, commit `feat(conversation): persist bounded encrypted context`, independent security review.

## Task 4 — Pure reconciliation and contextual response composition

**Files:** Create `src/modules/conversation/reconcile.ts`, `reconcile.test.ts`,
`responses.ts`, `responses.test.ts`.
**Consumes:** Tasks 1–3 domain types and Task 2 temporal evidence; no DB calls.
**Produces:**

```ts
export type ConversationDecision =
  | { kind: "CLARIFY"; request: PendingRequest; field: MissingField }
  | { kind: "PROPOSE"; request: PendingRequest }
  | { kind: "ABANDON_PENDING" }
  | { kind: "GREET" | "LUNAR_HELP" | "HELP" | "READ_ONLY_LIST" }
  | { kind: "SAFE_REJECT"; code: "CONFLICT" | "LIMIT" | "UNAVAILABLE" };
export function reconcileConversation(input: {
  model: ConversationModel; temporal: ConversationTemporalEvidence;
  previous: ConversationSnapshot | null;
}): ConversationDecision;
export function composeConversationReply(input: {
  decision: ConversationDecision; previousQuestion: MissingField | null;
  tone: "friendly" | "concise"; lunarAvailable: boolean;
}): string;
```

- [ ] Write RED tables for every lifecycle branch: full create draft, missing
  title/date/time/year/leap/relation, known exam date, follow-up time, explicit
  edit versus accidental conflict, abandoned request, unrelated HELP/LIST/new
  intent, expired context, receipt/processing date change, unknown calendar.

```ts
it("asks only for time and retains the known exam date", () => {
  const request: PendingRequest = { title: "ôn thi", calendar: "GREGORIAN",
    eventDate: { solarDate: "2026-10-11", calendar: "GREGORIAN", lunar: null,
      conversionVersion: null, sourceInboundId: "event-input" },
    reminderDate: null, reminderTime: null, count: 3, relation: "BEFORE_EVENT",
    missing: ["time"] };
  const reply = composeConversationReply({ decision: { kind: "CLARIFY", request,
    field: "time" }, previousQuestion: null, tone: "friendly", lunarAvailable: true });
  expect(reply).toMatch(/mấy giờ|lúc nào/iu);
  expect(reply).not.toMatch(/thi ngày nào/iu);
});
```

- [ ] Run `pnpm exec vitest run src/modules/conversation/reconcile.test.ts src/modules/conversation/responses.test.ts`; capture RED.
- [ ] Implement pure merge: only valid new evidence fills missing slots;
  replacing a resolved fact requires explicit EDIT classification plus matching
  deterministic user evidence. Model values never supply temporal fields.
  Missing relation/count stays clarification, not a recurrence default.
- [ ] Keep help/greeting/list non-mutating; don't refresh active context TTL for
  them. Abandon applies only to an identified pending request. Ambiguous abandon
  asks one question; never falls through to the old time prompt.
- [ ] Compose replies from validated known facts, one missing field and user
  preference. Stable output for identical revision; no extra LLM, retry wording
  roulette, rigid fixed conversation stages, invented date or success claim.
  Capability reply must consult readiness; before enabled it says unavailable.
- [ ] Validate, commit `feat(conversation): reconcile context and compose natural clarifications`, independent review.

## Task 5 — Finite series expansion and atomic confirmation/cancellation

**Files:** Create `src/modules/reminders/series.ts`, `series.test.ts`,
`infrastructure/d1/series-store.ts`, `series-store.integration.test.ts`,
`migrations/0008_finite_reminder_series.sql`; modify scheduler/delivery stores
and tests only where needed for cancellation fence compatibility.

**Consumes:** a resolved `PendingRequest`, current authenticated scope and
explicit confirmation. One-off `source_draft_id` uniqueness is unchanged.
**Produces:**

```ts
export interface SeriesOccurrence { index: number; scheduledAt: number; localDate: string }
export type SeriesExpansion = { status: "READY"; occurrences: SeriesOccurrence[] }
  | { status: "REJECTED"; reason: "MISSING" | "INVALID" | "PAST" | "LIMIT" };
export function expandFiniteSeries(request: PendingRequest, now: number): SeriesExpansion;
export interface SeriesStore {
  propose(scope: ConversationScope, request: PendingRequest, contextId: string,
    contextRevision: number): Promise<{ proposalId: string; revision: number } | null>;
  confirm(scope: ConversationScope, proposalId: string, revision: number): Promise<
    { status: "CONFIRMED" | "ALREADY_CONFIRMED"; seriesId: string }
    | { status: "STALE" | "EXPIRED" | "REJECTED" }>;
  proposeCancellation(scope: ConversationScope, seriesId: string): Promise<
    { proposalId: string; revision: number } | null>;
  cancelRemaining(scope: ConversationScope, proposalId: string,
    revision: number): Promise<"CANCELLED" | "ALREADY_CANCELLED" | "STALE">;
}
```

- [ ] Write RED expansion tests and parameterized count/range/date cases.
  Example: event 2026-10-11, relation BEFORE_EVENT, count 3, time 12:00 gives
  Oct 8/9/10, not Oct 9/10/11. INCLUDING_EVENT gives Oct 9/10/11. One occurrence
  is routed to the existing one-off flow rather than inserted as a fake series.

```ts
it("never shortens a series at confirmation after its first due time", () => {
  const request: PendingRequest = { title: "ôn thi", calendar: "GREGORIAN",
    eventDate: { solarDate: "2026-10-11", calendar: "GREGORIAN", lunar: null,
      conversionVersion: null, sourceInboundId: "anchor" },
    reminderDate: null, reminderTime: "12:00", count: 3,
    relation: "BEFORE_EVENT", missing: [] };
  expect(expandFiniteSeries(request, Date.parse("2026-10-08T06:00:00Z")))
    .toEqual({ status: "REJECTED", reason: "PAST" });
});
```

- [ ] Run `pnpm exec vitest run src/modules/reminders/series.test.ts`; capture
  RED, then implement civil-day expansion, validation and immutable preview.
  Include month/year crossings and leap-anchor conversion without asking the model.
- [ ] Add additive proposal/series/occurrence tables. Proposals store encrypted
  request and preview, owner/chat, revision, expiry and action CREATE or CANCEL;
  cancellation proposals target an owner-scoped existing series. Canonical
  occurrence rows uniquely map `(series_id, index)` to ordinary reminder IDs.
  Use purpose `series-proposal` for sensitive payload; reminder titles still
  use existing `reminder-title` encryption.
  Include additive `reminder_calendar_facts` keyed uniquely to a reminder for
  both one-off lunar reminders and series children: source calendar, original
  lunar date/leap flag when applicable, converted date and conversion version.
  Store event/title-related supplemental payload encrypted using the existing
  keyring; indexes contain only the operational fields needed for ownership
  and scheduling. One-off creation plus its calendar provenance must share the
  existing atomic confirmation transaction, not a best-effort follow-up write.
- [ ] Write local-D1 RED tests using existing Miniflare patterns for two
  concurrent confirmations, failed child insert, transaction rollback, replay,
  expired/edited revision, wrong owner and cancellation/delivery races.

```ts
// makeSeriesHarness(): synthetic DB, reviewed migrations, fake keyring,
// one owned pending three-occurrence proposal, confirm() and counts() helpers.
it("one proposal commits one series and three children under retry", async () => {
  const h = await makeSeriesHarness();
  try {
    await Promise.all([h.confirm(), h.confirm()]);
    expect(await h.counts()).toEqual({ series: 1, occurrences: 3, reminders: 3 });
  } finally { await h.dispose(); }
});
```

- [ ] Implement conditional D1 batch transaction fencing every insert to the
  same successfully claimed proposal revision and authenticated inbound. A
  failure in any insert rolls back all writes; zero-change claim cannot leave
  unconditional child inserts. Canonical state commits before outbound success.
- [ ] Cancellation must set existing reminder/delivery statuses to CANCELLED
  for unclaimed future children, not just a new series-table flag. Older Worker
  code therefore also respects cancellation. Preserve in-flight/UNCERTAIN
  states and report their limits instead of pretending they were recalled.
  `proposeCancellation` resolves an owner-scoped series and captures its target
  revision; `cancelRemaining` accepts only a CANCEL proposal after explicit
  confirmation, never an arbitrary series ID interpreted as approval.
- [ ] Verify old one-off command-store, scheduler and delivery tests against a
  DB with both additive migrations; no scheduling/delivery for cancelled rows.
- [ ] Validate, commit `feat(reminders): add confirmed finite daily series`, independent atomicity/rollback review.

## Task 6 — Real inbound orchestration and context cleanup

**Files:** Create `src/modules/conversation/service.ts`, `service.test.ts`;
modify `src/modules/reminders/command-service.ts`,
`src/modules/inbound/processor.ts`, `src/worker/composition-root.ts`,
`src/worker/index.ts`, existing related tests; create
`src/modules/inbound/conversation-v2.integration.test.ts`.

**Consumes:** accepted Tasks 1–5, semantic prepared attempt/budget mechanisms,
session/bound-chat authorization and existing deterministic controls.
**Produces:** `createConversationService(deps)` returning
`handle(message: BoundChatMessage, context: BoundChatContext): Promise<void>`.
Dependencies explicitly include `ConversationStore`, `SeriesStore`,
`LunarCalendarAdapter`, `SemanticGateway`, existing one-off command store,
read-only query store, keyring, clock, budget/attempt store and reply function.
Do not let model output call a store directly.

- [ ] Write RED end-to-end local fixtures for the exam → time/count → relation
  → draft → confirm flow and the missing-time → “thế thôi” abandonment flow.
  Assert draft phase has zero new canonical reminders; confirm twice has exactly
  three, and LIST has no writes. Include greeting plus request and mixed scope.

```ts
// makeConversationHarness(): current integration fixture pattern, mocked
// strict V2 transport, fixed receipt clock, synthetic DB and captured replies.
it("preserves event context but waits for explicit series confirmation", async () => {
  const h = await makeConversationHarness();
  try {
    await h.send("thi hết môn ngày 11/10/2026 ở Quang Trung");
    await h.send("12h trưa, nhắc liên tục 3 ngày");
    expect(await h.reminderCount()).toBe(0);
    await h.send("3 ngày trước ngày thi, không tính ngày thi");
    expect(await h.reminderCount()).toBe(0);
    const confirmation = await h.send("có");
    await h.redeliver(confirmation.inboundId);
    expect(await h.reminderCount()).toBe(3);
  } finally { await h.dispose(); }
});
```

- [ ] Run `pnpm exec vitest run src/modules/inbound/conversation-v2.integration.test.ts`; capture RED.
- [ ] Compose V2 only under an application capability argument defaulting to
  disabled; local tests pass it explicitly. Add no production environment switch
  in this implementation plan. Missing tables, unsupported calendar data or
  provider contract readiness must fail closed, never silently drop to V1 for
  a partially processed V2 conversation.
- [ ] Keep /connect/explicit confirm/cancel before AI; a local greeting fast
  path must match the whole standalone intent, not a prefix that consumes a
  substantive request. Successful connection welcome uses its existing reply.
- [ ] Reconcile context with claim/revision fencing, route one-off requests to
  existing draft machinery, series to series proposals, LIST to read-only query.
  Determine cancellation target before mutation; ambiguous persisted-series
  cancellation requires an explicit cancel proposal and confirmation.
- [ ] Do not allow V1 and V2 confirmable drafts to coexist for the same chat.
  Drain an existing V1 pending draft through existing controls before entering
  V2; do not convert it silently. Updates under one V2 context invalidate older
  V2 proposal revisions transactionally.
- [ ] Add bounded context purge to existing scheduled work and safe counters;
  failure must not abort reminder dispatch or change the cron expression.
- [ ] Validate all inbound/auth/BLOB/dedupe/context suites, commit
  `feat(conversation): compose guarded inbound conversation flow`, independent review.

## Task 7 — Nonblocking typing and safe stage timings

**Files:** Create `src/modules/conversation/processing-feedback.ts`,
`processing-feedback.test.ts`; modify `src/modules/inbound/processor.ts`,
`src/modules/semantic/service.ts`, `src/worker/composition-root.ts`,
`src/worker/index.ts` and their tests. Keep provider request body unchanged.

**Consumes:** authenticated, bound, newly claimed inbound; managed Worker task
lifetime supplied by `ctx.waitUntil`. AI provider preparation/dispatch remains
budget-fenced and one-shot.
**Produces:**

```ts
export interface FeedbackLifetime { waitUntil(task: Promise<unknown>): void }
export function startProcessingFeedback(input: {
  eligible: boolean; send: () => Promise<void>; lifetime: FeedbackLifetime;
  observe: (outcome: "OK" | "FAILED" | "TIMEOUT", elapsedMs: number) => void;
}): void;
```

- [ ] Write RED test with a pending/rejected typing promise proving AI dispatch
  starts without its settlement. Also assert no feedback for unbound, replayed,
  rejected-control or unauthorized input, and no unhandled promise rejection.

```ts
it("does not wait for typing before continuing inference", async () => {
  const tasks: Promise<unknown>[] = [];
  const send = vi.fn(() => new Promise<void>(() => {}));
  startProcessingFeedback({ eligible: true, send,
    lifetime: { waitUntil: task => { tasks.push(task); } }, observe: vi.fn() });
  const inference = vi.fn(async () => "result");
  expect(await inference()).toBe("result");
  expect(send).toHaveBeenCalledTimes(1);
  expect(tasks).toHaveLength(1);
  // Run this test with fake timers; advance through the 1000 ms timeout,
  // await all tasks, then restore real timers in finally.
});
```

- [ ] Run `pnpm exec vitest run src/modules/conversation/processing-feedback.test.ts`; capture RED.
- [ ] Initiate feedback after eligibility/claim but before expensive context/AI
  wait. Pass lifetime explicitly through composition; guard transport with its
  existing bounded abort/timeout and handle completion with an allow-listed
  observer. A Promise.race alone must not leak an un-aborted fetch.
- [ ] Remove the V2 awaited-feedback predecessor from semantic dispatch. V1
  contract behavior remains covered; neither path may accidentally send twice.
  Preserve redirect fencing and secret-header separation. No periodic typing
  refresh, debounce, queue parallelism or fake early acknowledgement.
- [ ] Measure persisted-inbound queue wait, eligibility-to-typing dispatch,
  model latency and final-reply latency as distinct safe durations. Fresh local
  benchmark P50/P95/P99, mock-transport P95 dispatch ≤200 ms; 1000 ms failed
  typing must add no wait to inference start. Record measurement environment.
- [ ] Validate, commit `perf(conversation): decouple typing from semantic response`, independent review.

## Task 8 — Web series preview and lifecycle visibility

**Files:** Create `src/contracts/api/reminder-series.ts`, its tests,
`src/worker/routes/reminder-series.ts` and tests,
`src/features/core-screens/ReminderSeriesCard.tsx` and tests;
modify `src/worker/routes/operations.ts`, `src/worker/router.ts`,
`src/worker/composition-root.ts`,
`src/features/core-screens/CoreScreenExperience.tsx`/CSS/tests.
The existing reminder route imports are in `src/worker/router.ts`; preserve
that router's session and request-validation conventions.

**Consumes:** Task 5 proposals/series, session auth/CSRF conventions, existing
design tokens. **Produces:** owner-scoped GET series view and revision-bound
POST confirm/cancel-proposal endpoints, sharing backend services with Zalo.

```ts
export interface PublicSeriesView {
  publicId: string; title: string; revision: number;
  state: "PROPOSED" | "ACTIVE" | "CANCELLED" | "COMPLETED";
  calendarLabel: string; eventLabel: string | null;
  occurrences: { localDate: string; localTime: string; status: string }[];
}
export interface SeriesDecisionRequest {
  publicId: string; revision: number; action: "CONFIRM" | "PROPOSE_CANCEL";
}
```

- [ ] Read local Next documentation, then write RED UI/API tests for full date
  preview, lunar+solar labels, no premature “created”, loading/error/stale
  revision, keyboard focus, mobile layout, owner isolation, unauthenticated401
  and CSRF rejection. Validated Zod enums replace free status strings at runtime.

```tsx
it("shows every date before confirmation", () => {
  render(<ReminderSeriesCard series={{ publicId: "synthetic", title: "Ôn thi",
    revision: 1, state: "PROPOSED", calendarLabel: "Dương lịch", eventLabel: null,
    occurrences: ["2026-10-08", "2026-10-09", "2026-10-10"].map(localDate =>
      ({ localDate, localTime: "12:00", status: "PROPOSED" })) }} onDecision={vi.fn()} />);
  expect(screen.getByRole("button", { name: /xác nhận/iu })).toBeEnabled();
  expect(screen.queryByText(/đã tạo/iu)).not.toBeInTheDocument();
});
```

- [ ] Run the new component and route tests; capture RED. Implement grouped
  series/children using existing UI tokens, not a redesign. Every occurrence
  must be inspectable even at count30; no truncated preview masquerading as full.
- [ ] Apply authenticated server-side ownership and revision checks; never
  trust public IDs from the model or a client-supplied owner/scheduled epoch.
  Cancellation is a proposal then confirmation, not immediate button mutation.
  Surface already-in-flight/uncertain deliveries accurately.
- [ ] Keep historical one-off reminders, login, Today filtering, timezone,
  settings and accessibility tests green. No admin page or session redesign.
- [ ] Validate, commit `feat(web): preview and manage finite reminder series`, independent UX/security review.

## Task 9 — Whole-slice offline acceptance and release handoff

**Files:** Create `tools/benchmark/conversation-v2.ts`,
`tools/benchmark/conversation-v2.test.ts`,
`src/modules/conversation/benchmark/conversation-v2.json`,
`docs/benchmarks/conversation-v2-results.md`,
`docs/runbooks/conversation-v2-release.md`; update `docs/roadmap.md` and relevant
current-state documentation only to the level supported by actual evidence.

**Consumes:** accepted Tasks 1–8 and synthetic fixture transports.
**Produces:** an offline report and release checklist, not production activation.

- [ ] Write RED scorer/provenance tests. Define fixtures with separate expected
  temporal/calendar facts, dialogue outcome, state transition and mutation
  count; mock model interpretation independently of backend expected facts.
  Bind corpus, prompt, schema, calendar dataset, reconciliation and scorer
  digests into a new run profile. Old hybrid evidence remains untouched.

```ts
it("cannot label a mock run as live model acceptance", () => {
  const result = summarizeConversationRun({ transport: "MOCK", total: 1,
    passed: 1, safetyFailures: 0 });
  expect(result.offlinePass).toBe(true);
  expect(result.liveModelAccepted).toBe(false);
});
```

  Define `summarizeConversationRun` in `tools/benchmark/conversation-v2.ts`;
  arguments are the exact fields above and result includes both booleans.
- [ ] Execute provider-free corpus with fatal-on-network transport. All
  deterministic/calendar safety cases must pass100%; mutation violations0,
  plaintext leaks0 and duplicate canonical mutations0. Report dialogue cases
  separately; mocked semantics do not prove Gemini quality.
- [ ] Run fresh `pnpm typecheck`, `pnpm check`, `git diff --check`, local D1
  migrations/context/series integration suites and safe-observability scan.
  Use an isolated environment without production/API credentials. Capture exact
  commands/counts/HEAD and all actual failures; no stale verification reuse.
- [ ] Test rollback compatibility using the old scheduler/delivery predicates
  against the additive schema and cancelled/uncertain occurrence fixtures.
  Verify unrelated historical one-off rows untouched; rollback never rolls D1 back.
- [ ] Whole-branch independent spec/security/code review, Critical0 Important0.
  Repeat affected gates after fixes. No production-ready claim from offline tests.
- [ ] Record pending live contract evaluation: selected same pinned model,
  new corpus/profile, explicit request/cost caps and user authorization required
  before any live call. Do not reuse historical benchmark permission for this
  changed contract. Keep capability default-off until that acceptance passes.
- [ ] Commit `test(conversation): record offline acceptance and release gates`.
  Handoff exact feature SHA, test counts, migration review, limits, performance,
  residual risks and next required live/release authorization. Do not merge,
  migrate or deploy as a side effect of completing this plan.

## Spec coverage / self-review

| Spec area | Owning tasks |
| --- | --- |
| Semantic-only authority, pinned privacy route and budgets | 1, 6, 9 |
| Bounded encrypted context, lifecycle, cleanup and ordering | 3, 4, 6 |
| Natural greeting, edit, abandonment and clarification | 1, 4, 6 |
| Finite daily series, confirmation and cancellation | 2, 5, 6, 8 |
| Explicit lunar opt-in, conversion, dual-calendar preview | 2, 4, 8 |
| Nonblocking typing, stage metrics, no burst processing | 7 |
| Provider-free/local tests, independent review and release gates | Every task, 9 |
| Continuous chat after admin | Roadmap only; excluded from implementation |

The plan deliberately creates an independently reviewed acceptance boundary per
task. Recommended execution: **subagent-driven**, with a fresh implementer and
fresh reviewer per task, because context encryption, calendar authority and
atomic multi-reminder creation must not borrow unverified assumptions from one
another. Written-plan approval and execution choice are still pending.
