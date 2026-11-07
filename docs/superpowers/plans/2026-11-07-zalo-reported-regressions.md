# Zalo reported regressions implementation plan

**Goal:** Make confirmation and saved Sếp addressing natural, and preserve the calendar intent in the November 7 screenshots.

**Spec:** The user requests Có/Không confirmation, em–Sếp wording, and correction of the pictured scheduling/context failures. Existing lifetime test budget remains USD4; production is still source463 and requires authorization of the final exact SHA.

**Architecture:** Keep V3 source evidence, immutable inbound order, delivered-preview authority, atomic database confirmation, and backend date arithmetic. Natural approval refers to the latest successfully delivered current preview; an approval received before delivery cannot save. Relative calendar months remain months, never an assumed thirty days. Application prose is personalized; user facts and model payload stay opaque.

## Tasks

- [ ] Confirmation: reproduce multi-turn Có failure; allow latest V2 delivered preview independent of draft revision/history. Preserve V1 restrictions, pre-delivery rejection, expiration, ownership, mixed edits, and duplicate fences. Make Có/Không the primary instruction.
- [ ] Persona: RED→GREEN tests for Sếp/em help and canonical clarification; preserve titles, facts, controls, and model opacity. Drop optional model question when safe personalization cannot be proved.
- [ ] Dates: add receipt-relative calendar months on the active V3 carrier with explicit missing-day clarification, preserving historical wire/storage compatibility; test November+4, month ends, receipt anchors, and source ownership.
- [ ] Before-event recurrence: qualify authored week and continuous wording or ask an explicit clarification; never silently turn the request into one notification.
- [ ] Reproduce context failure against the production/current codec paths, run affected tests and full engineering gate, obtain bounded independent review, then bind any paid qualification to the final source. Production promotion waits for exact-SHA consent.

## Review focus

- A late Có must not authorize a superseded preview or an uncertain send.
- A replacement approval must not also save the replacement.
- Preferences cannot rewrite an owner's factual text or fabricate a model statement.
- Calendar months cannot silently become fixed days or clamp a missing day.
- Continuous reminders need a finite window and must preserve the future event date.

## Evidence ledger

- Baseline master9787d2c clean; new work on fix/zalo-natural-confirmation. Fresh read-only Cloudflare metadata confirms old production09d6b952 at100%, deployed November4. The user's screenshots do not exercise the latest merged source.
- User has already asked for autonomous implementation and delegation; use focused workers and do not repeat design/continuation approval questions.
