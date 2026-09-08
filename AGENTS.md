<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cloudflare delivery rules

- Treat `wrangler.jsonc`, migrations, and GitHub Actions workflows as the
  reviewed source of truth for Calenote Cloudflare configuration.
- Before changing Worker configuration or running Wrangler, use the available
  Cloudflare Workers best-practices and Wrangler guidance; generate/check
  Worker types after a binding change.
- Never commit, print, or pass secrets through source, configuration, tests,
  URLs, or logs. Use environment-scoped, least-privilege deployment credentials.
- Production deploys, resource creation, secret rotation, remote D1 migration,
  custom-domain changes, and provider/AI side effects require explicit human
  authorization. Dashboard changes are emergency-only and must be reconciled
  into Git and deployment evidence afterward.
- Keep local, staging, and production D1, Queue, Worker, and credentials
  isolated. Do not use a production credential or provider authority in local
  or staging smoke tests.
- After bootstrap, use immutable Worker versions: upload once, record the
  version ID, then promote or roll back that exact version. Worker rollback
  never rolls back D1 migrations; migrations are forward-only and immutable.
