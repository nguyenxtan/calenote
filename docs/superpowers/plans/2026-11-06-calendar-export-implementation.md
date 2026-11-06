# Owner Calendar Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated owner download a bounded, private, deterministic ICS snapshot.

**Architecture:** A dedicated D1 store produces a bounded logical owner projection; a pure serializer writes RFC 5545. A rate-limited service audits downloads, a session route returns the file, and a keyed client panel prevents stale-owner download races. Root owns shared router/composition/Settings integration.

**Tech Stack:** TypeScript, Cloudflare D1/Web Crypto, React 19, Next 16.3.4 client boundary, Vitest and real workerd fixtures.

**Spec:** `docs/superpowers/specs/2026-11-06-calendar-export-design.md`

## Global Constraints

- Session cookie only; no URL tokens, providers, migration, deployment or secrets.
- Window now minus 30 days through now plus 400 days; 300 events, 1 MiB maximum.
- Title and location only; exclude notes, RRULE and VALARM.
- No commits; parent integrates shared files and runs final project checks.
- Internal background projection requires an actual owner sync-connection lease.

## Review Focus

- Old-owner response after an owner change must never start a file download.
- Current follow-through heads and finite series must retain stable logical UIDs.
- Corrupt or foreign canonical metadata must be counted and excluded.
- A bounded or skipped source must never imply deletion in a sync consumer.
- Re-import/cancellation behavior differs by calendar client and must not be promised.

### Task 1: Pure projection and serializer

Files: `src/modules/calendar/{projection,ics}.ts`, matching `.test.ts` files.
Interfaces: `ProjectedCalendarEvent`, `CalendarProjection`, `projectCalendarReminder(source)`, `boundCalendarProjection(events,now)`, `serializeCalendarExport(projection): CalendarExportFile`.

- [x] Write tests for stable root/series/group UIDs, date-only actual events, UTC, window/order, injection, Unicode folds, deterministic timestamps, and complete-file bounds.
- [x] Run `pnpm exec vitest run src/modules/calendar/ics.test.ts src/modules/calendar/projection.test.ts`; observe all six failing against explicit unimplemented functions.
- [x] Implement the pure functions and rerun the same command; six tests pass.

### Task 2: Bounded owner read, rate limit and audit

Files: `src/modules/calendar/infrastructure/d1/export-store.ts`, store test and workerd test, `src/modules/calendar/export-service.ts`.
Interfaces: `D1CalendarExportStore.read(SessionPrincipal,now):Promise<CalendarProjection>`, `recordExport(SessionPrincipal,now):Promise<void>`, `readForSyncAuthorizedOwner(ownerId,now):Promise<CalendarProjection>`, `exportOwnerCalendar(principal,deps):Promise<CalendarExportFile>`.

- [x] Write failing tests for stable current head, finite legacy/canonical rows, advance deduplication, session ownership/revocation, corrupt ciphertext, bounds, rate limit and content-free audit.
- [x] Run the store tests; observe explicit unimplemented read/service failures after fixing fixture-only setup issues.
- [x] Implement owner-fenced source SQL, bound decryption and metadata integrity, rate limit and audit.
- [x] Add coverage for session revocation during decrypt, date-only resolved lunar provenance, foreign-bound group details and a real service-created advance group on D1/workerd.
- [x] Review fix: observe failing partial-alert cancellation and non-first member version tests; make advance cancellation follow canonical whole-series state and version from all owned roots/current heads/follow-through items.
- [x] Run focused tests and targeted lint; verify green.

### Task 3: Route and private download UI

Files: `src/worker/routes/calendar.ts`, route test, `src/features/final-screens/CalendarExportPanel{.tsx,.test.tsx,.module.css}`.
Interfaces: `CalendarExportOperations {requireUser(credentials);exportCalendar(principal)}`, `handleCalendarExport(request,factory):Promise<Response>`, `CalendarExportPanel({ownerKey})`.

- [x] Write tests for cookie-only auth, attachment/cache/completeness headers, blob download, retries, partial/skipped copy and old-owner response suppression.
- [x] Run the route/panel tests and observe the intended missing behavior.
- [x] Implement the route, no-store fetch, validated metadata and keyed request cleanup.
- [x] Verify scoped lint and focused tests including accessibility structure checks.
- [ ] Parent wires factory/route/error cache classification and renders the panel beside usage in Settings.
- [ ] Parent runs final integrated project verification and review. No deployment is part of this plan.

## Integration contract

Composition factory creates the route keyring, `new D1CalendarExportStore(env.DB,keyring)` and `new D1RateLimitStore(env.DB)`. `requireUser` calls existing `requireSession` with `D1SessionStore`; `exportCalendar` calls `exportOwnerCalendar(principal,{store,keyring,rateLimitStore})`. Router registers GET `/api/calendar/export.ics` using `handleCalendarExport` and includes the path in its authenticated-error classification. Render `<CalendarExportPanel ownerKey={user.email}/>` in Settings beside `<AiUsagePanel/>`. `CalendarExportOperations` is exported by the new route; shared operations may re-export that type.
