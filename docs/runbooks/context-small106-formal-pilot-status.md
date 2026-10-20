# Small wire106 Formal Pilot status — 2026-10-20

## Verified results

Compiler diagnostic at eb6e34fe1a0d30c91c6373e84f6938f749446026 made exactly one inference request: HTTP 200 and strict R01/0 oracle PASS. It earned no Pilot credit.

Formal launcher source 6ad6be19284b2f25a5c3b8abbfcc830cb7710bce passed CI39364035041: 225 test files,10109 passed,2 skipped, plus the remaining engineering gates. Its source-bound authority3/debug3 selects SMALL_106 without changing canonical/oracle/model/provider. The frozen proposal SHA256 is 567805c57dfec97a4af6856089f64511788817e39fd2e71304a34fdf16a938cc.

The paid Formal Pilot STOPPED after exactly two inference requests, both HTTP200:

- R01/0: application CLARIFICATION_REQUESTED and oracle PASS.
- R01/1: wire decode refused, SCHEMA_INVALID; application REJECTED, oracle FAIL. The decoder reported only root WIRE_SHAPE_INVALID. This does not identify the actual failed table invariant. No raw model content was retained, so the failed object cannot be reconstructed from the receipt.

There was no observed compiler state-limit rejection in these two requests. This is not evidence that all remaining requests will compile or pass. Formal Pilot remains UNQUALIFIED. No retry, Full, merge, deployment or production activation occurred.

Accounting after STOP: 988 confirmed settlements,931891 confirmed ledger microunits,48 UNKNOWN unchanged,5062656 conservative UNKNOWN exposure microunits. Total retained5994547; remaining4005453 of10000000. Ledger hash chain PASS. Paid returned to HOLD.

## Diagnostic repair

The small-table decoder previously collapsed generation-shape errors and all invariant failures into one root diagnostic. It now reports finite decoder-owned smallTables.reason and optional table, with sanitized Zod paths. It distinguishes out-of-range references, unused rows, evidence/cardinality/order errors and inactive columns. It retains no authored text/error messages. Every acceptance predicate, generation schema, prompt and downstream typed/canonical decoder remains unchanged.

Regression tests cover refusal classifications, private sentinel exclusion, observer failure isolation, unchanged input, and the entire offline corpus80scripts/158turns. This repair is diagnostic visibility, not a claim that the actual R01/1 semantic failure has been fixed.

## Next execution gate

The completed Formal attempt and its direct-owner grant are consumed. Do not replay it, alter its terminal/ledger or manufacture a new owner digest. The launcher binds each paid grant to reviewed source/proposal and refuses a consumed direct message across namespaces. Any next paid execution requires the applicable fresh owner authority and a reviewed clean source/proposal, successful CI and key metadata gate. Preserve cumulative10USD,UNKNOWN,model/provider/canonical/oracle, no retries/fallback, no Full/deploy. Diagnostic evidence must determine the actual refusal before changing semantics or weakening validation.
