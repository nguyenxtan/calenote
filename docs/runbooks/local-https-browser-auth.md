# Local HTTPS browser authentication

Run the full local Worker application at `https://localhost:8787`, not the
Next-only development server at port 3000. The `dev:local` script explicitly
selects the only local runtime policy accepted by the Worker:

- `CALENOTE_RUNTIME_ENVIRONMENT=local`
- `APP_ORIGIN=https://localhost:8787`
- Wrangler local HTTPS at port 8787

Production remains hard-pinned to `https://calenote.iconiclogs.com`; neither
arbitrary origins nor HTTP localhost are accepted.

## One-time local setup

Keep `.dev.vars` ignored and place a distinct, random 32-byte base64url value
in it as `CALENOTE_MASTER_KEY`. Do not reuse a staging or production key. The
optional OpenRouter key is unrelated to browser authentication.

Build local assets and apply migrations only to local D1:

```powershell
pnpm.cmd build
pnpm.cmd exec wrangler d1 migrations apply calenote-production --local
```

## Start and trust local HTTPS

```powershell
pnpm.cmd dev:local
```

Open `https://localhost:8787`. Wrangler may present a locally generated
development certificate. Trust it only for `localhost` in the browser's local
certificate warning flow; do not disable TLS verification in Calenote code,
the browser, or provider clients.

`GET /api/session` returns a JSON 401 before login. Authenticated mutations
require an exact `Origin: https://localhost:8787`; HTTP localhost and every
other origin remain rejected.

## Acceptance boundary

The Worker, static assets, local D1, session cookie, and application routes can
be exercised locally. A real OTP requires an already active test bot and its
private chat. Provider delivery/webhook evidence is separate: do not invent an
OTP or weaken the authentication flow when those external test credentials are
unavailable.
