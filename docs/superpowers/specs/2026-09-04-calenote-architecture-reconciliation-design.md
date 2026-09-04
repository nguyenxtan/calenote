# Calenote architecture reconciliation design

## Status and scope

This design begins after the reviewed Task 9 checkpoint (`8498c27`). It covers
architecture reconciliation only: current-state truth, explicit D1 ownership,
composition, and local engineering gates. It intentionally does not deploy,
change an applied migration, introduce Gmail/Microsoft credentials, or add an
LLM, billing, mobile, team, couple, recurrence, or finance behavior.

Calenote remains a modular monolith. Zalo and Telegram are the daily front
door; the Worker is the brain; the Web application is a premium control plane.
The existing Queue, Cron, D1, encrypted credentials, session, and guarded
state-transition behavior are production invariants, not placeholders.

## Current-state truth

The Worker currently owns real HTTP routing, inbound Queue dispatch, reminder
delivery, login-code delivery, and the three independent Cron lanes. D1 is the
canonical store. The Web application is a static export served by Worker
assets, and browser interactions use the authenticated same-origin API.

The code is tested locally but has not been deployed or proven end-to-end with
a real private Zalo/Telegram chat. Therefore code and test evidence must never
be presented as deployment or chat E2E evidence.

## Architectural decision

Keep existing vertical feature modules while introducing explicit
`infrastructure/d1` ownership inside the features that currently mix D1 SQL
with application orchestration. This is a deliberate transitional structure;
it avoids a broad `src/modules` to `src/features` move before the risky
concurrency behavior is covered by focused tests.

Each application service depends on a narrow store/port interface. D1 classes
implement those interfaces and own SQL, row mapping, D1 batches, and guarded
compare-and-set statements. Application services own use-case sequencing,
state-machine policy, provider-operation classification, and safe user copy.
Provider adapters stay behind the existing channel contracts. The Worker is
the sole composition root for production dependencies.

The first reconciliation target is:

```text
src/modules/
  auth/
    application/                # login/session use cases and ports
    infrastructure/d1/          # login, session, dashboard stores
  inbound/
    application/                # webhook and queue processing use cases
    infrastructure/d1/          # inbound stores; no inheritance from reminders
  reminders/
    application/                # parser, command, API, scheduler, delivery logic
    infrastructure/d1/          # command, API, scheduler, delivery stores
  onboarding/
    application/                # onboarding/recovery/retry use cases
    infrastructure/d1/          # onboarding store
  connections/
    infrastructure/             # Zalo/Telegram adapters
  shared/                       # only future shared code with real multi-feature ownership
src/worker/
  composition-root.ts           # binds Env to all concrete adapters
  routes/                       # HTTP boundary
  index.ts                      # fetch/queue/cron entrypoints only
```

Existing public import paths may keep compatibility re-exports for one slice
only when moving them all at once would blur the behavior under review. New
code must import the owned location directly; compatibility re-exports are
removed in the following focused slice.

## Dependency rules

1. UI calls only same-origin Worker contracts; it never reads D1 or provider
   credentials.
2. Application code consumes ports and business types, never `env.DB.prepare`.
3. D1 classes own SQL and are constructed only by `src/worker/composition-root.ts`
   in production code.
4. Domain/application modules do not import React, Next.js, Worker bindings,
   Cloudflare D1, Zalo, Telegram, Gmail, Microsoft, or an LLM vendor.
5. The Worker may import application modules and concrete infrastructure; no
   feature may import the Worker.
6. Queue messages remain opaque IDs and consumers reload canonical D1 state.

## Safety invariants

The refactor must preserve, with existing focused tests kept intact:

- tenant/owner fencing for every read and guarded mutation;
- encrypted bot and login credentials, HttpOnly secure sessions, code expiry,
  revocation, recovery fences, and rate limits;
- bounded body handling and same-origin browser mutations;
- webhook authentication, dedupe, idempotent Queue processing, tiny queue
  payloads, bounded retry, and no raw chat/credential logging;
- reminder claim/send/cancel first-winner semantics and terminal `UNCERTAIN`
  handling after ambiguous provider egress;
- independent Cron lanes for due reminders, inbound orphan redrive, and login
  code redrive;
- static Web output and no personal-data flash before session confirmation.

No applied migration is edited for architecture cleanup. New migrations require
an actual domain-model change and a separate design decision.

## Documentation and governance

`docs/architecture/current-state.md` becomes the canonical capability map and
uses exactly `IMPLEMENTED`, `WIRED`, `TESTED`, `E2E_PROVEN`, `DEPLOYED`, and
`PLANNED`. Historical plans remain audit evidence but do not override it.

Concise ADRs record chat-first product shape, premium Web control plane,
modular-monolith/D1 persistence, encrypted BYOB credentials, deterministic
first intelligence, and the Figma brand source. They record decisions, not
aspirational feature claims.

## Completion criteria for this slice

- No D1 store inherits from a different feature's store merely to obtain a
  database handle.
- Each moved store has one explicit feature-owned D1 home and its old tests
  still exercise the same race/ownership behavior.
- Production `Env` construction happens in one named composition root.
- `pnpm check` runs the complete, sequential local gate: tests, typecheck,
  lint, static build, Worker types, and Wrangler dry-run.
- A fresh migrated local D1/workerd test remains part of the suite.
- Git status is scoped and `git diff --check` passes before each checkpoint.

## Deferred, intentional next slices

After this architecture slice is reviewed: integrate the approved Figma assets
without recreating the logo; refine the chat-first Web control plane; then add
the minimal SourceConnection/SourceItem/ActionCandidate/ActionDecision
foundation. Gmail and Microsoft authorization begin only after the Source/
Action approval boundary exists. Optional intelligence stays provider-agnostic,
deterministic-first, bounded, and disabled by default.
