# Calenote system overview

## Status classification

This document uses four operational classifications:

- **IMPLEMENTED** — repository code exists and is exercised by tests.
- **PROVEN_IN_PRODUCTION** — a bounded observation has verified the fact at the
  production origin.
- **OPEN_INCIDENT** — a production outcome is unresolved; hypotheses are not
  facts.
- **PLANNED** — intended boundary with no implementation claim.

## Implemented architecture

Calenote is a Cloudflare Worker application with a static Next.js web surface.
The Worker is the composition root for HTTP API routes, authenticated webhooks,
D1 persistence, Cloudflare Queues, scheduled reminder work, encryption, and
Zalo/Telegram provider adapters.

```text
Browser / provider webhook
          |
Cloudflare Worker (HTTP boundary, authentication, safe error mapping)
          |
  application modules and provider adapters
     |             |                 |
    D1         Cloudflare Queue     Cron
 canonical       opaque IDs       bounded lanes
 persistence
```

**IMPLEMENTED:** D1/SQLite is canonical persistence for users, sessions,
connections, encrypted credentials, connect-code digests, encrypted inbound
updates, reminders, delivery records, and audit data. The Queue consumer
processes `PROCESS_INBOUND`, `DELIVER_REMINDER`, and `DELIVER_LOGIN_CODE` jobs;
the cron trigger claims due reminders and redrives bounded work. No PostgreSQL,
Neon, Hyperdrive, Terraform, or external queue/outbox is used.

Credentials are encrypted at rest using the Worker keyring. Provider tokens,
webhook secrets/path components, connect codes, raw message content, and
private provider IDs are not returned in public connection APIs or diagnostics.
The browser uses same-origin authenticated mutations; ownership and rate-limit
fences are applied in the application boundary.

## Connections and inbound flow

**IMPLEMENTED:** User-owned Zalo/Telegram credentials are verified server-side
with provider `getMe`, encrypted in D1, and used only in short-lived server
operations. For a successful Zalo activation, Calenote derives a connection
specific HTTPS webhook URL and a separate header secret internally, then calls
`setWebhook`.

```text
getMe -> encrypt credential -> setWebhook -> ACTIVE_UNBOUND
                                           |
                                     private /connect
                                           |
                                      ACTIVE_BOUND
```

`ACTIVE_UNBOUND` means a connection has no bound private chat. A one-use,
expiring `/connect` code is stored only as a digest. An accepted private inbound
message is path- and header-authenticated, read with a bounded body limit,
parsed by the provider adapter, encrypted in D1, deduplicated, and queued for
processing. `ACTIVE_BOUND` is reached only by the fenced inbound binding flow.

`WEBHOOK_FAILED` permits a bounded webhook retry without requiring token
re-entry. `SUSPENDED` requires credential review and does not reuse webhook
retry. Bot ownership is currently one bot connection for one Calenote owner;
takeover/recovery policy is PLANNED.

## Reminder and Web control plane

**IMPLEMENTED:** Reminder creation, Vietnamese deterministic command parsing,
confirmation drafts, scheduling, delivery, retries, and safe status projection
are part of the Worker/D1/Queue system. The V2 Web UI is a control plane for
connection health, reminders, preferences, actions, and activity; it is not a
direct provider client and does not replace the chat-first command/delivery
boundary.

**IMPLEMENTED:** Optional OpenRouter intelligence can produce a strictly
validated, non-authoritative proposal. It is disabled without valid
privacy-first configuration; human confirmation and deterministic logic remain
authoritative.

## Production evidence and open Zalo incident

**PROVEN_IN_PRODUCTION:** `calenote.iconiclogs.com` is served by the reviewed
Worker with D1, Queue, cron, assets, and required secrets. For the active Zalo
connection, `getWebhookInfo` confirms the Calenote host/path prefix and
`testWebhook` returns `webhook.ok`.

**OPEN_INCIDENT:** A real private `/connect` message and a real plain private
text message were not observed by the Worker and produced no inbound D1 row.
`testWebhook` proves webhook reachability/verification only; it does not prove
provider real-message dispatch. Historical polling evidence was inconclusive and
is retained only as incident history; its temporary diagnostic surface is
retired and cannot be activated in production.

The browser-integrity exception below is narrowly scoped to Zalo webhook POSTs;
it is not a general Cloudflare security change:

```text
host = calenote.iconiclogs.com
method = POST
path prefix = /webhooks/zalo/
Browser Integrity Check = OFF
```

See [zalo-production-acceptance.md](../runbooks/zalo-production-acceptance.md)
and [cloudflare-incidents.md](../runbooks/cloudflare-incidents.md) for the
operational acceptance path and incident decision tree.

## Planned external-source boundary

**PLANNED:** Calenote may later consume bounded external work signals, including
from ICONIC Logistics Platform, without importing its domain ownership. Calenote
continues to own reminder, follow-up, user attention, notification/channel
delivery, and escalation. ICONIC continues to own forwarding, booking,
shipment, finance, and operational business state. The proposed contract is in
[external-source-boundary.md](./external-source-boundary.md); no integration is
implemented.
