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

## Follow-up d8bbb45 and inline-text-2 preparation

The separately approved d8bbb45f706ffcb5ec2f9cc4757dde706b8ba09a Formal Pilot also STOPPED after exactly two HTTP200 responses. Its new diagnostics identify R01/1 as UNUSED_TABLE_ROWS in texts, with the same payload digest956639fb75cf7fbfc94cf7012fdec37b855b37adb6074601538dfb0e4f25870c. This establishes the rejected invariant, not the contents of those orphan rows. Actual reported run cost0.0013793USD; UNKNOWN48 unchanged, retained5995927 and remaining4004073 ledger microunits. Paid HOLD, no retry/Full/deploy.

The prepared transport profile106-inline-text-2 eliminates free-standing text ownership. Every change and uncertainty alternative carries both value:number|null and text:string|null: text/enum fields use inline text and value=null; typed date/clock/number/period fields use their existing table index and text=null. CLEAR requires both null. The texts root is explicitly constrained to an empty array in the provider generation schema and strict decoder. It is never silently discarded or repaired. Other table usage checks remain strict. Optional guidance keeps its existing quarantine boundary.

Prompt and wire identities explicitly carry the inline-text-2 suffix; the runner pins the new prompt SHA256a568de0785070bd1fdcb0f2a6e1a1932a6d7f4757fcac66d01b1acc5532cd501. Source/proposal pins prevent historical authorities from selecting this changed grammar. Canonical contracts, typed105 expansion/decoder, oracle and frozen corpus remain unchanged.

Offline qualification:57 tests across codec, gateway, entire corpus and Formal launcher;95 additional compiler-launcher/diagnostic tests. The complete frozen corpus remains80scripts/158turns,144healthy responses,3941detail assertions,5actions,32heldout with zero safety failures. All three synthetic Formal76 paths remain covered. Independent review found no must-fix. Paid compiler admission and real Pilot success of this new profile remain UNVERIFIED; preparation is HOLD only.
