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
| Public V2 experience | IMPLEMENTED, WIRED, TESTED | `/` is a static Landing V2 with no personal-data request; `/onboarding` retains the bounded, same-origin first-time bootstrap; `/login` retains the bot-delivered OTP flow; and `/dashboard` is a compatibility redirect to `/app/today`. Local fixture/headless-browser capture is local test evidence only. Google OAuth is NOT_IMPLEMENTED / DEFERRED. |
| V2 authenticated app screens | IMPLEMENTED, WIRED, TESTED | `/app/today`, `/app/calendar`, `/app/inbox`, `/app/reminders`, `/app/connections`, `/app/activity`, and `/app/settings` confirm a session before requesting personal data. Connections exposes only Telegram/Zalo safe metadata; Settings uses read-only profile data and supported preferences. Activity is an authenticated read-only projection over existing audit persistence, scoped by `actor_user_id`, newest-first, bounded to 50 allowlisted events, and exposes only `action` plus `createdAt`—never raw audit payload. Local fixture/headless-browser capture is test evidence only, not staging or production evidence. |
| Production origin | DEPLOYED | `calenote` is deployed at `https://calenote.iconiclogs.com` with the reviewed production D1, Queue, assets, cron, and secret bindings. Deployment does not by itself prove a provider journey. |
| Zalo production transport | IMPLEMENTED, WIRED, TESTED, DEPLOYED | Controlled tokenless diagnostics proved the production Worker can make a simple Zalo HTTPS GET and an authorized TLS handshake. The real Zalo `getMe` POST path remains blocked before an HTTP response, so bot activation, webhook registration, and chat delivery are not E2E_PROVEN. |
| Chat E2E | PLANNED | A private `/connect`, confirmed near-future reminder, and received notification have not been E2E_PROVEN. Telegram live behavior has not been investigated in this evidence set. |

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

Historical one-time egress diagnostics were guarded by expired scheduled-time
windows. They have no public debug route, make no further calls, and the
temporary workers.dev control Worker used for comparison has been deleted.

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

The V2 web journey is canonical: `/` is Landing, `/onboarding` is first-time
bootstrap, `/login` is returning-user OTP login, `/app/today` is authenticated
home, and `/dashboard` is compatibility-only. The UI does not claim a full
external visual E2E or a change to the chat-first product boundary.

## Optional OpenRouter runtime

Optional intelligence is disabled when `AI_MODE` is absent or `off`.
`AI_MODE=privacy` requires `OPENROUTER_API_KEY`, `OPENROUTER_PRIVACY_MODEL`,
`OPENROUTER_PRIVACY_PROVIDER`, `AI_MAX_PRIVACY_PRICE`, and bounded timeout,
input, and output settings. The API key is a Worker secret and is never
committed. Missing or invalid settings select the null gateway, so startup and
`/api/health` remain available without OpenRouter.

The policy is **PRIVACY-FIRST / FREE-WHEN-ELIGIBLE**. User-derived intelligence
uses a pinned privacy route only: `allow_fallbacks=false`,
`data_collection=deny`, `zdr=true`, `require_parameters=true`, strict JSON
Schema, and prompt/completion price ceilings. No generic paid fallback is
configured. `AI_MODE=free` currently fails closed because `openrouter/free`
has no endpoint eligible for mandatory ZDR; a future safe/redacted input
boundary must independently prove free-route eligibility before it can be
enabled. The adapter enables no plugins, tools, or web search and emits no
provider logs; provider error bodies and malformed completion content reduce to
safe `UNAVAILABLE`.

`LIVE_OPENROUTER_E2E` is PARTIAL. Three bounded synthetic free requests proved
the ZDR eligibility failure. Catalog evidence identified the explicit
`google/gemini-3.5-flash-lite` / `google-vertex/global/flex` ZDR candidate, but
two bounded live gateway attempts (5s and 15s) timed out before an HTTP
envelope. No model output, usage, or cost is claimed. `PRODUCTION_AI` is
NOT_DEPLOYED; no remote deployment occurred.

## What is not proven

The product is DEPLOYED, but that is not provider end-to-end evidence. A
production Zalo token works in the independently controlled local probe, while
the Worker-side Zalo `getMe` POST has failed before any upstream HTTP response.
Simple Zalo GET and raw TLS handshake diagnostics succeed in both the deployed
custom-domain Worker and a now-deleted isolated workers.dev control. The
remaining proven boundary is therefore Zalo POST/request-shape or provider-edge
policy; no workaround has been applied. Zalo bot activation, webhook
registration, private `/connect`, inbound processing, reminder delivery, and
all Telegram live behavior remain not E2E_PROVEN.

## Next bounded phases

1. Review the proven Zalo POST/request-shape or provider-edge policy boundary
   before authorizing any provider workaround or product behavior change.
2. Prepare controlled live OpenRouter validation and staging only after explicit authorization.
3. Add Gmail authorization only after the Source/Action model is stable.
4. Keep optional intelligence provider-agnostic and disabled by default;
   deterministic parsing remains the core path.
