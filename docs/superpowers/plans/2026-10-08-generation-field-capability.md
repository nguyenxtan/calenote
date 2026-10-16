# Generation-time field capability implementation plan

> Execute natively with TDD and one independent whole-amendment review.

**Goal:** Prevent distance evidence from opening recurrence/count fields upstream without filling any values.
**Architecture:** Existing numeric predicates derive a request-bound field upper bound; a schema-family specialization removes disallowed branches before dispatch. Downstream ownership is unchanged.
**Tech stack:** TypeScript, Zod, Vitest, existing trusted T11 runner.
**Spec:** `docs/superpowers/specs/2026-10-08-generation-field-capability.md`.

## Review focus

Do not close explicit unsupported cadence, retained facts, count-question answers or CLEAR operations; do not borrow assistant evidence, old unrelated facts or control placeholders. No schema mutation across requests. Preserve strict numeric field/value checking after generation.

## Tasks

- [ ] A1: Add `field-capability.ts` beside context-contract wire, deriving capability from existing `supportsCadenceOperand` / `supportsLeadOffset`. RED tests in `field-capability.test.ts` for pure distance, pure count, mixed independent operands, retained context, pending answers and negative sources. No values are emitted.
- [ ] A2: Specialize `context-provider-wire.ts` cloned schema with a typed field allowlist. Test pruned field domains, CLEAR preservation, no empty enum and original schema immutability. Serialize derived schema in `wire.ts`; prevent observable gateway from replacing it with the unrestricted family schema. Assert actual fake transport matches request capability.
- [ ] A3: Bind dynamic schema proof in `tools/benchmark/context-contract-runner.ts`, keeping historical family evidence immutable and recording request schema digest separately. Test changed schema/capability mismatch fail-closed, one dispatch and trusted historical compatibility.
- [ ] Verify focused capability/gateway/runner/ownership tests, then `pnpm test --maxWorkers=1`, documentation test, typecheck, lint, build, diff check. Independent C0/I0; fix findings and commit locally.
- [ ] Trusted preflight, credential gate, Fresh Formal Pilot under existing USD 5 accounting. Continue scoped evidence-backed fixes only; no unchanged terminal retry. Settle each request, preserve UNKNOWN/history; report final Pilot PASS or genuine gate.

Commit boundary: one cohesive capability/schema/gateway/accounting-evidence amendment after full local acceptance. No isolated half-enabled dynamic-schema commit is live eligible.

## Local acceptance, 2026-10-08

## Clock capability correction boundary

- [x] Prove R06 failed at the existing source-presence guard, not canonical parsing; prompt already forbids absent clocks, but upstream clock change branches were unrestricted.
- [x] RED tests for absent continuation, pending time question, numeric/named expressions, embedded tokens, ASSISTANT exclusion, retained conflict/CLEAR and prior USER compatibility.
- [x] Extend `field-capability.ts` and `context-provider-wire.ts` only at the existing pre-generation upper-bound specialization. Do not alter evidence validators or oracle.
- [x] Verify independent schema rejects absent-clock SET/REPLACE/CLEAR while missing-field guidance remains expressible; existing alternative and exact CONTEXT_FACT regressions stay authoritative.
- [ ] Parent runs full offline check and independent C0/I0 review, then local commit and authorized Fresh Pilot. No live calls in implementation task.

A1–A3 implemented and reviewed as one cohesive boundary. RED/GREEN includes source control-span negation, occupied conflicts, NEW/CURRENT upper-bound continuity and actual transport/proof. Focused 10 files / 3501 PASS; stable full offline 181 files / 8608 PASS / 2 existing skips; architecture test 1 PASS; typecheck/build/diff PASS; lint 0 errors / 168 existing warnings. Independent review C0/I0/M0, reviewed source SHA256 fingerprints match final source. Logs and review evidence retained in the plan's local scratch directory. No paid request occurred before these gates. Live Pilot acceptance remains separate and pending.

## Live checkpoint

Candidate/harness `917a6e28d4bb65f7403730451c2128720a8f4350` passed fresh trusted preflight and credential metadata gate. Formal Pilot passed R01/R02 then stopped at R03 TURN 0 after 6 dispatches / 6 provider attempts. HTTP 200 with explicit finish_reason error correctly classified PROVIDER_FAILURE; no accepted semantic output, failing-turn DB reads or mutations. Generation `gen-1791423328-u24p4vK0e4K8B8jQ1tRC`, known cost 0. Safe read-only generation metadata eventually returned HTTP 200 and projected upstream Google status 429, cost 0; initial metadata 404 was not an inference failure. This proves provider throttling, not a schema incompatibility or semantic failure. R05 remains not evaluated on this candidate; Pilot is NOT PASS.

Execution `debug-63681424db0fcab39b9a8b80487a6fb4e6f24766` is terminal and retained. Cumulative exact confirmed USD 0.33827179; conservative confirmed USD 0.338455; UNKNOWN USD 2.109440 unchanged; conservative remaining USD 2.552105; ledger hash chain PASS. All 6 requests settled, no retry/fallback/Full/push/merge/deploy. Do not bump a documentation SHA to bypass the terminal fence. A fresh same-candidate execution after throttling needs a reviewed append-only lifecycle/admission policy; that is outside this field-capability amendment.
