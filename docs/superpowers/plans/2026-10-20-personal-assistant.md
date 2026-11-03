# Personal assistant implementation plan

> Use superpowers:subagent-driven-development for independent modules and execute integration in this worktree.

Goal: deliver the approved life-calendar, deadline strategy, daily review and explicit personal-memory capabilities.
Architecture: shared Zod document contract with encrypted per-owner D1 storage and revision compare-and-swap; deterministic annual planner; web workspace; bounded dispatch integrated with existing runtime where feasible.
Tech stack: existing TypeScript, React, Next static export, D1, keyring, Vitest.
Spec: ../specs/2026-10-20-personal-assistant.md

- [x] Define shared contracts and calendar planning; test lunar/solar edge cases and bounded offsets.
- [x] Implement owner-scoped encrypted storage/API with CAS, session and same-origin protection; migration locally only.
- [x] Implement accessible life events, memories and daily preferences UI and tests.
- [x] Integrate runtime, navigation and daily agenda; verify real DB transactions, boundaries and no duplicate scheduling.
- [x] Run focused tests, typecheck/lint/build; independent review, fix findings and document qualification limits.

Review focus: invalid anniversaries; cross-owner access; concurrent edits; interrupted delivery and duplicate dispatch; secrets/personal content at rest.

Rulings: explicit one-off year supports actual expiry dates; defaults off for all new automatic delivery; memory-only edits use keyed schedule fingerprint and do not revoke pending work; manually snoozed/rescheduled lineages never auto-respawn. Production qualification remains a separate exact-SHA gate.
