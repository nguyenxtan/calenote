# Calenote Cloudflare deployment model

## Current production evidence

The canonical Worker `calenote` is deployed at
`https://calenote.iconiclogs.com` using immutable Worker versions. This proves
the reviewed Worker, production D1/Queue bindings, assets, cron, and secret
binding are live; it does not prove any provider workflow.

On 2026-09-14, bounded tokenless diagnostics proved that both the deployed
custom-domain Worker and an isolated, subsequently deleted workers.dev control
could complete a simple Zalo HTTPS GET and an authorized TLS handshake. Earlier
The bounded tokenless POST matrix subsequently narrowed the remaining evidence
to `CALENOTE_REQUEST_INIT_COMBINATION`: generic JSON POST and Zalo request
shapes B/C/D received HTTP 200, while only exact current request shape E failed
before a response. Treat this as a request-init member-isolation review item,
not a reason to change TLS, DNS, provider credentials, or egress controls
without explicit authorization.

## Keyed AI target, 2026-11-03

The current cutover candidate targets keyed prompt139/wire136 on GPT-5 mini
low via only azure/swedencentral, required ZDR/data-collection denial and no
fallback. The exact previously qualified request builder and strict decoder
are shared by runtime and synthetic benchmarks. Canonical storage remains
calenote-context-3/state2/family2; no new migration is introduced.

Canonical vars: model openai/gpt-5-mini, provider azure/swedencentral,
AI_MAX_PRIVACY_PRICE2.2, AI_TIMEOUT_MS45000, AI_MAX_OUTPUT_TOKENS3072,
AI_MAX_INPUT_CHARS1800. Account ceilings stay50 calls/owner/day,
USD0.5/owner/month and USD2/global/day. Atomic reservation116759 microunits
matches400000 token financial exposure plus3072 output at pinned prices.

Queue, HTTP previews/details and cleanup use the serving version's full40hex
CF_VERSION_METADATA.tag. Upload with the exact reviewed master SHA tag.
Missing/wrong metadata or a different route does not enable the successor.
AI_MODE off keeps deterministic confirmation and existing previews available.
Exact local read-only commands stay local; memory/follow-through and stored
reply personalization retain master behavior. The qualified successor always
requires explicit preview confirmation; old automatic-save preference is not
new confirmation authority. Product release notes disclose that behavior.

Existing production secrets are preserved. Do not install .env.local's
management key or the expiring .env.pilot.local inference key. Test inference
retains the owner's USD2 lifetime cap. Remote preflight after reauthentication
found no pending migration through0018 and no active context to drain.
The pre-cutover rollback version is50e1bffb-0bdd-4125-8ae6-8dc40f1a25fd
(source f11b19d223ddb01abfe9bc1c096d07fc331b8c51).

At this documentation checkpoint the cutover is prepared, not yet promoted.
Final exact-SHA checks, immutable upload/promote and provider-free HTTP readback
are required. Active successor previews must not be handed to old readers on
rollback; ownership fences and confirmed schedules remain authoritative.

## Operating model

### Historical Semantic V1 cutover candidate

Task 5's accepted hybrid full run is
`semantic-v1-hybrid-full-20260919-1827-01`; see the
[committed benchmark evidence](../benchmarks/ai-semantic-conversation-v1-results.md).
This supersedes older model-selection failures, but does not prove production
readiness or authorize deployment by itself.

At that historical checkpoint, non-secret target vars selected `AI_MODE=privacy`,
`OPENROUTER_PRIVACY_MODEL=google/gemini-2.5-flash-lite`, and
`OPENROUTER_PRIVACY_PROVIDER=google-vertex/eu`. The real Semantic V1 gateway pins
that one provider with ZDR, data-collection denial, required parameters and
provider fallback disabled. No fallback model is configured; do not set a
literal `none` model or a legacy fallback variable. `AI_MODE=off` disables AI;
`free` remains unavailable. `semantic` is not an enablement mode.

| Canonical var | Value | Enforcement |
| --- | ---: | --- |
| `OWNER_DAILY_CALL_LIMIT` | 50 | Per-owner UTC daily call reservation limit |
| `OWNER_MONTHLY_COST_MICROUNITS` | 500000 | Per-owner UTC monthly hard cost limit |
| `GLOBAL_DAILY_COST_MICROUNITS` | 2000000 | Global UTC daily hard cost limit |
| `AI_MAX_PRIVACY_PRICE` | 0.4 | USD per million tokens ceiling; exact route caps input $0.10 / output $0.40 |
| `AI_TIMEOUT_MS` | 30000 | Bounded request timeout |
| `AI_MAX_INPUT_CHARS` | 1800 | Bounded input |
| `AI_MAX_OUTPUT_TOKENS` | 256 | Bounded output |

The runtime parser passes all three budgets to the existing atomic D1 budget
store before dispatch. Values may tighten but cannot exceed the approved
ceilings; invalid values disable the semantic capability. Missing budget vars
retain those same ceilings. Reservation TTL remains five minutes; unknown
dispatched usage retains its full reserved charge. The legacy internal name
`ownerDailyFallbackLimit` now covers the primary privacy call as well; it does
not enable a second model or a fallback.

Required secret **names** are `CALENOTE_MASTER_KEY` and `OPENROUTER_API_KEY`.
No secret value is stored in config. A missing API key keeps Semantic V1
unavailable. `pnpm dev:local` explicitly overrides AI to off; local smoke must
use only local data and synthetic credentials, never production credentials.
Generated Worker types describe the production target; parser tests also cover
missing bindings and rejected configuration.

Before production mutation, Task 6 still requires fresh remote migration
0005/0006 applied/pending state, actual bindings/secret names, current Worker
and rollback version, runtime/security review and explicit cutover acceptance.
Do not use this configuration commit as permission to install a secret, apply
migrations, merge master, upload or promote a Worker.

Git-managed `wrangler.jsonc`, migrations, and GitHub Actions workflows are the
authoritative Calenote configuration. GitHub Actions is the CI/CD control
plane; Wrangler owns Worker version upload and deployment. Cloudflare Dashboard
changes are emergency-only. Record and reconcile every emergency change into
Git and the incident/deployment evidence before normal operations resume.

Secrets are never committed or included in workflow output. Deployment tokens
must be environment-scoped and least-privilege. Staging credentials must not
read, deploy to, or invoke production resources; production credentials must
not be supplied to staging jobs.

## Environment model

| Environment | Runtime | Data and credentials | Provider authority |
| --- | --- | --- | --- |
| Local | Local Worker/D1 simulation and mocks | Local-only values; no production credentials | Mocked only |
| Staging | Dedicated Worker, D1, Queue, and secret set | Isolated from production | No production bot or AI authority |
| Production | Canonical Worker/domain, D1, Queue, and secrets | Production-only credentials | Explicitly approved only |

Resource IDs, queue names, Worker names, and domains must be distinct across
staging and production. Creation and binding are future explicit-authorized
operations; this repository does not provision them automatically.

## CI and target deployment workflows

The existing CI workflow remains non-mutating: frozen install followed by
`pnpm check`, including Worker types and `wrangler deploy --dry-run`.

When staging resources and credentials are explicitly approved, add a staging
workflow with GitHub Environment `calenote-staging`. It must use frozen install,
build and test, then upload a version only for the configured staging Worker.
It must record the commit, version ID, target, UTC timestamp, and a provider-
free HTTP smoke/read-back result.

When production authorization is explicitly granted, add a production workflow
with GitHub Environment `calenote-production`, protected approvals, and:

```yaml
concurrency:
  group: calenote-production-application
  cancel-in-progress: false
```

It must promote an already recorded immutable version using:

```text
wrangler versions deploy <version-id>@100
```

not rebuild or run a general deployment during promotion. The exact commands,
Worker target, version ID extraction, and smoke URL remain intentionally
unconfigured until the isolated target exists and deployment is authorized.

## Immutable versions, evidence, and rollback

After initial Worker bootstrap, upload a candidate with `wrangler versions
upload`, record the immutable version ID, and promote that exact ID. For every
staging/production promotion or rollback, save non-secret evidence in the
GitHub Actions summary or linked change record:

- Git commit SHA;
- Worker version ID;
- deployment target/environment;
- UTC timestamp;
- HTTP smoke/read-back status.

To roll back, select the recorded known-good version for the same Worker and
environment and run `wrangler versions deploy <version-id>@100`. Re-run the
safe smoke/read-back and record the incident. A Worker version does not include
D1 state, so rollback never reverses a D1 migration. Applied migrations remain
immutable; remediation uses a reviewed forward-only migration.

## Safety gates

- Custom-domain config stays Git-reviewed; no Dashboard-only attachment.
- Never automatically run real Zalo, Telegram, or AI calls for smoke tests.
- Do not apply remote D1 migrations as part of a generic Worker promotion.
- Do not deploy, create resources, rotate secrets, or bind a domain without
  explicit human authorization.
- A promotion that touches the Zalo provider, webhook, inbound, encryption, or
  queue path must also follow the provider-specific
  [Zalo production acceptance](./zalo-production-acceptance.md) gate. Generic
  HTTP smoke checks and `testWebhook` alone are insufficient evidence for real
  Zalo message delivery.
