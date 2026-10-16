# Bounded formal Pilot tooling implementation plan

**Goal:** Run the unchanged formal V12 Pilot after one fresh direct owner grant.
**Architecture:** Separate branded bounded-Pilot authority from single-validation
grants. Bind candidate, harness, physical campaign/account namespace, frozen full
manifest digest, ordered eligible targets, route and confirmed-cost cap. Reuse
actual application fixture runner with narrow per-turn tooling hooks. Persist
exclusive target claim/settlement/outcome records; account lock and consumed owner
message prevent duplicate launch. Crash recovery is conservative: an interrupted
execution remains consumed, no target redispatch or unsafe leapfrogging.
**Stack:** TypeScript/Zod, existing ledger/hash-chain and filesystem fsync.
**Spec:** Owner attachment `97664160-f705-46cf-aba2-db49c9befa29`.

## Constraints

Application bb233e9ee0740a673acebb7523c81b3e5a96b858 remains immutable.
No source/schema/prompt/model/fixtures/config/dependency changes. Pilot only;
stream=false, retry=0, fallback=none, approved model/provider/privacy unchanged.
No credentials/network before fresh paid authorization. Existing $1.50 cap,
zero-dollar durable claims, unchanged one-request headroom and UNKNOWN guard.
No historical accounting/grant rewrite or standalone R01 formal-credit reuse.
Only one tooling commit, then immediate read-only preflight; owner paid gate only.

## Ownership / review focus

`context-bounded-pilot.ts`: deterministic manifest, versioned scope validation,
trusted pins, candidate proof, duplicate/crash fences, target records and physical
HTTP binding. `context-contract-runner.ts`: capture actual fixture/turn identity,
accounting callbacks and first-failure stop without altering application behavior.
`context-contract-probe.ts`: optional tooling before-turn/action callbacks and
explicit deferred-action owner identity. `context-contract.ts`: shared unchanged
action oracle used by immediate stop and final aggregate scoring.
`context-contract-orchestration.test.ts`: coherent clean CLI fixture snapshot of
runner/oracle/probe dependencies; credential and authority assertions unchanged.
`context-contract-live.ts`: backward-compatible BOUNDED_PILOT ledger grammar.
Tests cover foreign/reordered targets, mutated source/manifest, consumed grants,
copied namespaces, cap/UNKNOWN between calls, crash and deferred fixture ordering.

## Execution

- [x] RED: fake formal Pilot confirmed-cost scope fails on current executor.
- [x] Authority characterization: missing authority, scope mismatches and
      duplicate targets reject. The initial authority scaffold preceded these
      tests; this process deviation is not represented as test-first provenance.
- [x] GREEN: implement `deriveBoundedPilotManifest(root)`,
      `createBoundedPilotLoader(trust)`, `prepareBoundedPilot(root,candidate)`,
      `runBoundedPilot(authority,transport)` and trusted live composition.
- [x] Actual fake-transport formal Pilot passes all frozen fixtures;
      first schema/evidence/provider failure stops later targets; settlement
      preserves actual/UNKNOWN, claim is zero, cap cannot reset with new run.
- [x] RED/GREEN safety corrections: immediate action oracle stop, interrupted
      target terminalization, bounded gate-code evidence, and delayed target
      acceptance through R12/R13 actions. No validator/runtime changes.
- [x] Historical regression: single-validation, replay, accounting/ledger tests.
- [x] Verification: focused tests, `pnpm check`, `git diff --check`; no network
      or Keychain. Whole-change independent review C0/I0, fix and reverify.
- [ ] Selective tooling/docs commit; actual loaded candidate/harness proof and
      read-only accounting/schema/target/authority preflight, no claims.
- [ ] Only when READY ask once for manifest-bound Pilot paid authority.
- [ ] After direct approval: bind append-only records, secure inference-key
      metadata gate, ordered formal Pilot, terminal on PASS/first failure.

Focused command: `pnpm test tools/benchmark/context-bounded-pilot.test.ts
tools/benchmark/context-contract-candidate-validation.test.ts
tools/benchmark/context-confirmed-cost.test.ts
tools/benchmark/context-contract-single-replay.test.ts
tools/benchmark/context-contract-live.test.ts
tools/benchmark/context-contract-runner.test.ts`.
Full command: `pnpm check` in network/Keychain-denying local sandbox.

## Recovery and evidence rulings

An abrupt process death leaves consumed authority and the account/ledger lock
fail-closed. There is no automatic launcher resume or unlock. Unsettled ledger
claims remain prospective UNKNOWN; a new grant cannot bypass that guard. A
caught interruption records rejected target terminality without inventing a
settlement. Successful semantic observations with required actions are held
until the owning action oracle passes, including deferred R13 turn 1.

The 76-request full fake test has an explicit 120-second test deadline because
it exercises actual application storage and repeated immutable-source checks;
the production request timeout and campaign time ceiling are unchanged.

Verification and review evidence are recorded in the local progress ledger.
Local acceptance: focused 289 PASS plus CLI orchestration 28 PASS; historical
authority subprocess 32 PASS; full check 156 files / 7980 PASS / 2 existing skips.
Typecheck, lint, docs, build, generated types and deployment dry-run passed in
the external-network/Keychain-denying sandbox. Independent review C0/I0.
No paid authority is created by this plan, readiness, tests or credential
presence. The paid phase starts only from a fresh direct owner message pinned
to the committed harness and frozen manifest.
