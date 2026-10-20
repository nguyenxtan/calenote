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

## Follow-up 3a2d871 and inline-values-3 preparation

The separately approved3a2d8714639961965c26112c02ac06e7c738004c Formal Pilot STOPPED after exactly two HTTP200 responses, at R01/1 with UNUSED_TABLE_ROWS in dates. No raw body was retained, so the unused date contents are unknown. Exact reported run cost0.0014281USD; UNKNOWN48 unchanged, retained5997356 and remaining4002644 ledger microunits. Paid HOLD, no retry/Full/deploy. This is a new rejected invariant, not proof that other cases passed.

Profile106-inline-values-3 replaces shared date indexes with consumer-owned typed cells: [] for no date or [one fully typed padded DateOperand]. Change and uncertainty date fields use value=null,text=null,date=[...]; nondate owners require date=[]; CLEAR requires value=null,text=null,date=[]. Query.date is reserved for CALENDAR_QUERY. Period.date/from/through each own their typed cell and retain canonical active-member checks. Inactive month/week boundary dates are rejected, never ignored or repaired. The root dates array, like texts, is constrained to maxItems0 in generation and strict decoding. Clock/integer/period tables remain reference-checked and reject unused rows.

Date objects retain explicit primitive member types and inactive-null checks. There is no JSON-in-string, heterogeneous union, recursive reference, calendar conversion, inferred year or runtime deletion of provider data. Canonical contracts, typed105 decoder, frozen corpus and oracle remain unchanged. Protocol/prompt identities advance together; prompt SHA25642e3d96ad586ce16b8e8bf7833fabb5bee37a59313ba9570029a44fdddd788d4. No previous paid grant applies to this new source.

Paid admission and Pilot success for inline-values-3 are UNVERIFIED. This section describes preparation only; the external source-bound packet records offline verification and CI separately. The default and terminal paid state remains HOLD.

## Follow-up b1a2ed6 and inline-values-4 preparation

The separately approved b1a2ed6 Formal Pilot STOPPED after two HTTP200 responses: R01/0 passed, R01/1 failed WIRE_DECODE_FAILED with TABLE_REFERENCE_INVALID in periods. No raw body was retained, so the actual invalid index is unknown. Reported cost $0.0015341; ledger debit1535microunits. UNKNOWN48 unchanged, remaining4001109 of10000000 microunits. Paid HOLD; no retry/Full/deploy.

Profile106-inline-values-4 removes period indexes from the provider grammar. Query.period and queryRange alternative.period own [] or [one typed padded period object], with typed date cells inside. Root periods is constrained empty. QueryRange alternatives require null value/text and empty date; other alternative types require empty period. Non-LIST query periods, inactive members, legacy indexes, duplicate cells, orphan rows and mixed values are rejected, never repaired. Clocks and integers retain strict indexed-table checks. No heterogeneous unions, references or JSON-in-string are added. Canonical contracts, typed105 decoder, corpus, oracle, model and provider remain unchanged.

This is offline preparation only. Paid compiler admission and Pilot success remain UNVERIFIED. No consumed authority can be reused. The external immutable source-bound proposal and separate CI evidence govern any later explicitly approved run.

## Follow-up 65fbff4 and nested typed-query diagnostics

CI39379582477 completed SUCCESS for65fbff48648ea87f0f9cd8940a01cf3cfb2a4d98. Its separately approved single Formal Pilot STOPPED after two HTTP200 responses. R01/0 passed; R01/1 failed at the strict typed-wire query validator with WIRE_DECODE_FAILED and path query. This was downstream of the small-table expansion, with no smallTables failure. No raw model body was retained, so the failing child field is UNKNOWN. Do not infer that a particular offset, topic or calendar value caused the actual failure. Cost0.0016417USD; UNKNOWN48 unchanged, remaining3999467 of10000000 ledger microunits. Receipts, ledger hash chain, consumed markers and released account lock verified; paid HOLD, no retry/Full/deploy.

The diagnostic-only follow-up projects the strict typed validator's complete bounded sanitized issue tree through the existing privacy projector instead of replacing the entire error with its first parent path. Tests reproduce invalid query topic/outputCalendar and nested period offset, retain refusal, expose the child paths and exclude private sentinel text. Every validator, predicate, generation schema, prompt, model/provider, canonical contract and oracle remains unchanged. This improves evidence for a later authorized run; it does not establish that the real semantic failure has been fixed or that Pilot passes.
