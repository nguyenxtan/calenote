# Context Contract V3 review checkpoint — 2026-10-13

Status: **development foundation ready for draft review; Formal Pilot not passed**.

This checkpoint accompanies the full `codex/llm-context-contract-design` branch against `master`. It records local validation and the remaining live failure separately. It is not production acceptance, migration approval, or deployment evidence.

## Scope

The branch contains the V3 semantic contract, application-owned state/evidence/target boundaries, strict provider wire, structural diagnostics, bounded candidate validation and accounting, migration, UI/Worker integration, and their design and qualification artifacts.

The final repair is wire104: generic notes-grounding guidance in the prompt. Scheduling-only text must not become notes merely because it supplies schedule fields. Explicitly requested notes, independent grounded details, eligible retained notes and SET/REPLACE/CLEAR ownership remain valid. Availability of the notes field is not evidence for a notes value.

This final repair adds no R03 source classifier or runtime guard. Schema, decoder, backend, oracle, source ownership, date/rank representations and provider settings are unchanged. Current prompt SHA-256 is `5088b17951d80be7df8987f5df771750ae91c4fd0d42dc9ed0ec9c0fa06909d9`; metadata identifies wire104. Historical prompt hashes remain asserted through explicit test-only restoration fixtures.

## Local validation

| Check | Result |
| --- | --- |
| Focused provider, notes and semantic-completeness suites | 492 passed |
| Corrected final notes fixture suite | 10 passed |
| Typecheck and scoped lint | Passed |
| Full-environment lint baseline | 0 errors; 169 existing warnings |
| Documentation checks and build | Passed |
| Strict token fit | 67 passed; existing 12,000 input / 1,536 output ceilings |
| Historical authority/representation suite | 195 passed |
| Frozen full suite | 201 files; 9,755 passed; 2 existing optional skips; 850.64 seconds |
| Independent final scoped review | No unresolved findings |

The first typecheck found an `unknown` fixture result being mutated. The fixture now parses through the canonical schema before authoring changes; final typecheck and tests passed. Runtime behavior was not changed to resolve that test typing issue.

The full suite ran once on fixed implementation and test bytes. Freeze checks matched after completion. This documentation checkpoint was added afterward; documentation validation was repeated. The reviews and local results do not establish acceptance of the entire foundation in production.

## Latest paid result and open issue

Latest paid candidate: wire103, `57619590a180fa64100a69eaf883c2de8b4ad283`.

Run `debug-c61404a1defa288c4914e3b1e68c3eba315a3bde` stopped after seven HTTP 200/provider calls. Every response passed canonical validation. Both R01 turns, all three R02 turns, and R03T0 passed their oracles. R03T1 reached `DRAFT_CREATED`, but its two notes/preview-notes assertions failed: expected null, observed a string. The private string's content and the model's motive are unknown; no payload reconstruction was used.

Public offline controls reproduce the ownership boundary without provider calls: the exact R03 relation-only answer is outside the existing notes-free guard; a supplied scheduling-as-notes proposal remains accepted by the unchanged decoder/service. Explicit notes, independent details, retained notes, replacement and clearing remain accepted. These controls validate preserved behavior and the authoring-policy distinction, not the live effectiveness of wire104.

**Wire104 has not been evaluated live.** No paid request was made after the instruction to finish the current work and publish a PR. Formal Pilot remains incomplete; its oracle has not been weakened, and a settled semantic failure was not replayed.

## Accounting and delivery state

Last settled accounting: 947 confirmed calls, 891,765 ledger microunits; reported confirmed cost approximately $0.891336. UNKNOWN holds remain $4.218880, execution claim is zero, the ledger chain passes, and conservative headroom is $4.889355 under the existing $10 cap.

Provider/model remain `google/gemini-2.5-flash-lite` via `google-vertex/eu`, retry 0 and fallback none. Credential material, provider payloads, detailed ledger and execution artifacts remain in ignored local storage and are not part of this checkpoint.

The draft PR is for review only. No merge, remote migration, resource change or deployment was performed in this handoff. The worktree remains available for subsequent review and separately scoped qualification work.

## Production-base offline integration — 2026-10-16

The isolated feature integration reconciles exact PR #11 head
`f8fb2a37e52d6632dcc01dfd28e93f6006ca9578` with production source
`dde4968e0f02e5680880bc5a635e181b4d8e32dc`. This is local preparation,
not a merge into master or deployment.

The existing pages retain the complete authenticated keyset reminder list.
Successor details and preview UI require the explicit component capability,
which defaults off; ordinary pages therefore do not acquire a migration 0009
dependency. Calendar lunar presentation, series controls, stale-read fencing,
mutation serialization and cancellation read-back remain available. Cancellation
uses the existing canonical DELETE route. The successor runtime capability is
absent by default; V2 local date/month/lunar/help routing and its allowlisted
failure telemetry remain wired independently.

Fresh offline checks on the integrated tree: 52 context/API/V2-activation suites,
3,159 tests passed; six production compatibility/local-read/failure/delivery
suites, 157 tests passed; four UI/client integration suites, 27 tests passed.
Typecheck, scoped lint, canonical documentation checks and diff checks passed.
These are synthetic/local tests, including local encrypted D1 fixtures. No new
full-repository check, browser visual acceptance or live-model result is claimed.

The historical wire103 failure and unevaluated wire104 status above remain.
Formal Pilot and Full qualification are still incomplete. Migration 0009 is
local review material only; provider/model/oracle/budget/protocol are unchanged.
No paid call, historical HOLD/UNKNOWN release, remote database operation,
master promotion, production activation, upload or deployment occurred.

## Dormant web factory completion — 2026-10-16

A subsequent factory-level audit found that the existing V3 backing store and
injected-operation route tests did not establish real application composition:
`createContextApiOperations` returned an empty preview list and unavailable
decisions, while its detailed-list path queried migration 0009 unconditionally.
These were unfinished offline integration boundaries. Spec §8.2 permits dormant
T1–T10 implementation while provider admission B is unresolved; B still blocks
network dispatch and release activation.

The factory now accepts the same explicit successor capability/source-SHA shape
as the runtime factory and rejects opt-in without a valid explicit source SHA.
Only opt-in selects the canonical V3 store and connects real owner/session-scoped
preview listing, revision-bound save/decline and complete reminder details.
Without opt-in, previews remain empty and decisions/details return the typed
unavailable result before querying successor tables. Router defaults and pages
remain unchanged. This is composition readiness, not production activation.

The factory regression tests use real local D1-compatible SQLite, a real hashed
session, an encrypted V3 snapshot, the actual Worker router and the actual store.
They establish full preview/save/idempotent replay/detail read-back, owner
isolation, decline/replay, revoked-session refusal and migrations 0001–0008
safe defaults. No provider, wire, prompt, oracle, budget or protocol changes.
Formal Pilot, Full qualification and paid HOLD remain unchanged.
