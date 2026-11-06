# Owner AI usage Implementation Plan

**Goal:** Give each owner truthful day/month AI accounting and known-call mean in Settings.
**Architecture:** Read-only owner/session-fenced D1 aggregates, strict API contract and a small client panel; reuse the active runtime's budget limits.
**Spec:** docs/superpowers/specs/2026-11-06-owner-ai-usage-design.md

## Constraints and review focus
No provider/secrets/network side effects, no global or foreign-owner data, UTC matching existing quota logic, unknown ceilings separate from known reported costs. Preserve immutable migration history. No final fullcheck until allfive are stable.

### Task1: Read-only aggregate and API
Files: new contracts/api/ai-usage.ts, modules/semantic/infrastructure/d1/usage.ts and tests; worker/routes/ai-usage.ts/tests, routes/operations.ts, composition-root.ts/router.ts; migration0023owner index.
- [x] RED mixed known/finalized-unknown/dispatched-reserved/pending/released and duplicate-window tests; assert exact counts and costs, cross-UTC day/month, future and foreign exclusion; revoked/foreign/expired principal reads fail.
- [x] Implement one owner/session guarded aggregate, no per-reservation response. Limits from validated runtime config; route auth, strict response and no-store.
- [x] GREEN SQLite+route tests; typecheck/scopedlint.

### Task2: Settings panel
Files: new features/final-screens/AiUsagePanel.tsx/CSS/tests; SettingsPanel.tsx and FinalScreenExperience.tsx.
- [x] Read relevant installed Next guide before UI writes. RED tests known-only mean, unknown labels/ceiling, zero known calls, loading/retry and auth/owner response race; accessible table.
- [x] Implement panel and owner-keyed Settings mount, with UTC/asOf and truthful accounting copy.
- [x] GREEN UI/settings tests and accessibility, types/lint; update combined release note and inventory, commit. Continue area4/5; no claim of production activation.
