# Calenote current state

This is the canonical record of the deployed Calenote architecture. Historical
plans are audit evidence only; they do not override this document.

## Evidence vocabulary

| Status | Meaning |
| --- | --- |
| IMPLEMENTED | Reviewed code exists in this repository. |
| WIRED | The code is reached from a Worker or Web composition path. |
| TESTED | Automated local coverage exists. |
| PROVEN_IN_PRODUCTION | A bounded production observation proved the stated fact. |
| DEPLOYED | A reviewed Worker version is serving the production origin. |
| OPEN_INCIDENT | Evidence shows a real fault or unknown; it is not resolved. |
| PLANNED | A future capability with no current-product claim. |

## Product capability map

| Capability | Status | Evidence boundary |
| --- | --- | --- |
| User-owned Zalo and Telegram onboarding | IMPLEMENTED, WIRED, TESTED | Server-side provider validation, authenticated session creation, encrypted credential persistence, and webhook registration compose in the Worker. |
| Credential and sensitive-data protection | IMPLEMENTED, WIRED, TESTED | D1 stores encrypted credentials and inbound text; browser/API responses and structured diagnostics exclude tokens, webhook secrets, connect codes, raw message content, and private provider identifiers. |
| Connection lifecycle and recovery | IMPLEMENTED, WIRED, TESTED | Owned connections expose safe metadata and support bounded webhook retry or `/connect` code rotation. `ACTIVE_UNBOUND`, `ACTIVE_BOUND`, `WEBHOOK_FAILED`, and `SUSPENDED` retain distinct recovery semantics. |
| Private-chat `/connect` binding | IMPLEMENTED, WIRED, TESTED | One-use, expiring code is stored as a digest; an accepted private inbound message binds the connection with D1 fencing and queue dispatch. |
| Webhook ingress and inbound processing | IMPLEMENTED, WIRED, TESTED, PROVEN_IN_PRODUCTION | Zalo real private webhook ingestion passed path/header authentication; the flat production payload persisted encrypted inbound data and enqueued/processed an opaque `PROCESS_INBOUND` job. |
| Reminder scheduling and delivery | IMPLEMENTED, WIRED, TESTED | D1 is canonical persistence. Cron claims due reminders; Queue delivery uses bounded retries, ownership leases, and safe failure states. |
| Login/session delivery | IMPLEMENTED, WIRED, TESTED | Session, login-code, and `DELIVER_LOGIN_CODE` paths use the same encrypted and owner-fenced persistence boundaries. |
| V2 Web control plane | IMPLEMENTED, WIRED, TESTED | Authenticated V2 screens manage safe connection status, reminders, preferences, and activity; chat remains the primary command/delivery channel. |
| Production origin | DEPLOYED, PROVEN_IN_PRODUCTION | `calenote` serves `https://calenote.iconiclogs.com` with production D1, Queue, assets, cron trigger, and secrets. Deployment alone is not chat E2E evidence. |
| Zalo webhook configuration and reachability | PROVEN_IN_PRODUCTION | `getWebhookInfo` reports the canonical host/path prefix and `testWebhook` returned `webhook.ok`. |
| Zalo real inbound message path | PROVEN_IN_PRODUCTION | A real private webhook reached the Worker; path/header authentication, flat payload parsing, encrypted D1 persistence, Queue/inbound processing, and bound-chat reminder create/confirm delivery were observed. |
| Telegram production behavior | PLANNED | `TELEGRAM_PRODUCTION_BEHAVIOR = PLANNED`; it is not E2E-proven. |

## Worker runtime and persistence

### Undeployed Conversation V2 branch — 2026-09-26

The isolated `codex/conversation-v2-urgent-lunar` package adds bounded encrypted
dialogue context, finite daily series, explicit Vietnamese lunar dates, managed
nonblocking typing and owner-scoped web series controls. These paths are
default-off application capabilities. They are **not** a deployed or live-model
accepted feature. New additive migrations 0007/0008 have only been tested locally.
See [offline evidence](../benchmarks/conversation-v2-results.md),
[implementation progress](../implementation/conversation-v2-progress.md) and
[release gates](../runbooks/conversation-v2-release.md). The domain is intended
for user UAT, but existing production-labelled resources are not thereby isolated.

### Existing runtime

`src/worker/index.ts` is the runtime composition root. It composes the HTTP
router/controllers, D1 stores, encrypted keyring, provider adapters, Queue
producer/consumer, and scheduled handler. Queue payloads carry opaque IDs, not
credentials or chat text. The active lanes are:

- `PROCESS_INBOUND`
- `DELIVER_REMINDER`
- `DELIVER_LOGIN_CODE`

The cron trigger runs bounded independent work: due-reminder claiming, orphaned
inbound redrive, and login-code redrive. D1/SQLite is canonical persistence;
the Worker does not use PostgreSQL, Neon, Hyperdrive, Terraform, or an external
outbox database. Worker rollback never rolls back D1 state or migrations.

## Provider and Web boundaries

Zalo and Telegram are BYOB interaction adapters. The browser never calls a
provider directly and never receives decrypted credentials. Provider adapters
use a fixed HTTPS hostname allowlist, bounded request/response handling, safe
error mapping, and no sensitive logging.

For Zalo, the normal activation path verifies `getMe`, persists encrypted
credentials, derives a per-connection webhook URL and header secret internally,
then calls `setWebhook`. Webhook ingress verifies the independent path and
`X-Bot-Api-Secret-Token` before provider parsing/persistence. `ACTIVE_UNBOUND`
means the webhook/connection is active but a private chat has not yet bound;
`ACTIVE_BOUND` means the private chat identity was bound by the inbound flow.

### PROVEN_PRODUCTION_BEHAVIOR

ZALO_REAL_INBOUND_PATH = PROVEN_IN_PRODUCTION

ZALO_WEBHOOK_CONFIGURATION_AND_REACHABILITY = PROVEN_IN_PRODUCTION

`testWebhook` is not an end-to-end message-delivery guarantee; the separately
observed private webhook and downstream processing flow provide that evidence.

WRAPPED_WEBHOOK_PARSING = TESTED

FLAT_REAL_WEBHOOK_PARSING = PROVEN_IN_PRODUCTION

ENCRYPTED_D1_INBOUND_PERSISTENCE = PROVEN_IN_PRODUCTION

D1_PERSISTED_BLOB_NORMALIZATION = PROVEN_IN_PRODUCTION

QUEUE_AND_INBOUND_PROCESSING = PROVEN_IN_PRODUCTION

BOUND_PRIVATE_CHAT_REMINDER_FLOW = PROVEN_IN_PRODUCTION

Zalo transport uses redirect fencing. Real private webhook ingress passed path
and header authentication, accepted the flat payload shape, persisted encrypted
inbound data, normalized persisted D1 BLOB byte arrays before decryption,
processed the opaque Queue job, and completed bound-chat reminder draft,
confirmation, persistence, and outbound Zalo reply.

### DURABLE_OBSERVABILITY

Webhook and inbound processing emit only structured, secret-free outcome
categories. They contain no message content, provider identifiers, tokens,
encrypted values, or webhook paths; they cannot mutate provider configuration
or change webhook behavior.

### RETIRED_INCIDENT_DIAGNOSTIC

The owner-facing polling route/UI, temporary webhook delete-and-restore flow,
scheduled egress probes, and diagnostic-only Worker were retired during the
trusted-machine master cutover. Historical evidence may be retained in archived
plans, but no production route or Worker configuration can activate those probes.

### HISTORICAL_INCIDENT

Earlier production observations showed no Worker event for a real private
`/connect` or plain text and recorded an inconclusive polling investigation.
Those observations are preserved as forensic history only; later production
evidence supersedes them for the current Zalo inbound status.

## Intelligence and external sources

Optional OpenRouter intelligence is IMPLEMENTED, WIRED, TESTED, and disabled
unless valid privacy-first configuration is present. It can emit a validated,
non-authoritative proposal only; deterministic parsing and human confirmation
remain authoritative. No production AI behavior is claimed here.

Source/action persistence and approvals are implemented. Gmail, Microsoft,
calendar APIs, forwarded email, and other source ingestion are PLANNED. A future
bounded external-source boundary is described in
[external-source-boundary.md](./external-source-boundary.md); it is not an
implemented ICONIC Logistics Platform integration.

## Current limits

TELEGRAM_PRODUCTION_BEHAVIOR = PLANNED

CONVERSATIONAL_CORE_V1 = NOT_IMPLEMENTED_ON_MASTER

LLM_SEMANTIC_FALLBACK = NOT_PRODUCTION_ENABLED

Duplicate `/connect` hardening beyond the currently proven binding behavior and
automatic `ACTIVE_BOUND` UI synchronization remain future work unless a later
review records separate production evidence.

## Next bounded work

1. Design bot ownership/takeover policy before allowing the same bot token to
   be supplied by a second user.
2. Keep optional intelligence and future external-source work independently
   authorized and non-authoritative.
