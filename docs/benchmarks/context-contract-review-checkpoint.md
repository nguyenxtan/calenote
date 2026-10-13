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
