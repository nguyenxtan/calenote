# Narrow semantic completeness amendment

Owner approved continuous implementation on 2026-10-07. Baseline: `75ea549c4ef141ce9f256d54bb1440c4a77fa3c5`.

## Goal and boundary

Prevent silent omission of an explicitly grounded location in a reminder proposal. Source identity alone is not completeness. The backend must never supply a location value, rewrite evidence, repair output, or make a second inference call.

## Contract

After existing canonical/evidence validation and before issuing a validated patch, check current USER semantic view only for a bounded affirmative locative clause: an action phrase (`đi thi`, `thi`, `họp`, `khám`, `gặp`, `đi làm`) followed by `ở` or `tại` and a nonempty bounded place phrase ending at punctuation, end of turn, or eligible finite continuation. Discovery considers discourse markers (`nhớ`, `nhắc`, `nhé`, `nha`, `rồi`, `và`), but creates an obligation only when the shared eligibility boundary accepts their continuation. Scheduling markers require a bounded actual date/day/clock at discovery too. Exact model-authored value must equal that bounded place span, not just a name prefix. This is an omission guard, not a general intent/location parser. Unknown constructions are not silently claimed as covered by this amendment.

Quoted, conditional, interrogative, negated, metalinguistic and removed-control clauses grant no obligation. Only CREATE_REMINDER is checked; side queries and historical turns grant no fresh obligation. Multiple locative clauses remain bounded obligations. Each obligation needs a non-null location change with already validated current source covering that exact clause and the model-authored value equal to its bounded place span; or a grounded location uncertainty alternative covering it; or the exact retained resolved location when CURRENT and no destructive location change is proposed. Uncertainty without grounded alternatives cannot bypass coverage.

Coverage first checks the already proposed/retained exact literal at the locative start and its source extent, ending at a finite continuation boundary or end/punctuation. Date/clock markers require an actual bounded date/day/clock production, not a bare word; discourse markers remain case-sensitive, with nhớ mang/đem/gọi/chuẩn bị, nhắc N/tôi/mình/tui/lúc, rồi về/đi/ăn and và ăn/về/đi/nhắc. Unrecognized lower-case nhớ/nhắc/rồi/và continuations create no obligation, even when a value is absent: discovery and coverage use the same bounded eligibility, rather than pretending to parse arbitrary continuation language. This preserves a full proper venue name containing a delimiter word (e.g. Công ty Ngày Mới) without inventing it. A name prefix followed by another ordinary name word is insufficient, including retained CURRENT prefixes. Backend never returns the matched value.

Failure rejects the entire patch as `SEMANTIC_LOCATION_OMITTED`; no partial merge, preview, query or persistence occurs. Existing safe failure reply handles rejection. No location value or source text is emitted in diagnostics. No obligation object enters canonical state or provider wire.

The model is reminded early to preserve explicitly stated venue independently of missing clock/relation. Pointer v26, canonical schema, source maps, evidence validators, oracle and all authority classes remain unchanged. Prompt digest is repinned, not mislabeled as the old prompt.

## Acceptance

TDD covers the R02 omission, correct grounded change, wrong/null/clear location, uncertainty coverage, retained location, different current location, negation/quotes/hypothetical/questions/control placeholders, side queries, old USER/ASSISTANT sources and immutable input. Existing frozen R01-R16 expectations remain unchanged. Full local checks and independent C0/I0 precede local commit and a fresh Formal Pilot under the existing conservative $5 debug ledger. No push, merge, migration, Full or deployment.
