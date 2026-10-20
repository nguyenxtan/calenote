# Typed uncertainty correlation diagnostic plan

**Goal:** Isolate the heterogeneous uncertainty-value union without changing typed carriers, canonical validation, oracle, routing, or paid authority.

**Evidence:** The exact 6e/36 request failed Google compilation with HTTP400. Its generation factor merges distinct field-code branches into one object with a ten-way alternative value union beneath two arrays. That union permits date/time/query objects for numeric fields. Google's compiler internals are unavailable; this is a falsifiable structural hypothesis, not a confirmed state count or provider fix.

**Implementation:** Keep `fieldCode`-bearing object branches correlated using the existing `kind` discriminator rule. Change only this generation factor. Strict schema and decoder remain unchanged. Preserve every strict-valid input-selected field/reason/value combination; reject cross-field types before generation. Retain prior QueryPeriod correlation and non-contiguous code domains.

1. Freeze the rejected generation schema and add failing field/value tests, including mixed alternatives, scalar/date/time/query values, and R02 missing-code holes.
2. Apply the single factor change. Adapt earlier tests that assumed global factorization to test accepted domains instead. Compare expanded schemas and record exact delta paths and branch/array structure, never labeling them Google states.
3. Run focused regression, complete offline suite, typecheck and scoped lint with network/Keychain blocked. Independent code review, then commit the exact candidate.
4. Prepare immutable payload/schema/proposal with the existing reviewed one-request launcher and fresh 47-UNKNOWN ledger pins. Read-only inspector and independent packet review; no authority, credential reads, quota calls, provider calls, Full, or deployment.

Review focus: valid numeric/time/date/query uncertainty values; mixed arrays; reason/field correlation; selected R02 code gaps; strict/canonical/oracle byte identity and fresh account locks/balance. Only a separately approved diagnostic can test Google admission.
