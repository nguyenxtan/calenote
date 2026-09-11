# Calenote V2 Phase 5A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove or safely block controlled OpenRouter E2E, correct any unit-invalid cost guard, and document staging readiness without remote mutation.

**Architecture:** The existing OpenRouter gateway remains the only live transport boundary. A scalar configured fallback ceiling applies to both token-priced provider dimensions, preserving fail-closed routing. Evidence and staging plans are documentation only; runtime secrets remain local and ignored.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers/D1/Queues, Wrangler, GitHub Actions, OpenRouter HTTP API.

**Spec:** User-approved Phase 5A directive, 2026-09-11.

## Global Constraints

- Maximum five OpenRouter HTTP requests; synthetic data only.
- Never expose, commit, log, or document secret values or raw model content.
- No deployment, remote Cloudflare mutation, remote migration, new resource, or production change.
- UI/auth/product behavior remains frozen except a verified cost-guard correction.
- Staging must use isolated Worker, D1, Queue, secrets, provider authority, and hostname.

---

### Task 1: Correct the token-priced fallback ceiling

**Files:**
- Modify: `src/modules/intelligence/infrastructure/openrouter/gateway.test.ts`
- Modify: `src/modules/intelligence/infrastructure/openrouter/gateway.ts`

- [ ] Write a gateway assertion that a configured scalar ceiling serializes as both `provider.max_price.prompt` and `provider.max_price.completion`, not `request`.
- [ ] Run `pnpm vitest run src/modules/intelligence/infrastructure/openrouter/gateway.test.ts` and confirm the assertion fails against the request-only implementation.
- [ ] Change only request construction so `AI_MAX_FALLBACK_PRICE` limits prompt and completion per million tokens.
- [ ] Re-run the gateway test and then the intelligence test group.
- [ ] Commit the cost-guard fix and regression evidence.

### Task 2: Establish safe local-live evidence state

**Files:**
- Create: `docs/operations/openrouter-live-e2e.md`

- [ ] Revalidate the official OpenRouter chat-completions, structured-output, privacy-routing, and max-price documentation.
- [ ] Check process environment and existing ignored local secret files without printing secret values.
- [ ] If `OPENROUTER_API_KEY` is available, execute at most one synthetic free-primary call through `OpenRouterIntelligenceGateway`, validate non-authoritative structured output, and record safe metadata only.
- [ ] If the key is unavailable, record `BLOCKED_MISSING_LOCAL_SECRET`, zero live HTTP calls, and preserve existing mocked safety evidence.
- [ ] Exercise the privacy admission gate with a transport call counter and record zero outbound calls for synthetic credential-like input.

### Task 3: Audit staging readiness and document Phase 5B

**Files:**
- Create: `docs/operations/staging-readiness.md`
- Modify: `docs/architecture/current-state.md`

- [ ] Audit `wrangler.jsonc`, workflows, migrations, runtime bindings, and deployment runbooks without remote commands.
- [ ] Record isolated staging resource and secret matrices without IDs or values; mark unknown targets explicitly.
- [ ] Record `STAGING_HOSTNAME = DECISION_REQUIRED` unless an approved hostname already exists.
- [ ] Specify a provider-safe Phase 5B smoke plan, including public/auth/app/reminder/connection/AI/security checks.
- [ ] Reconcile current-state truth without claiming a live or staging deployment.

### Task 4: Canonical verification and focused documentation commit

**Files:**
- Modify: only durable files from Tasks 1-3

- [ ] Run focused tests, `pnpm test`, typecheck, lint, build, Wrangler types check, deploy dry run, architecture docs test, and `git diff --check`.
- [ ] Run `pnpm check`.
- [ ] Commit durable docs separately from the cost-guard commit.
