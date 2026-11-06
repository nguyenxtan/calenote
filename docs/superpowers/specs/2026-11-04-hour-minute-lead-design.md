# Explicit hour/minute lead in chat

User authorizes completing all five feature areas and bounded Claude coding/review. This is area 2; no provider or production authority is added. Base `30f971b`, feature branch, existing Calenote folder.

## Behavior
- User-authored `leadOffsetHours` and `leadOffsetMinutes` are separate positive integer operands. Backend adds them, never asks the model to convert units or calculate a clock.
- A single `BEFORE_EVENT` reminder requires event date and event clock. Missing clock asks for the event clock. Unstated cadence may use the existing backend ONCE policy; an explicitly repeated cadence/count does not become ONCE.
- Compute `event instant - (hours*60 + minutes)*60000` in Asia/Ho_Chi_Minh. Cross-midnight is valid. Past/equal-now instants, more than 366 days in the future, or a total duration above 366 days clarify without saving. Integer fields individually bounded to hours8784/minutes527040; combined duration remains bounded.
- Explicit reminder date/clock together with a duration is a clarifying conflict. Day-offset plus hour/minute duration is also a clarifying conflict in this slice. DAILY/WEEKLY/MONTHLY/count>1/end-date plus duration is not executable.
- Explicit duration overrides saved advance defaults; one notification only, no advance group.
- Computed reminder date/time exist only in canonical occurrence timestamps. Never mint user/derived reminderDate/reminderTime facts for the computed time. Editing event time recomputes the preview; confirmation re-resolves and rejects elapsed instants.
- Preview includes the actual timestamp and hour/minute rule. Canonical persisted detail/occurrence shape stays unchanged.

## Source authority
- Verify already-proposed amount/unit against exact USER evidence and surrounding clause. Helpers may reject unsupported proposals; they must not author operands from text.
- Accept explicit Vietnamese “trước3tiếng/3tiếng trước”, “trước90phút”, “trước1tiếng30phút” with ordinary spacing and supported small-number words. Preserve source numbers/units.
- Reject negation, hypothetical/quoted instructions, foreign clauses/counts, fractional/zero/negative operands, half/to-clock forms, and ambiguous “trước3giờ chiều” clock usages. Never trim away a dangerous suffix to obtain permission.
- If a stated supported duration is omitted by a model, no preview may silently use advance defaults or a different clock. A boolean coverage/exclusion guard must fail closed; it cannot produce a missing operand.

## Contracts and compatibility
- Keep the 13 legacy SLOT_NAMES and uncertainty codebook V1 byte-for-byte. Append V3 slot names and a V2 codebook with hours16/minutes17 (V1 already uses0–15). Extend selected V3 semantic paths only.
- New stored slots optional; omit absent/MISSING extension slots when encoding. Old snapshots without new keys must retain exact round-trip bytes and remain readable; new contexts using extensions may fail closed in a rollback until expiry. Do not change stateVersion/canonicalVersion or encryption identity.
- Carry source evidence, fact aliases and conflict/clear/replacement semantics through context build, merge, resolve and confirmation. No numeric count/day authority may be borrowed.
- New keyed prompt146/wire137/capabilities3/codebook2. Keep inputVersion2 as a backward-compatible optional extension unless actual protocol validation proves a new input version necessary; report that finding before inventing a broad migration. Advertise HOUR_OFFSET supported only with implemented evidence/resolution/wire paths.
- Old fixtures remain immutable. Source hashes145 are anchors. A new fixture is qualified offline with synthetic transport and independently reviewed schema differences; root owns final qualification. No provider requests or keys.
- No SQL migration, production changes, new dependencies or unrelated refactor. EU/ZDR model/provider, reservations, pricing and cap4USD stay unchanged.

## Verification
Exact service-created preview/confirm/replay, explicit default override/no group, cross-midnight, missing event clock, clock/day/count conflicts, 366-day bounds/past-at-confirm, edits recompute, malicious/ambiguous evidence, omitted duration refusal, codec roundtrip and historical compatibility. Focused suites + typecheck/lint; one combined full check only after all five areas are stable.

## Implementation/compatibility evidence
- Core plus selected keyed transport implemented; typed bridge emission is now106 and selected keyed emission137, with codebook2; the immutable V1 code map remains0–15. General canonical/state/encryption identities stay3/state2.
- Historical105 strict schema SHA reproduced from sourcecae6d79, then independent successor106 qualification preserves codes0–15 field/value/reason correlations and adds16/17. All four145request anchors were verified from saved full captures; restoring only145prompt, capabilities2 and old output schema/name reproduces every145hash. Model/provider/pricing/reservations unchanged.
- Old snapshots with no extension keys preserve exact bytes. New contexts with duration extensions fail closed under an older binary until expiry. Clearing removes the extension fact and key, with current draft revision retained at context level; a later REPLACE of an absent extension cannot manufacture an old value.
- Typed slots may be proposed together with incompatible cadence operands so the existing target-aware resolver can clarify rather than erase user intent. They never execute with a repeated cadence or count>1.
- Lint/typecheck and focused service/codec/state/source suites run; full final application check remains deferred to all-five combined source. Zero provider calls in this phase.
