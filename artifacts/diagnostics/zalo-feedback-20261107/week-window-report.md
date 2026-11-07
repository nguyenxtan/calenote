# Authored week and continuous clock regression

Implemented by the week worker, coordinated with the relative-month worker for schemas, persistence, resolver and active wire codecs.

## Result

- `Nhắc trước 1 tuần. Liên tục vào 8h sáng.` authors the value `1` in `leadOffsetWeeks`, `DAILY`, `BEFORE_EVENT` and the authored reminder clock. The model supplies neither seven days nor a seven-notification count.
- The backend converts the week to days and expands a finite before-event daily window. With event 20 October 2026, the active keyed service test confirms seven reminders on 13–19 October at 08:00 local time after the user answers `Có`.
- Explicit `ONCE` with the same authored week creates one reminder on 13 October at 08:00.
- A continuous clock without finite bounds must clarify a count/end rather than preview or save an unbounded schedule.
- Exact amount/unit checks and existing user quote, surrounding negation and hypothetical guards remain mandatory. Omitted weeks or continuous DAILY, wrong units/amounts, clipped foreign evidence, computed count seven, fractional/oversized week omission, and clearing a retained operand cannot silently create a default single reminder.

## TDD and checks

- Initial RED: five missing continuous clock cadence cases and the missing authored-week generation capability.
- Evidence RED: fifteen missing unit/value, relation, omission and continuous-fidelity cases; then GREEN.
- Further RED/GREEN: unsupported week omission (three cases) and retained CLEAR bypass (two cases).
- Source guards: 36 tests plus the field capability regression pass. Existing cadence/day/duration safety coverage also passed (204 tests before the final five guard cases were added).
- Three actual active keyed gateway service tests pass: confirmed finite daily weeks, confirmed once weeks and unbounded continuous clarification. Initial service RED was recorded before shared codec/resolver work. Final combined focused command passed all 212 tests across six files; the generation capability regression also passed separately.
- ESLint on the nine owned source/test files and `git diff --check` passed. Root owns the final full-suite/typecheck/build result after all parallel work is integrated.

## Limits

This work verifies a finite vocabulary of explicit digit or `một`/`hai`/`ba` week distances and exact continuous clock phrasing. It does not add a general natural-language parser, infer request action/target, invent an unstated schedule bound, or claim live-model reliability. All provider responses were offline fixtures through the real active keyed gateway; no paid/provider, Cloudflare or GitHub operation was run.
