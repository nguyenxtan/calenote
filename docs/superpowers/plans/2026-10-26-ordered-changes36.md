# Ordered changes36 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the existing session and worktree. Existing strict_date_review is the only reviewer; no new agents/chats.

**Goal:** Remove model-authored rank coordinates while preserving the ordered canonical patch and strict semantic authority.

**Architecture:** A field-discriminated ordered array owns typed write values/evidence. An unindexed typed decoder shares existing canonical/evidence materialization without constructing ranks; old typed wire remains separately validated.

**Tech Stack:** TypeScript, Zod4, Vitest4, Node22.

**Spec:** docs/superpowers/specs/2026-10-26-ordered-changes36-design.md

## Global Constraints
- No canonical/evidence/oracle/corpus/capability/runtime/model/provider changes; no sort/renumber/drop/repair of received semantic output.
- All prior24 required files retained; initial<19000/healthy<26000; fixed input12000/output1536/response32768/timeout30000.
- Consumed34/35 immutable. New paid authority reviewed separately; no reusable same-SHA grant.

## Review Focus
- Duplicate field with distinct operations must reject, not execute in sequence.
- CLEAR explicit empty write differs from an absent row and missing/null write.
- Field context must remain local through date/clock/enum aliases; free strings unchanged.
- Evidence and identical clocks/alternatives stay with authored owners/order.
- Fact alias/future reference identities and genuine conflict/uncertainty behavior remain unchanged.

### Task1: Ordered typed bridge and representation
Files: context-provider-typed-wire.ts, new context-small-ordered-changes.ts/.test.ts, context-small-compact.ts/.test.ts, context-provider-small-wire.ts, small-protocol.ts, small-wire.ts.
Interfaces: ordered schema/attach/project helpers; separately exported ordered typed encode/decode; public small encode/decode unchanged signatures, new protocol identity.
- [ ] Write failing tests: no-rank ordered schema/codec and typed ordered canonical inverse; duplicatefields/legacy/rank/permissions/inactive poison whole refusal.
- [ ] Run targeted Vitest and record expected RED before implementation.
- [ ] Implement exact spec, reusing typed canonical finish; preserve legacy typed path.
- [ ] Run targeted GREEN, typecheck and inspect public schema sizes.

### Task2: End-to-end regressions and complete qualification
Files: new ordered public/service tests and existing public/runner tests adapted to new protocol representation; canonical test files unchanged unless additional regression cases.
- [ ] Write failing full-domain order/evidence/merge/futurefact/CLEAR/REPLACE/two-clock cases and oldalphabet controls.
- [ ] Implement only missing transport guards; retain all prior assertions and service/corpus coverage.
- [ ] Run all prior24 plus new files, full offline/inverses/matrix/mutations, type/lint/docs/resource guards.
- [ ] Existing reviewer checks exact source/diff and qualification, address findings with RED→GREEN.

### Task3: Exact source CI and immutable candidate packet
- [ ] Selectively commit genuine reviewed source; push existing feature branch and require exact CI success.
- [ ] Build a new immutable36 packet with authoritative tradeoff/provenance/qualification/resource/accounting/authority boundary; no frozen35 overwrite.
- [ ] Existing reviewer checks all packet gates, standing grant and new clarification applicability; no per-SHA approval inferred from consumed35.
- [ ] If authorized and all gates clear, exactly one bounded Formal through reviewed wrapper; otherwise state exact missing external scope once and continue independent fixes.
- [ ] Terminal verification, cost/UNKNOWN/hashchain/consumption/lock and STATE updated before another candidate; only strict PilotPASS plus full validation establishes acceptance.
