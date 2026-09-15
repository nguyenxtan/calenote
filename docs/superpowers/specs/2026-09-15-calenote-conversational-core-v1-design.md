# Calenote conversational core V1

## Status and scope

**Status:** APPROVED DESIGN — READY FOR IMPLEMENTATION PLAN.

This design delivers a provider-agnostic Vietnamese conversational reminder
core. It builds on the proven Zalo ingress, encrypted D1 persistence, queue
dispatch, bound private-chat, reminder draft, and reminder confirmation
boundaries. It does not redesign those boundaries, add a second calendar store,
or begin Telegram production diagnosis.

The intended production conversational mode is `AI_MODE=privacy`. `AI_MODE=off`
remains a deterministic fail-safe. `AI_MODE=free` remains unavailable by policy.
Enabling a live privacy model is a separate production gate: the exact model,
provider, current price, price cap, ZDR/privacy evidence, secret availability,
and live-smoke budget require explicit approval.

## Goals

- Understand common Vietnamese reminder commands without requiring a rigid
  marker such as `nhắc`.
- Return specific deterministic clarification/error replies rather than a
  generic help reply whenever the parser knows what is missing or invalid.
- Classify create, list, confirmation, cancellation, help, and unknown
  messages before attempting reminder creation.
- Read reminder lists from canonical reminder persistence for bound chats.
- Use an optional, strict, semantic OpenRouter fallback only for plausible,
  unresolved, non-sensitive input.
- Preserve confirmation as the sole route from a proposed reminder to a
  persistent reminder.
- Make duplicate `/connect` handling idempotent and make the Connections UI
  discover `ACTIVE_BOUND` without manual refresh.
- Remove temporary incident-only diagnostic surfaces after regression coverage;
  retain only safe operational observability that has enduring value.

## Non-goals

- No LLM tool use, agent loop, database write authority, scheduler authority,
  authorization authority, or provider-specific conversational behavior.
- A D1 migration is allowed only when persistent conversational clarification
  state or proven bind-idempotency requirements cannot be expressed safely by
  the current schema.
- No Telegram-specific production diagnostics, custom Cloudflare changes, or
  change to Zalo ingress, credential handling, encryption, queue topology, or
  webhook authorization.

## Ownership and flow

```text
provider adapter
  -> inbound normalization and encrypted persistence
  -> inbound processor
  -> conversational core
       -> deterministic intent router
       -> deterministic reminder parser / query resolver
       -> known clarification or error reply
       -> optional intelligence port for plausible ambiguity only
       -> schema and business validation
  -> command/query application boundary
  -> canonical D1 store mutation only after user confirmation
```

The core consumes a normalized bound-chat message and returns an application
outcome (reply, read-only query, or draft proposal). Provider adapters only send
the returned reply. The core never receives bot tokens, webhook data, IDs beyond
opaque command context, or raw persistence values.

## Deterministic conversation model

The deterministic intent router returns one of:

- `CREATE_REMINDER`
- `LIST_REMINDERS`
- `CONFIRM_PENDING`
- `CANCEL_PENDING`
- `HELP`
- `UNKNOWN`

Confirmation (`có`, `ok`, `xác nhận`) and cancellation (`hủy`, `huỷ`, `không`)
retain their current draft lifecycle. Obvious query phrases are routed before
the reminder parser: `lịch`, `lịch hôm nay`, `hôm nay có gì?`, `mai có gì?`,
`trên Calenote có lịch gì?`, and `nhắc gì sắp tới?`.

The reminder parser remains a compact deterministic grammar, not general NLP.
It supports optional reminder markers, filler words (`lúc`, `vào`, `nhớ`, `nhớ
nhắc`, `nhắc tôi/tui/mình`), relative/explicit dates, and explicit dayparts:
`12h trưa`, `7h sáng`, `3h chiều`, `8h tối`. It does not invent an hour for
phrases such as `chiều mai` or `tối mai`; those result in a missing-time
clarification.

Known parser failures map locally as follows:

| Failure | User reply intent |
| --- | --- |
| `PAST_TIME` | State the passed local time and request a future time. |
| `MISSING_DATE` | Ask for the date. |
| `MISSING_TIME` or imprecise daypart | Ask for the time. |
| `AMBIGUOUS_DATE` / `AMBIGUOUS_TIME` | Ask for the unresolved value. |
| `INVALID_DATE` / `INVALID_TIME` | State that the supplied value is invalid. |
| `MISSING_TITLE` | Ask what to remind. |
| `TOO_FAR` | Request a nearer date. |

The generic help reply is only for unsupported or unclassifiable input.

### Clarification continuation state

A clarification is a persistent, provider-agnostic application boundary, not
an in-memory prompt. It is scoped to the canonical bound private chat and user,
has a bounded TTL, and permits one active relevant flow per chat. Sensitive
title/context data is encrypted at rest through existing keyring patterns.

For example, `chiều mai gọi mẹ` creates a create-reminder clarification with a
resolved date and encrypted title but no time. A later `4h` is resolved against
that active flow to produce 16:00 tomorrow without requiring the original
sentence. Resolution is idempotent and terminalizes the context on success,
cancellation, or expiry. It remains safe across Worker restart and Queue delay.
The LLM may propose an interpretation but never writes or resolves a
clarification record directly.

### Time authorities

There are two distinct time authorities:

- `interpretationReferenceTime = inbound.receivedAt` anchors relative wording
  such as `hôm nay`, `mai`, and `ngày kia` for deterministic and AI
  interpretation.
- `mutationValidityTime = processingNow` validates that a draft creation or
  clarification resolution is still in the future when it becomes mutable.

Thus, a message received at 11:59 for 12:00 today retains that semantic time
when processed at 12:01, but is rejected locally as `PAST_TIME`. Queue delay
never silently changes the date meaning and never creates a stale draft.

### Deterministic failure versus AI-eligible ambiguity

Known/actual failures remain local: `PAST_TIME`, `INVALID_TIME`, `INVALID_DATE`,
`TOO_FAR`, and `TITLE_TOO_LONG`. A truly missing value remains local when no
plausible signal exists; `mai gọi mẹ` has no clock signal and receives a
missing-time clarification.

AI is eligible only for unresolved semantics: the message contains a plausible
date/time or intent signal that this compact grammar cannot confidently
normalize, such as `thứ sáu tuần sau lúc bốn giờ gửi báo cáo` or `mai tầm tám
giờ sáng nhớ bảo tui gọi mẹ`. Unsupported grammar must not be mislabeled as a
missing user value merely to suppress the one allowed semantic interpretation.

## Query behavior

The conversational query service reads the existing owned, confirmed,
non-cancelled reminders
for the bound chat's user/workspace. It has no write capability and no parallel
calendar table. All range construction uses `Asia/Ho_Chi_Minh`:

- `TODAY`: local calendar-day interval.
- `TOMORROW`: next local calendar-day interval.
- `DATE`: one explicitly identified local calendar-day interval.
- `UPCOMING`: a bounded future interval and bounded result count.

Replies contain only local time and decrypted title, never internal identifiers.
They distinguish an empty range from a concise ordered list.

The model is not a database-range authority. It returns `TODAY`, `TOMORROW`,
`UPCOMING`, or a bounded local calendar date; the backend constructs canonical
`from`/`to` timestamps in `Asia/Ho_Chi_Minh`, scopes ownership, applies the
status filter, and enforces a bounded result count before reading the canonical
store.

## Intelligence contract and safety

The narrow reminder interpretation evolves to a strict Zod discriminated union:

- `CREATE_REMINDER`: `title`, `scheduledAt`, exact Vietnam timezone,
  `confidence`.
- `LIST_REMINDERS`: `rangeKind`, bounded `from` / `to`, `confidence`.
- `NEEDS_CLARIFICATION`: create/list target, allowed missing fields, a bounded
  question, and `confidence`.
- `HELP` or `UNSUPPORTED`: `confidence` only.

OpenRouter receives a strict `json_schema` with `additionalProperties: false`.
The system instruction has one role: structured semantic interpretation. Current
time and timezone are trusted application context. No secret, credential,
connect command, private identifier, encrypted value, or internal database ID
is included in its input.

The intelligence port is called at most once per inbound message, only after:

1. Deterministic routing did not resolve the message;
2. no known deterministic failure gives a better local response;
3. the message is plausible for supported create/query semantics; and
4. the sensitive-input fence passes.

Schema acceptance is insufficient. Application validation checks timestamp
limits, title length, confidence threshold, timezone, query bounds, and allowed
missing fields. An invalid, unavailable, timed-out, rate-limited, or malformed
model result becomes a safe local clarification/help reply. It never leaves an
inbound message stuck and never writes a reminder.

`AI_MODE=privacy` uses only an approved provider, `data_collection: "deny"`,
ZDR where required and supported, no automatic provider fallback, input/output
bounds, timeout, and a prompt/completion price cap. `AI_MODE=off` uses the null
gateway and has zero external AI calls. `AI_MODE=free` is rejected by policy
until equivalent privacy evidence exists.

Model confidence is advisory only. It is never an authorization, security, or
mutation boundary. Backend authority remains schema validation, intent
allowlist, temporal/title/range validation, ownership/session context, the
mutation lifecycle, and user confirmation. User text is untrusted data; system
instructions explicitly state that instructions embedded in it cannot override
the semantic interpretation contract.

Safe metrics are limited to requested/used, mode, model, provider, latency,
result category, and provider-supplied usage/cost where available. They never
contain user content, title, identifiers, credentials, headers, or secrets.

## Draft and confirmation

Both deterministic and validated AI create interpretations pass through the
existing encrypted draft lifecycle. Draft replies include the local reminder
time and title. Confirmation decrypts the draft title, commits exactly one
canonical reminder through the existing transactional store, and replies with
the same title/time context. AI cannot bypass confirmation.

## `/connect` idempotency

The inbound bind application boundary is audited and strengthened under existing
ownership fences. The required outcomes are:

- Exact provider-message redelivery does not process twice.
- Same valid code from two messages or concurrent workers has one canonical
  mutation: `ACTIVE_BOUND`, one chat identity, consumed code, one `CHAT_BOUND`
  audit record.
- A later retry from the same bound private chat is idempotent success, not an
  invalid-code failure.
- A code consumed by a different private chat is safely rejected.
- Malformed `/connect CODE.` terminalizes with guidance without consuming a
  code or changing connection state.

Successful first bind terminalizes inbound as `PROCESSED`, consumes the code,
creates exactly one identity and `CHAT_BOUND` audit record, changes the
connection to `ACTIVE_BOUND`, and attempts one success reply. A later same-chat
retry terminalizes safely as idempotent success without changing ownership,
creating an identity/audit event, or treating a concurrent winner as an
infrastructure failure. A different private chat is rejected safely.

Database transaction conditions, not user behavior or in-memory locks, are the
authority for these guarantees.

## Connections state synchronization

After a user creates/rotates an active code in `/app/connections`, the V2 UI
performs bounded, cancellable polling of canonical `GET /api/connections`. It
stops on `ACTIVE_BOUND`, code expiry, bounded timeout, component unmount, or
authentication loss. It does not create a new backend endpoint or disclose
credentials.

On `ACTIVE_BOUND`, it immediately updates canonical UI state, clears the
command, stops polling, and shows `Đã kết nối thành công` plus `Bot đã sẵn sàng
nhận lệnh và gửi lời nhắc.` On expiry it states `Mã kết nối đã hết hạn.` and
offers `Tạo mã mới`. On timeout it states `Chưa nhận được xác nhận từ bot.` and
offers `Kiểm tra lại` (one canonical refresh and, while still valid, another
bounded watch) plus `Tạo mã mới`. No manual browser refresh is required.

## User response preferences

V1 reuses the existing preference boundary only for safe presentation wording
where it does not change deterministic domain meaning. Time, title,
confirmation, range, mutation, and validation semantics never vary by tone or
address preference. Full free-form tone personalization is explicitly deferred;
V1 prefers stable, concise Vietnamese replies.

## Temporary diagnostics

Before removal, diagnostics are classified individually:

- Keep only non-sensitive, durable event/health observability needed for normal
  operations.
- Remove owner-facing Zalo poll probe UI/route and investigation-only parser,
  early-inbound, and bind diagnostics after their tests and production evidence
  are reconciled.

Removal must not affect ingress behavior, authentication, persistence,
encryption, queue dispatch, or normal provider handling.

## Testing and acceptance

Focused tests cover deterministic grammar/failures, intent routing, query
ranges/responses, contextual draft/confirmation, privacy-mode structured output
and validation, zero AI calls for deterministic/sensitive inputs, unavailable
AI handling, duplicate bind sequences/concurrency, UI polling lifecycle, and
diagnostic removal. Canonical acceptance is `pnpm.cmd check` plus
`git diff --check`.

Production acceptance uses bounded, synthetic Vietnamese smoke tests only after
an approved deploy. The three distinct AI states are:

- `AI_FALLBACK_IMPLEMENTED`: the port, strict structured contract, validation,
  fencing, metrics, and failure behavior pass automated tests.
- `AI_FALLBACK_CONFIGURED`: an approved model/provider, price cap, privacy/ZDR
  evidence, and production secret are configured.
- `AI_FALLBACK_PROVEN_LIVE`: one explicitly approved bounded semantic smoke
  test passes with that exact configuration.

`AI_MODE=privacy` is the intended product mode; `AI_MODE=off` is its
deterministic fail-safe; `AI_MODE=free` is unavailable by the current privacy
policy. The documentation must never call the live fallback production-ready
before all three states above are evidenced.

### Required regression matrix

- Clarification continuation, expiry, cancellation, and separate Worker/queue
  invocation between turns.
- AI-eligible unsupported semantic date/time versus genuinely missing value.
- Queue-delay interpretation versus mutation-validity clock case.
- Query status filtering and backend-owned range construction.
- Prompt-injection-like user content cannot alter schema, authorization, or
  mutation authority.
- Same-chat duplicate `/connect` sequentially and concurrently, different-chat
  rejection, and malformed-command then valid-command behavior.
- UI code expiry, authentication loss, timeout/manual re-check, and
  `ACTIVE_BOUND` transition.
