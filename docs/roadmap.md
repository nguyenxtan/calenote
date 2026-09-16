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
