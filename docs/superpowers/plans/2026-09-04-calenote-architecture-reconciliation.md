# Calenote Architecture Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make current production behavior legible and maintainable by isolating D1 persistence, removing cross-feature store inheritance, and introducing one Worker composition root without changing Calenote behavior.

**Architecture:** Preserve the existing modular monolith and its guarded state machines. Move a feature's D1 implementation beside that feature behind its existing port, then update imports and prove behavioral equivalence with the current focused/race suites. The Worker composition root creates concrete adapters; HTTP, Queue, and Cron entrypoints only delegate.

**Tech Stack:** TypeScript, React/Next static export, Cloudflare Workers, D1/SQLite, Queues, Vitest, Miniflare/workerd, Wrangler.

**Spec:** `docs/superpowers/specs/2026-09-04-calenote-architecture-reconciliation-design.md`

## Global Constraints

- Preserve Task 8 ownership, recovery, rate-limit, queue, scheduler, and `UNCERTAIN` invariants exactly.
- Do not deploy, call a real provider, read external credentials, or edit applied migrations.
- Do not introduce a vendor LLM, Gmail/Microsoft OAuth, billing, teams, couples, finance, recurrence, mobile, or a database migration.
- Add behavior tests before any behavior fix; pure moves must preserve existing test coverage and add import/composition assertions only where necessary.
- Never log or return tokens, codes, raw chat text, cookies, encrypted columns, or webhook paths.
- Run all verification sequentially. Keep the controller-owned production plan change out of feature commits unless intentionally committed as documentation.

---

### Task 1: Establish canonical current-state documentation and ADRs

**Files:**
- Create: `docs/architecture/current-state.md`
- Create: `docs/architecture/adr/0001-chat-first-premium-web.md`
- Create: `docs/architecture/adr/0002-modular-monolith-d1.md`
- Create: `docs/architecture/adr/0003-encrypted-byob-credentials.md`
- Create: `docs/architecture/adr/0004-deterministic-first-intelligence.md`
- Create: `docs/architecture/adr/0005-figma-brand-source.md`
- Modify: `README.md`

**Interfaces:**
- Produces the only current capability/status source for later docs and release runbooks.
- Uses status words `IMPLEMENTED`, `WIRED`, `TESTED`, `E2E_PROVEN`, `DEPLOYED`, and `PLANNED` exactly.

- [ ] **Step 1: Write a failing documentation-contract test**

Add `docs/architecture/current-state.test.mjs` that reads the document and
asserts it has each status word, names the three live code lanes
`PROCESS_INBOUND`, `DELIVER_REMINDER`, `DELIVER_LOGIN_CODE`, and states that
deployment and chat E2E are not proven.

- [ ] **Step 2: Run the documentation test to verify it fails**

Run: `node --test docs/architecture/current-state.test.mjs`

Expected: FAIL because `current-state.md` does not exist.

- [ ] **Step 3: Write the canonical document and ADRs**

Document the Worker/router/Queue/Cron/D1/Web boundaries as observed in source.
Each ADR contains Context, Decision, Consequences, and Status. The Figma ADR
names `https://www.figma.com/design/956x39sa3514NSz8BVXnRQ` and prohibits
recreating the approved logo from screenshots.

- [ ] **Step 4: Run the documentation test to verify it passes**

Run: `node --test docs/architecture/current-state.test.mjs`

Expected: PASS with no capability claim beyond local test evidence.

- [ ] **Step 5: Commit documentation truth**

```bash
git add README.md docs/architecture
git commit -m "docs: establish Calenote current architecture"
```

### Task 2: Separate reminder D1 stores from application services

**Files:**
- Create: `src/modules/reminders/infrastructure/d1/api-store.ts`
- Create: `src/modules/reminders/infrastructure/d1/command-store.ts`
- Create: `src/modules/reminders/infrastructure/d1/delivery-store.ts`
- Create: `src/modules/reminders/infrastructure/d1/scheduler-store.ts`
- Modify: `src/modules/reminders/api-service.ts`
- Modify: `src/modules/reminders/command-service.ts`
- Modify: `src/modules/reminders/delivery.ts`
- Modify: `src/modules/reminders/scheduler.ts`
- Modify: imports in `src/worker/router.ts`, `src/worker/index.ts`, and focused reminder tests

**Interfaces:**
- Consumes the current `ReminderApiStore`, `ReminderCommandStore`,
  `ReminderDeliveryStore`, and `ReminderSchedulerStore` interfaces.
- Produces the same four named D1 implementations at feature-owned paths; SQL,
  D1 batch boundaries, row mapping, and guarded transitions move unchanged.

- [ ] **Step 1: Add an import-boundary test**

Create `src/modules/reminders/infrastructure/d1/import-boundary.test.ts` that
imports each new D1 class and checks its exported constructor accepts a D1-like
database. Do not mock state transitions; existing service tests remain the
behavior proof.

- [ ] **Step 2: Run the import-boundary test to verify it fails**

Run: `pnpm vitest run src/modules/reminders/infrastructure/d1/import-boundary.test.ts`

Expected: FAIL because the infrastructure modules do not exist.

- [ ] **Step 3: Move D1 classes without changing SQL semantics**

Move `D1ReminderApiStore`, `D1ReminderCommandStore`,
`D1ReminderDeliveryStore`, and `D1ReminderSchedulerStore` into the four new
files. Keep port types and application functions in their original service
files. Update Worker construction and tests to import the new concrete paths.
Do not change a SQL predicate, transaction/batch order, retry limit, or
ownership check in this task.

- [ ] **Step 4: Run focused reminder gates**

Run: `pnpm vitest run src/modules/reminders/api-service.test.ts src/modules/reminders/command-service.test.ts src/modules/reminders/delivery.test.ts src/modules/reminders/scheduler.test.ts src/modules/db/d1-workerd.integration.test.ts`

Expected: PASS; lifecycle, cancel/send race, ownership, and real D1 behavior
remain unchanged.

- [ ] **Step 5: Commit reminder persistence ownership**

```bash
git add src/modules/reminders src/worker/index.ts src/worker/router.ts
git commit -m "refactor: isolate d1 reminder repositories"
```

### Task 3: Remove inbound-to-reminder persistence inheritance

**Files:**
- Create: `src/modules/inbound/infrastructure/d1/processor-store.ts`
- Create: `src/modules/inbound/infrastructure/d1/webhook-store.ts`
- Modify: `src/modules/inbound/processor.ts`
- Modify: `src/modules/inbound/webhook.ts`
- Modify: `src/worker/index.ts`
- Modify: `src/worker/router.ts`
- Modify: `src/modules/inbound/processor.test.ts`
- Modify: `src/modules/inbound/webhook.test.ts`

**Interfaces:**
- Consumes `InboundProcessorStore` and `InboundWebhookStore` ports.
- Produces D1 implementations composed with an injected database, never a
  subclass of a reminder D1 store.

- [ ] **Step 1: Write a failing structural test**

Add a focused test that imports `D1InboundProcessorStore` and asserts it is
constructible with a D1 database while `Object.getPrototypeOf` does not equal
the reminder command-store prototype.

- [ ] **Step 2: Run the structural test to verify it fails**

Run: `pnpm vitest run src/modules/inbound/processor.test.ts`

Expected: FAIL until the class is moved/composed.

- [ ] **Step 3: Extract inbound D1 stores through composition**

Move inbound SQL and row mapping into the two inbound-owned D1 files. Pass a
database dependency directly; share only explicit helper functions where the
same SQL mapping is genuinely identical. Preserve inbound lease, dedupe,
private-chat authorization, command ordering, and ID-only Queue behavior.

- [ ] **Step 4: Run focused inbound and cross-lane gates**

Run: `pnpm vitest run src/modules/inbound/processor.test.ts src/modules/inbound/webhook.test.ts src/modules/reminders/command-service.test.ts src/worker/index.test.ts`

Expected: PASS; no cross-feature inheritance remains and Queue dispatch still
uses canonical inbound IDs.

- [ ] **Step 5: Commit inbound ownership**

```bash
git add src/modules/inbound src/modules/reminders src/worker/index.ts src/worker/router.ts
git commit -m "refactor: compose inbound persistence boundaries"
```

### Task 4: Create the Worker composition root

**Files:**
- Create: `src/worker/composition-root.ts`
- Create: `src/worker/composition-root.test.ts`
- Modify: `src/worker/index.ts`
- Modify: `src/worker/router.ts`
- Modify: `src/worker/index.test.ts`
- Modify: `src/worker/router.test.ts`

**Interfaces:**
- Consumes `Env`, feature ports, concrete D1 stores, provider adapters, and the
  keyring.
- Produces `createRuntimeOperations(env)`, `createWorkerOperations(env)`, and
  `createWebhookOperations(env)` as named composition functions used by Worker
  entrypoints/routes.

- [ ] **Step 1: Write a failing composition test**

Create a test with a valid fake `Env` asserting the composition root returns
objects exposing exactly the queue, Cron, authenticated route, and webhook
operations currently expected by `index.ts` and `router.ts`. Add an invalid
binding case that preserves the safe 503 route behavior.

- [ ] **Step 2: Run the composition test to verify it fails**

Run: `pnpm vitest run src/worker/composition-root.test.ts`

Expected: FAIL because no composition root exists.

- [ ] **Step 3: Move construction only**

Move environment validation, keyring construction, concrete store creation,
and adapter wiring into `composition-root.ts`. Keep `index.ts` responsible only
for fetch/queue/scheduled event delegation and `router.ts` responsible only for
route matching/response mapping. Do not change public routes, error responses,
Queue message types, or Cron `Promise.allSettled` behavior.

- [ ] **Step 4: Run Worker regression gates**

Run: `pnpm vitest run src/worker/index.test.ts src/worker/router.test.ts src/worker/routes/api-contract.test.ts src/worker/routes/webhooks.test.ts src/modules/db/d1-workerd.integration.test.ts`

Expected: PASS including readiness, route contracts, webhook verification, and
real D1 transactional tests.

- [ ] **Step 5: Commit the composition root**

```bash
git add src/worker src/modules
git commit -m "refactor: centralize Worker composition"
```

### Task 5: Add a single sequential local gate and reconcile root hygiene

**Files:**
- Modify: `package.json`
- Create: `scripts/check.mjs`
- Create: `scripts/check.test.mjs`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `docs/runbooks/local-development.md`

**Interfaces:**
- Produces `pnpm check`, which runs test, typecheck, lint, build, Worker type
  validation, and Wrangler dry-run one command at a time with the current
  package-manager invocation.

- [ ] **Step 1: Write a failing script-contract test**

Add `scripts/check.test.mjs` that imports the script command list and expects
the exact ordered commands `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm
build`, `pnpm exec wrangler types --check`, and `pnpm exec wrangler deploy
--dry-run`.

- [ ] **Step 2: Run the script-contract test to verify it fails**

Run: `node --test scripts/check.test.mjs`

Expected: FAIL because the command list and `pnpm check` do not exist.

- [ ] **Step 3: Implement the sequential gate**

Export the immutable command list from `scripts/check.mjs`, execute each with
`spawnSync(process.execPath, ...)` only after mapping the `pnpm` command to the
current package-manager executable, and terminate on the first non-zero exit.
Add `"check": "node scripts/check.mjs"` to `package.json`. Ignore only local
secrets/build/runtime artifacts; do not move `.superpowers` without proving it
is inactive tooling state.

- [ ] **Step 4: Run the script test and complete gate**

Run: `node --test scripts/check.test.mjs`

Run: `pnpm check`

Expected: PASS. The output documents each real command and no deploy occurs
because the final Wrangler command has `--dry-run`.

- [ ] **Step 5: Commit engineering gate**

```bash
git add package.json scripts .gitignore README.md docs/runbooks/local-development.md
git commit -m "chore: add Calenote verification gate"
```

### Task 6: Reconcile architecture evidence and prepare the next bounded phase

**Files:**
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/domain-model.md`
- Modify: `docs/architecture/system-overview.md`
- Create: `docs/architecture/dependency-map.md`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Produces a truthful post-refactor map and marks Brand, Sources, Actions,
  Gmail/Microsoft, and optional intelligence as planned until their own code
  and tests exist.

- [ ] **Step 1: Write a failing documentation assertion**

Extend `docs/architecture/current-state.test.mjs` to require a dependency map
and explicit `PLANNED` statements for Source/Action, Gmail/Microsoft, and
provider-agnostic intelligence.

- [ ] **Step 2: Run the documentation test to verify it fails**

Run: `node --test docs/architecture/current-state.test.mjs`

Expected: FAIL until the dependency map and deferred boundaries exist.

- [ ] **Step 3: Write the reconciled evidence**

Map UI -> Worker routes -> application ports -> D1/provider adapters. State
that current `modules` are a transitional modular-monolith layout and no empty
future folders were created. Record the next phase: export approved Figma
assets, then build the Source/Action approval foundation.

- [ ] **Step 4: Run the release-candidate local verification**

Run: `pnpm check`

Run: `git diff --check`

Run: `git status --short`

Expected: all checks pass and only intended documentation changes are present.

- [ ] **Step 5: Commit architecture reconciliation**

```bash
git add docs/architecture docs/roadmap.md
git commit -m "docs: reconcile Calenote architecture boundaries"
```
