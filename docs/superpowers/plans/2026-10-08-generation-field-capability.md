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

A1–A3 implemented and reviewed as one cohesive boundary. RED/GREEN includes source control-span negation, occupied conflicts, NEW/CURRENT upper-bound continuity and actual transport/proof. Focused 10 files / 3501 PASS; stable full offline 181 files / 8608 PASS / 2 existing skips; architecture test 1 PASS; typecheck/build/diff PASS; lint 0 errors / 168 existing warnings. Independent review C0/I0/M0, reviewed source SHA256 fingerprints match final source. Logs and review evidence retained in the plan's local scratch directory. No paid request occurred before these gates. Live Pilot acceptance remains separate and pending.
