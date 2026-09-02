# Calenote Production MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a personal Calenote MVP where user-owned Zalo and Telegram bots accept confirmed Vietnamese reminder commands and deliver due reminders, with a real authenticated dashboard at `calenote.iconiclogs.com`.

**Architecture:** Next.js is retained as a static UI build. One Cloudflare module Worker serves the assets and owns HTTP APIs, provider webhooks, Queue consumption, and minute Cron work; D1 is canonical state and bot credentials are AES-GCM encrypted with keys derived from one Worker secret.

**Tech Stack:** Next.js 16 static export, React 19, TypeScript 6, Cloudflare Workers, D1, Queues, Cron Triggers, Web Crypto, Wrangler 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-03-calenote-production-mvp-design.md`

## Global Constraints

- Production origin is exactly `https://calenote.iconiclogs.com`.
- MVP supports personal workspaces, private chat, one-time reminders, and `Asia/Ho_Chi_Minh` only.
- Raw provider tokens, webhook secrets, session values, login/connect codes, and chat text must never be logged, committed, returned after use, or stored plaintext.
- Browser mutations require a valid session plus same-origin validation; webhook mutations require constant-time secret validation.
- Queue messages contain only internal IDs and an enum type.
- Provider request hosts are fixed and redirects are disabled.
- Timeouts produce `UNCERTAIN` delivery state and are not blindly retried.
- Team, pair, groups, recurring reminders, finance, LLM parsing, and native apps remain explicitly deferred.

---

### Task 1: Cloudflare runtime and D1 schema

**Files:**
- Modify: `package.json`
- Modify: `next.config.ts`
- Modify: `.gitignore`
- Create: `wrangler.jsonc`
- Create: `migrations/0001_production_mvp.sql`
- Create: `src/worker/index.ts`
- Create: `src/worker/router.ts`
- Create: `src/worker/router.test.ts`
- Generate: `worker-configuration.d.ts`

**Interfaces:**
- Produces: `routeRequest(request, env, ctx): Promise<Response>`.
- Produces bindings `DB`, `JOBS`, `ASSETS`, `APP_ORIGIN`, and secret `CALENOTE_MASTER_KEY`.

- [ ] **Step 1: Write the failing router smoke test**

```ts
it("returns bounded JSON health without touching assets", async () => {
  const response = await routeRequest(new Request("https://example.test/api/health"), env, ctx);
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ ok: true, service: "calenote" });
});
```

- [ ] **Step 2: Run the test and confirm it fails because `routeRequest` does not exist**

Run: `pnpm vitest run src/worker/router.test.ts`

- [ ] **Step 3: Add static export, Worker scripts, Wrangler config, and minimal router**

Use `nextConfig.output = "export"`, `assets.directory = "./out"`, `assets.binding = "ASSETS"`, and `assets.run_worker_first = ["/api/*", "/webhooks/*"]`. Export `fetch`, `queue`, and `scheduled` handlers with generated `Env` types.

- [ ] **Step 4: Add the additive STRICT D1 migration**

Create the exact tables from the spec with foreign keys, unique bot fingerprints, unique inbound message keys, one delivery per reminder, status checks, and indexes on session digest, active connect/login code digest, pending inbound rows, and due reminders.

- [ ] **Step 5: Generate bindings and validate the runtime**

Run: `pnpm wrangler types`

Run: `pnpm vitest run src/worker/router.test.ts`

Run: `pnpm build`

Run: `pnpm wrangler deploy --dry-run`

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml next.config.ts .gitignore wrangler.jsonc migrations src/worker worker-configuration.d.ts
git commit -m "feat: add Cloudflare runtime foundation"
```

### Task 2: Worker-safe crypto and provider transport

**Files:**
- Create: `src/modules/security/encoding.ts`
- Create: `src/modules/security/keyring.ts`
- Create: `src/modules/security/keyring.test.ts`
- Modify: `src/modules/connections/contracts.ts`
- Replace: `src/modules/connections/providers/secret-provider-transport.ts`
- Modify: `src/modules/connections/providers/zalo.ts`
- Modify: `src/modules/connections/providers/telegram.ts`
- Modify: `src/modules/connections/__tests__/providers.test.ts`
- Modify: `src/modules/connections/__tests__/secret-provider-transport.test.ts`

**Interfaces:**
- Produces: `createKeyring(master: string): Promise<Keyring>`.
- `Keyring` exposes `encryptCredential`, `decryptCredential`, `fingerprintToken`, `digestSession`, `digestCode`, `webhookSecrets`.
- Provider transport consumes `{ provider, hostname, path, operation, body? }` and returns bounded parsed JSON.

- [ ] **Step 1: Write failing keyring round-trip and domain-separation tests**

```ts
it("round-trips a token while producing distinct domain-separated digests", async () => {
  const keys = await createKeyring(TEST_MASTER_KEY);
  const encrypted = await keys.encryptCredential("connection-1", "zalo", 1, "token-value");
  expect(await keys.decryptCredential("connection-1", "zalo", 1, encrypted)).toBe("token-value");
  expect(await keys.fingerprintToken("token-value")).not.toBe(await keys.digestSession("token-value"));
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm vitest run src/modules/security/keyring.test.ts`

- [ ] **Step 3: Implement HKDF, AES-256-GCM, HMAC digests, base64url helpers, and constant-time comparison**

Reject malformed master keys and ciphertext before decrypting. Bind AES additional authenticated data to connection ID, provider, and credential version.

- [ ] **Step 4: Write failing Worker-fetch provider tests**

Assert fixed host, POST JSON, `redirect: "error"`, absolute timeout, 64 KiB cap, safe error categories, Zalo/Telegram `getMe`, `setWebhook`, inbound parsing, and `sendMessage` normalization.

- [ ] **Step 5: Run RED, replace `node:https` transport with injected `fetch`, then run GREEN**

Run: `pnpm vitest run src/modules/connections/__tests__`

- [ ] **Step 6: Commit**

```bash
git add src/modules/security src/modules/connections
git commit -m "feat: secure provider credentials on Workers"
```

### Task 3: Sessions, one-time codes, and request safety

**Files:**
- Create: `src/modules/platform/types.ts`
- Create: `src/modules/auth/session.ts`
- Create: `src/modules/auth/session.test.ts`
- Create: `src/modules/auth/codes.ts`
- Create: `src/modules/auth/codes.test.ts`
- Create: `src/modules/http/body.ts`
- Create: `src/modules/http/security.ts`
- Create: `src/modules/http/security.test.ts`
- Create: `src/modules/rate-limit/service.ts`

**Interfaces:**
- Produces `createSession`, `requireSession`, `revokeSession`, `issueOneTimeCode`, `consumeOneTimeCode`.
- Produces `readBoundedJson`, `requireSameOrigin`, and `jsonResponse`.

- [ ] **Step 1: Write failing behavior tests**

Cover secure cookie attributes, database storage of digest only, expired/revoked session rejection, one-use code consumption, maximum failed attempts, generic login request responses, body cap, JSON type, and origin mismatch.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm vitest run src/modules/auth src/modules/http`

- [ ] **Step 3: Implement minimal repository-backed services and request guards**

Use dependency-injected stores in unit tests and D1 prepared statements in production adapters. Generate all random values with `crypto.getRandomValues()`.

- [ ] **Step 4: Run GREEN and regression tests**

Run: `pnpm vitest run src/modules/auth src/modules/http`

Run: `pnpm test`

- [ ] **Step 5: Commit**

```bash
git add src/modules/platform src/modules/auth src/modules/http src/modules/rate-limit
git commit -m "feat: add secure Calenote sessions"
```

### Task 4: Durable onboarding and webhook activation

**Files:**
- Create: `src/modules/onboarding/service.ts`
- Create: `src/modules/onboarding/service.test.ts`
- Create: `src/worker/routes/onboarding.ts`
- Create: `src/worker/routes/connections.ts`
- Modify: `src/worker/router.ts`
- Remove: `src/app/api/v1/bot-connections/verify/route.ts`
- Remove: `src/app/api/v1/bot-connections/verify/route.test.ts`

**Interfaces:**
- `onboard(input, deps)` returns `{ bot, connectCommand, sessionCookie }` and never returns a token.
- `POST /api/onboarding` creates and activates one personal connection.
- `POST /api/connections/:id/connect-code` rotates a short-lived binding code.

- [ ] **Step 1: Write failing onboarding tests**

Prove verification occurs before persistence, ciphertext differs from token, duplicate email/token is rejected, partial webhook failure leaves an auditable state, response excludes credential fields, and successful onboarding emits a secure session cookie plus `/connect` command.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm vitest run src/modules/onboarding/service.test.ts`

- [ ] **Step 3: Implement the service and routes**

Use normalized provider adapters, D1 batch writes for the account graph, and state transitions `VALIDATING -> ACTIVE_UNBOUND` or `WEBHOOK_FAILED`.

- [ ] **Step 4: Run GREEN and route tests**

Run: `pnpm vitest run src/modules/onboarding src/worker`

- [ ] **Step 5: Commit**

```bash
git add src/modules/onboarding src/worker src/app/api
git commit -m "feat: activate durable bot connections"
```

### Task 5: Webhook ingestion and private-chat binding

**Files:**
- Create: `src/modules/inbound/webhook.ts`
- Create: `src/modules/inbound/webhook.test.ts`
- Create: `src/modules/inbound/processor.ts`
- Create: `src/modules/inbound/processor.test.ts`
- Create: `src/worker/routes/webhooks.ts`
- Modify: `src/worker/router.ts`

**Interfaces:**
- `acceptWebhook(request, connection, deps)` returns a `Response` after durable dedupe and Queue publish.
- Queue message: `{ type: "PROCESS_INBOUND"; inboundId: string }`.

- [ ] **Step 1: Write failing webhook tests**

Cover wrong path/header secrets, constant-time comparison, non-JSON and oversized bodies, unsupported/group events, duplicate message IDs, durable insert before enqueue, and safe `2xx` duplicate acknowledgement.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm vitest run src/modules/inbound/webhook.test.ts`

- [ ] **Step 3: Implement bounded webhook acceptance**

Persist only normalized message data. Queue only the inbound row ID. Never log request URLs, headers, text, chat IDs, or codes.

- [ ] **Step 4: Write failing `/connect` processing tests, implement atomic consume/bind, and send the success reply**

Prove expired, reused, wrong-connection, and non-private codes cannot bind; repeated webhook processing is idempotent.

- [ ] **Step 5: Run GREEN and commit**

Run: `pnpm vitest run src/modules/inbound src/worker/routes/webhooks.ts`

```bash
git add src/modules/inbound src/worker
git commit -m "feat: bind private bot chats"
```

### Task 6: Vietnamese reminder grammar and confirmation

**Files:**
- Create: `src/modules/reminders/parse-vietnamese.ts`
- Create: `src/modules/reminders/parse-vietnamese.test.ts`
- Create: `src/modules/reminders/command-service.ts`
- Create: `src/modules/reminders/command-service.test.ts`
- Modify: `src/modules/inbound/processor.ts`

**Interfaces:**
- `parseVietnameseReminder(text, now, timezone)` returns a normalized candidate or a stable parse failure.
- `processBoundChatMessage(message, deps)` creates/replaces a draft, confirms, cancels, or sends help.

- [ ] **Step 1: Write failing table-driven parser tests**

Use a fixed instant and cover all four documented examples, year rollover, leap/invalid dates, past time, missing time/title, more than 366 days, and unsupported timezone.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm vitest run src/modules/reminders/parse-vietnamese.test.ts`

- [ ] **Step 3: Implement the deterministic parser and run GREEN**

Run: `pnpm vitest run src/modules/reminders/parse-vietnamese.test.ts`

- [ ] **Step 4: Write RED tests for draft replacement, confirmation, cancellation, expiry, and unbound-chat refusal; implement the command service**

Run: `pnpm vitest run src/modules/reminders/command-service.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/modules/reminders src/modules/inbound/processor.ts
git commit -m "feat: create reminders from Vietnamese chat"
```

### Task 7: Due-reminder scheduler and safe delivery

**Files:**
- Create: `src/modules/reminders/scheduler.ts`
- Create: `src/modules/reminders/scheduler.test.ts`
- Create: `src/modules/reminders/delivery.ts`
- Create: `src/modules/reminders/delivery.test.ts`
- Modify: `src/worker/index.ts`

**Interfaces:**
- Queue message: `{ type: "DELIVER_REMINDER"; reminderId: string }`.
- `claimDueReminders(now, limit, deps)` conditionally claims and enqueues.
- `deliverReminder(id, deps)` records `SENT`, `FAILED`, `RETRYABLE`, or `UNCERTAIN`.

- [ ] **Step 1: Write failing scheduler tests**

Prove bounded selection, conditional single claim, failed publish rollback, and repeated Cron safety.

- [ ] **Step 2: Run RED, implement, and run GREEN**

Run: `pnpm vitest run src/modules/reminders/scheduler.test.ts`

- [ ] **Step 3: Write failing delivery tests**

Cover already-sent idempotency, one unique delivery row, successful provider receipt, 429 retry, credential rejection suspension, network timeout to `UNCERTAIN`, and no retry after uncertain outcome.

- [ ] **Step 4: Run RED, implement delivery, wire Queue/Cron, and run GREEN**

Run: `pnpm vitest run src/modules/reminders/delivery.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/modules/reminders src/worker/index.ts
git commit -m "feat: deliver due bot reminders"
```

### Task 8: Bot-delivered login and authenticated reminder APIs

**Files:**
- Create: `src/modules/auth/login-service.ts`
- Create: `src/modules/auth/login-service.test.ts`
- Create: `src/worker/routes/auth.ts`
- Create: `src/worker/routes/reminders.ts`
- Modify: `src/worker/router.ts`

**Interfaces:**
- `POST /api/auth/request-code`, `POST /api/auth/verify-code`, `POST /api/auth/logout`.
- `GET/POST /api/reminders`, `DELETE /api/reminders/:id`.
- `GET /api/session`, `GET /api/connections`.

- [ ] **Step 1: Write failing login tests**

Prove generic request responses, bound-chat requirement, encrypted/transient code handling, ten-minute expiry, attempt cap, one-use consume, rate limits, and secure cookie issuance.

- [ ] **Step 2: Run RED, implement, and run GREEN**

Run: `pnpm vitest run src/modules/auth/login-service.test.ts`

- [ ] **Step 3: Write failing API authorization and tenant-isolation tests, then implement routes**

Run: `pnpm vitest run src/worker/routes`

- [ ] **Step 4: Commit**

```bash
git add src/modules/auth src/worker
git commit -m "feat: authenticate dashboard through bot"
```

### Task 9: Production onboarding, login, and dashboard UI

**Files:**
- Modify: `src/components/onboarding/OnboardingWizard.tsx`
- Modify: `src/components/onboarding/OnboardingWizard.test.tsx`
- Create: `src/app/login/page.tsx`
- Create: `src/components/auth/LoginPanel.tsx`
- Create: `src/components/auth/LoginPanel.test.tsx`
- Modify: `src/components/dashboard/DashboardShell.tsx`
- Modify: `src/components/dashboard/DashboardShell.test.tsx`
- Modify: `src/components/dashboard/ConnectionCard.tsx`
- Modify: `src/components/dashboard/TodayTimeline.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- UI consumes only the authenticated JSON APIs from Task 8.
- Onboarding submits the token once to `/api/onboarding`, clears it, and displays the returned connect command.

- [ ] **Step 1: Update the onboarding interaction test first and confirm RED**

Assert durable onboarding endpoint, success bot identity, visible `/connect` command, cleared token field, and honest webhook failure state.

- [ ] **Step 2: Implement onboarding UI and run GREEN**

Run: `pnpm vitest run src/components/onboarding/OnboardingWizard.test.tsx`

- [ ] **Step 3: Write failing login and dashboard tests**

Cover generic code request, code verification, loading/error/empty states, real reminders, manual create, cancel, connection state, failed/uncertain delivery, and logout.

- [ ] **Step 4: Implement UI, run focused tests, accessibility tests, and production build**

Run: `pnpm vitest run src/components`

Run: `pnpm build`

- [ ] **Step 5: Commit**

```bash
git add src/app src/components
git commit -m "feat: ship authenticated reminder dashboard"
```

### Task 10: Runbooks, full verification, and Cloudflare deployment

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/architecture/domain-model.md`
- Modify: `docs/integrations/zalo-bot-platform.md`
- Modify: `docs/integrations/telegram-bot.md`
- Modify: `docs/runbooks/local-development.md`
- Create: `docs/runbooks/cloudflare-production.md`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Produces exact deploy, migration, secret rotation, webhook recovery, smoke-test, and rollback commands.

- [ ] **Step 1: Update docs to match implemented capabilities and retain explicit deferred boundaries**

- [ ] **Step 2: Run the complete local gate**

Run: `pnpm test`

Run: `pnpm typecheck`

Run: `pnpm lint`

Run: `pnpm build`

Run: `pnpm wrangler types --check`

Run: `pnpm wrangler deploy --dry-run`

- [ ] **Step 3: Create and bind Cloudflare resources**

Run: `pnpm wrangler d1 create calenote-production`

Run: `pnpm wrangler queues create calenote-jobs`

Run: `pnpm wrangler queues create calenote-jobs-dlq`

Patch only the returned D1 ID into `wrangler.jsonc`; never persist credentials.

- [ ] **Step 4: Apply the D1 migration and Worker master key**

Run: `pnpm wrangler d1 migrations apply calenote-production --remote`

Generate 32 random bytes locally and pipe base64url directly to `pnpm wrangler secret put CALENOTE_MASTER_KEY`; do not print or save the value.

- [ ] **Step 5: Deploy the Worker and custom domain**

Run: `pnpm deploy`

Verify DNS, TLS, `/`, `/login`, `/dashboard`, `/docs`, and `/api/health` from the public origin.

- [ ] **Step 6: Bootstrap the real Zalo connection without logging the token**

Extract the token from the user-authorized local key file in-memory, call the production onboarding endpoint once, verify the normalized bot identity and webhook state, retain only the one-use `/connect` command, and scan repository/build output for zero token matches.

- [ ] **Step 7: Verify production state and document the remaining owner action**

Query D1 for counts/states without selecting encrypted credential columns. If the owner has not yet sent the `/connect` command and a reminder, report webhook-ready rather than claiming end-to-end notification success.

- [ ] **Step 8: Commit deployment docs/config and request final code review**

```bash
git add README.md docs wrangler.jsonc
git commit -m "docs: add Calenote production operations"
```
