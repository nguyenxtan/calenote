# Finite weekly/monthly reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Codex executes natively; Claude cross-reviewed the design and will review the final bounded diff.

**Goal:** Create confirmed finite Gregorian weekly and fixed-date monthly reminder series through the existing chat/web control paths.
**Architecture:** Reuse the semantic frequency operands and canonical exact timestamp series. Backend calendar expansion and evidence verification retain authority. No new persistence shape or migration.
**Tech Stack:** TypeScript, Vitest/SQLite/Miniflare, existing Worker/D1/React.
**Spec:** docs/superpowers/specs/2026-11-04-weekly-monthly-reminders-design.md

## Global Constraints
- Existing Calenote folder, feature branch; ONCE/DAILY/advance behavior preserved except rejecting demonstrably unsupported times-per-period instructions.
- Gregorian, Asia/Ho_Chi_Minh, STARTING_ON, finite 2–30 occurrences or inclusive end date, all occurrences within 366 days.
- Original monthly day; missing month-day clarifies with no save, no implicit clamp or skip.
- Model supplies evidence-bound operands; backend expands dates. No provider calls during source work. Existing cumulative paid-test ceiling USD4 and EU/ZDR route unchanged.
- Remote migration/deployment needs exact-SHA authorization; preserve immutable 144 fixtures and legacy wire/slot/persistence shapes.

## Review Focus
- Count per week/day/month must not become total count, even when endDate lets a model omit the count slot.
- Named weekdays and multiple weekdays cannot silently become the start-date weekday.
- Month-end invalid dates, leap years, inclusive end just before anchor day and count/range conflicts.
- Confirming after first occurrence passes must save nothing; replay saves once, ordinary series cancellation stays owner-fenced and separate from advance groups.
- Prior DAILY/ONCE proofs and original request fields/model/provider/price settings remain unchanged except reviewed capability/prompt metadata.

### Task 1: Exact periodic expansion and resolver integration
**Files:** new context-contract/finite-recurrence.ts and tests; resolve.ts, resolve-periodic.test.ts, existing resolve.test.ts only for now-supported cases.
**Interfaces:** expandPeriodicOccurrences({frequency:'WEEKLY'|'MONTHLY',startDate,endDate,count,reminderTime,now}) -> READY{count,occurrences} or CLARIFY{field,reason,invalidMonth?}; resolveRequest preserves resolved facts/preview and may expose backend-only invalidMonth.
- [ ] Write RED resolver tests for exact 4-week/end ranges, monthly anchor/leap/missing day, 30/366/past/conflict/solar-only/start-relation/default override cases. Run before code; expected existing UNSUPPORTED.
- [ ] Implement civil expansion from original anchor, bounded counts/horizon, no Date overflow. Branch periodic resolution before old daily arithmetic and reuse finish().
- [ ] Run focused resolver tests, typecheck; expect GREEN. Update obsolete unsupported expectations only where new behavior is intentional. Commit.

### Task 2: Grounding, weekday safety and useful clarification
**Files:** cadence-count-evidence.ts, event-relation-evidence.ts, evidence.ts call sites, new recurrence-evidence.ts/tests if needed; guidance.ts/transition.ts and focused service tests.
**Interfaces:** boolean validators check already-proposed values/evidence only; STARTING_ON accepts optional proposed frequency context; periodic weekday verification returns VALID/CONFLICT/MULTIPLE, never authors an operand.
- [ ] RED tests for times-per-period vs total, correct/mismatched cadence duration, negation/quotes/foreign counts; named weekday conflict/multi-day, and weekly/monthly STARTING_ON.
- [ ] Implement narrow evidence guards, matching-cadence start cues and backend conflict/unsupported responses. Keep arbitrary interval and lunar-month unsupported.
- [ ] RED/GREEN service+D1 tests: exact weekly/monthly previews, addressed confirm/replay, past-at-confirm, month-day explanation, and remaining-series cancellation without advance group rows.
- [ ] Run changed and existing daily/advance/evidence suites; expect GREEN. Commit.

### Task 3: Capability/prompt qualification and release evidence
**Files:** contracts.ts/context.ts, keyed-small-{wire,protocol}.ts, immutable successor fixture and gateway test reference, releases/catalog.json, capability answers/help where source claims otherwise; documentation.
**Interfaces:** capabilities-2 explicitly adds FINITE_WEEKLY/FINITE_MONTHLY to input enum/max7, removes WEEKLY/MONTHLY from unsupported; keyed145 prompt, output wire136/slots unchanged. Existing decoder/store formats unchanged.
- [ ] RED tests for capability announcement and scoped missing/unsupported questions, then implement accurate UI/backend capability text and prompt guidance.
- [ ] Qualify new request hashes offline: restoring only old144system prompt and old capability object must reproduce each144anchor. Never rewrite144fixture or make paid requests.
- [ ] Update release notes and inventory/spec/ledger with evidence. Run targeted gate then freeze final SHA, run pnpm check once; no edits/commits while it runs.
- [ ] One bounded Claude final diff review, resolve material findings with RED/GREEN and appropriate checks; prepare concrete reviewed release/PR. Ask only required exact-SHA production authorization after all authorized preparation is complete. No false claim of live acceptance.
