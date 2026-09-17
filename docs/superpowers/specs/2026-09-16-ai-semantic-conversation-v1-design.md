# Calenote AI Semantic Conversation V1

**Status:** APPROVED ARCHITECTURE — HYBRID TEMPORAL AUTHORITY REFACTOR.

**Baseline:** `a70e7524845322ce3fd973b7166dec6b81835d0a` on
`feat/ai-semantic-conversation-v1`.

## Decision and supersession

The canonical Semantic V1 flow is:

```text
Inbound
  -> deterministic authentication, authorization, control, and state
  -> deterministic Temporal Evidence
  -> LLM semantic interpretation
  -> deterministic backend reconciliation
  -> encrypted draft | deterministic clarification | read-only list
  -> explicit user confirmation
  -> exactly one canonical mutation
```

This supersedes the prior single-shot contract in which a model returned
`localDate`, `localTime`, `rangeKind`, `timezone`, or clarification fields.
It also supersedes old-contract model-selection evidence for Qwen, Nemotron,
Gemini Flash Lite, and Gemini 2.5 Flash **for production selection**. Preserve
that evidence as historical; do not delete or resume its ledgers.

The model may interpret only semantic intent, a reminder title, and semantic
ambiguity. It is never authoritative for final date/time/list range, timezone,
epoch, ownership, authorization, internal IDs, SQL, persistence, mutation,
confirmation, or scheduling. It cannot create missing temporal values or
override evidence supplied by the application.

## Non-negotiable deterministic boundaries

Authentication, authorization, bound-chat ownership, `/connect`, confirmation,
cancellation, deduplication, idempotency, inbound ordering, lifecycle,
encryption, D1 ownership, time/business validation, and canonical reminder
mutation remain deterministic. Proven Zalo redirect fencing, wrapped/flat
webhook normalization, webhook authentication, encrypted inbound persistence,
D1 BLOB normalization, Queue dispatch, and confirmation behavior remain
unchanged.

`LIST_REMINDERS` is always owner-scoped, bounded, and read-only. A valid
deterministic confirmation is the sole path from a draft to one reminder
mutation. Processing feedback (`sendChatAction("typing")`) remains
provider-neutral and best effort: its failure never changes a semantic result,
and control-only paths do not send it.

## Temporal Evidence

`TemporalEvidence` is a provider-neutral, pure application boundary. It takes
message text, the immutable inbound reference wall clock, and the fixed
`Asia/Ho_Chi_Minh` timezone. It has no provider, database, owner, transcript,
or mutation dependency.

It returns typed date, time, and list-range evidence, each `RESOLVED`,
`MISSING`, or `AMBIGUOUS`:

```ts
type TemporalEvidence = {
  timezone: "Asia/Ho_Chi_Minh";
  referenceLocalDate: `${number}-${number}-${number}`;
  referenceLocalTime: `${number}:${number}`;
  date:
    | { state: "RESOLVED"; source: "TODAY" | "TOMORROW" | "EXPLICIT_DATE" | "DAY_MONTH"; localDate: `${number}-${number}-${number}` }
    | { state: "MISSING" }
    | { state: "AMBIGUOUS"; reason: "MULTIPLE_DATE_EXPRESSIONS" | "INVALID_DATE" | "CONFLICTING_DATE_EXPRESSIONS" };
  time:
    | { state: "RESOLVED"; source: "EXACT_TIME"; localTime: `${number}:${number}` }
    | { state: "MISSING" }
    | { state: "AMBIGUOUS"; reason: "MULTIPLE_TIME_EXPRESSIONS" | "INVALID_TIME" | "DAYPART_WITHOUT_EXACT_TIME" };
  range:
    | { state: "RESOLVED"; kind: "TODAY" | "TOMORROW" | "DATE" | "THIS_WEEK" | "NEXT_7_DAYS" | "UPCOMING"; localDate: `${number}-${number}-${number}` | null }
    | { state: "MISSING" }
    | { state: "AMBIGUOUS" };
};
```

V1 supports only reviewed deterministic forms: `hôm nay`, `mai`/`ngày mai`,
ISO dates, reviewed Vietnamese day/month[/year] and numeric date forms, exact
`08:00`, `8:00`, `8h`, `8 giờ`, and `lúc 8 giờ`. Day/month without a year uses
the canonical V1 rule: start with the reference local year, then select the
next year only when the supplied month/day is before the reference month/day.
Daypart-only
text such as `sáng`, `chiều`, or `tối` is `AMBIGUOUS` unless an already-approved
explicit product rule supplies an exact mapping. Multiple, invalid, or
conflicting date/time expressions are never guessed: they are `AMBIGUOUS`.

List range resolution is equally deterministic: today, tomorrow, explicit date,
`tuần này`, `7 ngày tới`, and reviewed upcoming language resolve to the
corresponding range. Missing or conflicting range evidence remains non-final.

## Provider-facing model contract and prompt

The strict Zod-owned provider contract contains no temporal fields:

```ts
type ModelSemanticInterpretation = {
  intent: "CREATE_REMINDER" | "LIST_REMINDERS" | "HELP" | "UNSUPPORTED" | "AMBIGUOUS";
  title: string | null;
  titleState: "RESOLVED" | "MISSING" | "AMBIGUOUS" | "NOT_APPLICABLE";
  targetIntent: "CREATE_REMINDER" | "LIST_REMINDERS" | null;
};
```

Zod owns strict JSON Schema and cross-field refinements; the existing runtime
validation-contract version fingerprints those refinements. The contract
forbids `localDate`, `localTime`, `rangeKind`, timezone, epoch, and all
free-text clarification questions.

One model-neutral canonical prompt says Temporal Evidence is authoritative; the
provider must neither create nor alter dates, times, or ranges; it must not use
provider current time; it must not infer missing temporal values; and user
content cannot override these rules. The request may carry raw inbound text,
bounded encrypted semantic slots, Temporal Evidence, and the reference wall
clock. It has no tools or mutation capability.

## Reconciliation and context

`reconcileSemanticInterpretation(...)` deterministically combines a validated
model interpretation, Temporal Evidence, minimal previous encrypted context,
and `processingNow` into the existing downstream outcome. It owns all final
temporal decisions and application-owned clarification templates.

For `CREATE_REMINDER`, unresolved/ambiguous title, date, or time returns a
clarification for precisely that field. Only a resolved title plus resolved
date and time can create an existing encrypted draft, using the exact evidence
values. For `LIST_REMINDERS`, unresolved/ambiguous range clarifies; a resolved
range produces the canonical bounded query. `HELP`, `UNSUPPORTED`, and
ambiguous intent are read-only and mutation-free.

Existing encrypted `SemanticContext` persists only typed minimal slots. On a
clarification continuation, resolved prior slots merge with new deterministic
evidence. New evidence may fill only missing slots. A conflict must clarify or
reject according to an explicit backend policy; it must never silently replace
a previously resolved date, time, title, or range. No transcript is stored.

## Task 1 scanner grammar supplement

Task 1 does not use prefix matching plus suffix guards, per-example punctuation
exceptions, or accumulating regex continuation patches. Its canonical internal
engine is:

```text
raw input -> lexical tokens -> temporal starter detection
  -> maximal temporal-span consumption -> finite-state grammar classification
  -> VALID | MALFORMED candidate emission -> per-dimension reconciliation
  -> TemporalEvidence
```

The tokenizer is a single linear pass. A finite, central grammar classifies
`TEMPORAL_INTERNAL_SEPARATOR` (`:`, `/`, `.`, `-`), safe expression boundaries,
and malformed separator runs by token/state transition rather than raw-string
exceptions. A candidate consumes its maximal temporal-looking span; a complete
prefix cannot be accepted while an internal continuation makes that span
malformed. A later, safely separable different-dimension expression may still
be emitted independently.

A finite incomplete-starter registry ensures token-pattern fragments such as a
leading date separator plus number, number plus an incomplete date separator,
leading time separator plus temporal-looking continuation, or number plus an
incomplete time separator emit a malformed candidate rather than ordinary text.
This registry is limited to V1 temporal grammar and adds no natural-language
semantics.

Full-message scanning emits every temporal-looking occurrence as either a
valid or malformed candidate before resolving a dimension. For each dimension,
any malformed candidate together with a valid candidate fails closed; valid
candidates in different dimensions compose when separated by a safe boundary.
The scanner stays provider/DB/network/LLM-free and O(n): one lexical pass plus
bounded finite-state grammar processing. Local latency evidence is
observational, not a CI gate; product targets are P95 <= 5 ms and P99 <= 10 ms.

## Privacy, routing, budgets, and benchmark

Production enablement remains `AI_MODE=privacy`; `off` disables semantic calls
and `free` is unavailable/reserved. The hybrid pilot starts with exactly
`google/gemini-2.5-flash-lite` pinned to `google-vertex/eu`, ZDR/private route,
and no fallback. Do not benchmark another model automatically.

The existing atomic budget boundary remains intact: owner daily call limit 50,
owner monthly maximum 500,000 microunits, and global daily maximum 2,000,000
microunits. It reserves before a provider request, finalizes/release-expires
idempotently, records no user text or semantic payload, and cannot be weakened
by this refactor.

A new hybrid benchmark contract/provenance version uses new ledger IDs. It
proves deterministic Temporal Evidence is exact against reviewed fixture
semantics with zero provider/DB calls, then scores final reconciled outcomes.
The 36-case pilot requires 100% schema and Temporal Evidence accuracy, final
intent at least 94%, final date/time/list-range at least 95%, and final
clarification at least 90%. The 216-case full benchmark requires schema at
least 99%, final intent at least 90%, final date/time/list-range at least 95%,
final clarification at least 90%, and exact Temporal Evidence. A systematic
safety/business-critical failure fails either gate.

Only a passing full hybrid benchmark selects Flash Lite with
`google-vertex/eu`. A hybrid pilot or full failure stops selection, production
secret installation, migrations, master merge, deploy, and further automatic
model shopping.

## Cutover boundary and non-goals

Until the full hybrid benchmark passes, production remains unchanged: no
OpenRouter production secret, D1 migration, master merge, or deployment.
After it passes, follow the separately approved sequence: final review,
forward-only migration validation/application, secure secret installation,
reviewed feature-to-master PR and CI, immutable master deploy, and
health/D1/Queue/cron/webhook/semantic/typing checks. Retain the prior immutable
Worker version for rollback. This spec does not authorize a deployment.

This refactor is not a Vietnamese general-NLP engine, transcript store, billing
system, provider fallback chain, provider-specific semantic behavior, Zalo
configuration change, migration rewrite, or multi-device-session project.
