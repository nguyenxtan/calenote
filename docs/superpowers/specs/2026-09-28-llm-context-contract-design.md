# LLM-led conversation understanding with validated reminder objects

Date: 2026-09-28
Status: **DESIGN_DIRECTION_APPROVED / WRITTEN_SPEC_PENDING_REVIEW**
Inspected baseline: `6329b33264a2916f004953865f6483fafdfd7491`.

The user approved writing this design after requesting that the LLM understand
the whole conversation instead of repeatedly extending phrase-specific parsing.
This document is a proposed replacement contract, not an implementation or live
acceptance claim. No provider calls, migration, deployment, or runtime changes
are authorized by this document. Written-spec review precedes implementation
planning; exact-SHA deployment authorization remains separate.

## 1. Intended outcome

Users describe a task naturally, answer follow-up questions naturally, and do
not have to learn a grammar. Calenote retains the task's meaning, event details,
reminder schedule, and unresolved questions without confusing one with another.
It asks only for genuinely missing or ambiguous information. A valid object is
necessary but not sufficient: its meaning must also match the conversation.

The current seven-field model contract can label intent/title/dialogue but
cannot express date operands, query periods, or reminder/event relationships.
The application then tries to extract these independently from raw language.
Consequently an otherwise useful model interpretation cannot fill those slots.
The bot's advertised answers and the backend grammar can disagree.

Observed UAT gaps include month-range queries, relation follow-ups, bare pending
abandonment, a lunar-date question being treated as capability help, and generic
rejection of annual recurrence. Calendar lunar display is also absent. These
are acceptance inputs, not proof of any particular live provider response.

## 2. Decision and explicit supersession

**Selected:** one bounded LLM interpretation produces a typed semantic patch;
backend validates, merges, computes, presents, and executes approved operations.

Alternatives rejected:

- Keep adding raw-text grammar exceptions: preserves the competing language
  interpreters and requires users to discover acceptable wording.
- Let an agent write final schedules or database records directly: schema-valid
  output can still guess a date, erase a detail, or authorize the wrong action.

For this successor contract, the following V1/V2 design rules are superseded
upon implementation and acceptance, not retroactively in deployed V2:

| Earlier rule | Replacement |
| --- | --- |
| Provider exposes only semantic labels/title, no temporal operands | Provider may describe user-stated temporal expressions, calendar choice, recurrence intent, and relations as untrusted structured operands |
| Raw-text TemporalEvidence extraction must precede and approve all understanding | The LLM owns natural-language interpretation; a deterministic resolver evaluates structured operands, not a competing general language parser |
| Model cannot propose changes to resolved temporal slots | Model may propose an evidenced edit; backend checks scope/conflicts and issues a new draft revision before execution |

Scheduling authority does **not** move to the LLM. Epochs, timezone selection,
calendar conversion, date arithmetic, query bounds, occurrence expansion, access
control, confirmation, storage and delivery remain application-owned.
Existing scanner modules may remain for legacy paths/tests but must not veto or
silently reinterpret the new conversational path. Invalid new-contract output
must not fall back to a legacy parser with different semantics.

The earlier specs and benchmark results remain historical evidence. Before
activation, current-state/runtime docs must identify which contract is active;
V1/V2 test passes cannot select this contract for release.

## 3. Processing boundaries

1. Existing inbound authentication, owner/chat binding, dedupe and durable claim.
2. Explicit confirmation controls for the visible current revision; local
   greeting/help fast paths only for unambiguous whole utterances.
3. Best-effort typing, without waiting for provider completion.
4. Load and validate bounded encrypted context; construct a sanitized provider
   view containing known slots, their provenance and the actual pending question.
5. One bounded LLM call classifies intent and returns structured changes.
6. Strict-schema validation, evidence checks, deterministic merge and resolution.
7. Clarify, read-only answer/list, or render an exact draft preview.
8. Explicit deterministic confirmation; transactional, idempotent mutation.

No second model call for wording. No model-authored tools, SQL, reply prose,
internal IDs, ownership fields or confirmation decision. The local composer
uses verified known facts and the unresolved issue, rather than repeating a
generic question. All substantive mixed messages retain their substantive intent.

## 4. Three separate objects

### 4.1 Provider proposal: ConversationInterpretation

The provider returns a strict, versioned object with unknown fields rejected:

- `schemaVersion`: fixed contract version.
- `intent`: `CREATE_REMINDER | LIST_REMINDERS | CALENDAR_QUERY | CAPABILITY_QUERY
  | HELP | UNSUPPORTED | AMBIGUOUS`.
- `dialogueAct`: `NEW_REQUEST | CONTINUE | EDIT | ABANDON_PENDING | GREET
  | AMBIGUOUS`.
- `continuation`: `YES | NO | UNCERTAIN`.
- `changes`: bounded typed field operations described below.
- `query`: a typed calendar/list/capability question, or null.
- `uncertainties`: bounded field-specific alternatives or missing-information
  suggestions. Backend recomputes required fields; a model saying complete
  never makes an incomplete request executable.

Each change is `{ field, operation, value, evidence }` where `operation` is
`SET | CLEAR`, value must match that field's discriminated type, and evidence
references one or more provider-visible turn indexes with exact text spans.
Unmentioned fields are **unchanged**, not cleared by null. CLEAR requires a
current explicit removal request; it is not a way to omit inconvenient details.
Reject duplicate operations for the same field and invalid combinations.

Provider references are local indexes only. The application maps them to its
inbound provenance; the model never supplies database identifiers. Validate
span offsets and exact substrings against the supplied text. A matching quote
proves source presence, not interpretation correctness: ambiguity handling,
live evaluation and the user-visible preview remain essential.

Supported semantic slots:

| Slot | Meaning |
| --- | --- |
| `title` | Concise task label, grounded in the user's words |
| `location` | Separate event location, not discarded when shortening title |
| `notes` | Relevant task details not represented elsewhere; no invented facts |
| `eventDate`, `eventTime` | When the event itself occurs |
| `reminderDate`, `reminderTime` | When a notification is requested |
| `calendar` | GREGORIAN or explicitly requested LUNAR_VN |
| `recurrence` | User's requested frequency, count/end and event relation |

Typed date expressions: `CIVIL_DATE` with nullable year, `RELATIVE_DAY` with
integer day offset, and `WEEKDAY` with an explicit current/next-week or unresolved
qualifier. Typed clock: hour/minute and AM/PM/24-hour/unknown qualifier. A stated
`12h trưa` can normalize to 12:00; a missing clock is never manufactured.

List/query periods: `DAY`, `WEEK`, `MONTH`, `WEEKEND`, or explicit date bounds;
relative period offset identifies this/next/previous period. Calendar questions
specify a date expression and requested output calendar. Capability questions
specify the capability, never masquerade as date queries.

Recurrence separates **frequency**, **occurrence count**, **event relation**,
**lead offset**, and **end condition**. A one-time reminder two days before an
event is not a two-occurrence series. Frequency can describe DAILY, WEEKLY,
MONTHLY or YEARLY intent even when execution support is absent; unsupported
intent must survive interpretation so the application can explain it accurately.
The executable subset in this release remains one-off and finite daily series.
Qualifiers or units outside supported expression types produce a targeted
unsupported/clarification outcome, never a guessed conversion.

### 4.2 Application pending request

The application owns a versioned encrypted object containing the structured
slots, their `MISSING | PROPOSED | RESOLVED | CONFLICT` state, source turn/span,
resolution method/version, and current proposal revision. It separately stores
event and reminder roles. Unknowns remain unknown. No single model summary is
the source of truth for retained details.

New proposals initially remain untrusted. Deterministically valid operands may
become resolved pending facts; this does not mean the user has confirmed them.
A current explicit edit can replace a pending slot; a conflict without an edit
clarifies. Every schedule-affecting edit invalidates the older confirmation.
Unexpected title/location/note loss must be surfaced rather than silently saved.

### 4.3 Canonical confirmed object

Confirmation records the exact previewed revision, resolved occurrences,
calendar provenance, and encrypted task details. Preserve existing single-draft
uniqueness and series/occurrence lineage. Never reconstruct confirmed data from
a later model response. Scheduler/delivery consumes canonical records only.

The existing title-only pending contract cannot retain all these fields. The
implementation must add versioned encrypted detail storage and carry it through
draft, confirmation, query and web detail views. Existing keyring conventions
and owner-scoped authenticated encryption remain mandatory. Any new migration
must be additive and separately reviewed; do not rewrite 0007/0008 or silently
pack structured metadata into the title string.

## 5. Deterministic resolution and merge

- Use trusted inbound reference time and the user's supported timezone, never
  the provider's clock. Current supported calendar convention remains Vietnam
  UTC+7; do not expand timezone support implicitly.
- Default new unrelated requests to Gregorian. Lunar scheduling requires
  explicit user evidence. Querying or displaying lunar dates does not activate
  lunar scheduling and does not change a pending request's calendar.
- For Gregorian day/month without a year, preserve the existing documented
  next-valid-future-date policy and expose the resulting year in the preview.
  Invalid dates are not rolled over. Relative dates resolve against receipt
  time, not processing delay. Missing date/time triggers clarification.
- Lunar dates require explicit year and leap-month choice where ambiguous.
  Use the existing versioned `lunarCalendar.toSolar/toLunar` adapter, 1900–2100;
  reject unsupported or invalid dates, never ask the LLM to convert them.
- Resolve list periods to local half-open ranges `[start, nextBoundary)`.
  This month means the calendar month containing the reference date, including
  earlier days; it does not mean 30 days or upcoming-only. Query is owner-scoped,
  read-only, and reports if results are truncated rather than claiming completeness.
- In pending finite-series context, “nhắc trước 2 ngày” may specify the two
  preceding days when count/relation context establishes that meaning. Without
  that context distinguish a single lead-offset reminder from a daily series;
  ask one question if ambiguous. Do not convert offset into count by default.
- A relation-only answer preserves existing title/date/time/count. Missing fields
  are computed after merge, not inferred from absence in the current message.
- A clear contextual “bỏ” abandons only the current unconfirmed request. Model
  suggestion plus grounded whole-utterance/context validation may close it;
  negated, quoted or hypothetical abandonment cannot. It never cancels confirmed
  reminders. Confirmation remains outside the model's output vocabulary.
- Side questions (calendar date, capabilities, list) do not extend pending TTL
  or erase the request. New unrelated intents cannot inherit old facts.

## 6. Context, privacy and failures

Preserve existing six-turn / 16 KiB encrypted context limits, 2000 characters
per user turn, idle 30 minutes and absolute two hours; preserve the shorter
draft lifetime. Include normalized pending slots, the exact pending question
code, and bounded recent turns. Do not include owner IDs, credentials, full
reminder history, or unrelated conversations in provider context.

Do not silently drop essential facts to fit the provider request. Serialize and
preflight the **whole** prompt/schema/context budget. If it exceeds limits, use
a clear bounded restart/shorten response, preserving the current pending draft.
No extra model summarization call. Decryption, scope, version or validation
failure fails closed. Reuse revision CAS, inbound claim fencing and dedupe;
concurrent-message batching remains deferred.

Terminal/expired context follows existing cleanup. Confirmed structured details
remain encrypted canonical data, not a reason to retain raw chat indefinitely.
Never log raw messages, titles, evidence excerpts, secrets or provider bodies.

Timeout, unavailable provider, malformed schema, exhausted budget and unsupported
execution capability are distinct internal reason codes with safe, useful user
responses. Do not repeatedly ask the same satisfied slot or pretend success.
Do not retry an uncertain paid call or switch model/parser silently.

## 7. Calendar display and capability scope

Add secondary Vietnamese lunar day labels to the Calendar grid and selected-day
details using the same adapter/version as chat. Solar date remains primary;
show month on lunar month boundaries and distinguish leap months. Unsupported
dates get an explicit unavailable label, not fabricated values. Test responsive
layout and accessible names. This display does not alter event dates or enable
lunar scheduling. No astronomical moon-phase feature.

“Hôm nay ngày mấy âm lịch?” is a read-only CALENDAR_QUERY resolved by code.
“Có lưu âm lịch không?” is CAPABILITY_QUERY with an explanation of actual scope.

Annual lunar requests are understood and retained but **not executable** in this
slice. Explain that annual automation is unsupported and offer a one-off option;
only if the user chooses that option, collect missing year/time and show a
one-off preview. Never quietly replace annual intent with one occurrence.
An annual scheduler requires a separate design for leap-month/missing-day
policy, rolling materialization, cancellation and delivery lineage.

## 8. Model route, bounds and observability

Keep `AI_MODE=privacy`, `google/gemini-2.5-flash-lite`, `google-vertex/eu`, ZDR,
strict structured output, no fallback and existing timeout. No model shopping.
Keep hard production limits: 50 owner calls/day, 500000 owner monthly cost
microunits and 2000000 global daily cost microunits.

The richer object must not be squeezed into the old 256-output-token limit
without measurement. Implementation planning must provide explicit input/output
byte/token caps and matching pre-dispatch worst-case cost reservation; verify
them with offline serialization and a bounded live pilot. Raising output caps
never raises owner/global budgets. No code path may dispatch beyond its reserved
ceiling. Freeze tested caps in reviewed config before acceptance.

Content-free telemetry distinguishes: local fast path, pre-dispatch rejection
category, reserved, dispatched, provider outcome/schema outcome, latency, usage,
and backend decision. Use application-generated correlation identifiers, never
raw user identity/content. Dispatch does not imply success; model success does
not imply correct reconciliation. Retain aggregate counters so provider usage
can be checked without exposing conversation content or building an admin page.

## 9. Acceptance and release gates

TDD must cover the contract and lifecycle, not just the screenshot strings:

- Fresh create and multi-turn completion with task/location/note preservation.
- Date-only, time-only, relation-only and explicit-edit follow-ups; conflicting
  follow-ups, unknown referents, new requests, side queries and expired context.
- Current/next month, month/year rollover, leap year, day/week/weekend bounds.
- Finite daily series versus a single lead-offset reminder, include/exclude
  event day, missing event time, impossible/past dates and unsupported cadence.
- Pending abandonment paraphrases plus negation, quotation and hypothetical
  controls; no cancellation of canonical reminders and no implicit confirmation.
- Lunar current-date queries, capability help, explicit lunar create, year/leap
  clarification, annual unsupported explanation and solar/lunar round-trip tests.
- Calendar UI labels, lunar month boundaries, leap-month display and accessibility.
- Strict unknown-field rejection, invalid evidence references, semantic mismatch,
  detail preservation, context ownership/encryption, request budgets and provider
  failure without mutation, duplicate/reordered inbound and stale confirmation.

Use structural tables/paraphrase families plus held-out conversations, not a
finite registry of failed literals. Run focused tests, typecheck, full check,
diff validation and independent review with Critical=0 / Important=0.

Then run a new provenance-bound live evaluation of the **new contract** with
actual model calls. Freeze pilot/full corpus and denominators before dispatch;
bind source, prompt, schema, resolver, calendar, scorer and config digests.
Include the full UAT failure families and held-out paraphrases across multiple
turns. Required pilot gates: schema 100%, final object/operation correctness
>=95%, preservation of supplied required details 100%, and zero safety-critical
failures. Full gates: schema >=99%, final object/operation correctness >=95%,
required-detail preservation 100%, zero safety-critical failures, and all named
UAT regression flows correct. Invalid schemas count as failed outcomes; do not
exclude failed calls from denominators. Report category counts, latency and cost.

Pilot/full sizes, per-profile call/cost caps and seed are frozen in the written
implementation plan for approval before any paid call; retry count remains 0.
Historical V2 37-turn evidence stays intact but does not admit this contract.
Report separately: mock/offline results, live model results, deployed allocation,
and actual user acceptance. None substitutes for another.

Release requires reviewed config and any additive storage migration, exact-head
CI, fresh resource/rollback preflight, explicitly authorized remote mutations,
and deployment approval for the resulting immutable master SHA. Pending legacy
V2 context must be explicitly expired/restarted on contract mismatch; never
reinterpret it as the new schema. Preserve confirmed legacy reminders/series.
Rollback cannot undo D1 or cancel already confirmed reminders. Isolate new pending
context storage/version so older Workers cannot read it as V2; retain old
canonical fields so previously reviewed delivery still works after rollback.

## 10. Explicit exclusions and next step

No admin implementation, burst/debounce orchestration, Queue concurrency changes,
general-purpose chatbot, unbounded/annual scheduler, new provider, silent budget
increase or unrelated UI redesign. User-facing questions outside calendar/task
assistance receive a concise scope explanation, not arbitrary model execution.

Next gate: review this written spec. After approval, write the implementation
plan with task boundaries, storage evolution, concrete contract limits, live
profiles and execution method. This spec does not authorize implementation by
itself. Deployment remains unchanged until that work passes its release gates.
