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
| Webhook ingress and inbound processing | IMPLEMENTED, WIRED, TESTED | Same-provider path/header verification, bounded JSON read, encrypted inbound persistence, deduplication, and opaque `PROCESS_INBOUND` queue jobs are implemented. Real Zalo message receipt is separately an OPEN_INCIDENT. |
| Reminder scheduling and delivery | IMPLEMENTED, WIRED, TESTED | D1 is canonical persistence. Cron claims due reminders; Queue delivery uses bounded retries, ownership leases, and safe failure states. |
| Login/session delivery | IMPLEMENTED, WIRED, TESTED | Session, login-code, and `DELIVER_LOGIN_CODE` paths use the same encrypted and owner-fenced persistence boundaries. |
| V2 Web control plane | IMPLEMENTED, WIRED, TESTED | Authenticated V2 screens manage safe connection status, reminders, preferences, and activity; chat remains the primary command/delivery channel. |
| Production origin | DEPLOYED, PROVEN_IN_PRODUCTION | `calenote` serves `https://calenote.iconiclogs.com` with production D1, Queue, assets, cron trigger, and secrets. Deployment alone is not chat E2E evidence. |
| Zalo webhook configuration and verification | PROVEN_IN_PRODUCTION | `getWebhookInfo` reports the canonical host/path prefix and `testWebhook` returned `webhook.ok`. This proves configured webhook reachability only, not real event dispatch. |
| Zalo real inbound message path | OPEN_INCIDENT | One real private `/connect` and one plain private text produced no observed Worker event and no new inbound row. The first controlled polling result is inconclusive because its diagnostic parser expected an array rather than Zalo's documented object result; its webhook restoration was proven. |
| Telegram production behavior | PLANNED | Telegram production diagnosis begins only after Zalo closure; it is not E2E-proven. |

## Worker runtime and persistence

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

The temporary owner-only Zalo polling diagnostic is IMPLEMENTED and DEPLOYED for
the open incident. It is not a product feature: it fences ownership, same
origin, provider, state, concurrency, and a ten-minute rate limit; removes a
webhook only after exact-match verification; restores it in `finally`, retries
one restoration attempt, and returns safe metadata only. It does not alter a
connection state or connect code. It remains in place until the incident is
closed by an explicitly reviewed change.

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

## What is not proven

`testWebhook` success is not an end-to-end message-delivery guarantee. The
current Zalo evidence proves configuration/reachability but not that real
private-chat events are dispatched to the Worker. The current parser correction
makes the controlled polling diagnostic ready for a single authorized retest;
it does not itself establish a provider root cause. Do not infer a Zalo
provider-edge, Cloudflare, credential, or application-parser conclusion beyond
the recorded evidence.

## Next bounded work

1. Run one explicitly authorized Zalo polling retest and classify only from its
   safe evidence; restore verification remains mandatory.
2. Close the Zalo real-message acceptance path before Telegram production
   diagnosis.
3. Design bot ownership/takeover policy before allowing the same bot token to
   be supplied by a second user.
4. Keep optional intelligence and future external-source work independently
   authorized and non-authoritative.
