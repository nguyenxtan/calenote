# R01 canonical constraint diagnostics — offline closure

## Preserved checkpoint and artifact sufficiency

Baseline application/harness: `25cdd6dc0e590e6ad04ff032a6587804f9803845`.
Terminal formal Pilot executed two requests: R01 turn zero PASS; turn one HTTP
200, generation `gen-1791188763-NnnNaAg8DxblwdoW8W0I`, canonical root/custom
rejection. R02 was not run. Its immutable execution directory is
`t11-inference-resume-03b8896-20261003/bounded-pilot-executions/r01-validation-4c23a64c20b85a4f153e2eaf6a1538c511b55a3b/PILOT`
beneath the existing local campaign account root.

All JSON artifact shapes were inspected: claims, settlements, turn terminals,
execution record, responses, application evidence, report and terminal record.
Responses retain wire-content digest, byte count, usage, generation identity and
sanitized diagnostics; application evidence retains outcomes and failed oracles.
No raw/decoded ProviderWire, canonical pre-validation object, semantic control
snapshot of the rejected object or original evidence operands were retained.
The SHA256 is not a reversible representation. Exact reconstruction and offline
historical replay are impossible. No missing model value has been invented.

## End-to-end trace and bounded conclusions

The frozen R01 first input is `Có lịch nào ko?`: LIST with null period and
queryRange uncertainty, clarification persisted at revision one. The second
input is `Tháng này có lịch gì ko?`. Local expected proposal is LIST, MONTH offset
zero, DEFAULT status scope, current USER evidence, no reminder changes or target.
Expected month resolution is start 1788195600000/end 1790787600000 (September
2026, Asia/Ho_Chi_Minh), one authorized LIST store read, no reminder mutation,
REMINDERS_LISTED, pendingField null and revision two. All original oracles remain.

`parseGoogleLiteEuContextSectionsV3` decodes the legal wire, supplies application
schemaVersion/default LIST statusScope, then invokes `parseInterpretationSectionsV3`.
Canonical refinement fails before `validateEvidenceV3`, merge, date resolution,
query authorization and oracle acceptance. The retained null queryRange is the
application result after rejection; it does NOT establish that the model period
or canonical period was null. The first null is observable at turn-zero pending
state, retained after the failed turn; rejected input nullability is unknown.

The bb233e9 -> 25cdd6d delta was reviewed explicitly: prompt relation instruction,
internal factBound metadata, relation-only changes/alternatives filtering and
paired query-uncertainty alignment. These run after successful canonical parsing.
They cannot be the executing rejection site of this turn. Prompt changes might
influence model output, but no causal evidence identifies that mechanism.

## Root constraint inventory (same predicates, new identity only)

| V3 identity | Fields / failure condition |
| --- | --- |
| DUPLICATE_CHANGE_FIELD | changes: duplicate field |
| QUERY_INTENT_OWNERSHIP | intent/query/changes: query kind inconsistent with intent, query-branch changes, or nonquery intent carrying query |
| NON_MUTATING_CHANGES | intent/changes: HELP or UNSUPPORTED carries changes |
| REQUEST_TARGET_INTENT_OWNERSHIP | intent/requestTarget/uncertainties: CREATE lacks target, or non-CREATE carries disallowed target |
| REQUEST_TARGET_USER_EVIDENCE | requestTarget/evidence: targeting contains non-USER reference |
| MUTATING_OPERATION_USER_EVIDENCE | changes/operation/evidence: REPLACE/CLEAR lacks USER quote |
| OPERATION_ALTERNATIVE_USER_EVIDENCE | uncertainties/evidence: operation alternative lacks USER quote |
| UNRESOLVED_QUERY_TARGETED_UNCERTAINTY | query/uncertainties: incomplete query lacks corresponding queryRange/intent uncertainty |
| COMBINED_ACTIONS_NON_EXECUTABLE | intent/changes/requestTarget/uncertainties: combined-action uncertainty not AMBIGUOUS/non-executable/UNRESOLVED |

Legacy output has six root checks: shared duplicate/query/CLEAR/unresolved-query
rules plus legacy-specific non-mutating and combined-action descriptors. Input
root checks enforce current/latest USER/role bounds and unique fact aliases.
Nested custom checks cover Gregorian leapMonth, AM/PM hour, slot state/value/fact,
bounded NFC scalar text and input NFC semantic views. Advisory parsing adds no
separate root refinement. Every predicate and original error message is unchanged.

## Implementation and safety

Closed descriptor registry `canonical-constraints.ts` carries IDs, participating
field names, expected category and actual failure category. The rejecting
predicate attaches only its ID to the Zod issue. The diagnostic projector looks
up that ID; it does not re-evaluate semantics or copy issue prose/model params.
Unknown IDs are ignored; recognized IDs cannot inject arbitrary categories or
fields. Descriptors expose categories, not complete operand values. They identify
which rule rejected, not a general explanation of why the producer was wrong.

This is the artifact-insufficient branch, not CASE A-G semantic root-cause proof.
The proven defect is diagnostic identity loss. No prompt, wire, decoder, context
adoption, reconciliation, fixture, validator predicate or acceptance changes.
Semantic evaluation baseline remains 25cdd6d. Diagnostic source bytes do change:
future loaded-runtime proof must use the new diagnostic/harness commit explicitly,
never relabel it as byte-identical to 25cdd6d or reuse consumed authority.

## Verification boundary

- [x] RED: 13 missing-identity tests fail at real rejecting predicates.
- [x] GREEN: root/nested/input/privacy tests and diagnostic projector pass.
- [x] Synthetic R01 turn-one known ownership mismatch reaches actual gateway,
  decoder, canonical rejection and durable response diagnostics; stops safely.
  This is NOT a reconstruction of the historical model output.
- [x] Frozen actual-path R01 both turns and R02 43/43 remain unchanged.
- [x] Full check and independent C0/I0 review.
- [x] Verified local commit boundary; stop before provider reproduction.

Final verification: focused 6 files / 124 PASS; independent 4 files / 96 PASS,
review C0/I0; full `pnpm check` 160 files / 8056 PASS / 2 existing skips,
documentation check, typecheck, lint (0 errors / 167 warnings), build, Worker
types check and deploy dry-run PASS. Initial full command failed before tests
because its isolated PATH omitted pnpm; the corrected runtime PATH completed
the entire command. Network and Keychain execution were blocked throughout.
Read-only accounting inventory matches the terminal checkpoint exactly:
`c81e834a3d38c52069be7ad22a9d9704d905f84f3a07a4f13c8271c585be5eb0`,
24 confirmed requests, $0.0098996 recorded total, 12 historical UNKNOWN,
$1.265664 historical exposure, hash chain PASS. No historical records changed.

No network/provider/Keychain execution, campaign/accounting mutation or remote
operation is authorized. Local tests use fake transport and temporary ledgers.

NEXT_GATE = OWNER_REVIEW_OF_CANONICAL_CONSTRAINT_DIAGNOSTICS_BEFORE_ONE_FRESH_R01_TURN1_REPRODUCTION
