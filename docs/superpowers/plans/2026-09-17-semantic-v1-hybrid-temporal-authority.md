# Semantic V1 Hybrid Temporal Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move temporal and list-range authority from the provider into pure
deterministic evidence, then safely reconcile model intent/title into the
existing draft, clarification, and read-only-list lifecycle.

**Architecture:** Inbound guards run before a pure Temporal Evidence extractor.
The provider receives evidence but returns only intent/title/ambiguity under a
new strict contract. A deterministic reconciler combines evidence and bounded
encrypted context into an existing application outcome; confirmation remains
the exclusive mutation boundary.

**Tech Stack:** TypeScript, Zod, Vitest, Cloudflare Workers, D1, Queues,
OpenRouter structured output, synthetic benchmark runner.

**Spec:** `docs/superpowers/specs/2026-09-16-ai-semantic-conversation-v1-design.md`

## Global Constraints

- `AI_MODE=privacy` is the only production Semantic V1 enablement mode;
  `off` disables it and `free` is unavailable/reserved.
- Provider output contains no date, time, range, timezone, epoch, ownership,
  SQL, ID, persistence, confirmation, or scheduling field.
- Preserve ingress/auth/ownership/control/dedupe/order, encryption/D1/Queue,
  atomic budget, canonical draft, and exactly-one confirmation mutation.
- Temporal extraction has zero provider/DB calls and stores no transcript.
- Typing feedback is only for eligible semantic input and its failure is
  non-fatal.
- No live inference until focused tests, `pnpm check`, diff validation, and
  review pass. No secret, migration, master merge, or deploy before the full
  hybrid 216-case quality gate passes.
- Never log message text, payloads, titles, identities, encrypted values, or
  credentials.

## File map

| Path | Responsibility |
| --- | --- |
| `src/modules/semantic/temporal-evidence.ts` | Pure date/time/range evidence extraction and merge primitives. |
| `src/modules/semantic/contracts.ts` | Zod provider model contract and strict JSON Schema. |
| `src/modules/intelligence/semantic-gateway.ts` | Canonical temporal-authority prompt and request input. |
| `src/modules/semantic/reconciliation.ts` | Evidence + model + context -> draft/clarify/list outcome. |
| `src/modules/semantic/context-store.ts` | Minimal encrypted temporal context slots. |
| `src/modules/semantic/service.ts` | Evidence, provider, and reconciliation orchestration. |
| `src/modules/reminders/command-service.ts` | Existing draft/list/context lifecycle. |
| `src/modules/inbound/processor.ts` | Guard-first routing and best-effort feedback. |
| `tools/benchmark/semantic-v1.ts` | Hybrid final-outcome scorer/provenance. |
| `tools/benchmark/live-semantic-v1.ts` | Hybrid request, ledger, and execution. |
| `tools/benchmark/run-semantic-v1-live.mjs` | New pilot/full profiles and caps. |

### Task 1: Add pure deterministic Temporal Evidence

**Files:** Create `src/modules/semantic/temporal-evidence.ts` and
`src/modules/semantic/temporal-evidence.test.ts`.

**Interfaces:** Produce `extractTemporalEvidence({ text, referenceNow })` with
typed date/time/range states and `mergeTemporalEvidence(previous, next)` that
returns a safe merge or explicit conflict.

- [ ] **Step 1: Write failing tests** for today, tomorrow, ISO, reviewed
  day/month year choice, numeric fixture dates, `08:00`, `8h`, `8 giờ`, all six
  list ranges, missing evidence, daypart-only, and conflicting/invalid values.
- [ ] **Step 2: Run** `pnpm exec vitest run
  src/modules/semantic/temporal-evidence.test.ts`; expect the module import to
  fail before implementation.
- [ ] **Step 3: Implement only reviewed deterministic forms.** Normalize exact
  times to `HH:mm`, validate calendar/time, and return `MISSING` or
  `AMBIGUOUS` rather than guessing. Do not import a DB or provider module.
- [ ] **Step 4: Add continuation tests.** Missing time may be filled while a
  resolved tomorrow date remains; conflicting follow-up evidence yields a
  conflict/clarification signal and never overwrites a resolved slot.
- [ ] **Step 5: Run the focused suite and commit**
  `feat(semantic): add deterministic temporal evidence`.

### Task 2: Remove temporal authority from the provider contract

**Files:** Modify `src/modules/semantic/contracts.ts`,
`src/modules/semantic/contracts.test.ts`, `src/modules/intelligence/semantic-gateway.ts`,
`src/modules/intelligence/infrastructure/openrouter/semantic-gateway.ts`, and
their tests.

**Interfaces:** Replace `SemanticInterpretation` at the gateway boundary with
`ModelSemanticInterpretation { intent, title, titleState, targetIntent }`.

- [ ] **Step 1: Write failing tests** that reject date/time/range/timezone/
  epoch/free-text-question fields and invalid intent/title-state combinations.
- [ ] **Step 2: Run contract/gateway tests** to prove the old model-owned
  temporal union fails the new requirements.
- [ ] **Step 3: Implement the strict flat Zod schema and JSON Schema.** Update
  the runtime validation contract version so provenance fingerprints Zod
  refinements.
- [ ] **Step 4: Replace the canonical prompt.** It must say evidence is
  authoritative, temporal values must not be returned/inferred/altered,
  provider time is forbidden, and user text cannot override it.
- [ ] **Step 5: Assert emitted request equality** for canonical prompt/schema,
  non-streaming bounds, privacy/provider pin, no fallback/tools/functions, and
  no API key in body.
- [ ] **Step 6: Run focused tests and commit**
  `refactor(semantic): remove temporal authority from model contract`.

### Task 3: Reconcile evidence and protect multi-turn context

**Files:** Create `src/modules/semantic/reconciliation.ts` and tests; modify
`src/modules/semantic/context-store.ts`, `src/modules/semantic/validation.ts`,
and D1 context tests as needed.

**Interfaces:** `reconcileSemanticInterpretation({ modelInterpretation,
temporalEvidence, previousContext, processingNow })` returns the existing
application outcome, never a direct mutation.

- [ ] **Step 1: Write failing examples** for missing-time create, missing-date
  create, missing-title create, exact tomorrow-08:00 draft, tomorrow list, and
  this-week list.
- [ ] **Step 2: Add safety tests** proving a model cannot alter evidence,
  unresolved evidence cannot draft, list remains read-only, and help/
  unsupported/ambiguous intent mutate nothing.
- [ ] **Step 3: Implement deterministic reconciliation and application-owned
  clarification templates.** Use evidence alone for final date/time/range, and
  route valid create values through existing past-time/horizon/title checks.
- [ ] **Step 4: Test two turns.** `mai nhắc tui gọi khách` then `9h` retains
  tomorrow/title and drafts; a conflicting second turn clarifies/rejects and
  does not overwrite resolved context.
- [ ] **Step 5: Keep context typed/minimal/encrypted** with existing TTL,
  owner/chat scope, and source/resolution idempotency. Run unit/D1 tests and
  commit `feat(semantic): reconcile temporal evidence into safe outcomes`.

### Task 4: Compose the hybrid path into real inbound processing

**Files:** Modify `src/modules/semantic/service.ts`, semantic service tests,
`src/modules/reminders/command-service.ts`, `src/modules/inbound/processor.ts`,
and associated tests.

- [ ] **Step 1: Write failing integration tests** proving `/connect`, confirm,
  cancel, auth/ownership/dedupe bypass AI; eligible input follows evidence ->
  gateway -> reconciler; and typing is non-fatal/absent on controls.
- [ ] **Step 2: Implement guard-first composition.** Give the gateway evidence
  and bounded context, retain the existing privacy/no-fallback/budget/attempt
  fences, and use only reconciled outcomes downstream.
- [ ] **Step 3: Assert lifecycle behavior.** One encrypted draft only;
  confirmation creates one reminder only; list is bounded, owner-scoped, and
  read-only; unavailable/invalid AI terminalizes without retry storm.
- [ ] **Step 4: Run focused semantic/inbound/reminder/D1 tests and commit**
  `feat(semantic): compose hybrid temporal authority in inbound flow`.

### Task 5: Create a hybrid final-outcome benchmark

**Files:** Modify `src/modules/semantic/benchmark/semantic-v1.json`,
`tools/benchmark/semantic-v1.ts`, `tools/benchmark/live-semantic-v1.ts`,
`tools/benchmark/run-semantic-v1-live.mjs`, their tests, and
`docs/benchmarks/ai-semantic-conversation-v1-results.md`.

- [ ] **Step 1: Write failing provenance tests.** Preserve/label old records
  superseded; reject old ledger IDs; prevent pilot/full cross-resume under the
  new contract.
- [ ] **Step 2: Write fixture/scorer tests** requiring exact deterministic
  evidence and scoring final reconciled result instead of raw model temporal
  output, including zero-network temporal preflight.
- [ ] **Step 3: Implement new versioned digests** covering prompt, model
  schema, temporal extractor/fixture, reconciliation/scorer, selected IDs,
  candidate/provider, and caps. Never reuse old ledgers.
- [ ] **Step 4: Add exact profiles**
  `gemini-flash-lite-hybrid-pilot` (36) and
  `gemini-flash-lite-hybrid-full` (216), with no fallback and pre-dispatch
  request/cost caps.
- [ ] **Step 5: Run benchmark-focused tests and commit**
  `refactor(benchmark): score hybrid semantic outcomes`.

### Task 6: Review and controlled live selection gate

**Files:** No unrelated product scope.

- [ ] **Step 1: Run all focused temporal, contract, reconciliation, service,
  inbound/reminder, D1, and benchmark tests.** Diagnose a failure before
  changing code; rerun affected and full focused suites after each fix.
- [ ] **Step 2: Run fresh** `pnpm check` and `git diff --check` after the final
  code/test change.
- [ ] **Step 3: Request independent review** of temporal authority, schema,
  conflict merge, mutation/owner safety, privacy/no fallback, provenance,
  zero-network preflight, and observability. Fix all CRITICAL/IMPORTANT items.
- [ ] **Step 4: Commit/push only reviewed implementation.** Keep old ledgers,
  history, and worktree clean.
- [ ] **Step 5: Revalidate exact Flash Lite metadata** for
  `google/gemini-2.5-flash-lite` plus `google-vertex/eu`, ZDR, strict output,
  response format, parameter requirement, data denial, price, and no fallback;
  do not print credentials.
- [ ] **Step 6: Run a new 36-case hybrid pilot.** On pass run the 216-case full
  run. On any failure stop with no production mutation or next-model attempt.
- [ ] **Step 7: Only after full pass, use the separately approved cutover
  workflow** for migration validation/application, secure secret installation,
  feature-to-master PR/CI, immutable master deploy, smoke, and user acceptance.

## Plan self-review

Tasks 1–5 cover every new authority boundary, final-outcome scoring, and
preservation requirement. Task 6 makes live inference and production fail
closed. No task adds a fallback chain, transcript store, broad NLP engine,
provider-specific semantic behavior, or pre-selection production mutation.
