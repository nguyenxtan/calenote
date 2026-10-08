# Title Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Prevent omission of explicitly grounded exam task subjects without synthesizing model values.

**Architecture:** Share a bounded title coverage predicate between semantic completeness and request-specific generation capability. A versioned strict-object title carrier transports the model's own change and original array position into the unchanged canonical/evidence pipeline; missing, duplicate or malformed authority fails closed.

**Tech Stack:** TypeScript, Zod, JSON Schema, Vitest, existing OpenRouter Google Vertex gateway and trusted benchmark tooling.

**Spec:** docs/superpowers/specs/2026-10-08-title-presence-design.md

## Global constraints

- Same google/gemini-2.5-flash-lite through google-vertex/eu; stream=false, retry=0, fallback=none.
- No backend title filling, fuzzy evidence, output repair, general parser, canonical/evidence/oracle relaxation or extra inference.
- Preserve USD5 accounting, immutable history and UNKNOWN; no Full or production publication.
- Freeze all source/tests before full verification; application identity is distinct from harness identity.

## Review focus

- A query mentioning an exam must not become a forced reminder.
- Quotation/negation/hypothetical/control markers must not manufacture subject authority.
- CURRENT retained title cannot leak into NEW; changed subjects must remain real conflicts.
- Carrier round-trip must preserve model value, exact pointer and change order, not repair duplicates.
- Capability, actual request schema and measured prompt must agree; no silent fallback to old wire.

## One coherent implementation boundary

Files: context-contract/semantic-completeness.ts/.test.ts, evidence.ts and evidence diagnostic finite reason declarations; field-capability.ts/.test.ts; openrouter/context-provider-wire.ts/.test.ts and evidence-pointer.ts only if boundary integration requires it; context-contract/protocol.ts, prompt.ts/.test.ts; benchmark runner/fit tests and exact reviewed digest declarations. Existing approved specs/plans may receive narrow implementation references. No frozen fixture/oracle changes.

Interfaces: a bounded subject coverage predicate returns presence/coverage only; GenerationFieldCapability adds the application-owned title presence obligation; the wire exposes nullable indexed title SET carrier, encode/decode restore explicitly generated canonical changes without modification. Existing validators remain authoritative.

- [ ] Write failing bounded title coverage and application R05 omission tests; observe SEMANTIC_TITLE_OMITTED expectation fail on current code.
- [ ] Write failing carrier schema/codec tests: missing/null required title, original index/order, duplicate, invalid position, existing title REPLACE/CLEAR without obligation, absent unrelated/query/continuation obligations.
- [ ] Implement shared presence/coverage predicate and semantic guard; implement versioned carrier, request specialization and exact reversible mapping before evidence materialization.
- [ ] Update protocol/prompt representation and exact digest pins; include model-authored pointer source checks, complexity and actual outbound-schema/token binding tests. Do not weaken pin verification.
- [ ] Run focused completeness/capability/codec/gateway/runner/fit tests and typecheck; fix regressions, then freeze.
- [ ] Independent meaningful-boundary review C0/I0; fix findings and rerun covering tests.
- [ ] Run full offline pnpm test --maxWorkers=2, docs architecture test, pnpm typecheck, pnpm lint, pnpm build, git diff --check. Report all failures and retain old skips.
- [ ] Selective local commit after full/review PASS; trusted preflight/actual identity/budget/credential gates, then Fresh Formal Pilot within existing authority. Settle terminal before fixing new failures; no blind retry or history rewrite.

Focused command: pnpm exec vitest run src/modules/conversation/context-contract/semantic-completeness.test.ts src/modules/conversation/context-contract/field-capability.test.ts src/modules/intelligence/infrastructure/openrouter/context-provider-wire.test.ts src/modules/intelligence/infrastructure/openrouter/semantic-gateway.test.ts tools/benchmark/context-contract-runner.test.ts tools/benchmark/context-contract-fit.test.ts --maxWorkers=2

Acceptance: grounded title generated with exact USER pointer and required presence; wrong/missing authority rejected; original R01-R16 expectations preserved; full green, independent C0/I0, immutable local commit, then actual Fresh Pilot evidence. Commit is not a stop condition.

R03 follow-up scope: TDD reject explicit single Gregorian civil day/month mismatch using the existing scanner after USER source binding; preserve exact fact reuse, lunar/relative/ambiguous/unknown and LIST behavior. No generated values or arithmetic. Add literal event-date fidelity prompt instruction and update only prompt digest pins (wire28 schema unchanged), then focused evidence/date regressions, typecheck and freeze for controller review/full/live.
