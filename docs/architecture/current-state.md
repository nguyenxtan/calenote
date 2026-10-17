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

### Latest recorded production checkpoint — 2026-10-16

The read-only production checkpoint recorded remote `master` at
`dde4968e0f02e5680880bc5a635e181b4d8e32dc`, active Worker version
`9e620924-d9da-449b-a1ba-7ef2d8346efe` at 100%, deployment
`b8979d53-5dc6-4fa4-87f0-7e36906efcac` created at
2026-10-16T06:43:11Z. This is dated read-back evidence, not a claim of a new
production inspection or fresh provider acceptance on later dates.

That source enables Conversation V2 and the deterministic local
solar/lunar today/tomorrow, month-calendar and help paths. It includes bounded
failure observation, reminder-list keyset pagination and cancellation read-back.
The UI refresh at `24d06a8` already belongs to production ancestry; it is not an
unmerged UI task. Keyset pagination is not an atomic snapshot across concurrent
GET requests. Local reads bypass AI; their implementation does not prove broad
natural-language AI acceptance.

The two historical CREATE failures remain `UNKNOWN`. Paid inference remains on
hold. Missing failure events do not prove that the provider succeeded, and new
telemetry cannot reconstruct missing earlier incident details. Operational paid
HOLD is an authorization boundary: unchanged `AI_MODE=privacy` configuration is
not a blanket production AI kill switch.

### Current feature candidate — PR #11, not deployed

PR #11 reconciles Context Contract with that production baseline. The reviewed
`eb8f66e16d37915dd7c91cd97fe3118c230ee317` checkpoint passed both exact-head CI
runs with 9,976 tests and two existing optional skips. Later bugfixes require
checks for their own HEAD; the earlier green result does not certify them.

The feature implements owner-scoped durable manual CREATE receipts and explicit
recovery across lost responses/reloads, plus the real canonical web DELETE
cancellation route and explicitly gated Context Contract APIs. Successor runtime
and UI remain default off. CREATE/recovery needs migration0010 before new traffic.
Production D1 read-only inspection on October16 confirmed migrations0001–0008
applied, exactly0009/0010 pending, and all61 application schema definitions
matching the baseline. No remote migration is implied by local SQLite tests.

The accounting audit classified all29 prospective claims as DISPATCH followed by
terminal FINISH(null); existing receipts contain no authenticated numeric cost
for them. They remain UNKNOWN, not zero-cost settlements. The inspected261-history
namespace has982 known settlements totaling926,785 ledger microunits,12 historical
UNKNOWN and29 prospective UNKNOWN. This does not establish a complete owner
account inventory or fresh budget. Wire104/Formal Pilot/Full remain unqualified;
model/provider/oracle/budget changes and new paid calls are not authorized.

Migration, master promotion, deployment and successor activation retain separate
exact-SHA approval gates. Worker rollback does not reverse D1. After successor
activation the historical dde4968 Worker is not a certified rollback target:
its old reader lacks successor filtering and companion-detail delivery. The
current compatibility tests exercise current legacy classes, not that historical
Worker. Require a successor-capable rollback version and reviewed drain policy.
See the [wire104 handoff](../runbooks/context-contract-wire104-handoff.md) and
[offline completion status](../implementation/product-closeout-status.md).

### Historical undeployed checkpoint — 2026-09-28

The isolated `codex/conversation-v2-live-evaluation` package adds bounded encrypted
dialogue context, finite daily series, explicit Vietnamese lunar dates, managed
nonblocking typing and owner-scoped web series controls. The authorized release
candidate explicitly enables V2 in HTTP series operations, Queue and scheduled
composition; the underlying factories remain default-off. Bounded live evaluation passed 37/37 turns,
schema 36/36, temporal 37/37 and zero safety failures at source `cfe5f1f`.
They are **not deployed**; post-run error-copy/test-only changes are documented
separately from the evaluated source. Fresh read-only Cloudflare preflight passed
on 2026-09-28: active Worker `6e0596cc-0800-486d-b20d-894de3a90aea` at 100%,
remote master `9018344f1f8b1e0adf4d7905d3e7e6550f9ee5ad`, migrations 0001–0006
applied and 0007/0008 pending. The user authorized V2 activation, those two
migrations and merge after test/CI success, but not deployment. The dedicated
write credential is expired; no migration has been applied by this activation
checkpoint. A new master SHA still needs explicit deployment approval.
See [evaluation evidence](../benchmarks/conversation-v2-results.md),
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

## Historical limits from the earlier checkpoint

The following labels describe the older checkpoint, not the later V2 source or
its deployment. V1 and the optional semantic fallback labels must not be used to
infer that the current V2 Worker is disabled.

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
