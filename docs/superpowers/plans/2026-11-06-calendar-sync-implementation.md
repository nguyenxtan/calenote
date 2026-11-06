# Optional Google Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Complete the inactive source for optional one-way Google calendar synchronization.

**Architecture:** Inject HTTP and owner projection ports. D1 owns session-bound nonces, encrypted connections, immutable egress leases and keyed event mappings. Root integrates routes, queue and cron separately.

**Tech Stack:** TypeScript, Cloudflare D1/Web Crypto, React, Vitest, existing SQLite D1 test adapter.

**Spec:** `docs/superpowers/specs/2026-11-06-calendar-sync-design.md`

## Global Constraints

- Status is `SOURCE_COMPLETE_NOT_ACTIVATED`; no provider calls/resources/secrets/deploy.
- Do not edit shared router/composition-root/operations/queue/keyring/catalog/config.
- No real network in tests. No commit.
- Gate requires flag plus both client fields. Scope `calendar.app.created` only.
- A successful disconnect blocks unresolved provider egress and keeps remote events.

## Review Focus

- Expired/replayed/wrong-session nonce must fail before token exchange.
- A timed-out create must resolve its deterministic event ID before another write.
- A lost provider settlement must not allow disconnect or a second concurrent write.
- Partial/window projections cannot delete absent events.
- Disabled capability must not load GIS or call providers.

### Task 1: Gate and concrete HTTP adapter
Files: `src/modules/calendar-sync/{contracts,google-provider}.ts`, `google-provider.test.ts`.
Interfaces: exported provider, gate, projection and token types.
- [x] Add failing tests for disabled gate, exact OAuth POST bodies, scope, payload privacy, deterministic IDs and unknown responses.
- [x] Run `pnpm exec vitest run src/modules/calendar-sync/google-provider.test.ts`; observe missing implementation.
- [x] Implement bounded injected HTTP adapter and base32hex helper.
- [x] Run focused tests and verify green.

### Task 2: Durable session/connection/mapping state machine
Files: migration `0025_calendar_sync.sql`, `src/modules/calendar-sync/{store,service}.ts`, `service.test.ts`.
Interfaces: service begin/connect/status/disconnect/sync/selectDue; injected projection returns bounded events.
- [x] Add failing SQLite tests for live-session nonce CAS, encryption, lease/egress fencing, uncertainty, idempotency, explicit cancellation, bounded retries.
- [x] Run `pnpm exec vitest run src/modules/calendar-sync/service.test.ts`; observe failure.
- [x] Implement migration/store/service with content-free errors.
- [x] Run focused tests and verify green.

### Task 3: Routes and UI
Files: `src/worker/routes/calendar-sync.ts`, route tests, `CalendarSyncPanel*` new component files, `src/worker/optional-calendar-env.d.ts`.
Interfaces: GET status and POST begin/code/disconnect; session and Origin checks before service.
- [x] Add failing route and UI tests for session/Origin/custom-header checks, unavailable state and privacy copy.
- [x] Run the focused route/UI tests; observe failure.
- [x] Implement bounded routes and popup UI.
- [x] Run focused tests, targeted lint/type check and record root integration contract.

## Verification and rulings

- The parent explicitly authorized implementation without a design gate and requested no commits. Native execution in the existing feature workspace therefore continues without another permission round or commits.
- Task 1 observed RED missing contracts/provider; GREEN provider tests. Task 2 observed RED missing store/service; GREEN SQLite state-machine tests. Task 3 observed RED missing routes/UI; GREEN route/UI tests.
- Author review fixed a D1/Web Crypto blob-shape mismatch through the existing persistedD1Blob helper, successful-edit retry counters, duplicate queue backoff and ACTIVE state preservation after first-sweep uncertainty. Added focused RED→GREEN checks.
- Final own validation: 35/35 focused tests; targeted ESLint clean; TypeScript noEmit clean. The parent is responsible for integrated full-suite/build and fresh whole-branch review. No real provider calls, credentials, resources or deployment were used.
- See `docs/superpowers/specs/2026-11-06-calendar-sync-source-report.md` for exact integration and activation limits.
- Parent-requested actual Workerd/D1 smoke passed with all forward migrations: concurrent nonce/claim/disconnect CAS, expired unresolved egress hold, zombie marker rejection and transactional audit rollback.
