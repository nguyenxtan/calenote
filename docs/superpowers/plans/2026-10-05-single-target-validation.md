# Single Target Validation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Independent review follows the complete tooling delta.

**Goal:** Bind one canonical target to fresh owner authority and execute at most one paid attempt.

**Architecture:** Extend candidate-validation authority with a strict versioned target tuple. Reuse immutable application proof, closed loaded-module checks, append-only consumption, confirmed-cost accounting and physical HTTP fencing. Resolve targets from the unchanged canonical Pilot source; reject continuation turns requiring unprovided context instead of manufacturing it.

**Tech Stack:** TypeScript, Zod, Vitest, Node filesystem durability and SQLite application probe.

**Spec:** Owner instruction attachment `a9bae0f8-ef90-4905-a8bf-4d96249003e1`.

## Global Constraints

- Application candidate `bb233e9ee0740a673acebb7523c81b3e5a96b858`; no runtime/schema/prompt/fixture changes.
- One request, retry=0, fallback=none; existing Google Lite EU/ZDR policy.
- CONFIRMED_COST_V1; zero financial claim; historical executions and UNKNOWN remain immutable.
- No credential/network until fresh direct grant after committed read-only readiness.

## Review Focus

- Fresh target pins cannot be read from untrusted authorization itself.
- Canonical digest and target are revalidated before durable consumption.
- Nonzero turns without authoritative preceding context fail closed.
- Consumption remains global per owner message across old/new formats.
- Diagnostic values never retain free text.

## File ownership and interfaces

- `context-contract-candidate-validation.ts`: version 3 scope, target trust pins, readiness and durable terminal record.
- `context-contract-runner.ts`: `resolveSingleValidationTarget(root,target)` and single-target execution using existing complete oracle.
- `context-contract-live.ts`: strict SINGLE_TARGET_VALIDATION ledger grammar and one-call cap.
- `context-contract.ts`: sanitized complete assertion state alongside accepted failure diagnostics.
- Corresponding benchmark tests: target authority, isolation, accounting, crash/duplicate and privacy.

## Execution

- [ ] RED: add version-3 authority and R02-only fake execution tests, mismatched target/manifest/limit, duplicate and exception tests.
- [ ] GREEN: implement strict target authority, canonical resolution, independent harness binding, single request fences and terminal persistence; preserve legacy versions.
- [ ] RED/GREEN: complete safe oracle assertion projection and privacy tests.
- [ ] Run `pnpm exec vitest run tools/benchmark/context-contract-candidate-validation.test.ts tools/benchmark/context-contract-runner.test.ts tools/benchmark/context-contract-live.test.ts tools/benchmark/context-oracle-diagnostics.test.ts` under network/Keychain-denied sandbox.
- [ ] Run network/Keychain-denied `pnpm check` (full tests/docs/typecheck/lint/build/types/dry-run) and `git diff --check`.
- [ ] Independent whole-delta review, resolve Critical/Important, reverify and one local tooling commit.
- [ ] Read-only prepared R02 turn 0 proof/accounting/schema gates; no records/reservation/credential/network.
- [ ] If READY ask once for candidate+harness+target max-one paid authority. Bind only after direct approval.
- [ ] One live attempt, confirmed settlement or UNKNOWN, durable terminal. PASS stops; FAIL permits only proven offline TDD fix/review/commit, never second paid call.

## Ruling

Single-target selection supports independently executable canonical turn-zero fixtures. Later turns are represented but rejected with `SINGLE_TARGET_CONTEXT_REQUIRED` until a separately specified trusted preceding-context mechanism exists. No offline seed or surrounding paid turn is inferred.

## Progress

RED observed: 10 target-capability failures, then missing complete oracle state and missing control projection. GREEN: 206 focused tests across authority, runner, ledger, diagnostics and confirmed-cost accounting. Historical authority regressions remain included. Independent whole-delta review C0/I0; supplemental v3 crash coverage review C0/I0/M0. Historical 778-file snapshot remains byte-identical.

Final full verification after control-state and crash-coverage additions: 157 files / 8009 PASS / 2 existing skips; docs/typecheck/lint/build/types/dry-run PASS (exit 0). Lint remains zero errors with pre-existing warnings. No paid authority, credential access, durable real execution claim or external request. Application/runtime, ProviderWire v12, canonical schemas, prompt, evidence verification and frozen expectations remain unchanged.

Prior full verification: 157 files / 8007 PASS / 2 existing skips, docs/typecheck/lint/build/types/dry-run PASS. Lint has warnings but zero errors; newly introduced unused bindings were removed.
