# Semantic completeness implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline; one independent final review. Owner explicitly authorized continuous spec → plan → implementation → live acceptance without routine handoff pauses.

**Goal:** Reject grounded location omissions before merge without backend value creation.
**Architecture:** A pure bounded coverage predicate consumes source-map validated current source and existing resolved changes/alternatives. Evidence validation invokes it before issuing the branded patch. Existing safe rejection remains authoritative.
**Tech Stack:** TypeScript, Zod, Vitest, existing D1/service harness.
**Spec:** `docs/superpowers/specs/2026-10-07-semantic-completeness.md`.

## Global constraints

No auto-fill/general parser/schema/evidence/oracle relaxation. Preserve pointer v26, provider/model/retry=0/fallback=none, ledger/history/UNKNOWN. No push/merge/deploy. Existing $5 debug cap is cumulative.

## Review focus

- Negated/quoted/conditional places must not cause false required facts.
- Old/assistant/control sources cannot establish current coverage.
- Side queries must not alter pending reminders.
- Null/clear/wrong location and unsupported uncertainty must not bypass omission checks.
- Exact retained location can cover CURRENT only, never a fresh NEW request or changed venue.

### Task 1: Coverage gate and integration

Files: create `src/modules/conversation/context-contract/semantic-completeness.ts` and `.test.ts`; modify `evidence.ts`, `downstream.ts`, `prompt.ts`; repin prompt digest in `tools/benchmark/context-contract-runner.ts` and `context-contract-fit.test.ts`.

Interface: `locationCoverageComplete({intent,target,currentTurn,changes,changeEvidence,uncertainties,alternativeEvidence,retainedLocation}): boolean`. Source/value information stays internal; returns only a predicate, never a patch/value.

- [ ] Add integration RED test: R02 USER explicitly includes Quang Trung; title-only valid proposal must REFUSE `SEMANTIC_LOCATION_OMITTED`.
- [ ] Run `pnpm test src/modules/conversation/context-contract/semantic-completeness.test.ts --maxWorkers=1`; observe actual missing guard failure.
- [ ] Implement pure narrow predicate and invoke after existing evidence resolution before branded patch issuance. Add closed diagnostic reason.
- [ ] Add table-driven edge tests from Review Focus and service regression asserting zero draft/reminder mutations on omission.
- [ ] Run focused predicate/evidence/pointer/service/benchmark regressions and prompt fit tests. Expected: zero failures; original frozen oracle unchanged.
- [ ] Run full offline check: `pnpm test --maxWorkers=1`, docs current-state test, typecheck, lint, build, Wrangler types check and dry-run in existing offline sandbox; `git diff --check`.
- [ ] Independent delta review from baseline; fix all C/I findings; commit exact local paths after C0/I0.

### Task 2: Fresh Pilot and accounting handoff

Consumes reviewed immutable Task 1 commit and existing trusted debug-loop launcher. Produces separately recorded terminal live result, never historical replacement.

- [ ] Derive conservative budget and verify candidate/application identity, frozen manifest and authority using launcher preflight without credentials/network.
- [ ] Run fresh Formal Pilot, max76 requests, one call per eligible turn, stop/settle first failure. No artificial financial reservation or release of historical UNKNOWN.
- [ ] If same-scope failure: diagnostics → offline TDD → review/check → new immutable candidate, then fresh execution while cumulative $5 remains admissible. Never retry a terminal execution.
- [ ] Stop on Pilot PASS or owner-defined genuine gate. Append actual results to canonical progress ledger and report local/live distinction.

## Rulings

No approval pause is inserted because owner explicitly authorized this full narrow workflow. Coverage is intentionally lexical and bounded, not a claim of universal semantic completeness; unknown expressions remain subject to unchanged model/evidence handling.

## Local acceptance evidence

RED integration reproduced missing omission guard. Focused coverage/evidence/service/fit: 193 PASS / 2 existing skips; final coverage/offset fixture regression: 51 PASS. Independent final boundary and fixture reviews: C0/I0/M0. Full offline verification exited zero: 174 files, 8393 PASS / 2 existing skips; documentation test, typecheck, lint, build, Worker types check and dry-run PASS. Lint: zero errors, 168 existing warnings. The offset diagnostic fake proposal now supplies its already-explicit location so the original offset/conflict assertions execute; frozen oracle is unchanged. Local acceptance does not establish live Pilot acceptance.
