# Product Experience V2

Approved by the user on 2026-09-24 for integrated implementation, verification,
merge and production delivery. Supersedes the prior blue visual direction.

## Scope and acceptance

- Warm orange/cream shared tokens, self-hosted Vietnamese typography, restrained
  font weights, consistent controls and spacing across public/authenticated routes.
- Today is a Vietnam-local-day projection: future active today, later days,
  overdue/error attention, sent today history. No delivery state changes.
- Settings exposes all existing address/tone capabilities, custom appellation,
  explicit save feedback/locking, local browser density, honest account details,
  connection/activity links and plain-language privacy guidance.
- Login/onboarding share colour, typography and control geometry. Preserve their
  existing security/state transitions.
- Inbox/reminders get useful empty states, separated headings/tabs and content.
  Activity becomes a compact timeline. Mobile calendar retains day selection.
- No new notification/session-management subsystem, no migration, no AI routing
  change. Those features require their own backend and remain unimplemented.

## Execution

1. Add tests and implement date/status projection.
2. Reconcile design tokens, font assets, brand, public/auth screens and app shell.
3. Implement supported Settings preferences and consolidate content surfaces.
4. Focused tests, full check, desktop/mobile browser QA, independent review.
5. Commit, normal PR/CI/merge; record immutable reviewed master and obtain its
   exact-SHA deployment approval per AGENTS.md. Record rollback and verify production.

## Verification evidence (2026-09-24)

- Fresh `pnpm check`: 77 Vitest files / 1,476 tests PASS, current-state docs test
  PASS, typecheck/lint/build PASS, Worker types and deploy dry-run PASS.
- `git diff --check`: PASS. No migration, Worker config, credentials or provider
  logic changed.
- Independent review after corrections: 0 Critical, 0 Important, 0 outstanding
  Minor. The reviewer independently ran 47 focused tests.
- RED then GREEN coverage for refreshing delivery status on focus and bounded
  timer across local midnight, unmount cleanup, and Settings unsaved-edit notice.
- Local fixture browser QA: desktop Today/Settings/Activity/Inbox and mobile
  Settings/Calendar/Login/Onboarding inspected. Fixture data only; this is not
  authenticated production acceptance.
- Today refreshes authenticated reads on focus/visibility and each visible minute;
  request ordering prevents an older response from replacing newer state.
- Settings currently exposes existing backend preferences only. Account editing,
  multiple-device session management and delivery preferences remain future work.
