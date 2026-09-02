# Calenote Foundation Implementation Plan

> **For Codex:** Execute task-by-task with tests first for behavioral code and verify each checkpoint before claiming completion.

**Goal:** Ship a polished, runnable Calenote foundation that verifies user-owned Zalo/Telegram bot tokens through official APIs and documents the complete account-to-chat connection pipeline.

**Architecture:** One Next.js modular monolith contains the responsive UI and a narrow server boundary. Provider-specific HTTP code lives behind normalized adapters. The first release deliberately stores no token; durable encrypted credentials, webhook ingress, account auth and scheduling remain documented production stages.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Vitest, Testing Library, jsdom, ESLint, plain CSS design tokens.

---

## Task 1: Repository and application shell

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`

**Step 1:** Initialize Git and add package/tool configuration.

**Step 2:** Install exact dependencies and generate `pnpm-lock.yaml`.

**Step 3:** Add the root metadata/layout and global design tokens.

**Step 4:** Run `pnpm typecheck` to verify the shell.

**Step 5:** Commit the repository foundation.

## Task 2: Provider adapters and token-verification API (TDD)

**Files:**

- Create: `src/modules/connections/contracts.ts`
- Create: `src/modules/connections/token-policy.ts`
- Create: `src/modules/connections/provider-error.ts`
- Create: `src/modules/connections/providers/zalo.ts`
- Create: `src/modules/connections/providers/telegram.ts`
- Create: `src/modules/connections/verify-bot-token.ts`
- Test: `src/modules/connections/__tests__/providers.test.ts`
- Create: `src/app/api/v1/bot-connections/verify/route.ts`
- Test: `src/app/api/v1/bot-connections/verify/route.test.ts`

**Step 1:** Write failing tests proving Zalo uses `POST .../getMe`, normalizes `account_name/account_type/can_join_groups`, does not echo token and rejects unsafe token paths.

**Step 2:** Write failing tests proving Telegram uses `POST .../getMe`, normalizes `first_name/username/can_join_groups`, handles provider `ok: false`, and sends no token in response bodies.

**Step 3:** Implement the smallest typed adapters needed to pass those tests. All fetches use fixed hosts, `redirect: "error"`, timeout and `cache: "no-store"`.

**Step 4:** Write failing Route Handler tests for valid input, invalid JSON/provider/token and provider failure.

**Step 5:** Implement `POST /api/v1/bot-connections/verify` with a small request limit, generic safe errors and `Cache-Control: no-store`.

**Step 6:** Run focused tests and commit.

## Task 3: Onboarding UI (TDD)

**Files:**

- Create: `src/components/brand/CalenoteMark.tsx`
- Create: `src/components/onboarding/OnboardingWizard.tsx`
- Create: `src/components/onboarding/ProviderCard.tsx`
- Create: `src/components/onboarding/ProgressRail.tsx`
- Test: `src/components/onboarding/OnboardingWizard.test.tsx`
- Create: `src/app/page.tsx`

**Step 1:** Write a failing interaction test for account → provider → token steps.

**Step 2:** Implement accessible form controls, keyboard-safe provider selection and responsive progress.

**Step 3:** Write a failing test that submits a token, renders normalized bot identity on success, clears the raw token, and renders a safe retry message on failure.

**Step 4:** Implement the verification request and states: idle, validating, verified, error.

**Step 5:** Add provider-specific official setup instructions and an explicit production-boundary checklist.

**Step 6:** Run focused UI tests and commit.

## Task 4: Dashboard preview and product navigation

**Files:**

- Create: `src/components/dashboard/DashboardShell.tsx`
- Create: `src/components/dashboard/TodayTimeline.tsx`
- Create: `src/components/dashboard/ConnectionCard.tsx`
- Create: `src/app/dashboard/page.tsx`
- Test: `src/components/dashboard/DashboardShell.test.tsx`

**Step 1:** Write a failing render test that distinguishes active preview surfaces from future modules.

**Step 2:** Implement responsive desktop navigation, mobile header, today timeline, chat prompt and connection health card.

**Step 3:** Add labels that keep sample data and future-only modules unambiguous.

**Step 4:** Run focused tests and commit.

## Task 5: Operational and architecture documentation

**Files:**

- Create: `README.md`
- Create: `docs/architecture/system-overview.md`
- Create: `docs/architecture/domain-model.md`
- Create: `docs/integrations/zalo-bot-platform.md`
- Create: `docs/integrations/telegram-bot.md`
- Create: `docs/security/byob-credentials.md`
- Create: `docs/runbooks/local-development.md`
- Create: `docs/roadmap.md`

**Step 1:** Document the exact Zalo Bot Manager and BotFather setup paths with official links.

**Step 2:** Document token verification, polling for local work, webhook for production, secret-header validation, `/connect` binding and delivery retry/idempotency.

**Step 3:** Document account/workspace/domain boundaries and the migration path to PostgreSQL, queue and native mobile.

**Step 4:** Document security controls and list production gates clearly.

**Step 5:** Verify all relative links and commit.

## Task 6: Full verification and visual QA

**Step 1:** Run `pnpm test`.

**Step 2:** Run `pnpm typecheck`.

**Step 3:** Run `pnpm lint`.

**Step 4:** Run `pnpm build`.

**Step 5:** Start the local app and inspect onboarding/dashboard at desktop and mobile sizes.

**Step 6:** Fix observable layout/accessibility issues, rerun affected tests and capture final Git status.

