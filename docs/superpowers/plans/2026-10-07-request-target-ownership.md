# Request-target ownership implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Owner explicitly authorizes continuous execution, with one independent final review and no routine spec/plan approval pauses.

**Goal:** Reject CURRENT without a trusted existing active draft before patch issuance.
**Architecture:** Extend the existing evidence admission boundary using its private trusted context snapshot, not provider fields. Context builder retains identity/scope/lifetime authority; merge retains stale-base authority. Deliver the already-existing target instruction earlier in the prompt.
**Tech Stack:** TypeScript, Zod, Vitest, current service/D1 harness.
**Spec:** `docs/superpowers/specs/2026-10-07-request-target-ownership.md`.

## Global constraints

No CURRENT→NEW rewrite; no validator/oracle relaxation; preserve pointer v26 and completeness. Model google/gemini-2.5-flash-lite/provider google-vertex/eu, retry=0/fallback=none. Existing cumulative $5 cap and all UNKNOWN/history remain. No Full/push/merge/deploy.

## Review focus

- Context presence and transcripts do not imply an active draft.
- Terminal/expired/mismatched scope/revision cannot provide CURRENT authority.
- Legitimate continuation and pending candidate adoption into a real draft remain valid.
- Queries and NEW/UNRESOLVED retain their ownership, not accidental CURRENT authority.
- Invalid CURRENT must not create partial fields, preview or persistence.

### Task 1: Trusted target admission

Files: modify `src/modules/conversation/context-contract/evidence.ts`, `downstream.ts`, `prompt.ts`; add `request-target-ownership.test.ts`; repin prompt in `tools/benchmark/context-contract-runner.ts` and `context-contract-fit.test.ts`.

Interface: existing `validateEvidenceV3(proposal,built,observe)` returns REFUSED/REQUEST_TARGET_NOT_AVAILABLE for CURRENT without trusted retained active draft; existing VALID patch interface is unchanged.

- [ ] Write absent/context-only CURRENT RED tests and observe actual VALID failure with `pnpm test src/modules/conversation/context-contract/request-target-ownership.test.ts --maxWorkers=1`.
- [ ] Add trusted snapshot check after current target evidence validation, before patch/adoption/merge. Closed diagnostic reason only; no identifiers or user content.
- [ ] Add real active draft, stale/scope/terminal/expiry, NEW/UNRESOLVED, unchanged proposal and service no-partial-write tests.
- [ ] Deliver existing targeting instruction early; recompute actual prompt digest and repin runner/fit.
- [ ] Focused command: `pnpm test src/modules/conversation/context-contract/request-target-ownership.test.ts src/modules/conversation/context-contract/merge.test.ts src/modules/conversation/context-contract/evidence.test.ts src/modules/conversation/context-contract/semantic-completeness.test.ts tools/benchmark/context-contract-fit.test.ts --maxWorkers=1`; zero failures.
- [ ] Full offline command: `pnpm test --maxWorkers=1 && node --test docs/architecture/current-state.test.mjs && pnpm typecheck && pnpm lint && pnpm build && pnpm exec wrangler types --check && pnpm exec wrangler deploy --dry-run`; zero exit in existing no-network sandbox. `git diff --check`.
- [ ] Independent whole-delta review C0/I0; fix findings TDD and rerun checks. Selective local commit after acceptance.

### Task 2: Fresh Pilot

Consumes immutable Task 1 candidate and reviewed debug executor; produces distinct terminal run and truthful ledger.

- [ ] Trusted read-only preflight derives budget and actual loaded candidate identity without credentials/network.
- [ ] Run FORMAL_PILOT through existing debug-loop launcher, frozen manifest, max76 requests; one call per eligible turn; first failure terminal and settlement.
- [ ] Same-scope defects: offline TDD/review/check/new local candidate then fresh run; never reopen terminal executions.
- [ ] Record actual spend/UNKNOWN/remaining and stop on Pilot PASS or owner's genuine gate. No release.

## Local evidence

Two absent-target RED failures observed actual VALID; GREEN after trusted snapshot admission. Final ownership15 PASS; transition40 PASS; independent review C0/I0, minor coverage resolved (independent55 PASS). Legacy no-target CURRENT merge expectation changed to approved hard rejection. Four undelivered-operation fixture cases now use UNRESOLVED/operation uncertainty, preserving all source/lifetime/delivery/adoption/no-mutation assertions; frozen oracle unchanged.

First full run failed: 34 VALIDATION_APPLICATION_CHANGED when executor candidate snapshots detected test-source edits during the run; standalone bounded36 PASS. Four old transition CURRENT fixtures failed as intended under new rule and were corrected above. Fresh fixed-source full offline exit zero: 175 files/8408 PASS/2 existing skips; documentation/typecheck/lint/build/types/dry-run PASS; lint zero errors/168 existing warnings. Diff check PASS. No provider or credential access before local acceptance. Prompt digest `7a0c4c865dcc1d5c5cc019c12dcc3a7282167ac30cc2c3f8c084c430a7f91d4b`; wire/canonical/pointer/completeness unchanged.

## Live terminal result

Candidate59732fc trusted preflight and approved credential metadata PASS. Formal Pilot four calls, R01 turns0–1/R02 turn0 PASS; R02 turn1 FAIL on leadOffsetDays2 vs required null. New CURRENT gate correctly accepted its real retained draft. Evidence binding and canonical passed; backend conflict question diverged from reminderTime oracle. R04 NOT_REACHED. Cost0.0036566 USD KNOWN, conservative remaining2.746042 USD, UNKNOWN2.109440 USD unchanged, hashchain PASS. Stop at owner's outside-request-target architecture gate; no Full/release. Canonical history remains unchanged.
