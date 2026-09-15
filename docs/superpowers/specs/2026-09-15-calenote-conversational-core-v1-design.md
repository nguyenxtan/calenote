# Calenote conversational core V1

## Status and scope

**Status:** approved design, pending implementation plan.

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
- No D1 schema migration unless the idempotency audit proves an existing schema
  invariant cannot express the required atomicity.
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

## Query behavior

The conversational query service reads the existing owned/confirmed reminders
for the bound chat's user/workspace. It has no write capability and no parallel
calendar table. All range construction uses `Asia/Ho_Chi_Minh`:

- `TODAY`: local calendar-day interval.
- `TOMORROW`: next local calendar-day interval.
- `DATE`: one explicit local calendar-day interval.
- `UPCOMING`: a bounded future interval and bounded result count.

Replies contain only local time and decrypted title, never internal identifiers.
They distinguish an empty range from a concise ordered list.

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

Database transaction conditions, not user behavior or in-memory locks, are the
authority for these guarantees.

## Connections state synchronization

After a user creates/rotates a code in `/app/connections`, the V2 UI performs
bounded, cancellable polling of canonical `GET /api/connections`. It displays a
waiting state and transitions to a clear `ACTIVE_BOUND` success state without
requiring refresh. The polling stops on success, unmount, timeout, or mutation
error. It does not create a new backend endpoint or disclose credentials.

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
an approved deploy. A live AI smoke test additionally requires explicit approval
of the selected model/provider/cost/privacy evidence. The final documentation
labels code implementation, automated proof, and production proof separately.
