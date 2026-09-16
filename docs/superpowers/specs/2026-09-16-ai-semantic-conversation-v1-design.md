# Calenote AI Semantic Conversation V1

**Status:** APPROVED ARCHITECTURE — DOCS CHECKPOINT; runtime implementation requires a separate review.

**Baseline:** `de7b4e0c23177ca2ea25143de4879a7199d9da4a` on `master`.

## Decision

Semantic interpretation moves from a large deterministic Vietnamese grammar to
a constrained AI boundary. Deterministic code remains the authority for
control/state commands, authentication, ownership, rate limits, deduplication,
idempotency, lifecycle, D1 access, time validation, reminder query/persistence,
and user-confirmed mutation. AI receives only minimal semantic context and
returns a strict object; it cannot call tools, access D1, select identities,
schedule work, authorize, or mutate state.

```text
provider adapter -> normalized encrypted inbound -> deterministic guards
  -> semantic interpreter -> strict object -> Zod + business validation
  -> query | clarification | encrypted draft -> user confirmation -> canonical mutation
```

Proven Zalo transport, redirect fencing, wrapped/flat normalization, webhook
authentication, encrypted inbound persistence, D1 BLOB normalization, Queue
dispatch, bound-chat semantics, and reminder confirmation are unchanged.

## Deterministic boundary

Only unambiguous controls stay deterministic: `/connect`, confirmation,
cancellation, help, authentication/authorization, ownership, rate limiting,
message deduplication, idempotency, conversation lifecycle, and backend date,
time, horizon, title, query-range, and mutation validation. Optional future
fast paths may short-circuit obvious traffic, but cannot be the semantic source
of truth. The recovered large Vietnamese NLP expansion is explicitly out of
scope.

## Structured semantic contract

Application code defines this Zod discriminated union and sends its equivalent
strict JSON Schema with `additionalProperties: false` and strict mode:

```ts
type SemanticInterpretation =
  | { intent: "CREATE_REMINDER"; title: string; localDate: `${number}-${number}-${number}`; localTime: `${number}:${number}`; timezone: "Asia/Ho_Chi_Minh"; needsClarification: false }
  | { intent: "LIST_REMINDERS"; rangeKind: "TODAY" | "TOMORROW" | "DATE" | "THIS_WEEK" | "NEXT_7_DAYS" | "UPCOMING"; localDate: `${number}-${number}-${number}` | null }
  | { intent: "NEEDS_CLARIFICATION"; targetIntent: "CREATE_REMINDER" | "LIST_REMINDERS"; missingFields: Array<"date" | "time" | "title" | "range">; question: string }
  | { intent: "HELP" }
  | { intent: "UNSUPPORTED" };
```

The model receives message text, `interpretationReferenceTime` (the inbound
receipt time), timezone, and, only when needed, bounded encrypted-context
semantics from the application. It returns local date/time, never an authority
epoch. The backend converts local values in `Asia/Ho_Chi_Minh`, validates them
against `processingNow`, title/range limits, and ownership, then either creates
an encrypted draft, runs a bounded query, or asks a clarification. A queued
message therefore preserves relative-language meaning while still rejecting a
now-past mutation.

## Conversation state and queries

One pending provider-agnostic semantic context is scoped to a bound chat and
owner, is idempotent by source/resolution inbound, has a bounded TTL, and
encrypts any user-derived content. It is terminalized on resolution,
cancellation, or expiry. It carries only the minimal prior semantic slots needed
for the next turn; no transcript is persisted or sent to a model.

List intent is read-only. Backend-owned `TODAY`, `TOMORROW`, `DATE`,
`THIS_WEEK`, `NEXT_7_DAYS`, and `UPCOMING` ranges become bounded canonical D1
queries scoped to the owning bound chat. The model never creates SQL, ranges,
identifiers, or ownership predicates.

## Routing, privacy, and cost policy

`AI_MODE` is `off | semantic`. `off` makes zero AI calls and returns local
help/clarification for unresolvable semantic input. V1 routing is exactly
`FREE_PRIMARY -> CHEAP_PAID_FALLBACK -> STOP`; `AI_MAX_CALLS_PER_MESSAGE=2` is
a hard ceiling: at most two calls per inbound. There is one free attempt and at
most one paid attempt. There is no free-secondary chain, agent loop, hidden
retry chain, tool use, or premium implicit route.

Paid fallback is an infrastructure/contract recovery only. It is eligible only
when the free primary cannot produce a usable structured semantic result with
one of these safe categories: `FREE_UNAVAILABLE`, `FREE_TIMEOUT`,
`FREE_RATE_LIMITED`, `FREE_PROVIDER_FAILURE`, `FREE_INVALID_JSON`,
`FREE_SCHEMA_INVALID`, or `FREE_REQUIRED_FEATURE_UNSUPPORTED`. Each eligible
free failure can cause one paid attempt at most. A paid attempt cannot retry or
escalate further.

A schema-valid `CREATE_REMINDER`, `LIST_REMINDERS`, `NEEDS_CLARIFICATION`,
`HELP`, or `UNSUPPORTED` is a successful semantic outcome and never permits
paid fallback merely because the application dislikes its meaning. In
particular, `NEEDS_CLARIFICATION is a successful semantic outcome`; it stays
local to the normal clarification flow. Past-time business validation after a
schema-valid free result must not trigger paid fallback: if free returns a
valid `CREATE_REMINDER` for 12:00 today and `processingNow` is 12:05, the
backend returns its local `PAST_TIME` behavior. Business validation, including
time, ownership, title, range, and lifecycle rules, remains backend-owned.

No production model is selected in this checkpoint. A model can be configured
only after a current documented review proves its availability, Vietnamese
benchmark score, strict JSON-schema support, provider behavior, privacy/data
collection policy, ZDR eligibility where required, limits, context/output
bounds, and price caps. OpenRouter's current documentation supports strict
`json_schema`, `require_parameters`, `data_collection: "deny"`, and optional
`zdr`; the selection gate requires those controls, not a $0 label. If no free
candidate clears privacy/reliability gates, skip it and use the selected cheap
paid fallback.

The review record must cite the then-current official [structured-output
documentation](https://openrouter.ai/docs/guides/features/structured-outputs),
[provider-routing documentation](https://openrouter.ai/docs/guides/routing/provider-selection),
[data-collection policy](https://openrouter.ai/docs/guides/privacy/data-collection),
and [ZDR policy](https://openrouter.ai/docs/guides/features/zdr), together with
the selected model/provider capability page. Documentation is evidence, not a
permanent eligibility grant: availability, pricing, provider behavior, and
privacy fields must be refreshed immediately before enabling any route.

Planned configuration names are `AI_FREE_PRIMARY_MODEL`,
`AI_PAID_FALLBACK_MODEL`, `AI_PAID_FALLBACK_ENABLED`,
`AI_MAX_CALLS_PER_MESSAGE=2`, input/output limits, per-user daily paid-fallback
and monthly-cost limits, global daily budget, and prompt/completion price caps.
A free-secondary configuration is deliberately absent from V1. Enforcement is
application-owned and fail-closed.

## Atomic paid-call budget boundary

`SemanticBudgetStore` is the sole authority to reserve, finalize, release, and
recover a paid-call budget. Before any paid provider request, the router calls
`reservePaidCall(...)` with an owner/user identity, source-inbound idempotency
key, UTC daily/monthly window keys, the configured maximum cost in integer
microunits, and a bounded reservation TTL. It returns either an opaque
reservation id or a safe local `BUDGET_EXHAUSTED` category. Only an acquired
reservation allows the one paid call.

The future implementation must atomically reserve capacity against all three
hard limits: the owner/user daily paid-fallback limit, the owner/user monthly
AI-cost limit, and the global daily AI budget. It must use pre-seeded D1 budget
window rows and a single transactional D1 batch of conditional increments plus
the reservation insert. The request is authorized only if every conditional
increment succeeds in that transaction; otherwise no paid provider request is
made. The implementation test suite must prove the deployed D1 semantics used
by this store, including simultaneous contenders. If those semantics cannot
provide a single atomic multi-window reservation, implementation must stop and
adopt one application-owned serialization boundary before enabling paid calls;
it must not weaken a hard limit.

Minimal additive persistence is a `semantic_budget_windows` table for
`USER_DAILY`, `USER_MONTHLY`, and `GLOBAL_DAILY` window counters (reserved and
finalized microunits), plus a `semantic_budget_reservations` table with opaque
reservation id, owner/user scope reference, source-inbound idempotency key,
window keys, reserved maximum cost, state, expiry, and optional finalized
provider usage/cost. These records contain no user text or semantic payload.
They are not a billing subsystem: they exist only to enforce configured hard
limits and safely observe bounded usage.

`finalizeUsage(...)` is idempotent and transitions only the reservation it owns
from `RESERVED` to `FINALIZED`, converting its reserved maximum to provider
usage/cost when safely available; unknown provider usage conservatively
finalizes the reserved maximum. `releaseOrExpireReservation(...)` is idempotent
and transitions only a still-reserved, expired, or safely failed reservation to
`RELEASED`/`EXPIRED`, removing its reserved amount exactly once. Conditional
state transitions, non-negative checks, source-inbound uniqueness, and
reservation-id idempotency prevent negative and double accounting. A bounded
reaper and before-reserve expiry sweep recover Worker-crash reservations without
storing content or contacting the provider.

The existing `rate_limits` table cannot safely implement this boundary: it has
only `(subject_digest, bucket, count, expires_at)`, no monetary amount,
reservation identity/state/TTL, global-plus-user atomicity, or finalization.
It remains the ordinary rate-limit mechanism and is not reused for AI budgets.

Safe observations are request flag, tier, configured model/provider, latency,
result category, schema validity, fallback use, and safely supplied token/cost
metadata. They never include user text, model payload, title, identifiers,
credentials, or encrypted values.

## Provider processing feedback

Semantic processing depends on a provider-neutral optional
`sendProcessingFeedback()` capability. It cannot alter the semantic outcome,
block processing, or become Zalo-specific business logic. Zalo capability and
policy must be verified from current official documentation before any adapter
UX is implemented; this V1 checkpoint makes no provider UX claim.

## Recovery reuse matrix

| Recovered component | Classification | Decision |
| --- | --- | --- |
| `163fd4f` intent contracts/router | REFACTOR_AND_REUSE | Retain only narrow deterministic control-state classification ideas; replace semantic create/list ownership with the strict contract above. |
| `163fd4f`/`f16d124` Vietnamese parser expansion | DISCARD | It attempts to grow Vietnamese regex/NLP authority and conflicts with this decision. |
| `163fd4f` parser regression examples | REFACTOR_AND_REUSE | Move useful phrasing into synthetic benchmark cases, without treating parser output as truth. |
| `69c35c0` clarification table/store | REFACTOR_AND_REUSE | Generalize to encrypted provider-neutral semantic context with typed slots, TTL, source/resolution idempotency, and no raw text. |
| `69c35c0` query service/tests | REFACTOR_AND_REUSE | Keep canonical bounded owner-scoped query shape; replace any recovered semantic routing assumptions. |
| `69c35c0` migration `0005` | DISCARD | Do not cherry-pick; it lacks generic list context/typed state and must be newly reviewed as an additive migration. |

## Benchmark design

The benchmark is a reproducible synthetic fixture of **at least 200** Vietnamese
cases, with no production text. It contains balanced create/list/clarify/help/
unsupported cases across today/tomorrow/explicit dates, dayparts, colloquialisms,
fillers, reordered syntax, implicit requests, missing/ambiguous fields, past
time, typos, and multi-turn continuations. Each record fixes reference time,
timezone, minimal previous semantic context, expected strict object, and whether
business validation accepts it. Models are scored on intent, date, time, title,
clarification, schema validity, P95 latency, and estimated cost. A model is
eligible only when it satisfies the documented privacy and price gates as well
as a review-approved score threshold.

## Migration impact assessment

**Implementation migration required: YES, but not in this checkpoint.** Existing
`command_drafts` cannot represent an encrypted, intent-typed clarification that
precedes a draft or a query. A future additive forward-only `0005` must create a
provider-agnostic semantic-context table keyed by bound chat, source inbound,
and optional resolution inbound; it needs encrypted context, intent/slot state,
TTL, terminal lifecycle, and one-pending-context uniqueness. The same reviewed
additive migration may also add the minimal semantic-budget tables defined
above; it must not modify `rate_limits`. It must not alter existing encrypted
values, command drafts, reminders, webhook state, or Queue configuration. Its
design and idempotence/rollback-forward tests require their own review before
application.

## Deferred multi-device auth note

This semantic slice does not implement session management. The authentication
roadmap must preserve concurrent user sessions across multiple devices: multiple
active sessions per user, current-device identification, revoke-one-device,
logout-all-other-devices, and no forced logout of an existing device merely
because another device logs in.

## Supersession and non-goals

This supersedes the old Conversational Core V1 design and plan. It does not
resume duplicate-connect hardening, `ACTIVE_BOUND` UI synchronization, provider
waiting UX, Telegram production work, deployment, secret configuration, live
AI calls, or Zalo configuration changes.
