# Calenote V2 Architecture, Intelligence, and Web Design

## Status

Approved execution design. This document reconciles the V2 product brief with
the code observed at `d991d4b` and supersedes no historical evidence record.

## Current truth and scope

Calenote is a Next.js static web control plane plus a Cloudflare Worker using
D1 and one `JOBS` queue. D1 is canonical. Credentials are encrypted and queue
messages are opaque IDs. The current application has a `/dashboard` control
plane, reminder lifecycle, Telegram/Zalo providers, source/action tables and
services, and structured preferences. It does *not* yet have a composition
root: Worker dependency construction remains in `index.ts` and `router.ts`.

V2 preserves the Worker, D1, Queues, Cron, encrypted credentials, reminder
idempotency, and chat-first interaction. It adds clear contracts, optional
provider-agnostic intelligence, runtime wiring for actions/preferences, and a
calm route-based web control plane. No production deployment, remote resource
mutation, Gmail OAuth, ORM, or applied-migration editing is in scope.

## Architecture

The repository remains a modular monolith. Existing `src/modules` stays a
transition-friendly feature root; new code is feature-owned and must follow
domain/application/infrastructure/UI boundaries rather than trigger cosmetic
mass moves. A single `src/worker/composition-root.ts` constructs all D1 stores,
keyring, providers, queues, and optional intelligence. `index.ts` only
dispatches fetch/queue/cron; the router only matches routes and maps errors.

Public same-origin APIs use shared Zod schemas in `src/contracts/api`. Worker
controllers validate inputs and outputs with those schemas; browser hooks
consume the same schemas and inferred types. Internal D1 rows and secrets never
cross a public contract.

## Intelligence

Reminder parsing stays deterministic first. An `IntelligenceGateway` port
returns validated proposals only; application code never imports OpenRouter.
The OpenRouter adapter is selected at the composition root and supports:

- `AI_MODE=off`: no model invocation;
- `AI_MODE=free`: `OPENROUTER_FREE_MODEL` (default `openrouter/free`) only;
- `AI_MODE=economy`: explicitly configured economy model and fallback list.

Missing credentials or any model failure produces a safe unavailable result,
never an authoritative write. Inputs are length-limited and rejected/redacted
when they contain secret-like material. Prompts and raw responses are never
logged or stored. AI requests are kept off critical reminder delivery paths;
all queue messages remain identifiers.

## Product UI

New authenticated routes are `/app/today`, `/app/calendar`, `/app/inbox`,
`/app/reminders`, `/app/connections`, `/app/activity`, and `/app/settings`.
`/dashboard` redirects to `/app/today`. The original `CalenoteMark` is reused
unchanged. A small token-based design system supplies shared controls, app
shell, feedback, empty states, and accessible focus behavior. Today centers
quick reminder capture, timeline, pending actions, and non-intrusive connection
health. Inbox preserves the human approval boundary. Settings exposes only
structured presentation preferences and optional AI mode, never credentials.

## Data and safety

Applied migrations `0001` through `0004` are immutable. Any new state is a
forward-only migration with an idempotent test. D1 ownership fencing,
compare-and-set transitions, inbound dedupe, provider retry bounds, and
`UNCERTAIN` delivery handling are retained. Browser and AI responses contain no
tokens, connect codes, encryption material, or raw credentials.

## Verification

Each behavior slice starts with a focused failing test. The final gate is
`pnpm.cmd check` in this PowerShell environment (the `pnpm.ps1` shim is blocked
by machine policy), plus `git diff --check`. No deployment is claimed.

## Deployment governance

Cloudflare delivery follows `docs/runbooks/cloudflare-deployment.md`: Git is
the authoritative configuration source; GitHub Actions is the control plane;
Wrangler owns Worker delivery; and Dashboard changes are emergency-only then
reconciled into Git. Local, staging, and production use isolated Worker, D1,
Queue, and credentials. Production delivery is serialized, explicitly
authorized, records non-secret evidence, and promotes an uploaded immutable
Worker version. Worker rollback selects a recorded known-good version and never
rolls D1 back; D1 migrations remain immutable and forward-only.
