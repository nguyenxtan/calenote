# Evidence Pointer Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation. Owner explicitly authorized continuous execution without intermediate approval pauses.

**Goal:** Eliminate model-authored source quotations without expanding semantic authority.

**Architecture:** A narrow materializer expands explicit USER_TURN or backend-catalogued USER_SEGMENT pointers using the validated immutable gateway input. Existing ProviderWire decoding and canonical/evidence validators remain downstream and authoritative.

**Tech Stack:** TypeScript, Zod, Vitest, existing OpenRouter gateway and T11 append-only debug executor.

**Spec:** `docs/superpowers/specs/2026-10-07-evidence-pointer-amendment.md`.

## Global constraints

No evidence repair, normalization, fuzzy matching, validator/oracle changes, provider/model changes or production side effects. Preserve accounting and UNKNOWN history; existing $5 total cap applies.

## Review focus

Wrong role/index must reject; caller mutation cannot alter dispatched source; inactive padding cannot create evidence; full-turn control gaps remain rejected; broad quotes cannot authorize unsupported offsets/relations.

## Tasks

### P1 — Materialization boundary

Files: create `src/modules/intelligence/infrastructure/openrouter/evidence-pointer.ts` and `.test.ts`; modify `context-provider-wire.ts`.

Interface: `materializeProviderEvidence(raw: unknown, input?: ContextInput, strictPointers?: boolean): unknown`; returns a detached provider object with only known evidence carriers expanded, or throws a structural error without source content. Current decoder supplies strict mode from its immutable validated ContextInput; absence rejects pointers but preserves context-free historical fixtures.

Ruling: current dispatch decoding selects strict pointer mode from its captured ContextInput, never model fields. Context-free historical/local parsing alone retains USER_QUOTE transport. Add exact backend USER_SEGMENT catalogue in `wire.ts` for correction text beside control placeholders; no source-map guard is relaxed. `tools/benchmark/context-pointer-fixtures.ts` binds its canonical declarative specimens to their original input before encoding source pointers; invalid fabricated refs remain invalid. The original `context-contract-fixtures.ts` remains byte-identical so trusted seed provenance is not rewritten. Shared fake gateway/probe transport explicitly supplies its dispatched input. Selected query diagnostics use that same input to materialize pointers before the existing parser, retaining only the unchanged finite diagnostic whitelist.

- [x] RED tests: exact full USER source, absent context, wrong role/index, extra key, oversized/malformed source, legacy parity and uncertainty alternatives.
- [x] GREEN: implement bounded explicit-carrier traversal and strict pointer materialization.
- [x] Focused pointer tests 35 PASS; wire/parity regression 3095 PASS; gateway/runner focused 89 PASS; adapter/seed/service migration 149 PASS; orchestration 28 PASS.

### P2 — Gateway and prompt integration

Files: `semantic-gateway.ts`, `semantic-gateway.test.ts`, context-contract `prompt.ts`, `prompt.test.ts`, `protocol.ts`, affected explicit version/hash pins.

- [x] RED fake gateway test: pointer decodes using captured validated input despite mutation of original input.
- [x] GREEN: thread validated context through offline/observable decoders; advance wire version and replace quote-copy guidance with pointer-only guidance without changing semantic rules.
- [x] Run focused gateway, prompt, wire parity and evidence regression tests.

### P3 — Authority proof and local admission

Files: pointer tests, canonical execution ledger documentation. Runtime validators/oracles remain untouched.

- [x] Exercise pointer-materialized evidence through existing validator regression fixtures: target currentness, historical role/scope, source-map gap, negation, unrelated number, count versus offset, conflicting clauses. Duplicate-source fixture conversion has a RED/GREEN regression preserving the selected second occurrence.
- [x] Full offline command: `pnpm test --maxWorkers=1 && node --test docs/architecture/current-state.test.mjs && pnpm typecheck && pnpm lint && pnpm build && pnpm exec wrangler types --check && pnpm exec wrangler deploy --dry-run`, using existing offline sandbox. Final exit zero: 173 files/8357 PASS/2 existing skips; docs/typecheck/build/types/dry-run PASS; lint zero errors/168 existing warnings.
- [x] Run `git diff --check`; independent whole-delta review C0/I0; fix findings with TDD. Final review C0/I0/M0, including transport migration and synthetic-clone dependency fix.
- [x] Selectively commit local: `97f39c016b2795e15bce742b7c7cb71c2adfd559`; bounded live execution followed.

### P4 — Bounded live continuation

- [x] Derive current conservative accounting and prove candidate/harness identity using existing debug launcher.
- [x] Run one CANONICAL_WIRE admission canary for material wire change, then new-candidate FORMAL_PILOT only after admission PASS. Canary passed; Formal Pilot reached R04, then equivalent clock representation failed the unchanged oracle. Two reviewed prompt-only instruction-delivery followups were committed and independently tested.
- [ ] Settle each request; preserve failed historical runs. Continue same-scope offline fixes and reviewed new candidates under owner $5 grant until Pilot PASS or genuine authorized stop gate.
- [ ] Never run Full or release pipeline.

## Genuine architectural boundary

Latest evaluated candidate `206c8f19dfad6268c34a6eda56bca89df4d4763d` Formal Pilot stopped after three provider requests at R02 turn zero. HTTP 200, generation `gen-1791341208-3Ictwmm09gbLkqbIvjYP`; cost 0.0009227 USD KNOWN. Transport, canonical, evidence and application clarification passed. The model omitted the explicitly supplied location; frozen oracle failed `fields.location` (expected string digest, actual null). Zero reads/mutations. No retry or repair call.

Offline source inspection confirms evidence validation traverses proposed changes only; exact source materialization does not fabricate an omitted field. Independent boundary review confirms robust semantic-completeness enforcement requires a separate amendment beyond this narrow evidence contract. Automatically extracting/filling location would add semantic authority; requiring an optional location always would be incorrect; oracle relaxation/repair inference are prohibited. Existing prompt already requests every explicit detail, so another wording experiment is not a completeness guarantee.

Current trusted accounting: cap 5000000 microunits; confirmed retained 133639; UNKNOWN exposure 2109440 unchanged; conservative retained 2243079; remaining 2756921; hash chain PASS. Latest execution terminal, Pilot FAIL, Full not run. No push/merge/remote migration/deploy. Next gate: OWNER_DECISION_ON_SEMANTIC_COMPLETENESS_AMENDMENT.
