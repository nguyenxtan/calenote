# LLM-led conversation understanding with validated reminder objects

Date: 2026-09-28
Historical status (2026-09-28 planning): **WRITTEN_SPEC_APPROVED / IMPLEMENTATION_PLAN_PENDING_REVIEW**
Approval reference: owner approved the exact specification at
`e8f9e75f436a672b23387eb0054047da217ade23` on 2026-09-28 for implementation planning only.
Implementation plan: [LLM context contract implementation](../plans/2026-09-28-llm-context-contract-implementation.md).
Inspected baseline: `6329b33264a2916f004953865f6483fafdfd7491`.
Revision audit: `cafe6da1e26a19d140b7a231b8f1f291ed8c2fc4`; no later
commits or tracked/untracked changes at the start of this documentation revision.
Targeted closure checkpoint: `9d1b0abfd2e0cbadbcbb29dd6f64ef409d4f1c2a`;
verified clean on `codex/llm-context-contract-design`, no intervening commits.
Owner policy selections are recorded in §10.1; the written spec is now approved
at the reference above. Implementation and evaluation remain unauthorized.

The user approved writing this design after requesting that the LLM understand
the whole conversation instead of repeatedly extending phrase-specific parsing.
This document is a proposed replacement contract, not an implementation or live
acceptance claim. No provider calls, migration, deployment, or runtime changes
are authorized by this document. The owner has separately authorized planning
only; plan approval and exact-SHA deployment authorization remain separate.

### Current execution and methodology authorization (2026-09-29)

Owner authorization `1dac4827-7d8f-4172-a2b1-8e2e91e78f03` approved plan
`a2508f15b3180e7bd68beabe5cce4339c03edb78`, local T0–T10 execution and a
conditional bounded T11 campaign. Amendment
`6af13f1c-4203-4fec-a724-c147d6a793ec` splits feasibility as specified in
§8.2.1 and permits isolated development-only tokenizer provisioning. These
supersede the historical planning-only statements for execution authority,
not product semantics or numeric limits. Historical T0 at
`e44b9a415b87b7471085bc683d20e55c0360d9e8` remains BLOCKED.
Remote migrations, push/merge, activation and deployment remain unauthorized.

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

### 1.1 Source audit and coverage before revision

Code observations below refer to the local baseline, not a fresh live audit.
All new contracts, tables and examples below are proposed designs, not code.

| Requirement | Original coverage | Revision / source finding |
| --- | --- | --- |
| Responsibility and no alternate parser | Covered §2–3 | Retained; explicitly separate interpretation from execution validity |
| Context input and provenance | Ambiguous §4.1/6 | §4.1/6.1 define wire input and references; current `conversation/prompt.ts` sends title/question/outcome codes, not complete facts or actual assistant turns |
| Separate fields through delivery | Partial §4 | §4.2–4.4; current `PendingRequestSchema` lacks location/notes/eventTime |
| State, controls and concurrency | Partial §5–6 | §5.1/6.2; preserve D1 CAS, claim and terminal-outcome fences; specify preview binding and recovery |
| Monthly query | Partial §5 | §5.3; `semantic-query-store.ts` currently rejects >30-day ranges, filters three active statuses and limits to five rows |
| Lunar lookup/display | Covered §7, detail missing | §7 uses existing `toSolar/toLunar`; Calendar currently renders only solar labels |
| Annual recurrence | Explicitly excluded §7/10 | Remains excluded; recognized intent is not executable capability |
| Real-model evidence | Partial §9 | §9.1–9.3 specify layers, numbers and denominators. Existing live probe already calls `processBoundChatMessage` and real conversation service/D1 stores; it is not merely a pure-function runner. Its reply sink is a no-op and some decisions are reconstructed afterward: extend observation of actual outputs, not a parallel evaluator |
| Compatibility/release | Partial §9 | §9.5 specifies mixed-version and in-flight safety |
| Product choices | Unstated | §10.1 records owner selections; written-spec approval is recorded in the header |
| Admin/batching/annual engine/integrations | Outside §10 | Remain outside; not dependencies |

Inspected relevant sources: `conversation/{contracts,prompt,service,turn,
reconcile,lunar-calendar}.ts`, D1 conversation context/runtime stores;
`reminders/semantic-query.ts`, D1 semantic-query/series stores and their safety
tests; `semantic/temporal-evidence.ts`, `conversation-order.ts`;
`core-screens/CoreScreenExperience.tsx`; benchmark live/probe/offline runners;
V2 design/release docs, V1 hybrid design and ADR 0004. Existing source tests are
evidence of asserted boundaries, not test results from this documentation task.

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

Structural/evidence validation, allowed fields/operations, authorization,
state/version checks, calendar arithmetic, recurrence expansion, product policy,
confirmation and idempotency are retained; they are not competing language
interpretation. Every rejection has a reason code. Valid JSON plus a matching
quote can still be semantically wrong: never claim these checks prove meaning.
The model cannot select another user's records, treat an assistant suggestion
as user approval, or claim successful creation. Only a committed application
result can cause a success acknowledgement. Do not request/store private
chain-of-thought; enums, structured operands and evidence suffice.

The earlier specs and benchmark results remain historical evidence. Before
activation, current-state/runtime docs must identify which contract is active;
V1/V2 test passes cannot select this contract for release.

## 3. Processing boundaries

1. Existing inbound authentication, owner/chat binding, dedupe and durable claim.
2. Load scoped application control state; resolve explicit controls bound to the
   current pending decision and visible revision; local greeting/help fast paths
   only for unambiguous whole utterances.
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

Use domain-specific Zod discriminated unions, not JSON Patch or arbitrary paths.
Wire version is `calenote-context-1`; every root key is required, unknown keys
fail closed. `changes` is at most 13 entries; `uncertainties` at most 4 entries,
each `{field, reason, alternatives}` with at most two typed alternatives.
Reason is `MISSING | AMBIGUOUS | CONFLICT | UNSUPPORTED_COMBINATION`.
Issue field is one of the 13 slots, `intent`, `queryRange` or `operation`.
`controlEvidence` is a required array of at most three references (empty except
when citing a dialogue act); it uses the same evidence union below.

Each change is `{field, operation, value, evidence}`. SET has a non-null value
matching that field's type. CLEAR has literal null and current explicit-removal
evidence. Omission from `changes` means KEEP; null never means both KEEP and
delete. Title/date/time CLEAR makes the request incomplete; it does not delete
an existing saved reminder. `notes` is one bounded text value: a SET must retain
previous notes unless current evidence requests their replacement/removal.
Duplicate fields reject the whole patch atomically.

Evidence is one to three references per change, using one of these wire shapes:

```json
{"kind":"USER_QUOTE","turn":2,"quote":"Đổi sang 9h.","occurrence":1}
```

```json
{"kind":"CONTEXT_FACT","ref":"f3"}
```

The application constructs the control-free semantic view (§6.1.1), then
NFC-normalizes each role-labelled turn before sending it.
`turn` is a zero-based index in that exact payload; `occurrence` is one-based
among left-to-right non-overlapping exact substring matches. Match NFC text
case-sensitively; no accent stripping, case folding, UTF-16 offsets or byte
offsets on the wire. Repeated phrases require the explicit occurrence number.
Reject empty/over-2000-code-point quotes, absent turns, non-user quotes and nonexistent
occurrences. Store the derived code-point span internally with original turn
identity, view-to-source mapping and normalization version. Quotes must cover
only unchanged USER source segments, never a control placeholder or a span
crossing removed text. Retain source text encrypted for the pending
lifetime, not in logs. Surrogate pairs/combining accents require regression tests.

`f3` is a per-payload alias for a validated reminder/query fact, not an internal
ID. Each alias has explicit REMINDER/QUERY scope; query facts cannot supply
reminder slots. The server holds the alias-to-field/provenance mapping bound to that call's
context revision. A fact reference may preserve/reuse its value, not fabricate a
changed value. SET replacement and CLEAR require current USER_QUOTE evidence;
old quotes alone cannot undo a newer correction. Assistant proposals cannot be
fact evidence. The backend, not the model, stamps `EXPLICIT_USER` or
`DERIVED_POLICY(policyVersion, dependencies, referenceTime)` provenance.
An inferred year is always derived even if the model emits a year: a year not
explicitly present in evidence is omitted/null and resolved under §5.2.

Evidence existence is not semantic entailment. Uncertain interpretations must
carry alternatives; impossible/incompatible combinations clarify or reject.
Do not try to prove all meaning with another Vietnamese regex parser. Preview,
real-model evaluation and confirmation address residual interpretation risk.

Supported semantic slots:

| Slot | Meaning |
| --- | --- |
| `title` | Concise task label, grounded in the user's words |
| `location` | Separate event location, not discarded when shortening title |
| `notes` | Relevant task details not represented elsewhere; no invented facts |
| `eventDate`, `eventTime` | When the event itself occurs |
| `reminderDate`, `reminderTime` | When a notification is requested |
| `calendar` | GREGORIAN or explicitly requested LUNAR_VN |
| `frequency` | ONCE, DAILY, WEEKLY, MONTHLY, YEARLY or UNKNOWN |
| `occurrenceCount` | Number of notifications, not a lead offset |
| `eventRelation` | BEFORE_EVENT, INCLUDING_EVENT or STARTING_ON |
| `leadOffsetDays` | Explicit calendar-day offset for ONCE; never reused as count |
| `endDate` | An explicitly requested finite end condition |

`timezone` is an application setting, not a writable model field. The 13
allowed fields are exactly the table's individual slots. String bounds are
title 1800, location 300, notes 2000 Unicode code points; budget checks may reject
the combined payload earlier. Full meaningful details cannot be silently cut.

Date operands are strict discriminated unions (design notation):

- `CIVIL_DATE {calendar, day, month, year, leapMonth}`: required source calendar
  `GREGORIAN | LUNAR_VN`, integer day 1–31, month 1–12,
  year null or 1–9999; leapMonth null/boolean. Gregorian requires leapMonth null;
  lunar execution requires explicit year and resolves ambiguous leap choice by
  clarification. Calendar validity and supported horizons are separate checks.
- `RELATIVE_DAY {offsetDays}`: integer -366–366, relative to source receipt.
- `WEEKDAY {weekday, qualifier}`: ISO weekday 1–7 and qualifier
  `THIS_WEEK | NEXT_WEEK | UNRESOLVED`; unresolved selection clarifies.
- Clock `{hour, minute, qualifier}`: integer minute 0–59, hour 0–23 for `H24`,
  1–12 for `AM | PM`, or 0–23 for `UNKNOWN`; UNKNOWN clarifies if ambiguous.
  A stated `12h trưa` can normalize to 12:00; no missing clock is manufactured.

Relative day/weekday operands operate on civil Gregorian days; switching a
request to lunar does not make “tomorrow” a different day. Lunar year/month/day
conversion applies to explicitly lunar CIVIL_DATE operands only.
Every CIVIL_DATE declares its own source calendar, including query operands;
it never inherits an unrelated pending reminder's calendar. Reminder operands
must agree with their request's calendar slot or clarify the conflict. Query
`outputCalendar` is separate: neither it nor the active draft chooses the input
calendar. Relative/weekday operands always identify Gregorian civil days under
the runtime reference policy. If the user names no calendar, use Gregorian default
with policy provenance, not an inferred opposite of outputCalendar.

CALENDAR_DATE supports both Gregorian-to-lunar and lunar-to-Gregorian lookup
through the canonical converter. “Hôm nay là ngày mấy âm lịch?” uses
RELATIVE_DAY(offsetDays=0), outputCalendar=LUNAR_VN. “Ngày 15/6/2027 âm lịch là
ngày dương nào?” uses CIVIL_DATE(calendar=LUNAR_VN,day=15,month=6,year=2027,
leapMonth=null), outputCalendar=GREGORIAN; clarify leap choice only if ambiguous.
No converted value is stipulated here. Explicit Gregorian lookup with a lunar
draft, or lunar lookup with a Gregorian draft, leaves that draft unchanged.
LIST civil-date endpoints in this slice are Gregorian only; preserve an explicit
lunar LIST request as unsupported, never relabel its dates. No new recurrence
or date-expression type is introduced.

List query shape is `{kind: LIST, period, statusScope: DEFAULT}`; period may be
null only to ask for range. Period is a discriminated union: `{kind: DAY, date}`,
`{kind: WEEK|MONTH|WEEKEND, offset: -1|0|1}`, `{kind: REST_OF_MONTH}`,
`{kind: NEXT_7_DAYS}`, `{kind: UPCOMING}`, or `{kind: DATE_BOUNDS, from, through}`.
Calendar query is `{kind: CALENDAR_DATE, date, outputCalendar: LUNAR_VN|GREGORIAN}`.
Capability query is `{kind: CAPABILITY, topic: LUNAR|FINITE_SERIES|ANNUAL}`.
These are design type notations, not executable JSON. Calendar/capability
queries never masquerade as scheduling changes. Every non-null query also has
one to three `evidence` references grounding its operands; a reference to the
pending query may reuse scope, but new range operands require current user
evidence. Required but unresolved query operands are null with a targeted
uncertainty, not invented defaults.

Recurrence separates **frequency**, **occurrence count**, **event relation**,
**lead offset**, and **end condition**. A one-time reminder two days before an
event is not a two-occurrence series. Frequency can describe DAILY, WEEKLY,
MONTHLY or YEARLY intent even when execution support is absent; unsupported
intent must survive interpretation so the application can explain it accurately.
The executable subset in this release remains one-off and finite daily series.
If no cadence is requested, the application defaults a new complete one-off
request to ONCE/count1 with DERIVED_POLICY provenance. UNKNOWN or explicitly
unsupported cadence never receives that default. Integers count/offset must be
positive, with executable daily count 2–30 and lead offset at most 366 days;
out-of-bound requests receive a limitation, not a clamped schedule.
Qualifiers or units outside supported expression types produce a targeted
unsupported/clarification outcome, never a guessed conversion.

Proposal dispatch rules: LIST/CALENDAR/CAPABILITY require their matching `query`
union and empty changes; non-query intents require query null. Read operations
may contain uncertainty but never draft SET/CLEAR operations. HELP/UNSUPPORTED/
ABANDON cannot carry executable changes. A multiple-action utterance is returned
as AMBIGUOUS with `UNSUPPORTED_COMBINATION` and current evidence; ask which to
handle first, preserve the existing draft and do not silently execute a subset.
CREATE/EDIT proposals still require backend completeness checks and confirmation.

Cross-field checks reject/clarify count/offset conflation, count versus end-date
disagreement, competing event-relative and absolute schedules, timezone changes,
unsupported cadence, lunar/solar conflicts and inaccessible context references.
When DAILY has start+end but no count, backend derives inclusive count (2–30);
with both count and end, they must agree. A relation-based daily series uses
count, not lead offset; unsupported combinations are explained, not guessed.

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
Every material detail edit, not only schedule edits, creates a new preview
revision; approval includes location and notes too. `contextRevision` changes
for conversational bookkeeping; `draftRevision` changes only for draft content
or validity. A read-only interruption must not masquerade as a draft edit.

### 4.3 Canonical confirmed object

Confirmation records the exact previewed revision, resolved occurrences,
calendar provenance, and encrypted task details. Preserve existing single-draft
uniqueness and series/occurrence lineage. Never reconstruct confirmed data from
a later model response. Scheduler/delivery consumes canonical records only.

The existing pending contract lacks separate location, notes and eventTime. The
implementation must add versioned encrypted detail storage and carry it through
draft, confirmation, query and web detail views. Existing keyring conventions
and owner-scoped authenticated encryption remain mandatory. Any new migration
must be additive and separately reviewed; do not rewrite 0007/0008 or silently
pack structured metadata into the title string.

### 4.4 Preservation example and complete data path

Design example, fixed receipt date 2026-09-28 in Asia/Ho_Chi_Minh:

| Exact user turn | Accepted pending fields after the turn | State / effect |
| --- | --- | --- |
| “Ngày 11/10 đi thi ở Quang Trung, nhớ mang giấy tờ.” | title=đi thi; location=Quang Trung; notes=nhớ mang giấy tờ; eventDate=2026-10-11 (year derived); reminderTime missing | CLARIFYING; zero canonical reminders |
| “Nhắc hai ngày liên tiếp trước hôm thi.” | Preserve above; frequency=DAILY; occurrenceCount=2; eventRelation=BEFORE_EVENT | Ask only time |
| “8h.” | reminderTime=08:00; all other facts unchanged; derived occurrences 09/10,10/10 | AWAITING_CONFIRMATION at draft revision v; no canonical mutation |
| “Đổi sang 9h.” | reminderTime=09:00 only; same two dates and details | New preview v+1; v cannot confirm |

Model proposal → validated encrypted draft → preview displaying title, location,
notes, event date separately from every notification date/time → confirmation of
that version → transaction writes canonical reminder(s) plus encrypted versioned
details → authenticated API decrypts only for the owner → web detail renders
separate fields → outgoing reminder includes title, location, notes and relevant
event date. No stage reconstructs missing fields by parsing the title again.
Preserve safe output encoding and message-length limits; if the complete preview
or reminder would exceed the channel limit, ask the user to shorten details
before confirmation, not silently omit notes or send extra notifications.
Legacy records expose absent detail fields as unknown/null, never inferred.

## 5. Deterministic resolution and merge

- Use trusted inbound reference time and the user's supported timezone, never
  the provider's clock. Current supported calendar convention remains Vietnam
  UTC+7; do not expand timezone support implicitly.
- Default new unrelated requests to Gregorian. Lunar scheduling requires
  explicit user evidence. Querying or displaying lunar dates does not activate
  lunar scheduling and does not change a pending request's calendar.
- For Gregorian day/month without a year, preserve the existing code's policy:
  current local year unless month/day is earlier than receipt's month/day, then
  next year. This is NOT a search for the next leap year or future clock time.
  Expose the derived year in the preview. Invalid dates are not rolled over.
  Relative dates resolve against receipt time, not processing delay.
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
- A clear contextual “bỏ” abandons only the current unconfirmed request through
  the scoped whole-utterance control in §5.1. Other model-proposed abandonment
  asks for that explicit control; negated, quoted or hypothetical text cannot
  close it. It never cancels confirmed reminders. Confirmation remains outside
  the model's output vocabulary.
- Side questions (calendar date, capabilities, list) do not extend pending TTL
  or erase the request. New unrelated intents cannot inherit old facts.

### 5.1 State and control transitions

State names here describe the new contract; map AWAITING_CONFIRMATION to the
existing DRAFT_READY lifecycle where compatible. A query question is a separate
small pending read operation, not a reminder draft. At most one active reminder
request and one transient query question per owner/chat; no general task stack.

| Prior state | Input/outcome | Result and allowed side effects |
| --- | --- | --- |
| NONE | New incomplete create | CLARIFYING; save encrypted pending facts only |
| CLARIFYING | Valid answer | Merge only supplied slots; ask smallest remaining field or preview |
| CLARIFYING | Conflicting answer without clear edit | Preserve accepted value, retain alternatives, targeted clarification |
| AWAITING_CONFIRMATION | Correction, including “Có, nhưng đổi sang 9h” | Never confirm; invalidate old preview, resolve and display new version |
| AWAITING_CONFIRMATION | Exact scoped confirmation | Transactional commit of visible version; COMPLETED |
| Active reminder | Read-only question | Retain draft/revision/TTL; query independently; resume prior question only on an explicit continuation or applicable answer |
| NONE | List without range | Pending query clarification; next range answer queries, not CREATE |
| Active reminder | Unambiguous “Bỏ.” / scoped escape | CANCELLED; discard only unconfirmed state; durable terminal fence |
| Any | “Đừng bỏ.” / quoted note | No abandonment; preserve draft or update grounded note |
| Active reminder | Unrelated new create | Ask whether to replace pending request; do not copy its facts or silently replace it |
| Any active | Expiry or invalid encrypted context | EXPIRED/INVALID; never reuse facts; explain restart, no canonical change |
| Any | Unsupported/combined request | Explain exact limitation, preserve existing draft; no partial execution |
| Any | Provider/config/budget/schema failure | No proposed changes accepted; preserve readable valid draft; specific recovery |

**Controls.** Decision type is checked before the existing confirmation
allowlist (`có`, `ok`, `1`, `xác nhận`). Match the whole NFC/case/outer-space
normalized utterance, allowing one terminal period/exclamation, never a prefix.
Mixed text always goes through interpretation after §6.1.1 sanitization.
No LLM CONFIRMED field exists. A model saying ABANDON alone cannot delete state.
Proposed scoped escape: complete standalone `bỏ`, `hủy`, `huỷ` (case/NFC/space
normalization and one terminal period/exclamation permitted) with exactly one
active unconfirmed request discards that request. Quotes, extra words and
negations never match. This small explicit UI control vocabulary is not a second
general language parser. Other abandonment paraphrases are interpreted by LLM
and ask a scoped confirmation using the escape command, rather than trusting
semantic output to perform deletion. Do not extend this to saved reminders.

**Preview binding.** Persist a preview receipt containing draft/revision/hash,
channel/chat and send outcome. Chat confirmation must follow that preview's
inbound order, target the only applicable revision and have no accepted edit in
between. If send outcome is uncertain, show the same preview again rather than
confirm an unseen version. Web confirmation carries an authenticated opaque
draft/revision token; a stale token is rejected. A bare confirmation in another
chat cannot target this draft. An authorized web user can confirm the exact
version shown there; transaction CAS makes concurrent web/chat confirmation one
winner. A query-only interruption may resume the same preview if still valid.

Arrival order alone cannot prove which edited preview a bare “có” refers to.
After a replaced/edited preview, or when send/order evidence is uncertain, require
a channel reply reference bound to that preview if supported, otherwise an
application-generated short confirmation token shown with the preview. Validate
token, owner/chat, revision and expiry together; the token is not authorization
by itself and is not sent to the LLM. Bare confirmation remains available for a
single stable, unambiguously delivered preview with current decision SAVE_PREVIEW.
The owner selected this edited-preview policy; do not equate “latest” with
“user-approved”. Cross-channel bare confirmation always fails this binding.

**Loop recovery (owner-selected policy).** Count consecutive unresolved answers for
the same question and unchanged accepted facts. At two such answers, show the
retained facts and two clear choices or the missing field's acceptable value;
do not repeat the same menu. At a third, keep the draft unmodified and offer
scoped cancel/restart. Offer web review only when an authorized screen actually
renders this contract's relevant draft state; the existing title/schedule inbox
is not proof of that capability. Otherwise recovery stays in chat. Never invent a value, erase the request or
extend its TTL. Reset the counter only after actual progress. Model/provider
failures are not treated as user clarification failures.

#### 5.1.1 Pending decision: type as well as version

Maintain at most one application-owned `pendingDecision`, not a workflow stack:
`{kind, target, questionId, previewId?, draftRevision?, contextRevision,
issuedAfterInbound, deliveryState, expiresAt, acceptedReplies}`. Target contains
owner/chat binding and the relevant request/proposal identity; a replacement or
alternative may hold one bounded encrypted candidate plus its source evidence.
All of this counts against the existing context limit. IDs, reply tokens and
authorization handles remain internal; the provider sees only semantic question
kind/text/options, never authority to approve it.

| Kind | Positive local reply when the current question is unambiguous | Authorized effect |
| --- | --- | --- |
| SAVE_PREVIEW | `có`, `ok`, `1`, `xác nhận`, or exact `xác nhận <token>` / bound reply under §5.1 | Commit only the identified valid preview through normal confirmation |
| REPLACE_PENDING | `có`, `ok`, `1`, or exact `đồng ý <token>` / bound reply | Atomically invalidate A and adopt the evidenced candidate B as unconfirmed; collect fields or show B; no canonical write |
| ACCEPT_ONE_TIME_ALTERNATIVE | Same non-save replies | Accept consideration of ONCE only; collect/preview it if no competing request, otherwise ask a separate REPLACE_PENDING question; no save |
| RESUME_PENDING | Same non-save replies | Resume retained facts and reissue clarification/preview with a fresh decision; no save |
| RESTART_PENDING | Same non-save replies | Discard only the identified unconfirmed request and ask for a fresh request; no saved-reminder cancellation |

For each decision, exact `không` or `2` declines that decision and preserves any
otherwise valid draft; it does not mean discard all state. The explicit `bỏ`/
`hủy`/`huỷ` escape remains separately scoped to the unconfirmed request (or sole
unaccepted offer when no request exists), never a saved reminder. If a current
offer and retained request make the escape target ambiguous, ask which to drop;
discard neither until scoped. Mixed replies
such as “Có, nhưng đổi sang 9h” are not any local approval.

Create a decision only after application validation; a model label cannot mint
it. Its expiry is no later than its target's existing lifetime (a standalone
offer uses the bounded conversation lifetime); showing a question never renews
a draft. New questions, accepted edits, changed target/revision, abandonment,
completion, expiry or uncertain delivery invalidate the previous decision and
its handles. Even a non-approval clarification suspends bare save confirmation.
Never search older decisions for one that matches a bare reply. A read-only
interruption preserves the draft, but returning to it must explicitly reissue
its question/preview and decision before accepting bare save approval.

Bind every approval to the current decision type, owner/chat, delivered question,
target and revision atomically. Where reference is uncertain require its bound
reply/short token; stale tokens/replies never bypass a newer question. Replays
return the recorded transition without applying it twice. Applying a non-save
decision consumes it; only a subsequent, separately answered SAVE_PREVIEW may
commit. Authenticated web save remains explicitly typed and revision-bound,
not a bare chat response to a different question.

Required flows: preview A -> new request -> REPLACE_PENDING -> “Có.” replaces
only pending A with B; it saves neither A nor B. B requires its own preview and
SAVE_PREVIEW. With unrelated A and an annual lunar request, accepting the one-off
offer saves neither request; ask whether to replace A, then collect/preview the
accepted one-off and require separate save confirmation. Declining replacement
leaves A unchanged and drops the candidate; no hidden request queue is retained.

### 5.2 Temporal examples and reference time

Assume eventDate is already resolved to 2026-10-11, reminderTime explicit:

| Interpretation | Backend-derived dates |
| --- | --- |
| ONCE, leadOffsetDays=2, BEFORE_EVENT | 2026-10-09 |
| DAILY, occurrenceCount=2, BEFORE_EVENT, no offset | 2026-10-09 and 2026-10-10 |
| DAILY, occurrenceCount=2, INCLUDING_EVENT | 2026-10-10 and 2026-10-11 |
| DAILY, occurrenceCount=2, STARTING_ON, reminderDate=2026-10-08 | 2026-10-08 and 2026-10-09 |

The LLM describes operands; it never supplies the resolved occurrence array.
Daily BEFORE_EVENT uses E-count through E-1; INCLUDING_EVENT uses E-count+1
through E; STARTING_ON uses S through S+count-1. An explicit change to E recomputes
all dependent proposed occurrences and invalidates preview approval. Independent
absolute reminder dates do not move with E; an incompatible mixture clarifies.

Each temporal operand retains its source turn's trusted receipt instant and
timezone. A fact resolved from “mai” before midnight keeps that date on a later
turn after midnight. A NEW “mai” in the later turn uses that later receipt;
if it conflicts, follow edit/conflict rules. Retry uses the original receipt,
never the retry clock. Facts referenced from context retain original provenance.

Missing date/time is clarified. Year inference follows §5 above and is tagged
DERIVED_POLICY, not user-supplied. If inferred 29/02 is invalid in that year,
ask for a year; do not search or normalize. Explicit past dates stay past and
cannot schedule. At preview and confirmation recheck that every occurrence is
future and within the existing 366-day horizon; do not skip past children or
auto-roll an elapsed same-day time to tomorrow. Unknown event time must not be
invented from reminderTime. Hour-offset reminders are outside this daily design.
Default ONCE is not permission to invent a reminder date: an event date alone
without a stated reminder date/relation requires targeted clarification. For an
explicit same-event-day one-off, INCLUDING_EVENT resolves to E; BEFORE_EVENT
requires its lead offset. STARTING_ON requires its stated reminder date.

### 5.3 Read-only range semantics (owner-selected status policy)

All boundaries use Asia/Ho_Chi_Minh and half-open intervals. The month containing
the query turn is anchored to its receipt, not any old pending reminder's date.

| Meaning | Range |
| --- | --- |
| “Tháng này” | Local month start to next month start, including earlier days |
| “Từ giờ đến cuối tháng” | Receipt instant to next month start |
| Today / tomorrow / explicit date | Corresponding midnight to next midnight |
| This/next week | Monday midnight to following Monday |
| This/next weekend | Saturday midnight to Monday within the selected week |
| Next seven days | Today midnight through midnight seven days later |
| Upcoming | Receipt through receipt +30 days, explicitly labelled 30 days |
| Explicit inclusive date bounds | Start midnight to midnight after end date |

Maximum query span 366 days; reject an oversized/reversed range with an explicit
reason, not an empty list. The 30-day store guard must change for the successor
so a 31-day month can execute. Both endpoints of explicit date queries remain
within 366 calendar days of the query's receipt date.

Return scheduled canonical reminders in `PENDING, CLAIMED,
RETRYABLE, SENT, FAILED, UNCERTAIN`; exclude CANCELLED and unconfirmed drafts.
Label each status; SENT is delivered, not a user-completed task. This broadens
the current active-only query intentionally under the owner selection (§10.1).
Preserve current owner/workspace/**bound chat** query scope; do not widen to
another connection merely because the owner is the same. Label that scope.

Order ascending by scheduledAt then stable internal ID. Fetch six, display at
most five, and say “5 kết quả đầu; còn kết quả khác” when the sixth exists;
link to authenticated Calendar for more, explaining that web may show other
owner-authorized channels. Do not claim an exact total without a count query.
The web API's own result cap also requires a visible partial-result notice; a
link alone is not a guarantee of a complete monthly result. No pagination or
unbounded fetch is implied by that link.
No new chat-pagination subsystem. A failed or unauthorized query is not “empty”.
Query success cannot write reminders, proposals or extend pending TTL; only
inbound completion, bounded query conversation state and content-free audit are
allowed. No model call receives or invents database results.

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

### 6.1 Explicit context input

Internal state: authenticated owner/workspace/connection/chat IDs, inbound ID,
receipt/order tuple `(receivedAt, rowid)`, claim marker, request ID,
contextRevision/draftRevision, contract version, lifecycle, field provenance,
pending reminder/query questions, preview receipt, model-attempt binding, expiry,
capability version. None of those identifiers is provider-selected.

Provider root keys are mandatory; nullable objects mean absent, arrays may be
empty. Payload version is `calenote-context-input-1`:

| Field | Contents and trust |
| --- | --- |
| `schemaVersion` | Runtime-owned literal |
| `reference` | Runtime-owned current receipt's ISO instant, local date, timezone; not writable |
| `turns` | Oldest-first role-labelled `{role: USER or ASSISTANT, text}` semantic views from §6.1.1; at most six USER turns including current and six ASSISTANT turns; all text untrusted as instructions |
| `currentTurn` | Runtime index of current USER entry; exactly one current message |
| `activeRequest` | Null or sanitized lifecycle, each of the 13 slots with state, value and local fact alias; accepted means backend-validated pending fact, NOT confirmed |
| `facts` | Alias map to value, EXPLICIT_USER or DERIVED_POLICY provenance, source reference time and dependencies; no owner/request/inbound IDs |
| `pendingQuestion` | Null or control-free semantic question text, scope REMINDER/QUERY, field, decision kind if applicable and reason; no internal decision ID/handle; assistant text never evidence for user approval |
| `ambiguities` | Unresolved field alternatives tied to evidence; bounded to four |
| `capabilities` | Runtime-owned version and supported/unsupported operations, calendars and limits; content does not let a user enable features |

Retain the actual assistant clarification/preview text and its kind in encrypted
context, distinguishing sent, failed and uncertain delivery internally. Do not
present a failed send as a question the user has seen. A full preview need not
be represented to the LLM twice if its semantic view is already an assistant turn.
Server-owned policy and user text are separate structured fields; user text
cannot override policy even if it impersonates a system message.

No free-form model summary. The six USER-turn bound includes the incoming turn;
up to five prior user turns and the corresponding assistant turns can be sent.
The entire encrypted snapshot, facts, questions and turns remains <=16 KiB.
Do not evict source evidence while it supports a pending fact. At overflow,
refuse further semantic dispatch and explain shorten/restart while keeping the
valid draft and local cancel controls available. No silent truncation.

NONE is different from load failure: with no request, a short “9h” cannot borrow
old facts; clarify the task/date. Corrupt, unavailable or expired context never
falls back to guessed history. Use scoped restart only after explicit user
choice where valid state can be preserved. Side queries retain the reminder
until its existing expiry; latest QUERY question takes priority for a range-only
answer. If a fragment could answer both scopes, ask which. Process restart
loads the same encrypted accepted state; volatile uncommitted model output is
not retained as fact. Completed/cancelled contexts cannot be resumed.

#### 6.1.1 Internal transcript versus provider semantic view

The encrypted internal transcript retains exact received/sent text and delivery
state within existing lifetime/size limits. Provider text is a transformed
semantic view, not an exact unmodified transcript. At the context-builder
boundary, use application-recorded control spans and an owner/chat-scoped issued
handle registry to replace confirmation tokens, action-bearing application URLs
(including their parameters), opaque approval handles and internal control IDs
with fixed non-authorizing placeholders. Keep question meaning, options, task,
dates/times and ordinary user location/notes. Do not strip arbitrary URLs/numbers
or all assistant context. Never include removed values in placeholders or logs.
Issued short tokens use a reserved application marker and random value, not
ordinary task numbers or words; registry matching is scoped, not a global regex.

Whole exact control replies are handled locally only under §5.1.1. For mixed
user text containing a known issued control, normalize and replace that exact
control span before semantic dispatch; retain “đổi sang 9h”, for example. Never
strip a token then reinterpret the remaining “có” as local approval. If safe
separation or source mapping is ambiguous, refuse dispatch with a specific
rephrase response and preserve the draft. Do not delete ordinary semantic text
merely because it resembles a token; a genuine collision also fails safely.

Apply this projection to every provider-facing string, including facts, notes,
pendingQuestion, alternatives and evidence excerpts, not just turns. Retain a
bounded registry for active and retained-transcript controls until that context
expires; unknown control-shaped material that cannot be classified safely blocks
dispatch rather than invoking a broad user-content stripping rule. Final payload
validation rejects any remaining known forbidden control value, including JSON
escaped/URL-encoded representations. No outbound provider request may carry one.

Evidence indexes/occurrences match the exact NFC semantic view supplied to the
model. Keep an internal segment map to the original encrypted source; reject
quotes spanning removed segments or placeholders. NFC combining marks and
surrogate pairs must map correctly. Sanitization cannot manufacture approval,
promote assistant text to USER evidence or alter accepted field authority. It
does not grant permission to change ordinary task content or expand the caps.

### 6.2 Ordering, identities and recovery

Reuse existing D1 transaction, `ownedInbound`, terminal-outcome order fences and
revision compare-and-set patterns; no new coordination service or debounce.
Proposed changes must add a pre-dispatch observation token covering context
absence as well as presence, so work started with NONE cannot overwrite a later
accepted request/terminal outcome. R13 cancellation itself requires an existing
persisted pending request: bind owner/chat + context ID/revision and, where
present, source-linked proposal ID/revision; reuse `ownedInbound`, context CAS,
`conversation_context_outcomes` and later terminal inbound ordering fences.
An interpretation editing that request loses authority after its abandonment.

First-ever interpretation still in flight with no persisted draft is NOT a
supported targeted-abandon case in this slice. Reply truthfully that no pending
draft can yet be identified/cancelled; do not say “đã bỏ”. Existing newer-terminal
inbound fencing may supersede old work, but is not a cancellation receipt. R13
does not prove targeted cancellation of that first in-flight request. No new
batching/coordination subsystem is implied; the no-draft variant must verify
truthful response and no canonical mutation, not fictitious draft cancellation.

| Identity | Binding |
| --- | --- |
| Inbound | Existing unique provider message/dedupe identity and trusted ordering tuple |
| Request / draft | Application-created identity under one owner and conversation |
| Context / draft version | Exact pre-read revision and current visible proposal revision |
| Model attempt | One durable inbound attempt, bound to context token + input/prompt/contract digest; never supplied by model |
| Confirmation | Inbound dedupe key or authenticated web request key + exact preview revision/hash |
| Canonical mutation | Existing unique source draft / series proposal and occurrence indexes, committed atomically |

Duplicate inbound does not call the model or advance the request twice. Two
nearby messages are not automatically combined: if the second finishes first,
the first cannot overwrite it. If the second was interpreted without a required
predecessor's accepted context, reject it as CONTEXT_STALE/CONTEXT_NOT_READY and
ask a targeted resend; do not claim lossless burst handling. Arrival alone does
not invalidate an earlier valid result: a later accepted outcome/correction or
terminal state does. Recheck binding/expiry/ownership in the mutation transaction,
not just before the provider call. A queued confirmation received before a
preview cannot confirm that later preview.

An accepted correction invalidates the prior preview. An accepted abandon writes
a durable terminal outcome before acknowledging it. Delayed model results fail
their context binding and cannot save, send a stale preview or resurrect state.
Outbound selection rechecks current revision; once an external send is already
in flight it cannot be recalled. Do not claim exactly-once external messaging.

Canonical commit plus lost reply: read the existing result through the same
authorized identity, report it if known, never repeat INSERTs or claim failure
without checking. Duplicate confirmation is a no-op returning existing outcome.
An uncertain outbound delivery is recorded UNCERTAIN; no blind resend of either
reminder or paid inference. Known safe outbound retries retain delivery policy.

| Failure reason | Recovery / state |
| --- | --- |
| BUDGET_EXHAUSTED / CONFIG_UNAVAILABLE | No dispatch; explain unavailable AI, retain draft, allow local controls |
| PROVIDER_TIMEOUT / PROVIDER_FAILURE | No automatic retry/fallback; retain draft; user may submit a new turn |
| SCHEMA_INVALID / EVIDENCE_INVALID | Reject complete patch; explain interpretation failure and request clarification |
| CONFLICT / UNSUPPORTED_CAPABILITY | Show conflicting fields or exact capability limit; no substitute schedule |
| CONTEXT_STALE / SUPERSEDED | Discard old result; do not emit an obsolete success or preview |
| STORE_UNCERTAIN | Read back authorized revision/result; acknowledge only verified state |

Do not promise unchanged pending state after a partial storage operation without
read-back. Context/preview transitions should be transactional where coupled;
canonical mutation, encrypted details, lineage and terminalization must be.

## 7. Calendar display and capability scope

Add secondary Vietnamese lunar day labels to the Calendar grid and selected-day
details using the same adapter/version as chat. Solar date remains primary;
show month on lunar month boundaries and distinguish leap months. Unsupported
dates get an explicit unavailable label, not fabricated values. Test responsive
layout and accessible names. This display does not alter event dates or enable
lunar scheduling. No astronomical moon-phase feature.

Use version `lunar-vn-utc7-ae2.1.19-v1` from the current artifact, not browser
locale assumptions. Supported lunar years are 1900–2100; the artifact's solar
coverage is 1900-01-31 through 2101-01-28 inclusive. Chat/web check actual adapter
coverage, including boundary days, rather than clipping by Gregorian year.
Calendar month navigation and “today” must use Vietnam civil dates even if the
browser is in another timezone. Keep existing reminder markers/details visible.
Each grid cell shows primary solar day and secondary lunar day; lunar day 1 and
the first visible day show lunar day/month. Leap-month labels include “nhuận”.
Selected-day detail shows full solar and lunar day/month/year and convention;
accessible names contain both dates, selected state and reminder count.
Outside coverage retain solar/reminder display and say lunar lookup unavailable.

Parity fixtures use the existing 13 reference vectors in
`tools/calendar/reference-vectors.json`, plus day before/after each reference
date, all artifact month starts/ends, both coverage edges and one day outside.
Include 2004-03-21 = lunar 1/2/2004 nhuận and 2004-04-18 = lunar 29/2/2004 nhuận.
These are repository reference fixtures, not newly verified external astronomy
claims. Chat and Calendar must produce identical results from the same adapter.

“Hôm nay ngày mấy âm lịch?” is a read-only CALENDAR_QUERY resolved by code.
“Có lưu âm lịch không?” is CAPABILITY_QUERY with an explanation of actual scope.

Annual lunar requests are understood and retained but **not executable** in this
slice. Explain that annual automation is unsupported and offer a one-off option;
only if the user chooses that option, collect missing year/time and show a
one-off preview through ACCEPT_ONE_TIME_ALTERNATIVE (§5.1.1). If another draft
exists, separately resolve replacement first; accepting the offer never saves
that draft or the alternative. Never replace annual intent with one occurrence.
An annual scheduler requires a separate design for leap-month/missing-day
policy, rolling materialization, cancellation and delivery lineage.

## 8. Model route, bounds and observability

Keep `AI_MODE=privacy`, `google/gemini-2.5-flash-lite`, `google-vertex/eu`, ZDR,
strict structured output, no fallback and existing timeout. No model shopping.
Keep hard production limits: 50 owner calls/day, 500000 owner monthly cost
microunits and 2000000 global daily cost microunits.

Retained proposed design limits, selected for later feasibility measurement: 1800
UTF-16 code units for current provider input and 12000 input tokens for the entire
prompt/schema/context; increase maximum output from 256 to 1536 tokens and
bounded response body to 32 KiB. Context's 16 KiB is a separate tighter content
limit, not a token estimate. A deterministic tokenizer or proven conservative
upper bound must account for the entire wire request and schema overhead before
dispatch. Oversized/truncated output rejects atomically; never accept half a
patch. Offline worst-case serialization must fit; otherwise revise the design
for owner review before live testing, not silently raise caps.

Reserve the maximum input+output cost before dispatch using the revalidated
route prices. At the existing ceilings ($0.10/$0.40 per million input/output
tokens), the proposed token ceiling reserves at least 1815 microunits per call,
rounded upward; include any documented additional billable overhead. Keep 30s
per-call timeout and retry=0. No code path dispatches beyond its reservation.
Output-cap changes require separate reviewed runtime config; this doc changes
no settings. Owner/global limits above remain hard and unchanged.

Content-free telemetry distinguishes: local fast path, pre-dispatch rejection
category, reserved, dispatched, provider outcome/schema outcome, latency, usage,
and backend decision. Use application-generated correlation identifiers, never
raw user identity/content. Dispatch does not imply success; model success does
not imply correct reconciliation. Retain aggregate counters so provider usage
can be checked without exposing conversation content or building an admin page.

### 8.1 Invocation and trace contract

| Case | Invocation policy |
| --- | --- |
| Natural new request, contextual answer, mixed correction, natural query | One semantic call after guards and budget admission |
| Exact scoped confirm/abandon or standalone greeting/help | Local fast path; trace why bypassed |
| Calendar grid, authorized explicit API range, arithmetic after validated operands | No model call |
| Invalid auth/context, duplicate, disabled/unavailable config or no budget | No dispatch; categorical refusal |

Events: `INBOUND_ACCEPTED`, `CONTEXT_LOADED`, `MODEL_REQUIRED` or
`MODEL_BYPASSED(reason)`, `REQUEST_PREPARED`, `REQUEST_DISPATCHED`,
`RESPONSE_RECEIVED`, `STRUCTURE_VALIDATED`, `PROVENANCE_DOMAIN_VALIDATED`,
`TRANSITION_ACCEPTED` or `TRANSITION_REJECTED`, `SCHEDULE_RESOLVED`,
`QUERY_EXECUTED`, `CONFIRMATION_VALIDATED`, `MUTATION_COMMITTED` or
`MUTATION_IDEMPOTENT_SKIP`, `REPLY_SELECTED`, `REPLY_DISPATCHED`, and the outbound
outcome. Emit only relevant events; failures must terminate with a reason.

Correlate with random application attempt/trace IDs and safe revision numbers,
not raw owner/chat/message IDs. Record source SHA, contract/prompt version,
configured and observed model/provider when available, outcome/reason, timing,
token/cost availability, context/draft version before/after and reservation ID
through protected internal mapping. Do not log prompt, response, excerpts,
names, ciphertext or chain-of-thought. Mark unknown usage/route as unknown, not
zero/verified. Prepared, dispatched, response-valid and end-to-end correct are
different counters. Provider timing does not prove visible typing animation.

### 8.2 Size boundaries and offline fit gate

These are distinct gates, all required; passing one never overrides another.
Count text after NFC normalization, before control redaction, without truncation
or trimming task content to pass admission. Retain original encrypted source and
the normalization/view mapping. A code point is one Unicode scalar; a UTF-16
code unit is JavaScript string.length (a supplementary character counts as two).
Combining sequences may contract under NFC; neither count means grapheme count.

| Boundary | Limit / precedence |
| --- | --- |
| Inbound transport | Existing webhook body cap 32 KiB of raw request bytes, plus current channel validation; 1800/2000 are not transport body limits |
| Retained user turn | 2000 NFC code points, preserving the existing context bound; longer text may be transport-admitted but is not appended to semantic context |
| Current semantic-dispatch input | 1800 NFC UTF-16 code units, preserving the current gateway ceiling; also obey the retained-turn cap; check before and after projection so removal cannot bypass admission |
| Retained context | Six USER turns and <=16 KiB UTF-8 serialized snapshot JSON before encryption, including facts, decision/candidate, internal transcript and mapping; encryption overhead is separately bounded by storage |
| Serialized provider request | <=12000 total input tokens for prompt/schema/context, plus all constituent limits; measure JSON UTF-8 bytes as a separate diagnostic, not as an interchangeable token count |
| Provider response | <=1536 output tokens AND <=32 KiB raw response body bytes; reject truncated/oversized/schema-invalid output atomically |

Named boundary cases use NFC UTF-16 units for the current message:
INPUT_1799 and INPUT_1800 pass that length gate only; all context/token/domain
gates still apply. INPUT_1801 and INPUT_2000 may pass transport and the 2000-code-
point retained-turn ceiling, but must not dispatch semantically. Return
SEMANTIC_INPUT_TOO_LONG with a concise request to shorten/resend; do not append
the rejected message to accepted semantic facts or damage/extend the valid draft.
Text over 2000 code points also fails context-turn admission. These cases need
NFC Vietnamese, decomposed accents and supplementary-character variants, not
ASCII-only tests. Boundaries never silently truncate the current message.

Deferred offline gate (NOT RUN in this documentation task): serialize ordinary
complete create; multi-field correction; long title/location/notes preservation;
one-to-three evidence references including escaping; up to four ambiguities with
two alternatives; and maximum retained context plus full prompt/schema overhead.
Measure request/response bytes and tokens or a proven conservative bound, and
verify rejected oversized/truncated responses preserve prior state and produce
useful recovery. Include control projection and internal mapping overhead.

Independent slot maxima are not a promise that their simultaneous maximum JSON
fits 1536 output tokens: copying long text plus evidence/alternatives competes
for the same output budget. Cost arithmetic (1815 microunits reservation) proves
neither serialization size nor token feasibility. Before live admission, prove
ordinary required flows fit and define a conservative aggregate admission guard;
reject over-budget cases with shorten/restart guidance, never clip fields. If
required flows cannot fit, stop for a bounded spec amendment (compact evidence
representation or a lower explicitly disclosed aggregate envelope), not a
silent cap/budget increase. No tokenizer/serialization feasibility result is
claimed here and no executable tests are changed by this task.

#### 8.2.1 Owner-approved split feasibility methodology (2026-09-29)

The preceding combined gate is retained as historical methodology. The owner
explicitly replaces its dependency rule with two separately reported dimensions:

**A — Local engineering feasibility.** Verify strict contracts, lossless
serialization, Unicode/byte limits, retained-context capacity, representative
synthetic output sizes, applicable local token counts and known prompt/schema
content overhead, explicit aggregate refusal and independent evidence review.
No known unresolved required ordinary-flow violation of an enforceable local
boundary may remain. Independent maxima are still not promises of aggregate
fit; classify each overflow against the original spec/manifest, never by the
desired test result. Refusal preserves the prior accepted state, details and
expiry without dispatch or mutation. Local probe proof is distinct from later
real-store transactional proof.

Provision pinned official Google local-tokenizer tooling and its hash-verified
referenced artifact only in a plan-owned ignored virtual environment/cache.
No runtime dependencies, global Python changes, credentials, API client,
inference or provider counting calls. Record bootstrap downloads separately;
warm and verify the cache, then block network during synthetic measurement.
Report actual application text, raw serialized JSON diagnostic text and the
SDK-supported structured counting projection separately. Inspect ignored or
unsupported schema/config fields; never silently prune the canonical schema.
None of these measurements alone establishes the transformed provider count.

**B — Provider-route admission and live validation.** Establish actual
OpenRouter/provider transformation, strict-schema compatibility, applicable
framing/accounting and a defensible pre-dispatch reservation/admission method,
then observe actual usage and application-path acceptance under authorized
evaluation. Unknown external transformation/framing remains UNKNOWN. Local
Python tooling is not a Worker admission implementation; runtime enforcement
must be valid for the deployed architecture. Missing or unverified route
admission fails closed before any real successor dispatch. Test-only admission
observations can exercise fake transports only, never select a network path.

After A and its independent review PASS, dormant T1–T10 implementation proceeds
automatically even if B remains unresolved. B still blocks affected real network
dispatch and release activation. Do not report `T0_FIT=PASS` for A alone; use
`T0_LOCAL_ENGINEERING_GATE` and `FULL_ROUTE_TOKEN_BOUND` independently.
All original limits, model/route/privacy/no-fallback policy, evaluation ceilings,
product exclusions and release authorizations remain unchanged. T0 authorizes
no early calibration campaign. If B remains unresolved after useful local work,
report one consolidated specific external-method request without executing it.

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

### 9.1 Three verification layers

1. Deterministic contract/domain/integration tests: schema/evidence, merge,
   ordering, arithmetic/conversion, encryption, ownership, idempotency, API and
   persistence compatibility; injected timeouts/budget/corruption failures.
   Keep existing safety coverage. These tests do not call a provider.
2. Real-LLM conversations through actual application construction: production
   context builder, configured gateway, response validation, service transition,
   schedule resolver, real D1 store implementations in isolated test persistence,
   actual confirmation path and API read-back. Stub only external messaging and
   use synthetic clock/identities/fixtures. Capture real selected reply text in a
   test sink and inspect committed state after each turn. Do not replace context
   with handwritten prompt fixtures or use a second pure evaluator as the oracle
   for what the service did. Existing `conversation-v2-probe.ts` is a useful base,
   not proof of this new path. No production credentials/data/notifications.
3. Channel/UI acceptance after separate deployment approval: exact Worker/source
   version, authorized test account, controlled reminders, Zalo visible responses,
   Calendar parity and canonical read-back. Record typing visibility separately.

Every critical script checks interpretation, patch, preserved fields, state after
each turn, calculated dates, response meaning, canonical mutation/child counts
and absence of unintended effects. Friendly wording alone is not a score.

### 9.2 Retained proposed dataset and scoring (not execution authority)

- Pilot: 16 mandatory scripts R01–R16 once, plus two additional runs of each
  of R02/R03/R05/R06/R07/R08/R11/R13: **32 conversation executions**.
- Full after pilot PASS: 64 distinct scripts = the 16 regressions +16 development
  paraphrase/abbreviation variants +32 held-out scripts never used to tune the
  prompt. Run each once, plus two additional runs of the same eight critical
  regressions: **80 conversation executions**. No best-of-three selection.
- Each script has at most six user turns. Freeze exact text, expected model-call
  turns, timestamps, fault schedule, expected per-turn field states, expected
  mutation counts and scorer before dispatch. R04 has two independent branches
  in its script, with an explicit state reset between comparisons. Fresh state
  per execution; repeat count is planned sampling, not retry after failure.
- Pilot requires 32/32 conversation executions correct and schema 100%. Full
  requires >=76/80 executions correct, >=31/32 held-out scripts correct, schema
  >=99%, and every mandatory regression/repetition correct. Both require 100%
  preservation of explicitly supplied required details and zero observed safety
  failures. Any mandatory failure fails the gate regardless of aggregate score.

A conversation passes only if ALL expected per-turn outcomes, invariants and
final effects pass. Denominator is all 32/80 planned executions, not only those
that finish. Turn accuracy is correct planned turn outcomes / all manifest
turns. Schema rate is valid outputs / all manifest turns requiring a healthy
model call; an unexpected missing dispatch, timeout or malformed result is a
failure there. Also report raw valid outputs / actual dispatches independently.
Expected deterministic bypasses and explicitly injected refusal tests do not
enter the schema denominator; their expected safe outcomes still enter turn and
conversation scores. Freeze those categories before execution.

Detail preservation is correct required field assertions / all required field
assertions in the manifest, checked after every applicable turn and persistence
stage. Count missing/unexecuted assertions as failures. Safety includes wrong
owner access, pre-confirmation mutation, duplicate canonical mutation, stale
confirmation, unsupported-schedule substitution or private-data leakage. A
confirmed daily series legitimately creates N children under ONE authorized
series transaction; expect exactly that N, not one reminder row.

Record separate categories for semantic failure, safety failure, expected
unsupported behavior, provider unavailability, and cost/time termination. Do not
hide outages in successful-only metrics. Preserve stopped runs and mark remaining
executions NOT_RUN, never PASS. A finite suite does not prove universal safety.

### 9.3 Proposed live envelope, not authorization

| Profile | Maximum dispatched calls | Maximum total reservation/spend | Maximum wall time |
| --- | --- | --- | --- |
| Pilot | 192 | USD 0.50 | 20 minutes |
| Full | 480 | USD 1.00 | 45 minutes |

Retry=0; no fallback; planned repetitions consume these caps. Combined new
campaign ceiling USD1.50, not an increase to production budgets. Admission must
verify the actual config/price ceiling fits each cap; retained worst-case
reservations, not optimistic actual usage, guard uncertain calls. A new run or
failed run cannot reset cumulative authorization. Stop before the next dispatch
would exceed calls/cost/deadline; abort outstanding calls at deadline and retain
their reservations. Stop immediately on a safety or mandatory regression failure,
route mismatch, credential/isolation failure, or unexpected provider failure.

Future explicit approval must name the immutable candidate, profiles, permitted
non-production provider credential source and isolated persistence, these caps,
cleanup and stop conditions. Synthetic per-scenario identities still exercise
the unchanged runtime budget checks; an append-only campaign ledger additionally
enforces the aggregate cap across isolated fixtures/repetitions. Do not rotate
real users or credentials to evade limits. Clean up only explicitly identified
synthetic local stores; preserve sanitized manifests/digests/outcomes/usage and
authorization ledgers. No live runs are authorized or executed by this task.

Bind evidence to source, prompt, input/output contract, context builder, calendar,
resolver, storage/migrations, scorer, corpus, config and observed model/provider.
Material changes require affected revalidation; frozen held-out data used to tune
a fix must be replaced before the next held-out acceptance run. Historical V2
37-turn evidence stays intact but does not admit this contract. Mock, live-model,
deployed-version and human-channel evidence remain separate.

### 9.4 Mandatory regression matrix

Design fixtures below retain the user's Vietnamese wording. Unless noted,
initial time is 2026-09-28 10:00 Asia/Ho_Chi_Minh, event E=2026-10-11 where
preconditions supply it. All queries/clarifications/previews have zero canonical
reminder mutations. Preseeded state is synthetic, owner-bound and explicit in
the manifest; it is never injected instead of actual multi-turn context building
for R02/R07/R08/R11. Additional test turns may confirm the shown version.

| ID | Exact input / setup | Required state and effects |
| --- | --- | --- |
| R01 | “Có lịch nào ko?” then “Tháng này có lịch gì ko?” | Pending query range resolves to Sep1–Oct1; authorized query; no repeated range question; no create |
| R02 | “Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.” → “Nhắc trước 2 ngày.” → “8h.” | Preserve exam/location/E/count2; relation BEFORE_EVENT; only time missing after turn2; preview Oct9/10 08:00, no commit |
| R03 | Pending relation question; “Nhắc trước sự kiện.” | Set BEFORE_EVENT, keep count/E/title; ask only remaining field, never abandon menu |
| R04 | “Nhắc một lần trước ngày thi 2 ngày.” versus “Nhắc 2 ngày liên tiếp trước ngày thi.”; E and 08:00 supplied in context | Separate scripts branches: one Oct9 versus Oct9/10; no count/offset conflation |
| R05 | Unconfirmed request; “Bỏ.” | CANCELLED, no saved reminder cancellation, no repeated menu; a new request can start |
| R06 | “Đừng bỏ.” then “Ghi chú là: đừng bỏ quên giấy tờ.” | No abandonment; note remains note; draft/details otherwise preserved |
| R07 | Four-turn preservation example §4.4, ending “Đổi sang 9h.” | Only reminderTime changes; revision advances; old preview invalid |
| R08 | After 08:00 preview: “Có, nhưng đổi sang 9h.” | No old-version commit; 09:00 preview needs fresh confirmation |
| R09 | “Hôm nay là ngày mấy âm lịch?” | Actual canonical conversion for receipt's local date; read-only answer, not capability help |
| R10 | “Ngày 15/6 âm lịch hằng năm, nhắc ngày giỗ người thân.” | Honest annual-unsupported explanation; no one-off downgrade; offer requires explicit acceptance, then year/time clarification |
| R11 | Pending draft; “Tháng này có lịch gì?” then return to draft | Read-only result, no contamination/loss/TTL extension; resume exact valid facts/version |
| R12 | “Mai 8h nhắc gọi mẹ” received Sep28 23:59, processed/retried Sep29 00:01 | Reminder Sep29 08:00; original receipt retained; no extra provider dispatch for replay |
| R13 | Persisted pending request; older interpretation editing it delayed; later “bỏ” accepted | Owner/chat/context-revision cancellation fence prevents resurrection/old preview; first-in-flight/no-draft case is separate under §6.2 |
| R14 | Same confirmation delivered twice; reply lost after commit | One canonical transaction and expected child count; read-back recovers truth, no duplicate send promise |
| R15 | Malformed object, unsupported field, fabricated evidence, timeout, budget refusal (five deterministic injected variants) | Safe explicit failure, no patch/canonical mutation, no alternate parser; separate failure categories |
| R16 | Same solar/lunar dates through chat and Calendar, §7 reference/boundary set | Converter/labels match; no model arithmetic; read-only |

R15's five injected variants and R16's full UI/vector expansion belong to Layer1
and Layer3 respectively. Their Layer2 scripts exercise healthy real-model
interpretation plus one predeclared injected failure (R15), and one real lunar
query plus a shared presentation projection (R16). Those narrowed live scripts
do not replace the mandatory full deterministic/UI expansions. Record each
layer's result separately; all expansions are required for final acceptance.

#### 9.4.1 Targeted closure variants, within the existing envelope

These disclosed cases are development regressions, NOT held-out data. R01–R16
and their original Vietnamese wording remain; do not replace them to make room.

| Family | Layer1 deterministic variants | Layer2 application/real-model variant | Layer3 after authorized deployment |
| --- | --- | --- | --- |
| R08/R11/R14 | A save decision superseded by replacement; yes changes only pending state; stale/save tokens rejected; duplicate decisions idempotent | Show A -> new request -> replacement question -> “Có.” -> B still unconfirmed; mixed “Có, nhưng đổi sang 9h” stays correction | Visible question/token and resulting exact preview; no unintended A/B save |
| R10/R11 | One-time offer while unrelated A exists; acceptance then separate replacement then separate save; declines preserve A | Annual request with A, accept offer, resolve replacement, collect/preview; never save on offer approval | Truthful annual limitation and distinct approval steps |
| R05/R13 | Persisted-request abandon with delayed edit; separate no-draft/first-in-flight case returns no cancellation claim; verify actual fences | Original R13 uses real persisted context and delayed response | No stale preview after accepted persisted-draft cancellation; no false first-in-flight cancellation claim |
| R09/R16 | Source/output calendars independently typed; both converter directions, opposite-calendar pending draft unchanged; relative receipt anchor | Explicit lunar-to-solar question and Gregorian lookup with unrelated lunar draft; original today-lunar fixture remains | Chat/Calendar parity, no invented conversion values |
| R06/R07/R08/R15 | Issued token/action URL absent anywhere in serialized provider payload, including mixed input/facts; internal binding intact; Vietnamese NFC evidence/source map valid | A genuine time correction with semantic preview context after control removal | Token still usable for its intended decision; no token exposure in observable provider payload evidence |
| R07/R15 | INPUT_1799/1800/1801/2000; full payload-fit matrix §8.2; preserve valid draft on refusal/truncation | Admitted ordinary/multi-field correction, not paid boundary probing | Honest shorten/recovery message, no unavailable web-review link |

No extra live campaign: retain pilot 16 originals +16 critical repeats =32;
full 16 originals +16 development variants +32 held-out +16 critical repeats =80.
Allocate eight of the existing 16 full development slots: replacement decision;
annual offer with unrelated draft; explicit lunar-to-solar; Gregorian query with
lunar draft; lunar query with Gregorian draft; mixed token/time correction;
resume decision; restart decision. The other eight remain development variants.
These eight closure variants are mandatory within the full gate; failures cannot
be hidden by the aggregate threshold. Keep each script <=6 user turns and use
actual setup turns/state transitions, not fake context. Fixed test-only generated
tokens may be substituted from the actual application-issued receipt by the
runner; do not change words or branches in response to model quality. All calls
remain counted. Layer1 covers combinatorial/negative expansions without paid
calls; Layer3 covers channel/UI. Existing 192/480 call caps, $0.50/$1.00 caps,
32/80 denominators and 32 held-out scripts are unchanged. Freeze exact manifests
before separately authorized execution; if setup cannot fit, report that fit
failure rather than silently increasing turns/calls or omitting required checks.

### 9.5 Compatibility and release

Release requires reviewed config and any additive storage migration, exact-head
CI, fresh resource/rollback preflight, explicitly authorized remote mutations,
and deployment approval for the resulting immutable master SHA. Pending legacy
V2 context must be explicitly expired/restarted on contract mismatch; never
reinterpret it as the new schema. Preserve confirmed legacy reminders/series.
Rollback cannot undo D1 or cancel already confirmed reminders. Isolate new pending
context storage/version so older Workers cannot read it as V2; retain old
canonical fields so previously reviewed delivery still works after rollback.

Version input/output, encrypted pending payload and encrypted canonical detail
payload independently. Add owner-scoped companion detail storage for drafts,
reminders and series lineage, retaining legacy required fields and existing
unique keys. Copy details in the SAME confirmation transaction; failure rolls
back every child and canonical record. Older records remain valid without a
detail row; newer APIs must explicitly version their strict response contract
so old clients do not fail on unknown keys. No LLM-based backfill of legacy data.

Before later cutover, quiesce/drain affected processing and verify no old Worker
can accept successor writes. Do not use a mixed-version traffic split unless
both versions enforce the shared fences. Enforce compatibility in storage as
well as routing: new contexts must be isolated while legacy confirmation/claim
paths are blocked from treating the same owner/chat as empty and starting an
overlapping request. Preserve common terminal ordering evidence. A version-only
JSON tag is not sufficient if old SQL can still confirm a legacy draft.

In-flight attempts bind to their contract/context revision and fail stale after
cutover. Do not convert old unconfirmed drafts implicitly; expire/restart with
notice or finish them before activation. Confirmed reminders keep their stored
schedule and lineage. Rollback requires a recorded compatible Worker version
that honors new fences; an older historical Worker is not automatically safe.
Older delivery may omit new optional details, which must be disclosed as a
rollback limitation; it must not duplicate, reschedule or reinterpret reminders.

## 10. Explicit exclusions and next step

No admin implementation, burst/debounce orchestration, Queue concurrency changes,
general-purpose chatbot, unbounded/annual scheduler, new provider, silent budget
increase or unrelated UI redesign. User-facing questions outside calendar/task
assistance receive a concise scope explanation, not arbitrary model execution.
No email/ICONIC integration, team/organization features, billing/subscriptions,
native app, long-term memory subsystem, snooze or completion-tracking additions.

### 10.1 Owner policy selections recorded

| Decision | Selected policy | Limit on this selection |
| --- | --- | --- |
| Monthly query status inclusion (§5.3) | PENDING/CLAIMED/RETRYABLE/SENT/FAILED/UNCERTAIN; exclude CANCELLED/drafts; label statuses and partial results, retain authorized scope | SENT is delivery, not completion; no new pagination |
| Clarification recovery (§5.1) | Two no-progress answers: summarize retained facts and ask a bounded useful question; third: preserve draft and offer explicit chat recovery | No TTL extension or counting provider/config failures; web review only if an actual authorized screen supports that state |
| Edited-preview confirmation (§5.1/5.1.1) | Bound reply or short token for ambiguous version; ordinary bare confirmation only for stable delivered preview with current SAVE_PREVIEW decision | Decision-type binding is required in addition to version; no non-save approval commits a reminder |
| Output and evaluation envelope (§8/9.2/9.3) | Retain 1536 output tokens, 32 pilot/80 full executions, 192/480 calls and $0.50/$1.00 ceilings as proposed design/admission limits | Fit unproven; offline feasibility and separate explicit provider authorization remain mandatory; route, production budgets, retry=0 and no fallback unchanged |

These four selections alone did not approve the revised written spec or further
work. The subsequent owner approval at `e8f9e75` approves the written spec and
planning only, not execution, evaluation spending or deployment.
No additional product policy decision is requested here;
payload/token feasibility remains a future measured gate, not a fabricated PASS.

Missing-year behavior and unsupported annual recurrence are already resolved by
the inspected baseline/scope and are not reopened as owner blockers. Structured
storage evolution and isolated context versions are necessary implementation
work, not optional new product categories.

### 10.2 Adversarial design review outcome

- No second general language interpreter: typed validation can reject with a
  reason but never replace meaning via V1/V2 fallback (§2/4.1).
- Schema-valid invented facts remain a residual model risk; evidence existence
  alone is not proof. No automatic canonical write; preview, consent and held-out
  semantics are mandatory, and no universal correctness claim is made (§4/9).
- Missing operations KEEP; CLEAR and replacement require current evidence;
  separate slots and per-turn field assertions detect detail loss (§4).
- Observation token, revisions and terminal outcomes prevent stale overwrite or
  resurrection; external sends already in flight cannot be recalled (§6.2).
- Mixed confirmation is never an exact control; it creates a new preview (§5.1).
- Current decision type prevents replacement/alternative/resume approval from
  saving an older preview (§5.1.1); R13's no-draft limit is explicit (§6.2).
- CIVIL_DATE source calendar is independent of output/draft calendars (§4.1).
- Internal transcript is not the provider transcript; control-span projection
  and view-to-source evidence mapping close the token leak (§6.1.1).
- Queries may record processing metadata but cannot change reminder data (§5.3).
- Unsupported recurrence remains explicit and cannot become one-off success (§7).
- Shared adapter plus coverage-edge/reference parity protects chat/web dates (§7).
- Actual service replies/state/confirmation/API must be observed; a post-hoc pure
  projection cannot stand in for application execution (§9.1).
- Mock results, real calls, dispatch outcomes and channel acceptance remain
  separately reported; no claim of implementation follows document checks (§8/9).

Next gate: owner review of the linked implementation plan and execution method.
This spec does not authorize implementation by itself. Deployment remains
unchanged until separately authorized work passes its release gates.
