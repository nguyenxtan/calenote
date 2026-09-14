# Calenote Cloudflare deployment model

## Current production evidence

The canonical Worker `calenote` is deployed at
`https://calenote.iconiclogs.com` using immutable Worker versions. This proves
the reviewed Worker, production D1/Queue bindings, assets, cron, and secret
binding are live; it does not prove any provider workflow.

On 2026-09-14, bounded tokenless diagnostics proved that both the deployed
custom-domain Worker and an isolated, subsequently deleted workers.dev control
could complete a simple Zalo HTTPS GET and an authorized TLS handshake. Earlier
Zalo POST probes failed before an upstream HTTP response. Treat this as a
Zalo POST/request-shape or provider-edge-policy review item, not a reason to
change TLS, DNS, provider credentials, or egress controls without explicit
authorization.

## Operating model

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
