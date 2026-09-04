# Calenote current state

This is the canonical current-state record. Historical Foundation documents and
implementation plans are audit evidence; they do not override this page.

## Evidence vocabulary

| Status | Meaning |
| --- | --- |
| IMPLEMENTED | Reviewed code exists in this repository. |
| WIRED | The code is reached from a production Worker/Web composition path. |
| TESTED | Local automated evidence currently covers the behavior. |
| E2E_PROVEN | A real external end-to-end interaction has been observed. |
| DEPLOYED | The reviewed version is running at the production origin. |
| PLANNED | A documented future capability; no current-product claim. |

## Current product capability map

| Capability | Status | Evidence boundary |
| --- | --- | --- |
| User-owned Zalo/Telegram bot onboarding | IMPLEMENTED, WIRED, TESTED | Durable API validates a token, encrypts it, creates a session, and registers the webhook when the provider accepts it. |
| Private-chat binding with one-use `/connect` | IMPLEMENTED, WIRED, TESTED | Webhook, D1 constraint, and queue tests cover bounded direct-chat binding. |
| Vietnamese chat reminder proposal and confirmation | IMPLEMENTED, WIRED, TESTED | Queue processor parses supported Vietnamese forms, writes one confirmation draft, and accepts exact approval/cancel control words. |
| Manual dashboard reminders | IMPLEMENTED, WIRED, TESTED | Dashboard sends same-origin authenticated API requests and converts Vietnam wall-clock input deterministically. |
| Reminder scheduler and delivery | IMPLEMENTED, WIRED, TESTED | Cron claims due reminders; Queue delivery applies ownership leases, bounded retry, and `UNCERTAIN` on ambiguous provider egress. |
| Login code and browser session | IMPLEMENTED, WIRED, TESTED | Login code delivery, recovery, session revocation, and real D1/workerd tests are local evidence. |
| Web control plane | IMPLEMENTED, WIRED, TESTED | Static `/`, `/login`, `/dashboard`, and `/docs` builds without personal-data flash before session confirmation. |
| Production origin and webhook | PLANNED | The reviewed source has not been DEPLOYED; no production webhook is configured. |
| Chat E2E | PLANNED | A private `/connect`, confirmed near-future reminder, and received notification have not been E2E_PROVEN. |

## Worker runtime

`src/worker/index.ts` is the runtime entrypoint. Its Queue dispatcher receives
only opaque job IDs for three real application lanes:

- `PROCESS_INBOUND`
- `DELIVER_REMINDER`
- `DELIVER_LOGIN_CODE`

The scheduled handler runs three independent bounded lanes via
`Promise.allSettled`: claim due reminders, redrive orphaned inbound work, and
redrive login-code delivery. A Worker rollback does not roll back D1 or Queue
state; deployment/runbook evidence is therefore required before a production
claim.

## Data, channel, and Web boundaries

D1 is canonical persistence. Bot credentials and login material are encrypted
at rest. Queue payloads are identifiers, never chat text or credentials.

Zalo and Telegram are interaction channels. The current product has no Gmail,
Microsoft, forwarded-email, calendar, API, or external-source ingestion, so
those source concepts are PLANNED. Source information will propose an action;
only validated user approval will create an authoritative reminder, task, or
event.

The Web UI is a first-class control plane, not a replacement for chat. It is
allowed to manage complexity—connection health, reminders, account access—but
daily create/confirm/notify flow is chat-first.

## What is not proven

The product is not DEPLOYED. It has not connected a real production Zalo bot,
Telegram bot, custom domain, D1 database, Queue, or webhook. It has not sent a
real reminder to a private chat, so chat E2E is not E2E_PROVEN. Local provider
mocks and static page visual tests are useful, but are not production proof.

## Next bounded phases

1. Reconcile persistence ownership and Worker composition while preserving
   current tests.
2. Export and integrate the approved Figma brand assets as the sole logo truth.
3. Add SourceConnection, SourceItem, ActionCandidate, and ActionDecision with
   a human approval boundary.
4. Add Gmail authorization only after the Source/Action model is stable.
5. Keep optional intelligence provider-agnostic and disabled by default;
   deterministic parsing remains the core path.
