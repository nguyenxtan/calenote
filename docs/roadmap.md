# Calenote roadmap

This roadmap is forward-looking. Canonical implemented and production-evidence
claims live in [current-state.md](./architecture/current-state.md).

## Production status — 2026-09-15

- **PROVEN_IN_PRODUCTION:** `calenote.iconiclogs.com` runs the reviewed Worker
  with D1, Queue, cron, assets, and secrets.
- **PROVEN_IN_PRODUCTION:** Zalo `getWebhookInfo` matches the canonical host/path
  prefix and `testWebhook` returns `webhook.ok`.
- **PROVEN_IN_PRODUCTION:** A real Zalo private webhook reached the Worker,
  passed path/header authentication, used the flat payload shape, persisted an
  encrypted D1 inbound row, completed D1 BLOB normalization and Queue/inbound
  processing, and completed bound-chat reminder create/confirm/outbound reply.
- **HISTORICAL_INCIDENT:** Earlier missing-Worker-event observations and the
  inconclusive polling investigation are forensic history only; the diagnostic
  remains retired.
- **PLANNED:** Telegram production diagnosis remains separate and not E2E-proven.

## Near-term operational backlog

### Preserve Zalo production acceptance evidence

The real-message acceptance chain is proven in production. Preserve its
redirect fencing, path/header authentication, flat payload support, encrypted
D1 persistence/BLOB normalization, Queue processing, and reminder confirmation
boundaries. Do not revive the retired polling diagnostic; `testWebhook` alone
remains reachability evidence rather than E2E evidence.

### Bot ownership / claim policy

**PLANNED product design.** Current behavior is a single-bot,
single-Calenote-owner constraint. If another email supplies the same bot token:

- do not reveal the prior owner's email or other identity;
- do not silently take over, duplicate, or reassign the connection;
- define a recoverable, auditable claim/takeover policy before expanding this
  behavior;
- model future shared bots through workspace membership and roles, not duplicated
  token ownership.

### Telegram production diagnosis

**PLANNED.** Reuse the same evidence discipline: configuration verification is
not real-message E2E, and no provider-specific conclusion is made without safe
production evidence.

## Product roadmap

### Conversation UX and reminder lifecycle

**Existing source capability:** Zalo `sendChatAction("typing")` is wired into
the semantic path. Its presence does not prove user-visible latency; the next
design measures and reduces feedback delay without changing Queue batching or
per-chat concurrency.

**DRAFT_FOR_USER_REVIEW — 2026-09-25:**
[Conversation V2, finite urgent reminders, and explicit lunar dates](./superpowers/specs/2026-09-25-conversation-v2-urgent-lunar-design.md)
consolidates contextual greetings, clarification/edit/abandon behavior,
encrypted short-lived conversation context, finite daily reminder series,
explicit-opt-in Vietnamese lunar dates, and typing responsiveness. These are
proposed changes, not implemented capabilities or production claims. Written
spec and implementation-plan review remain required before runtime work.

### Continuous-message handling — after admin

**DEFERRED_BY_USER — 2026-09-25.** Revisit only after the admin page is built.
This dependency does not authorize building admin in the conversation slice.

- Evaluate per-chat burst grouping/debounce, ordered processing, cancellation
  of superseded in-flight interpretation, and stale-response suppression.
- Measure queue wait, end-to-end response latency, duplicate/reordered webhook
  delivery, and messages arriving while the previous response is processing.
- Require a separate design for bounded waits, ownership, durable ordering,
  cost limits, and confirmation behavior before changing concurrency.
- Do not add a batching wait, parallelize inbound jobs, or change production
  Queue settings as part of Conversation V2. Preserve existing dedupe and
  claim/revision fences in the meantime.

### Later reminder and delivery capabilities

**FUTURE product design — not implemented:** define these contracts before
adding behavior, schema changes, provider calls, or delivery guarantees:

- `SMART_DEADLINE` reminder cadence, including deadline completion and overdue
  semantics;
- recurring yearly events and indefinite lunar/solar recurrence; the proposed
  Conversation V2 slice covers explicit one-off lunar dates and finite daily
  series only, not annual recurrence or astronomical moon-phase tracking;
- notification-delivery preferences and App/Web canonical notification history;
- Zalo and Telegram external-delivery adapters, plus delivery fallback policy;
- future iOS/mobile push delivery;
- concurrent multi-device sessions: multiple active sessions per user,
  current-device identification, revoke-one-device, logout-all-other-devices,
  and no forced logout of an existing device when another device logs in.

These later capabilities are backlog/design items only. They are not part of PR #1 and require
separately approved product, persistence, privacy, and operational designs.

### Optional intelligence

Keep intelligence provider-agnostic, privacy-first, bounded, and
non-authoritative. Deterministic parsing and explicit human confirmation remain
the core path. Production AI activation requires separate authorization and
evidence.

### External source signals

Design the future bounded external-source contract before integrating Gmail,
Microsoft, calendar APIs, forwarded email, or ICONIC Logistics Platform. Calenote
may own follow-up/reminder attention, but external systems retain their business
domain ownership. See [external-source boundary](./architecture/external-source-boundary.md).

### Shared workspaces

Define invitation, membership, roles, audit, ownership transfer, and privacy
policy before introducing shared-bot or team experiences.

## Transition criteria

Do not call a roadmap item complete from a UI placeholder, a mock, a valid token,
or a green webhook verification alone. Completion requires the reviewed contract,
appropriate automated coverage, safe operational evidence, and—where a provider
journey is claimed—an observed end-to-end interaction.
