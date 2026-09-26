# Conversation V2 execution evidence

Plan: `docs/superpowers/plans/2026-09-25-conversation-v2-urgent-lunar.md`.
Execution base: `cab27b641e49bca082927ff5cf0be61105607338`.
User requests whole-package UAT review; implementation runs inline, with a
fresh independent whole-branch review before release. No per-task human review.

## Decisions and delivery boundary

- Keep burst/consecutive-message orchestration deferred until after admin.
- Future admin gets Releases and Features: exact deployed version, features,
  availability/acceptance, environment, change notes and rollback baseline.
- The user uses the current domain for UAT. Its resources remain labeled
  production in reviewed configuration; do not silently swap credentials or
  relax immutable-SHA deployment approval based on terminology alone.
- The V2 provider DTO contains no internal identifiers or conversation claims.
  Use bounded title/recent turns, not the full persistence object.

## Task 1 — semantic-only contract and shared gateway

- RED: fail-closed schema scaffold rejected valid V2 payloads (5 failed/17 passed).
- RED: V2 gateway export absent (9 failing tests); then implement the shared
  contract-selecting gateway without changing the default V1 request envelope.
- Focused: 73/73 PASS (new contract/prompt + existing OpenRouter adapter).
- Typecheck: PASS. Scoped ESLint: PASS. Diff validation: PASS.
- Full fresh suite: 79 files / 1507 tests PASS, 85.85 seconds.
- Baseline: 77 files / 1476 tests PASS. Node emits its existing experimental
  localStorage warning; it is not a test failure or a new runtime diagnostic.
- No production bindings/configuration, secrets, provider calls or deployment.
- Task implementation checkpoint only; whole-branch acceptance remains pending.

## Task 2 — deterministic calendar/event/cadence evidence

- RED: missing cadence/calendar behavior; ownership regression exposed accent
  folding before the accepted scanner. Preserve original NFC spans; match only
  new productions on a separate folded shadow. Scanner implementation unchanged.
- RED: reminder title containing an event word stole the reminder date; bounded
  utterance roles now distinguish reminder titles from event declarations.
- Focused calendar + conversation + accepted scanner: 367 tests PASS.
- Independent published reference facts include century boundaries, normal/leap
  months and near-midnight Vietnam/China differences. Exhaustive supported-day
  round-trip and exact offline regeneration PASS. See lunar conversion document.
- Full check: 82 files / 1544 tests PASS; documentation, typecheck, lint, build,
  Worker types and deployment dry-run PASS. No upload or promotion.
- Scanner 15000 samples: P50 0.008000 ms, P95 0.144625 ms, P99 0.194125 ms.
- Initial full gate caught a pre-existing wall-clock-sensitive login rate-limit
  test at the 10-minute window boundary (401 instead of 429). Freeze Date.now
  inside that test and restore it afterwards; production limits/code unchanged.
  Exact test and entire check rerun PASS. This test-only repair is intentional.

## Remaining work

Tasks 8–9 remain. No user-facing V2 capability is enabled or deployed.

## Task 3 — encrypted revision-fenced context

- Additive local migration 0007 only; historical migrations unchanged. Not
  applied remotely. Owner/chat/claim checks and revision CAS guard mutations.
- RED: module absent, then explicit security regressions for scope-bound AAD,
  nullable encryption metadata, and atomic expired-buffer replacement.
- Encryption identity binds owner/chat/context; sensitive content never stored
  in plaintext. Completed/cancelled/invalid/expired payloads are removed while
  content-free outcome history retains replay and ordering fences.
- Local D1 covers revision races, rollback on outcome failure, replay, cross-user
  access, stale claims, corrupt ciphertext/key/AAD/schema, Unicode/byte bounds,
  TTL, legacy draft exclusion, populated migration replay and indexed cleanup.
- Cleanup tested with 101 synthetic contexts: at most 100 per call; no production
  DB or provider access. Existing V1 semantic data and drafts remain unchanged.
- Full check PASS: 83 files / 1569 tests; typecheck, lint, build, generated types,
  dry-run and diff check PASS. Final independent branch review still pending.

## Task 4 — pure reconciliation and local response composition

- RED: absent reconciliation/composer, then multi-turn lunar year/leap/count
  loss, ambiguous-title revival and ambiguous replacement dropping context.
- Pure backend decisions preserve deterministic dates/times; explicit edits
  need both semantic edit intent and a caller-validated edit control. Expiry
  uses an explicit clock input rather than a hidden wall-clock read.
- Pending lunar operands remain encrypted application state, not model fields.
  Year-only/leap-only answers complete deterministic conversion. Missing daily
  count remains a clarification across turns; no inferred recurrence default.
- Friendly/concise replies are stable local compositions, one question at a
  time, without a second model call or premature creation claim. Capability
  response checks release readiness. HELP/LIST/greeting do not update context.
- Focused reconciliation/response/wrapper: 68/68 PASS. Fresh full check after
  final fixes: 85 files / 1619 tests PASS; typecheck, lint, build, Worker types,
  dry-run and diff check PASS. Final independent whole-branch review pending.

## Task 5 — Finite series and atomic lifecycle

- Finite 2–30 daily occurrences; full preview is revalidated at confirmation,
  never shortened after a due time passes.
- Additive migration 0008 stores encrypted proposals/calendar provenance and
  fences atomic creation/cancellation. One-off provenance and context cleanup
  remain compatible with the legacy confirmation transaction.
- Focused local D1/expansion/context tests: 86/86. Legacy command, scheduler and
  delivery suites on the additive schema: 85/85. Fresh full check: 87 files,
  1,681 tests; typecheck, build, lint, Worker type/dry-run and diff checks pass.
- No remote migration, provider call or deployment performed.

## Task 6 — guarded inbound composition

- Explicit default-off application capability composes the V2 gateway,
  encrypted context, deterministic reconciliation and existing one-off/series
  transactions. No new production environment switch.
- Real encrypted inbound/Worker composition tested with synthetic transport;
  legacy drafts drain through deterministic controls before V2 can take over.
- Three-turn exam flow, exact preview, confirmation retry, abandonment, read-only
  LIST, new-request lunar reset, provider failure, missing schema, ownership and
  durable attempt/budget fences covered. Proposal text exceeding the outbound
  bound is rejected before storing a confirmable proposal, not truncated.
- Relation-only follow-ups reconcile missing current-turn facts against already
  resolved context. Urgency without an event anchor asks for it, never invents
  cadence. User tone is read from owned preferences.
- Bounded expiry cleanup joins the existing scheduler without aborting other
  lanes; cron and Queue configuration unchanged.
- Full fresh check: 89 files / 1711 tests PASS; typecheck/lint/build/types/dry-run
  PASS. Independent whole-branch acceptance still pending.

## Task 7 — nonblocking managed typing

- V2 durable eligibility precedes context load and managed feedback initiation.
  The feedback task is owned by Worker waitUntil and has a 1000 ms deadline
  which aborts the actual HTTP signal, not just the waiting promise.
- V1 preserves dispatch ordering: it waits for local credential preparation,
  not provider settlement. No lifetime means no background provider request.
- Distinct content-free queue-wait, typing-dispatch, model and final-reply
  durations; safe feedback outcome enums. No token/message/identity telemetry.
- RED: context loaded before feedback; real composition did not register any
  lifetime task. GREEN: mocked Zalo transport remains pending while inference
  and final reply complete; real transport receives abort at deadline.
- Fresh full check: 90 files / 1719 tests PASS. No live calls or deployment.
- Local arm64 Node v26.7.0, 10000 mock-dispatch samples: P50 0.000333 ms,
  P95 0.000833 ms, P99 0.001875 ms. This measures local dispatch overhead, not
  real Zalo UI latency or end-to-end provider response time.

## Task 8 — Web series preview and lifecycle visibility

- Owner/session-scoped GET and revision-bound POST share the Zalo atomic
  series transactions. Web authority is a live authenticated session, not a
  fabricated inbound. Original inbound IDs remain lineage only.
- RED/GREEN: missing web/API/UI boundary; stale queued context takeover;
  cancellation renewal after expiry; pre-proposal queued confirmation.
  Web completion leaves a content-free ordering fence, and confirmation must
  have been received after the proposal was created or renewed.
- Full date preview includes all 30 occurrences, dual calendar labels, explicit
  confirmation and two-step cancellation; in-flight/uncertain sends are not
  claimed as recalled. Owner isolation, revoked sessions and concurrent
  web/Zalo confirmation use real local D1 tests.
- Local built-page visual inspection: desktop and mobile viewport, 30 rows
  visible in the DOM, no horizontal overflow, keyboard focus reaches the
  confirmation button above mobile navigation. Synthetic fixture only.
- Listing is bounded to 10 recent series plus 10 pending proposals, clearly
  labelled in the UI. Historical pagination is not included in this slice.
- Before pause: full check 93 files / 1730 tests PASS; final fresh resumption
  verification is recorded in the task ledger before commit. No remote effects.

## Task 9 — offline corpus and release handoff

- Task 8 fresh resumption gates: focused 61/61; full check 93/1730; typecheck
  and diff PASS. Committed as `4fa122036719a53f257568bd84370bfdccbdab86`.
- New scorer RED: module missing. GREEN: 10/10 scorer/provenance tests; malformed
  accounting, tampered provenance and live-profile injection fail closed.
- Synthetic corpus: 22 scenarios / 37 turns, temporal 37/37, mocked dialogue
  37/37, projected state/request/expansion 37/37, zero observed failures.
  Initial past-date fixture needed an explicit year: DD/MM intentionally rolls
  to its next occurrence; runtime logic was not changed to fit the fixture.
- Pure corpus has no persistence authority. Separate real local D1/inbound and
  legacy command/scheduler/delivery suite: 6 files / 145 tests PASS; covers
  ciphertext-only storage, no premature mutation, duplicate confirmation,
  cancellation/claim races, unchanged historical rows and additive migration
  rollback compatibility. No observed plaintext or duplicate-creation failures.
- Fresh full check: 94 files / 1740 tests PASS; typecheck, lint, build, Worker
  types and dry-run PASS. Canonical documentation test and diff validation PASS.
- Safe-observability scan: no direct logging/network/env credential access in
  new conversation modules or offline runner; timing sinks project only bounded
  stage/outcome/duration, cleanup logs only outcome/count. Existing ingress
  diagnostic allowlists preserved. No live key/provider/database access.
- Final independent whole-branch review remains pending at this checkpoint.
  Capability stays default-off. Live V2 evaluation, remote migration, reviewed
  master promotion and exact-master deploy authorization remain release gates.
