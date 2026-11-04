# Finite weekly/monthly reminders — design

Baseline 76d3741. User asks for an actionable feature backlog, Claude cross-review and immediate implementation; ordinary design choices are delegated. Claude completed bounded cross-review; the decisions below are confirmed engineering choices under the user's delegated execution request. Work stays in the existing Calenote folder on feat/finite-weekly-monthly-reminders; no production mutations.

## Intent and scope

Make common weekly and fixed-date monthly reminder requests work through the existing chat interpretation, exact preview, confirmation and saved series controls. LLM supplies grounded operands; backend expands timestamps. Cron/reminder delivery adds no model call. Existing ONCE/DAILY/advance schedules remain unchanged.

- GREGORIAN solar recurrence in Asia/Ho_Chi_Minh; weekly uses the starting weekday, monthly uses the original anchor day-of-month.
- Finite 2–30 occurrences or an explicit inclusive end date, within the existing 366-day horizon. Require missing count/end information; no silent indefinite schedule.
- At least a known start date and reminder clock. Ambiguous weekday/week remains clarification. Start-in-past remains refusal/clarification; no silently advancing a requested start.
- Explicit cadence overrides day/hour advance defaults. Preserve request-time policy, provenance, exact occurrence preview and confirmation-time re-resolution.
- STARTING_ON schedules only in this first slice. Do not reinterpret DAILY event-relative semantics, one-off distances, multi-weekday patterns, monthly nth-weekday or lunar-month recurrence as supported weekly/monthly patterns.
- No new provider, queue setting, paid model, credential, external resource or remote migration is assumed. Inspect persistence constraints before deciding whether any additive local migration is required.

## Approaches considered

1. Reuse existing WEEKLY/MONTHLY semantic frequency operands and canonical arbitrary timestamps/series persistence. Smallest authority change and no new model arithmetic. Recommended.
2. New RRULE/generic recurrence engine or unbounded recurring jobs. More surface and different termination/dispatch semantics than this finite request; defer.
3. Weekly-only first. Cheapest but leaves monthly gap; acceptable fallback only if review finds a concrete blocker to a bounded fixed-date monthly implementation.

## Month-end decision (Codex proposal endorsed by Claude)

Keep the original anchor day. Never use JS Date overflow to turn 31 February into a March date, nor chain a clamped February date and drift later months. If any requested occurrence has no such day in its month, return a precise clarification before any save; preserve the user's date instead of silently changing or omitting it. Existing life-event missing-day settings belong to a different contract; do not borrow them implicitly. Support a chosen last-day policy only as a separately explicit operand/UI contract later. Exact calendar counts/end boundaries must be tested, including leap years.

## Grounding and compatibility

Do not let a duration/count in another clause authorize recurrence. Extend boolean evidence checks only for already-proposed weekly/monthly frequency/count/STARTING_ON operands, retaining negation, quotes, hypotheticals, exact spans and unrelated-number guards. A phrase counting weeks/months must agree with the actual cadence; a before-event distance is not a count. No second natural-language parser may manufacture operands.

Update capability reporting, missing-field questions, unsupported copy and keyed model guidance together. Preserve immutable 144 fixtures; if request prompt/capabilities change, create a separately qualified successor request fixture proving only reviewed differences. Keep wire/slot shape stable unless review identifies necessity. Current source must continue reading stored ONCE/DAILY/advance metadata; rollback remains constrained by those strict envelopes.

## Proof required

- Pure resolution: weekly dates across month/year, monthly from original anchor, leap/non-leap February, missing day, count and inclusive end consistency, 30/366 bounds, past/missing/ambiguous input, lunar/multi-pattern rejection and explicit cadence overriding defaults.
- Evidence: positive weekly/monthly Vietnamese, negative/quoted/foreign counts, mismatch between days/weeks/months; old daily/one-off proofs unchanged.
- Service+D1: preview exact timestamps, addressed confirmation saves once, replay/idempotency, stale/past-at-confirm refusal, ownership, web series list and remaining-occurrence cancellation. Existing daily/advance settlement must remain distinct.
- No paid/live call during implementation or Claude review. Final production/live acceptance still requires explicit exact-SHA approval and budget admission. Report source capability separately from deployment and observed delivery.

## Cross-review decisions

Claude confirms no migration or persistence/slot change is needed. Add explicit FINITE_WEEKLY/FINITE_MONTHLY input capability tokens with capabilities-2 and qualified keyed145 request metadata; output wire136 is unchanged. Fix times-per-period grounding (including the proven daily safety case), named-weekday/start-date conflicts and multi-weekday rejection, and cadence-matched STARTING_ON support. These guards validate proposed operands only. Inferred findings must be demonstrated by RED tests before implementation.
