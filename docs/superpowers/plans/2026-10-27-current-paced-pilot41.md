# Current-candidate paced Pilot41 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Existing root writer + strict_date_review only; no new agents.

**Goal:** Carry tested pacing into genuine current-candidate completion without old-binding reuse or fast fallback.

**Architecture:** Strict new V3scope/v6record selects per-grant policy in the existing paced engine; controller budget and private execution token carry verified dynamic source/baselines. Existing V2defaults/records stay frozen; app40 semantic files unchanged.

**Tech Stack:** Node22 TypeScript/Vitest, existing durable scheduler/accounting/forensic modules.

**Spec:** docs/superpowers/specs/2026-10-27-current-paced-pilot41-design.md

## Global Constraints
- No paid/probe/replay40/oldbatch/sourcefakeSHA. One future attempt only after full normal review+CI+fresh paced binding gates.
- Fixed model/provider/privacy/canonical/evidence/oracle/corpus/runtime limits.
- Max76/32/84,45minrun/90minouter,15s+0..3sjitter/15..30mincooldown,250000attempt/500000phasegrowth/10Mglobal,UNKNOWN65full105472reserve.
- Preserve V2constants/strict old source binding/default behavior. No normal fallback in the new current workflow.

## Review Focus
- Fresh newer app/harness must pass immutable proof while old consumed bindings cannot be relabeled.
- V3 timing only through private validated capability; raw runner options cannot buy45min or bypass source/target checks.
- Delay before reserve/claim, physical-start ledger after final guards; no apparent pacing from CPU overhead.
- Missing/notcaptured Retry-After differ; malformed hints fail, no retry/probe.
- Budget reserves/phase baseline and lock retention survive abort/persistence/foreign drift.

### Task1: Portable scope/controller/parent eligibility
Files: new context-rate-current-policy.ts/.test.ts; context-rate-batch.ts/.test.ts; context-rate-successor.ts/.test.ts.
- [ ] RED tests derive exact one-attempt current policy from bound source/baseline, reject widened caps/runs/resetphase; oldP defaults remain.
- [ ] Add narrowly validated controller budget config; enforce250k plus fixed500kphase and one-run cap without modifying timing constants.
- [ ] Factor read-only parent verification for supplied validatedsource, keep legacy wrapperfixedoldsource. Test current40likeprefix and wrongsource/semantic/noprogress refusal.
- [ ] GREEN focused tests; no authority or real network.

### Task2: Current authority and private paced route
Files: context-rate-launcher.ts, context-rate-execution.ts, context-contract-runner.ts, context-contract-live.ts; new current launcher tests; existing rate-timing/runner tests.
- [ ] RED strictv6/current-trust source/baseline/newmode/no-fastfallback tests and V3ledgerordinal1/deadline.
- [ ] Add loadCurrentRateAwareLaunch and per-grant policy toshared engine; old loader/schema fixed. Budget/namespace/parent/source checks revalidate under lock.
- [ ] Bind source/timing via private token; explicit V3ledger45min identity, no runtimeoverride. One run only; capture typed receipts and physical fetch starts.
- [ ] Fake76fullPilot/first429/abort/headers/budget/persistence/consumption cases; oldV2tests stillGREEN. No actual key/HTTP.

### Task3: Full qualification and immutable execution preparation
- [ ] Allprior37required plusnewtests; full standard suite/type/lint/docs and unchangedapplication proof/all144offline qualification.
- [ ] Existing reviewer design/source/acceptance assertions/resource/authority evidence checks; commit real harness-only change and exact CI.
- [ ] Derive fresh explicitlyAGENTDERIVED current-paced binding under reviewed standing scope; preserve all spentphasecost/UNKNOWN/oldmarkers. Allpacket/gate/ACTUAL/preflight checks before ONEpacedFormal, then terminal/reconcile. No perSHAhumanquestion.

## Binding paid stop received during offline implementation
The parent reports approval-review denial of further paid continuation: the two-run/$0.50 approval was consumed and the broader standing-grant interpretation was not accepted. This supersedes earlier future-execution eligibility in this document. Complete unpaid integration, qualification and review only. Do not mint/activate paid authority, run a new paid attempt, retry a denied operation or choose alternative routes. Existing receipts and scope reviews remain historical evidence, not new human permission. Mail C1 remains pending; no deploy.
