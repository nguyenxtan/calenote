# Hour/minute lead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. One bounded Claude implementation pass; root reviews and completes qualification.

**Goal:** Interpret explicit hours/minutes before an event and preserve exact confirmed timestamp authority.
**Architecture:** Two optional integer successor slots, appended V2 uncertainty codes, source-bound evidence, backend-only duration arithmetic, unchanged canonical persistence.
**Tech Stack:** TypeScript/Zod, Vitest, SQLite/Workerd existing harness.
**Spec:** docs/superpowers/specs/2026-11-04-hour-minute-lead-design.md

## Global Constraints
- Preserve immutable legacy13slots/codebookV1/historical fixtures, state/encryption identity, production route/budgets.
- Hours1–8784/minutes1–527040, total<=366days; ONCE/BEFORE_EVENT plus event date/clock; future<=366days.
- No provider calls, secrets, production mutation, migration, new dependencies or fullcheck during this slice.

## Review Focus
- Old snapshots without extension slots retain exact bytes; extension facts never disappear during merge/projection.
- A model dropping an authored duration cannot invoke advance defaults.
- “giờ chiều”, negation/quote and split foreign clauses cannot ground durations.
- Event-time edits recompute; past-at-confirm cannot save.
- Day/count ownership is never widened by a duration number.

### Task1: Optional successor operands and compatibility
**Files:** context-contract/contracts.ts, state.ts, context.ts, merge.ts, output-authority.ts, canonical-constraints.ts, evidence.ts and selected provider codec/schema dependencies; new tests.
**Interfaces:** V3_SLOT_NAMES appends hours/minutes; optional stored positive-integer slots; codebookV2 appends16/17; legacy encodings unchanged.
- [ ] RED tests: V3 typed hours/minutes accepted, legacy absent-slot snapshot round-trip, field/fact/evidence integrity.
- [ ] Implement optional extensions through selected V3 context/merge/evidence loops and wire carriers, leaving old constants/codecs intact.
- [ ] GREEN focused contract/state/wire tests and typecheck; report any unresolved cross-layer issue.

### Task2: Grounding and exact resolver behavior
**Files:** new lead-duration-evidence.ts/tests, lead-offset/evidence/field-capability guards, resolve.ts, transition.ts/guidance.ts/responses.ts and focused service tests.
**Interfaces:** boolean amount/unit verifier only; occurrences pure function of eventDate/eventTime/hours/minutes; no computed reminder slot facts.
- [ ] RED: 15h-before3h=>12h; before90min=>13h30;1h30min; midnight crossing; missing clock; clock/day/count conflict; malicious/ambiguous evidence; omitted duration; past/horizon/confirm/edit/default precedence.
- [ ] Implement bounded pure duration resolution and truthful clarification/preview, plus source coverage to refuse omitted operands.
- [ ] GREEN focused new + existing day-offset/daily/periodic/advance and provider codec tests; types/lint. No full suite.

### Task3: Qualification and review (root)
**Files:** prompt146/keyed wire137 metadata, capabilities3, new fixture146 and production gateway test reference; combined release catalogue/spec/inventory.
**Interfaces:** old145fixture+captured request body are immutable hash anchors; new schema/capabilities reviewed independently; synthetic capture only.
- [ ] Offline qualification against145 anchors; preserve all old fixtures, no external requests. Run targeted gateway/capability gates.
- [ ] Review implementation, prove material findings RED/GREEN, document compatibility/rollback limits, commit source.
- [ ] Continue areas3–5; combined final source freeze/fullcheck/independent review before exact-SHA production approval.
