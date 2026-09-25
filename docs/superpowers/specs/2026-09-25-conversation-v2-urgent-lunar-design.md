# Conversation V2 — contextual reminders, finite urgent series, explicit lunar dates

Date: 2026-09-25
Status: **DESIGN_APPROVED — IMPLEMENTATION_PLAN_REVIEW_PENDING**
Inspected source: `9018344f1f8b1e0adf4d7905d3e7e6550f9ee5ad`.
This document proposes behavior; it does not claim implementation, benchmark
acceptance, migration authorization, or deployment. Conversation-level scope
was requested by the user. The user approved this written specification with
“làm đi” on 2026-09-25. This approves preparation of the implementation plan;
runtime implementation still requires that plan's review and execution choice.

## 1. Intent and scope

Make Calenote follow a short reminder conversation without making the user
repeat facts, guessing missing dates, or mechanically repeating instructions.
Support the concrete journey of an exam/event and a finite sequence of reminders
leading up to it, including explicitly requested Vietnamese lunar dates.

The user requested:

- greetings and context-aware follow-up questions, not rigid dialogue scripts;
- asking for an event date when unknown, while remembering a date already given;
- finite urgent reminders, with a preview and confirmation;
- Gregorian dates by default; lunar dates only when explicitly requested;
- explaining lunar support when asked, without unsolicited syntax advertising;
- less perceived waiting, including earlier typing feedback;
- deferring continuous-message handling until after the admin page.

Proposed technical limits below are design choices for review, not previously
approved production configuration. No admin implementation, burst coalescing,
Queue concurrency change, new model, fallback route, astronomical moon-phase
feature, or unrelated UI redesign belongs to this slice.

## 2. Approach and current constraints

Use one bounded conversation domain with separate temporal, dialogue, context,
series, and response-composition modules. Preserve the existing authenticated
inbound, encrypted persistence, strict provider gateway, confirmation, and
delivery boundaries.

Alternatives considered:

1. Add phrase-specific fixes to the existing commands: small initial change,
   but does not solve intent changes or preserve event/reminder distinctions.
2. Delegate scheduling and conversation state to a free-form agent: flexible
   wording, but violates deterministic authority and confirmation guarantees.
3. **Selected:** semantic interpretation plus deterministic dialogue state and
   scheduling, with bounded encrypted context and local contextual responses.

Current source already has encrypted clarification slots and ordering fences.
It does not have an event/reminder distinction, series lifecycle, lunar intent,
or a bounded dialogue buffer. The recurrence rejection occurs before pending
context is reconciled. Existing one-off reminders enforce a unique
`source_draft_id`; series support must not weaken that constraint.

## 3. Authority and processing boundary

Authenticated inbound and bound-chat ownership
→ dedupe/claim and deterministic controls
→ eligible best-effort typing
→ deterministic temporal/calendar/finite-series evidence
→ bounded semantic/dialogue interpretation when needed
→ deterministic context reconciliation
→ locally composed clarification, draft, or read-only list
→ explicit confirmation of the current proposal revision
→ canonical mutation.

The model may suggest semantic intent, title, title ambiguity, conversational
act, and whether the utterance continues the pending request. Suggested acts
include greet, capability question, continue, edit, abandon, and new request.
These are non-authoritative suggestions, not executable commands.

The model must not supply dates, times, timezone, epochs, SQL, internal IDs,
ownership, persistence decisions, or confirmed status. It may reference input
spans for semantic interpretation; deterministic code validates the span and
its temporal meaning. A reference is never a substitute for valid Temporal
Evidence. Unknown or incompatible schema fields fail closed.

Keep `AI_MODE=privacy`, the reviewed `google/gemini-2.5-flash-lite` route pinned
to `google-vertex/eu`, ZDR, and no model/provider fallback. Keep hard limits of
50 owner calls/day, 500000 owner monthly cost microunits, and 2000000 global
daily cost microunits. Do not add an AI call just to improve wording. Existing
durable attempt fencing remains authoritative across retries.

## 4. Context and conversation lifecycle

Separate three kinds of state:

1. Authoritative structured pending request: title, temporal evidence,
   calendar choice, event anchor, finite cadence, missing fields, revision,
   owner/chat scope, and provenance of resolved facts.
2. Short-lived encrypted conversational context: bounded recent user turns and
   structured assistant outcomes, used only to understand the active request.
3. Confirmed reminders/series and delivery records: existing canonical storage,
   never reconstructed from an LLM summary.

Proposed limits: at most six user turns, each at most 2000 Unicode characters,
and at most 16 KiB UTF-8 total context payload. Exceeding limits asks for a shorter
request rather than silently truncating authoritative facts. Idle TTL is 30
minutes, with a two-hour absolute lifetime. A draft retains its shorter existing
confirmation lifetime and must not be kept alive merely by unrelated chatter.

Use the existing encryption/keyring architecture; encrypt before persistence.
Decryption requires current owner/chat authorization and valid context version.
Ciphertext corruption, invalid schema, expiry, or scope mismatch fails closed.
Do not log titles, dialogue, provider payloads, raw identities, or ciphertext.
Only bounded categorical outcomes and durations enter telemetry.

Persist conversation updates under existing inbound claim and ordering fences
plus a context revision compare-and-set. Older jobs cannot overwrite newer
context. This preserves safety; it does not implement the deferred burst
orchestration or promise globally ordered provider replies.

Lifecycle: `NONE → CLARIFYING → DRAFT_READY → COMPLETED`, with `CANCELLED`,
`EXPIRED`, and `INVALID` terminal outcomes. Revision edits invalidate the prior
proposal. Reconciliation reads pending state only, never a completed request.
On terminalization, discard the new dialogue-buffer ciphertext; retain only
the canonical record and required non-content audit metadata. Expired buffers
are unreadable immediately and physically purged by bounded cleanup on the
existing scheduler, within 24 hours under normal operation. Cleanup failures
must be observable without payload logging. Do not delete historical inbound
or audit records as part of this policy.

HELP, greetings, capability questions, and LIST may leave a pending request
suspended, but must not silently confirm it or reset its TTL. A clearly new
request must not inherit unrelated old title/date facts. If replacing an active
proposal is ambiguous, ask whether to replace it.

## 5. Natural dialogue without temporal guessing

The backend identifies the missing/conflicting field; a local response composer
uses the actual context, user tone preference, and last question to phrase the
reply. Compose acknowledgements, known facts, and one useful question rather
than replaying a fixed multi-step script. Do not add random wording changes on
retries: reply selection is stable for one inbound revision.

Examples illustrate outcomes, not a registry of special-case inputs:

- “thi hết môn ngày 11/10 ở Quang Trung” → remember the title and deterministically
  resolved event date; ask when to remind, not the already-known exam date.
- “nhắc ôn thi, gấp lắm” → ask the exam/deadline date if no anchor is known;
  urgency alone supplies neither a date nor a cadence.
- “12h trưa, nhắc liên tục 3 ngày” with an event date → preserve 12:00 and count;
  ask whether to include the event day or use the three preceding days unless
  the user already specified that relation.
- “thế thôi” after an unresolved proposal → clarify abandonment if ambiguous;
  a clear abandonment closes only that pending request, then acknowledges it.
  Do not immediately ask the same missing-time question again.
- a greeting → greet naturally; if relevant offer to continue the pending
  request, without making that compulsory or injecting a product tutorial.

Clear standalone greetings and explicit controls take a local fast path.
Mixed messages must still process their substantive request. Successful first
connection may include one welcome in its existing acknowledgement, not an
additional unsolicited outbound message. Do not greet on every turn.

An explicit edit permits replacement only of the fields supported by new valid
deterministic evidence. Conflicts without clear edit intent clarify. Ambiguous
title changes clarify. Never allow the model to replace resolved temporal facts.
Confirmation binds to the current visible draft revision; stale web callbacks
fail closed, and ambiguous chat confirmations cannot choose among proposals.

## 6. Finite urgent reminders

This slice supports a **finite daily series**, not unbounded recurrence or
automatic escalation. Proposed limits: 2–30 occurrences, one explicit reminder
time per day, and all scheduled occurrences within 366 days of confirmation.
One occurrence uses the existing one-off flow. More frequent or indefinite
requests receive a clear explanation and a supported alternative, with no
silent conversion and no mutation.

The event date and reminder time are different fields. An exam date does not
imply the exam happens at the reminder time. Event time is optional unless the
requested relation requires it. Same-day timing that depends on an unknown
event time must clarify, not claim the reminder is before the event.

“Three days before” excludes the event date; “including the event day” includes
it. “Three consecutive days” without a start or anchor relation clarifies.
Calendar-day arithmetic is deterministic in the user's supported timezone.
Reject or clarify past occurrences; never silently remove them and change the
confirmed count. Revalidate the full list at confirmation time.

Draft preview contains the title, event anchor when present, all exact reminder
dates/times, count, timezone, calendar labels, and cancellation behavior. Only
explicit confirmation creates the series and all occurrences atomically.

Persistence design is additive: a series proposal, a canonical series, and an
occurrence mapping referencing ordinary reminders. A unique confirmed proposal
revision identifies one series; unique `(series_id, occurrence_index)` and
reminder mappings identify its children. Preserve the existing one-off draft
unique index. The atomic transaction creates child reminders with series
lineage rather than reusing a one-off draft ID for several children. No orphan
or partially confirmed series is allowed. Retries return the original result.

Reuse the normal encrypted-title, scheduling, Queue, and delivery machinery.
Show a grouped series with individual occurrence states in web reminders;
one-off reminders retain their current behavior. A proposed cancel-remaining
action must identify the series and be explicitly confirmed. Apply it atomically
to future unclaimed occurrences; delivery claim checks cancellation state.
Already-sent or in-flight provider delivery cannot be recalled, and uncertain
delivery must not be blindly retried. Exactly-once canonical creation does not
promise exactly-once external delivery.

## 7. Explicit Vietnamese lunar-calendar support

Default calendar is Gregorian. Only an explicit lunar request activates
`LUNAR_VN` for the active request. Carry it through clarification; never change
an account-wide default as an inference. A clearly new request defaults to
Gregorian again unless it explicitly requests lunar dates.

“Có lưu âm lịch không?” is a capability question, not a scheduling instruction.
Answer with a short example only when asked. Before the feature is actually
enabled, never answer that it is available.

Use a pure deterministic `LunarCalendarAdapter`, isolated from LLM and network,
for Vietnamese lunar-date validation and Gregorian conversion. Proposed initial
supported lunar years are 1900–2100, subject to implementation conformance tests;
unsupported dates fail explicitly, never fall back to Gregorian interpretation.
The implementation plan must select and document a licensed conversion source
and independent reference vectors before code adoption. Correctness gates are
part of release acceptance, not optional implementation details.

Preserve the requested lunar year/month/day and leap-month flag together with
the converted Gregorian date and conversion version. Ask for a missing year;
ask normal versus leap month if both could apply. Reject nonexistent lunar
dates. Use the Vietnamese calendar convention at UTC+07:00 for conversion;
reminder instant conversion still uses the supported user scheduling timezone.
Do not silently claim support for other regional lunar conventions.

Preview both calendar representations and the explicit time before confirmation.
For an urgent series anchored to a lunar event, first resolve its Gregorian
anchor, then count consecutive civil days; show those resulting dates. This
does not imply annual or monthly lunar recurrence, which remains backlog.

## 8. Typing responsiveness — without burst-message work

Measured user experience reports 1–2 seconds before typing; no production trace
yet attributes that delay to a specific stage. Source currently awaits feedback
before provider dispatch and performs earlier claim/preparation work.

After authentication, active binding, dedupe, and eligibility checks, initiate
best-effort typing independently of the AI request. Use a managed Worker task
lifetime, a bounded timeout, and handled failures; no untracked floating
promise. Typing failure must not delay AI dispatch or change business state.
Do not emit repeated typing for webhook retries or process unauthenticated
messages merely to show feedback. Preserve provider redirect fencing and safe
request handling. No periodic refresh loop is included initially.

Measure persisted inbound-to-processing wait, eligible-processing-to-typing
dispatch, provider latency, and eligible-processing-to-final-reply separately.
Record safe timing distributions, not message bodies or provider identifiers.
Proposed local target: P95 eligible-processing-to-dispatch ≤200 ms under mocked
transport, and a timed-out typing call adds no blocking latency to AI dispatch.
Measure provider-visible timing during separately authorized live acceptance;
do not guarantee client animation timing from a server measurement.

Queue batching, per-chat coalescing, debounce, parallel consumers, and stale
outbound supersession are deferred until after admin. Residual Queue wait must
remain visible in results rather than hidden by a narrower timing metric.

## 9. Verification and delivery boundaries

Implementation will use TDD and task-level independent review. Required coverage:

- greeting alone versus greeting plus scheduling request; no welcome spam;
- known event date retained, missing date asked, event/reminder time separated;
- continuation, explicit edit, cancellation, abandonment, unrelated intent,
  expired/corrupt/cross-owner context, bounded payloads, cleanup, revision races;
- every prior Temporal Island safety invariant and hybrid semantic contract;
- daily-series boundaries, include/exclude anchor semantics, past-date handling,
  transactional failure, duplicate confirmation, cancellation/delivery races;
- lunar normal/leap months, invalid dates, year boundaries, inverse conversions,
  independent reference vectors, Gregorian default, capability-only questions;
- typing timeout/failure does not block AI, retry dedupe, correct eligibility;
- web and Zalo proposal equivalence, CREATE draft-only and LIST read-only;
- no user content in logs, no unsafe provider routing, unchanged hard budgets.

Run focused tests, local D1 integration, typecheck, full `pnpm check`, diff
validation, and runtime/security review before publication. New semantic
contract/corpus versions need their own provenance-bound offline evaluation;
old hybrid evidence remains historical, not proof of these new capabilities.
Live model benchmarking requires a separately specified corpus and request/cost
authorization. This spec authorizes no live provider calls.

Migrations must be additive and reviewed independently. Historical migration
files remain immutable. Any cleanup uses the existing scheduled invocation,
not a changed cron schedule. Production migration and exact-master deployment
approval remain separate gates. Record rollback compatibility before release;
an old Worker must not resume delivery of cancelled series. If backward-safe
delivery cannot be demonstrated, that is a cutover blocker.

Rollout is staged internally, with no user-facing capability claim until its
complete backend, persistence, UI, and acceptance evidence are present. Finish
the slice only with evidence for natural clarification, confirmed finite-series
creation, explicit lunar opt-in, and safe latency behavior. Admin and continuous
chat remain separate follow-up work.

## 10. Written-review checkpoint

This is the consolidated design, not an execution plan. Review the proposed
limits and product behavior above. After written-spec approval, prepare the
implementation plan with explicit task ownership, RED/green tests, migration
review, independent acceptance, and release gates. Runtime implementation waits
for that plan's review and execution choice.
