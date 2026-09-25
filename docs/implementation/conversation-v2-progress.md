# Conversation V2 execution evidence

Plan: `docs/superpowers/plans/2026-09-25-conversation-v2-urgent-lunar.md`.
Execution base: `cab27b641e49bca082927ff5cf0be61105607338`.
User requests whole-package UAT review; implementation runs inline, with a
fresh independent whole-branch review before release. No per-task human review.

## Decisions and delivery boundary

- Keep burst/consecutive-message orchestration deferred until after admin.
- Future admin gets Releases and Features: exact deployed version, features,
  availability/acceptance, environment, change notes and rollback baseline.
- The user uses the current domain for UAT. Its resources remain labeled
  production in reviewed configuration; do not silently swap credentials or
  relax immutable-SHA deployment approval based on terminology alone.
- The V2 provider DTO contains no internal identifiers or conversation claims.
  Use bounded title/recent turns, not the full persistence object.

## Task 1 — semantic-only contract and shared gateway

- RED: fail-closed schema scaffold rejected valid V2 payloads (5 failed/17 passed).
- RED: V2 gateway export absent (9 failing tests); then implement the shared
  contract-selecting gateway without changing the default V1 request envelope.
- Focused: 73/73 PASS (new contract/prompt + existing OpenRouter adapter).
- Typecheck: PASS. Scoped ESLint: PASS. Diff validation: PASS.
- Full fresh suite: 79 files / 1507 tests PASS, 85.85 seconds.
- Baseline: 77 files / 1476 tests PASS. Node emits its existing experimental
  localStorage warning; it is not a test failure or a new runtime diagnostic.
- No production bindings/configuration, secrets, provider calls or deployment.
- Task implementation checkpoint only; whole-branch acceptance remains pending.

## Remaining work

Tasks 2–9 remain. No user-facing V2 capability is enabled or deployed.
