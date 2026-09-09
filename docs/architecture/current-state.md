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
| Reminder D1 adapters and Worker composition | IMPLEMENTED, WIRED, TESTED | API, command, scheduler, and delivery SQL live in feature-owned D1 adapters; the Worker composes concrete adapters at runtime. |
| Source/Action approval foundation | IMPLEMENTED, WIRED, TESTED | Authenticated `/api/actions` lists only an owner's decrypted pending candidates. Same-origin approval or rejection uses the existing D1-fenced decision service; approval alone creates its authoritative reminder. OpenRouter extraction is IMPLEMENTED/TESTED at the application boundary with mocked transport only; source ingestion remains unwired. |
| Presentation preferences | IMPLEMENTED, WIRED, TESTED | Authenticated `/api/preferences` reads stable defaults and applies same-origin, bounded, validated presentation updates only for the session owner. |
| Optional intelligence foundation | IMPLEMENTED, WIRED, TESTED | Provider-agnostic reminder proposals pass strict admission into the existing chat CommandDraft confirmation boundary. The Worker composition selects an optional OFF/FREE/ECONOMY gateway; absent or invalid configuration remains OFF/null. |
| OpenRouter adapter | IMPLEMENTED, WIRED, TESTED | Worker composition can select the adapter only from validated optional runtime configuration. Inbound and source application flows use the real adapter with injected mocked transport; no live provider request has been made. |
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

Zalo and Telegram are interaction channels. The Source/Action foundation now
persists encrypted candidate titles and exposes only authenticated owner-pending
approval controls. It has no Gmail, Microsoft, forwarded-email, calendar API,
or other external-source ingestion: all of those remain PLANNED. Optional
intelligence is provider-agnostic and disabled by default. Deterministic parsing
remains the primary reminder path; an optional capability can only produce a
validated, non-authoritative proposal or clarification. Provider adapters and
live calls remain PLANNED. Source or intelligence output will propose an action;
only validated user approval will create an authoritative reminder, task, or
event.

The Web UI is a first-class control plane, not a replacement for chat. It is
allowed to manage complexity—connection health, reminders, account access—but
daily create/confirm/notify flow is chat-first.

## Optional OpenRouter runtime

Optional intelligence is disabled when `AI_MODE` is absent or `off`. Its
configuration is intentionally optional: `AI_MODE=off|free|economy`,
`OPENROUTER_API_KEY`, `OPENROUTER_FREE_MODEL`, `OPENROUTER_ECONOMY_MODEL`,
`OPENROUTER_FALLBACK_MODELS`, `AI_TIMEOUT_MS`, `AI_MAX_INPUT_CHARS`, and
`AI_MAX_OUTPUT_TOKENS`, `AI_MAX_FALLBACK_ATTEMPTS`, and
`AI_MAX_FALLBACK_PRICE`. `OPENROUTER_API_KEY` is a Worker secret and is never
committed. Missing or invalid settings select the null gateway, so startup and
`/api/health` remain available without OpenRouter.

`AI_MODE=free` is FREE-PREFERRED: it defaults to `openrouter/free`, then may
try only the ordered IDs in `OPENROUTER_FALLBACK_MODELS` after a retryable
availability failure. Each fallback is explicit, deduplicated, bounded by
`AI_MAX_FALLBACK_ATTEMPTS` (maximum three), and requires
`AI_MAX_FALLBACK_PRICE` as an OpenRouter request-price ceiling. A configured
fallback can incur cost; it is not a zero-cost guarantee. Authentication
failures, malformed provider output, and privacy/domain rejection never
fallback. `AI_MODE=economy` remains an explicit primary model plus bounded
allowlisted fallbacks. Every request sends `allow_fallbacks=false`,
`data_collection=deny`, `zdr=true`, and `require_parameters=true`; the adapter
does not enable plugins, tools, or web search. It emits no logs; provider error
bodies and malformed completion content are reduced to a safe `UNAVAILABLE`
result rather than being propagated. Runtime evidence uses injected mocked
transport only: `LIVE_OPENROUTER_E2E` is NOT_PROVEN and `PRODUCTION_AI` is
NOT_DEPLOYED.

## What is not proven

The product is not DEPLOYED. It has not connected a real production Zalo bot,
Telegram bot, custom domain, D1 database, Queue, or webhook. It has not sent a
real reminder to a private chat, so chat E2E is not E2E_PROVEN. Local provider
mocks and static page visual tests are useful, but are not production proof.

## Next bounded phases

1. Export and integrate the approved Figma brand assets as the sole logo truth.
2. Add Gmail authorization only after the Source/Action model is stable.
3. Keep optional intelligence provider-agnostic and disabled by default;
   deterministic parsing remains the core path.
