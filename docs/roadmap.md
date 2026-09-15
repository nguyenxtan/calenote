# Calenote roadmap

This roadmap is forward-looking. Canonical implemented and production-evidence
claims live in [current-state.md](./architecture/current-state.md).

## Production status — 2026-09-15

- **PROVEN_IN_PRODUCTION:** `calenote.iconiclogs.com` runs the reviewed Worker
  with D1, Queue, cron, assets, and secrets.
- **PROVEN_IN_PRODUCTION:** Zalo `getWebhookInfo` matches the canonical host/path
  prefix and `testWebhook` returns `webhook.ok`.
- **OPEN_INCIDENT:** Real Zalo private `/connect` and plain-text messages have
  not produced an observed Worker event or inbound D1 row. The first temporary
  polling probe was inconclusive due to its now-corrected response-shape parser;
  webhook restoration was proven successful.
- **PLANNED:** Telegram production diagnosis is deferred until Zalo real-message
  acceptance closes.

## Near-term operational backlog

### Close Zalo real-message acceptance

Run one explicitly authorized retest through the temporary owner-safe polling
diagnostic, then classify only from safe evidence. A successful `testWebhook`
is not acceptance: the path must prove real private message -> Worker -> D1
inbound -> Queue -> `/connect` -> chat identity -> `ACTIVE_BOUND` -> outbound
confirmation. See [Zalo production acceptance](./runbooks/zalo-production-acceptance.md).

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

**PLANNED.** Start only after the Zalo acceptance incident is closed. Reuse the
same evidence discipline: configuration verification is not real-message E2E,
and no provider-specific conclusion is made without safe production evidence.

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
