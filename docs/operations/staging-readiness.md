# Staging readiness checklist

## Phase 5A audit result

This document is a design and readiness record only. It does not create,
deploy, migrate, configure DNS, or upload a secret to Cloudflare.

`wrangler.jsonc` currently names the canonical production Worker, production
D1/Queue resources, canonical production origin, and production custom domain.
It has no approved staging environment binding block, resource IDs, Worker
name, Queue names, or hostname. CI is non-mutating and runs frozen dependency
installation plus `pnpm check`; no staging or production workflow exists.

## Staging resource matrix

| Resource | Current status | Required staging property |
| --- | --- | --- |
| Worker/application environment | MISSING | A distinct Worker name and Wrangler environment configuration. |
| Static assets/runtime | MISSING | Build the reviewed commit and bind assets to the staging Worker only. |
| D1 database | MISSING | Dedicated staging D1; never point staging at production D1. |
| `JOBS` queue | MISSING | Dedicated staging producer/consumer queue and dead-letter queue. |
| Cron consumer | MISSING | Staging-only schedule, enabled only after explicit deployment approval. |
| Connection encryption/session key material | MISSING | Staging-specific secret, never copied from production. |
| OpenRouter credential | UNKNOWN | Optional staging-specific key with least privilege and bounded budget. |
| Zalo/Telegram test bots | UNKNOWN | Test-only identities with no production authority. |
| Route/hostname | DECISION_REQUIRED | An approved staging hostname and Git-reviewed custom-domain configuration. |
| GitHub Environment credentials | MISSING | `calenote-staging`, isolated from production credentials. |

No remote discovery was performed in Phase 5A, so no row is claimed to exist.

## Staging secrets matrix

| Secret/configuration | Purpose | Staging-specific | Required | Rotation expectation |
| --- | --- | --- | --- | --- |
| `CALENOTE_MASTER_KEY` | Encrypts credentials and derives keyring material. | Yes | Yes | Rotate through a reviewed keyring migration/compatibility procedure; never overwrite blindly. |
| `OPENROUTER_API_KEY` | Enables optional AI transport. | Yes | Optional | Scoped to staging budget; rotate/revoke immediately on exposure. |
| `AI_MODE` | Enables only free-preferred behavior. | Yes | Optional | Set to `free` only after approved AI validation; otherwise `off`. |
| `OPENROUTER_FREE_MODEL` and AI bounds | Non-secret policy controls for primary/model limits. | Yes | Optional | Git-reviewed with cost review. |
| `OPENROUTER_FALLBACK_MODELS` and `AI_MAX_FALLBACK_PRICE` | Explicit paid fallback allowlist and prompt/completion ceiling. | Yes | Optional | Absent unless exact models and current pricing are approved. |
| Zalo/Telegram test credentials | Test-bot operation. | Yes | Only for connection/delivery smoke | Use test bots only; rotate at provider on exposure. |

Session digest and token-encryption material derive from `CALENOTE_MASTER_KEY`;
there is no separate committed session secret. User-owned bot credentials are
encrypted D1 data, not deployment bootstrap secrets.

## Staging AI policy

The recommended initial policy is `AI_MODE=free`, `OPENROUTER_FREE_MODEL=openrouter/free`,
strict JSON schema, `require_parameters=true`, `data_collection=deny`,
`zdr=true`, no tools/plugins/web search, and bounded input/output/timeout
values. A paid fallback remains disabled until a specific current model and
prompt/completion price ceiling are reviewed and approved. `max_price.request`
is not a substitute for token pricing.

## D1 migration readiness

The repository contains immutable forward-only migrations `0001` through
`0004`. No V2 migration is uncommitted. The inspected local Wrangler D1 state
has all four migrations pending; Phase 5A does not apply them. Existing
Miniflare/D1 integration tests are the local migration validation evidence and
`REMOTE_MIGRATION_APPLIED = NO`. Phase 5B must apply the exact reviewed
migration sequence to the isolated staging D1 before Worker promotion.
Worker rollback never reverses a D1 migration; remediation is additive and
forward-only.

## Phase 5B deployment and smoke plan

1. Explicitly approve isolated staging resource creation, hostname, and GitHub
   Environment credentials; add no production credential to staging.
2. Provision/bind the distinct Worker, assets, D1, queues/DLQ, cron policy,
   staging secrets, and test-only provider identities through Git-reviewed
   configuration.
3. Run frozen install, canonical verification, migration preflight, then apply
   reviewed migrations to staging only. Upload an immutable Worker version and
   record commit, version, target, timestamp, and safe HTTP read-back.
4. Public smoke: `/`, `/onboarding`, `/login`, and `/dashboard` redirect.
5. Auth smoke: first-time onboarding, returning-user OTP, session cookie, and
   logout/revocation where enabled.
6. App smoke: Today, Calendar, Inbox, Reminders, Connections, Activity, and
   Settings under an isolated staging account.
7. Reminder smoke: create/list/cancel and one safe staging-channel delivery.
   Connection smoke: a staging Zalo/Telegram bot whose encrypted secret is not
   returned after persistence.
8. AI smoke: deterministic reminder, ambiguous input, one controlled free
   request, no paid fallback unless separately approved, and privacy-blocked
   input with zero provider calls.
9. Security smoke: cross-user ownership fencing, same-origin mutation checks,
   and no secret logging. Generic smoke tests never trigger real provider or
   AI side effects.
10. Promote only after explicit authorization. Record evidence and retain the
    known-good immutable Worker version for rollback; do not roll back D1.
