# Formal Pilot launcher implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepare one source-bound FORMAL_PILOT launch without lifting paid HOLD.
**Architecture:** A strict reviewed launch record binds owner message/proposal, source/harness proofs, manifest and physical account inventory. A narrow wrapper uses existing debug execution with a pre-execution callback under the existing account lock; it revalidates all pins and consumes proposal/owner fences before obtaining an inference key. Default missing authority refuses before credential access; no probe, freshRun or mode argument is exposed.
**Tech Stack:** TypeScript/Zod, existing fsynced exclusive records and ledger readers, Vitest.
**Spec:** User October19 approval of CONSERVATIVE_DEBUG_V1, cumulative10000000microunits, UNKNOWN retained; paid HOLD. Preparation proposal in dated local artifacts.

## Global constraints

Application remains b11c7d439ab79467f1e2c843723f4548d0a3e29f; new harness gets a separate exact commit/proof. Preserve wire104, model/provider/privacy/oracle/manifest, retry0/fallbacknone and32scripts/84turns/76healthyrequests/20minutes. No real grants, consumption markers, credentials, provider calls, production changes or ledger writes during preparation.

## Review focus

- Changed source/proof/manifest/inventory/proposal or unreviewed record rejected before key callback.
- Generic debug modes/freshRun injection rejected by strict launch schema.
- Prior proposal/owner consumption or base leaf rejected before key; duplicate concurrent launch serialized under existing lock.
- Credential failure leaves consumed marker and fail-closed lock; no implicit retry/unlock.
- New execution excluded only from baseline inventory revalidation; all other histories still count. UNKNOWN not resolved.

## Task1: one-run launch boundary

- [x] Add synthetic failing tests in tools/benchmark/context-formal-pilot-launcher.test.ts for pins, no approval, consumed/locked state, under-lock recheck and one-run key fence.
- [x] Add tools/benchmark/context-formal-pilot-launcher.ts with strict record validation, immutable trusted pins, preflight and FORMAL_PILOT-only executor.
- [x] Add optional beforeExecution callback to context-debug-loop.ts after under-lock accounting and before mkdir/first request, keeping existing behavior unchanged when absent.
- [x] Run focused tests, typecheck, then full project tests and relevant checks; independent review and fix blockers.
- [x] Freeze clean harness commit/proofs, namespace audit and proposal hashes; document owner paid approval still required and no execution permission created.

## Verification receipt

Full network-outbound/Keychain-denying pnpm check passed:214files,10017tests,2existing optional skips; architecture,typecheck,lint,build,Worker types and Wrangler dry-run passed. Independent review found no C/I blockers. Final source/harness/proposal hashes are recorded after commit in the dated local pilot approval packet; no paid authority is created.
