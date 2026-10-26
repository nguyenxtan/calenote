# Joint operation/query owner39 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Root implements in this existing isolated worktree; existing strict_date_review reviews. No new agents or sessions.

**Goal:** Remove producer-valid operation/query contradictions without relaxing canonical/evidence/oracle acceptance or modifying received payloads.

**Architecture:** A new transport-only joint owner wraps the existing selected operation and exact query-row domains in five disjoint operation branches. Targeted and untargeted nonquery branches own no query property; LIST/CALENDAR/CAPABILITY each own one optional-length exact query array. Trusted encode and strict inverse preserve [] absence and meaningful null/missing operands; old root-query syntax refuses under a new protocol.

**Tech Stack:** Existing TypeScript/Zod/Vitest/Node22, no dependencies.

**Spec:** `/Users/bichtuyen/Documents/Codex/2026-10-24/calenote-paced-batch38-c3dc846-approved/COMMON_CAUSE_ROOT39.json`, `COMMON_CAUSE_REVIEW39.json` and `COMMON_CAUSE_REVIEW39_ROOT_ADDENDUM.json`.

## Global constraints
- Offline only; consumed batch38 cannot restart/replay/admit a second semantic-failure child. No key/provider/upload/deploy/authority/ledger change.
- Canonical, evidence, classifier, capabilities, uncertainty, corpus, clocks and oracle unchanged. Whole patch refuses contradictions; no selecting/dropping/coercion/default/repair/fallback.
- Model authors operation/target/query presence/value/evidence. Query [] absence and missing operands remain representable.
- Existing19000initial/26000healthy test ceilings; runtime input12000/output1536/response32768/timeout30000 unchanged.
- Keep prior35 qualification plus new tests, full offline/inverses/actions/safety/type/lint/docs and exact committed source CI. Existing frozen paid policy remains bound to13804ae; do not update it to authorize new source.

## Review focus
- Cross-code query carrier poisoning and old root q must fail producer and decoder unchanged.
- Targeted CREATE/UPDATE/AMBIGUOUS vs untargeted HELP/UNSUPPORTED/AMBIGUOUS retain exact selected target evidence domains; no silent operation remap.
- All LIST/CALENDAR/CAPABILITY queries retain missing operands, null topic/calendar/year and free strings/evidence, with zero forced query presence.
- Guidance roots directive/reply retain quarantine behavior; no unrelated semantic authority change.
- Legacy paid harness integration tests use explicit synthetic proof only where existing guards/identity/scheduler are already mocked; real source guards retain independently tested refusal of app drift.

### Task1: Joint owner TDD
**Files:** create `src/modules/intelligence/infrastructure/openrouter/context-small-operation-query.ts` and `.test.ts`; add public regression tests.
**Interfaces:** `operationQuerySchema(source)`, `attachOperationQuery(wire)`, `expandOperationQuery(raw)`: exact schema transform, trusted contradictory-source refusal, strict declared inactive syntax inverse.
- [ ] RED public regression: current producer accepts op0 plus LIST q; new source must make it unrepresentable without changing decoder refusal.
- [ ] Implement five selected branch groups reusing existing operation/query schema nodes, no new semantic domains; exact keys/cardinality/correlation before projection.
- [ ] GREEN negative/positive all operation kinds, empty queries, target/null/evidence/unknown keys and immutability.

### Task2: Public adapter/codec/protocol alignment
**Files:** `context-provider-small-wire.ts`, `context-small-compact.ts`, `small-protocol.ts`, current small-wire prompt and directly affected tests.
**Interfaces:** Existing encode/decode signatures unchanged; new protocol `ordered-changes-36-operation-query-39-date-roles-33-text-roles-34`.
- [ ] Apply joint owner after ordered changes and before compact pack; exact inverse before existing strict ordered projection.
- [ ] Add operation.query compact q scope and generated owner metadata; remove only obsolete root q. Keep all other alias/code/free-string paths unchanged.
- [ ] Align prompt transport identity, generated key book and query ownership example only; inherited source meaning/anchor/uncertainty guidance unchanged.
- [ ] Update structural tests for five disjoint operation branches and nested q; preserve internal flat regression tests and strict old-version refusal.

### Task3: Review/qualification/freeze
**Files:** new immutable local packet and plan; test-only legacy rate fixture proof adaptation if needed.
- [ ] Full80script158turn144healthy3941detail32heldout5action0safety; all144 bidirectional public inverses, operation/target/query matrix and controls, context/schema non-owner parity.
- [ ] Existing reviewer independent exact changed-file/source/design review; fix only relevant findings with regression coverage.
- [ ] Direct type/lint/docs and full standard Vitest, name skips/failures; commit actual app source before source-bound tests when required, then final committed proof and exact CI.
- [ ] Report offline readiness separately from consumed38 and absent new paid authority; never self-rebind frozen v2 grant.
