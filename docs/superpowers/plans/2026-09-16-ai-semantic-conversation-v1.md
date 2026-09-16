# Calenote AI Semantic Conversation V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a provider-neutral, AI-semantic reminder interpreter that preserves deterministic safety and user-confirmed canonical mutations.

**Architecture:** Controls and state guards resolve locally; remaining semantic input is interpreted by one free and at most one cheap paid model through a strict JSON Schema contract. Zod and business validation turn an accepted semantic object into a bounded query, encrypted clarification, or existing draft/confirmation lifecycle.

**Tech Stack:** TypeScript, Zod, Cloudflare Workers, D1, Queues, Vitest, OpenRouter structured outputs.

**Spec:** `docs/superpowers/specs/2026-09-16-ai-semantic-conversation-v1-design.md`

## Global Constraints

- `AI_MODE` is `off | semantic`; maximum calls per inbound is exactly two.
- No model gets D1, provider credentials, internal IDs, tools, authorization, scheduling, or mutation authority.
- Preserve Zalo ingress/authentication/encryption/BLOB/Queue/bound-chat and existing draft confirmation behavior.
- Model selection requires current official capability/privacy/price evidence and the synthetic benchmark; no model is configured by this plan.
- Migration is additive/forward-only and is not applied without separate production authorization.
- Never log user text, model payloads, titles, identities, codes, credentials, webhook material, or encrypted values.

## File map

| Path | Responsibility |
| --- | --- |
| `src/modules/semantic/contracts.ts` | Zod union, JSON Schema, safe result categories, semantic context types. |
| `src/modules/semantic/service.ts` | Guard-first orchestration, two-tier bounded routing, Zod/business validation. |
| `src/modules/semantic/validation.ts` | Local date/time, title, range, horizon, and clarification validation. |
| `src/modules/semantic/infrastructure/d1/context-store.ts` | Encrypted bounded context lifecycle and idempotency. |
| `src/modules/semantic/benchmark/*.json` | 200+ synthetic inputs and expected strict objects. |
| `src/modules/intelligence/infrastructure/openrouter/*` | Semantic-only request, strict provider preferences, price/cost controls. |
| `src/modules/reminders/command-service.ts` | Consume validated semantic create/query/clarification outcomes while retaining draft confirmation authority. |
| `migrations/0005_semantic_context.sql` | Reviewed future additive context persistence; do not apply during docs phase. |

### Task 1: Freeze the contract and synthetic benchmark

**Files:** Create `src/modules/semantic/contracts.ts`, `src/modules/semantic/contracts.test.ts`, `src/modules/semantic/benchmark/semantic-v1.json`; modify no runtime integration yet.

- [ ] Write Zod tests rejecting extra properties, unknown intent, non-Vietnam timezone, malformed local fields, unbounded clarification fields, and model prose.
- [ ] Add strict JSON Schema generated from the Zod-owned contract with `additionalProperties: false` for every union arm.
- [ ] Add 200+ synthetic records spanning all required Vietnamese categories; each fixes reference time, expected object, prior minimal context, and accept/reject expectation.
- [ ] Run `pnpm exec vitest run src/modules/semantic/contracts.test.ts` and a fixture-count assertion requiring `>= 200`.
- [ ] Commit `test(semantic): freeze strict contract and benchmark fixture`.

### Task 2: Implement application-owned semantic validation

**Files:** Create `src/modules/semantic/validation.ts`, `src/modules/semantic/validation.test.ts`.

- [ ] Test conversion of valid `localDate` + `localTime` in `Asia/Ho_Chi_Minh`, invalid calendar/time values, past-at-processing cases, horizon/title limits, and all permitted list ranges.
- [ ] Implement pure validators returning a typed accepted create/query/clarification outcome or a local safe clarification/help category.
- [ ] Assert a model epoch, ownership, SQL, provider, or identifier field cannot enter the contract or validator.
- [ ] Run focused tests and commit `feat(semantic): validate local semantic values in backend`.

### Task 3: Add encrypted semantic context persistence

**Files:** Create reviewed `migrations/0005_semantic_context.sql`, `src/modules/semantic/infrastructure/d1/context-store.ts`, and tests.

- [ ] Write failing D1 tests for one pending context per bound chat, encrypted user-derived slots, source/resolution idempotency, TTL expiry, cancellation, and restart-safe reread.
- [ ] Implement the additive table/store only after migration review; do not copy recovery migration wholesale.
- [ ] Verify migration idempotence and forward-only remediation behavior in disposable integration storage.
- [ ] Commit `feat(semantic): persist bounded encrypted clarification context`.

### Task 4: Implement bounded model routing

**Files:** Modify `src/modules/intelligence/*`; create `src/modules/semantic/service.ts` and tests.

- [ ] Test `off` makes zero calls; `semantic` tries eligible free once; unavailable/provider/invalid-schema free outcome permits one paid fallback; no third call is possible.
- [ ] Build strict non-streaming JSON-schema requests with required parameter support, data-collection denial, optional ZDR, bounded input/output, timeout, and explicit configured model/provider only.
- [ ] Enforce per-user/day, per-user/month, global/day, and price-cap checks before the paid call; return safe local help/clarification when blocked.
- [ ] Record only safe request/tier/model/provider/latency/result/schema/fallback/usage-cost metadata.
- [ ] Run focused tests and commit `feat(semantic): add bounded free-to-paid interpretation routing`.

### Task 5: Integrate semantic outcomes without changing mutation authority

**Files:** Modify `src/modules/reminders/command-service.ts`, `src/modules/inbound/processor.ts`; add focused tests.

- [ ] Test deterministic `/connect`, confirmation, cancellation, help, dedupe, and ownership bypass the model.
- [ ] Test accepted create becomes exactly one existing encrypted draft, query remains owner-scoped/read-only/bounded, and clarification persists only through the application store.
- [ ] Test confirmation alone creates one reminder; invalid/failing AI terminalizes inbound safely without a retry storm or duplicate mutation.
- [ ] Run focused inbound/reminder/semantic tests and commit `feat(semantic): apply validated outcomes through canonical lifecycle`.

### Task 6: Benchmark and selection evidence

**Files:** Create `docs/benchmarks/ai-semantic-conversation-v1-results.md` and a reproducible runner outside production paths.

- [ ] Run only the synthetic fixture against candidate models after explicit spend authorization; do not use production data.
- [ ] Record capability, provider, privacy/ZDR evidence date, limits, prices, metrics, and fail/pass thresholds without prompts or responses.
- [ ] Select free/paid config only when every gate passes; otherwise configure `off` or approved paid-only semantic mode.
- [ ] Commit benchmark evidence separately from runtime configuration.

### Task 7: Full verification and review checkpoint

**Files:** No product-scope expansion.

- [ ] Run focused suites, `pnpm check`, `git diff --check`, migration integration coverage, and a static scan for unsafe observability.
- [ ] Obtain review for the exact model evidence, migration, privacy routing, and cost gates before any production deploy or live semantic call.
- [ ] Commit only reviewed files; do not deploy, migrate production, rotate secrets, or contact a provider without separate authorization.

## Plan self-review

The tasks cover strict union/schema, semantic versus deterministic authority,
two-call free/paid policy, backend time/query/mutation validation, encrypted
multiturn state, benchmark, cost/privacy gates, safe observability, migration
review, and regression verification. They deliberately exclude provider waiting
UX, Telegram, duplicate-connect work, and `ACTIVE_BOUND` UI synchronization.
