# Count/offset ownership implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Owner authorizes continuous execution and one independent whole-delta review, without routine approval pauses.

**Goal:** Prevent retained series count from granting an independent equal lead offset.
**Architecture:** Add optional trusted series context to the existing boolean offset support verifier. V3 evidence admission supplies it only for CURRENT from the private snapshot. Keep all exact-source protections and exact inherited fact reuse; reject whole invalid proposals, never rewrite.
**Tech stack:** TypeScript, Zod, Vitest, existing application/D1 and debug harness.
**Spec:** `docs/superpowers/specs/2026-10-07-count-offset-ownership.md`.

## Constraints and review focus

Preserve wire/canonical/oracle, pointer/completeness/target guards, model/provider and $5 accounting/history/UNKNOWN. Review equal-count ambiguity, explicit independent offset, different-offset conflict, exact fact carry-forward, NEW isolation, negated/different-clause wording, uncertainty alternatives and no partial mutation.

## Task 1 — Contextual admission

Files: `src/modules/conversation/context-contract/lead-offset-evidence.ts`, `evidence.ts`, `lead-offset-evidence.test.ts`, `offset-admission-diagnostics.test.ts`, `prompt.ts`; prompt digest pins in `tools/benchmark/context-contract-runner.ts`, `context-contract-fit.test.ts`.

Interface: `supportsLeadOffset(value,evidence,turns,seriesCount?:number):boolean`; `validateEvidenceV3` supplies count only for a trusted CURRENT DAILY series. Existing valid-patch and refusal contracts unchanged.

- [ ] RED actual R02 count2/context + bare before2 rejects; count alone/unrelated2 reject; explicit independent offset accepted, distinct offset3 reaches conflict, carry-forward and NEW isolated.
- [ ] Run `pnpm test src/modules/conversation/context-contract/lead-offset-evidence.test.ts src/modules/conversation/context-contract/offset-admission-diagnostics.test.ts --maxWorkers=1`, verify expected RED.
- [ ] Implement narrow contextual gate preserving exact span/clause/source checks and inherited facts; update early prompt instruction and actual digest pins.
- [ ] GREEN focused command above plus `pnpm test src/modules/conversation/context-contract tools/benchmark/context-contract-fit.test.ts --maxWorkers=1`.
- [ ] Independent whole-delta review C0/I0; fix findings with TDD.
- [ ] Full no-network verification: `pnpm test --maxWorkers=1 && node --test docs/architecture/current-state.test.mjs && pnpm typecheck && pnpm lint && pnpm build && pnpm exec wrangler types --check && pnpm exec wrangler deploy --dry-run`; `git diff --check`. No edits during the suite.
- [ ] Selective local commit and truthful progress evidence.

## Task 2 — Fresh Pilot

- [ ] Existing debug executor preflight derives immutable loaded-source identity and cumulative conservative accounting; no reset/release.
- [ ] Fresh frozen Formal Pilot through approved executor, max76 requests/one per eligible turn, retry0/fallbacknone, terminal at first failure.
- [ ] Settle actual known cost or conservative UNKNOWN. Same-scope failure: offline TDD/review/check/new candidate then fresh execution; never reopen history.
- [ ] Stop at Pilot PASS or owner-defined scope/security/budget/production gate. Record actual evidence; no release.

## Local acceptance evidence

Actual R02 and three lexical variants RED: canonical offset2 appeared despite retained series context. Contextual gate GREEN. Reviewer initially C0/I1 for unrelated marker borrowing across conjunction; six helper/service regressions RED, immediate marker attachment GREEN. Final independent review C0/I0/M0, focused130 PASS/2 existing skips. Full fixed-source no-network run exit0:175 files/8429 PASS/2 existing skips; documentation/typecheck/lint/build/Worker types/dry-run PASS, lint0errors/168 existingwarnings. Diff check PASS. First full run deliberately stopped before review-fix edits and is not acceptance evidence. No credentials or provider calls during implementation. Wire/canonical/oracle unchanged; prompt digest86f00c1c5fca9855f5ae20b164b94e30caa127e8d342b2c8dc1a3c39ae99a18f.

## First new live result and prompt delivery correction

Candidate77d8891: trusted identity/accounting/credential PASS; four calls, R01 turns0–1 and R02 turn0 PASS, R02 turn1 terminalFAIL. Model still proposed equal offset2, but new field-value gate correctly rejected it (current USER pointer, FAIL). Whole proposal rejected, zero mutation/read in failing turn; no partial rewrite. Four authoritative costs total0.0036424 USD, settledKNOWN; conservative remaining2.742398 USD, UNKNOWN2.109440 USD unchanged, hashchainPASS. Generation gen-1791354423-0CswwH0VCqfJ0FBITrqE. Frozen historical result remains FAIL.

The pending question was reminderTime, not eventRelation. Existing prompt's pending-question-specific phrasing could be misread as allowing offset outside the relation question despite the general rule. Add a final context-slot ownership check independent of pendingQuestion.field, distinguishing bare equal-count answer from independently stated start/single instruction. No backend/wire/schema/oracle changes. Fresh local verification/review/commit before another fresh Pilot. Prompt digestf76060e99e0295dc66eb7b5a10555412bf4fe0f91eb8c98fcb909600b7ab637a.

Prompt delivery correction accepted independently C0/I0/M0; focused130 PASS/2 skips; fresh full175 files/8429 PASS/2 skips, docs/typecheck/lint/build/types/dry-run exit0, lint0errors168existingwarnings, diffPASS. Live result not inferred from local checks; new immutable candidate and trusted fresh Pilot next.

## Fresh 211136b result and cadence grounding delivery

Fresh Pilot211136b terminalFAIL after14 calls: R01–R04 all turnsPASS, including R02 relation-only and draft preview. R05 turn0 model inferred frequencyONCE from an offset-only request; frozen expectation frequencynull pending reminderTime. Exactly one oracle failure fields.frequency; source/offset validation passed, failing turnzero reads/mutations. Generationgen-1791355286-XtYUECPf0rZteRj9zC3j; failingcost0.00056838 USD, run14authoritativecosts0.01204651 USD KNOWN. Conservative remaining2.730344 USD, UNKNOWN2.109440 unchanged, hashchainPASS.

Same semantic grounding family: distance must not supply cadence/default ownership. Clarify prompt that lead distance alone supplies offset/relation only, while explicit single occurrence supplies ONCE; backend alone derives unstated cadence at ready-schedule resolution. No new parser/validator/rewrite/schema/oracle change. Add application-path characterization of missing cadence until readiness vs explicitly supplied single cadence; do not claim those already-passing policy tests as feature RED. Review/full/localcommit precede fresh live. Prompt digestf20b260e775de2ca60157a2ad0b81149fcfbe91910a3308ebd418535f4e6c382.

Cadence delivery delta independently reviewed C0/I0/M0. First full attempt exposed only an obsolete literal prompt-example assertion; updated the prose pin without weakening a frozen oracle. Focused161 PASS/2 existing skips. Fresh fixed-source full exit0:175 files/8431 PASS/2 existing skips, docs/typecheck/lint/build/Worker types/dry-run PASS; lint0errors168existingwarnings, diffPASS. No credential/provider access during these local corrections. Proceed with a new immutable local candidate and trusted fresh Pilot under the existing debug authority.

Fresh7f2467e terminalFAIL after14 HTTP/dispatches: R01–R04 PASS, R05 turn0 inferred DAILY from distance-only instruction, causing frequency/pendingField oracle failures. Offset evidence passed; zero failing-turn reads/mutations. HTTP200 generationgen-1791356873-8o54Uj71u7zJE7ibIWmd, cost0.0009933 USD, all14knowncosts0.0136564 USD settled. Conservative remaining2.716683 USD, UNKNOWN2.109440 unchanged, hashchainPASS. Add an early general minimal contrast between distance and consecutive notification days, not a fixture-specific answer or oracle relaxation. Instruction-delivery regression RED1/29PASS before correction; serialized prompt digesta1a136a9355fc5930a7549deb948edbc8281fc1c50f7990e10d563900207aa5c. Backend/wire/canonical/evidence/oracle unchanged.

Independent review initially C0/I1: new example anchor cuộc hẹn was not supported by unchanged evidence verifier. Stopped initial full run before edits (not acceptance evidence), replaced only that anchor with supported sự kiện, added2 exact helper characterization tests. Reviewer recheck C0/I0/M0. Final prompt digestc4a97eecfdadbfa0f5900ca588241e81a9254521c9498f734118bc1b97875678. Focused164 PASS/2 skips; fresh fixed-source full175 files/8434 PASS/2 skips and docs/typecheck/lint/build/types/dry-run exit0, lint0errors168existingwarnings, diffPASS. No provider or credential access during local correction. Fresh immutable candidate/live execution next.

Fresh0d28452 terminalFAIL after14requests: R01–R04PASS, R05turn0 model NEW with frequencyDAILY/count2 and missingoffset, although USER stated a lead distance only. Three frozen field assertions fail; zero failing-turn reads/mutations. Generationgen-1791357833-qdgFjK293kHaKtxYvkWQ, cost0.00060358USD; run knowncost0.01309926USD settled. Remaining conservative2.703577USD, UNKNOWN2.109440unchanged/hashchainPASS. Model over-inference proven; exact internal reason not exposed. No decoder/evidence defect established. Add positive NEW-vs-CURRENT decision at final numeric check rather than applying a retained-series rule to no retained target. Instruction test RED1/30PASS before addition; digestb1dd6e0fdddb28798e5c1d3011a6bec8922fa7676c004f2bfa3af4604ecb91c6. No validator/schema/oracle change.

Final NEW/CURRENT delta reviewed independently C0/I0/M0; focused165PASS/2existing skips. Full fixed-source175files/8435PASS/2skips, docs/typecheck/lint/build/Worker types/dry-run exit0; lint0errors168existingwarnings and diffPASS. Commit then fresh trusted Formal Pilot; no live result inferred from local checks.

Fresh76014f3 terminalFAIL after4requests: R01PASS/R02turn0PASS; R02turn1 model CURRENT addedoffset2 equal retainedcount2, existing contextual guard correctly refused. Generationgen-1791358708-oNj6DUqg3WZMWyvxgOkW, cost0.0010052USD; fourknowncosts0.0035597USD settled. Remaining2.700015USD, UNKNOWN2.109440unchanged/hashchainPASS. Static instruction additions are not a reliable state discriminator. Implement the narrow state-scoped transport hint amendment, not a new parser or proposal repair.

Follow-up ownership: `wire.ts` exports a deterministic versioned numericOwnership catalogue derived only from trusted non-conflicting DAILY/count slots. Selected serialization adds it beside evidenceSources; historical reference serialization unchanged. `prompt.ts` explains its limited CURRENT scope and NEW isolation. RED matrix in a dedicated wire test covers null/retained/proposed/resolved/conflict/othercadence/hostiletext and immutable input; update selected serialization expectations without weakening source separation. Static prompt digest pins updated; no output/schema change. Focused wire/prompt/offset/fit -> whole delta review C0/I0 -> fresh full/static -> local commit -> actual fresh Formal Pilot. Hint never grants field-value evidence or blocks independently grounded corrections.

Catalogue acceptance: initial test setup import failures are not feature RED. Corrected setup then inert catalogue stub/old serialization produced4 behavioralRED/3PASS; trusted-state derivation GREEN. Expanded conflict/missing/hostiletext matrix focused175PASS/2skips; whole delta independently C0/I0/M0. First full failed27 gateway tests solely because old exact-request specimen omitted reviewed catalogue; test-only expected serialization updated without relaxed admission. Reviewer confirmedC0/I0, gateway136PASS, focused311PASS/2skips. Fresh full176files/8445PASS/2skips, docs/typecheck/lint/build/types/dry-run exit0, lint0errors168existingwarnings, diffPASS. Canonical/output-wire/evidence/oracle unchanged. Prompt digest79c762d4a6e6394fb0bc662189f982bbb3c18f3b2490ac997dcf4aee6963acf5; harness verifies catalogue equals derivation from serialized canonical input. Commit then fresh trusted live next.

Freshefd30de:15HTTP/dispatches. R01–R04 and R05turn0(offset)/turn1(cancel) PASS; R05turn2 FAIL at changes[2].value WIRE_SHAPE_INVALID/string, zero failing-turn reads/mutations. HTTP200 generationgen-1791360543-7TnjXD6W10eLgz0jmZq3, cost0.000998USD; all15knowncosts0.01504893USD settled. Conservative remaining2.684959USD, UNKNOWN2.109440unchanged/hashchainPASS, terminal. Decoder path inspection identifies dateJsonOperands failure family: DATE_OPERAND_JSON was excluded by diagnostic expected whitelist. Exact malformed-vs-invalid-date contents were not retained, so do not claim them. TDD RED2/41PASS adds safe constraint-family telemetry and a final date-representation instruction; keep decoder/predicates/schema/oracle unchanged, no repair. Prompt digest6478238be3a3e60bde6ade543d097428cc300e852a512f80584788f0ff013569. Focused wire/gateway/diagnostics/prompt/offset/fit, independent review, fresh full then commit/live as before.

Date transport delta acceptance: focused323PASS/2existing skips; independent C0/I0/M0. Fresh fixed-source full176files/8447PASS/2skips, docs/typecheck/lint/build/types/dry-run exit0, lint0errors168existingwarnings, diffPASS. Runtime acceptance predicates unchanged; only safe diagnostic family and model delivery instruction changed. Commit and fresh actual Pilot next.
# Notification-date ownership follow-up

## Approved provider-envelope diagnostics extension

- Historical d6729bf HTTP body is not retained; exact invalid finish literal cannot be reconstructed from the old structural issue. Read-only generation metadata returns HTTP 200, finish_reason=null, native_finish_reason=null, prompt tokens 9385, completion tokens 6, cost 0. These metadata values are not substituted for the original envelope (whose issue had string type).
- Trace: transport returns bounded original UTF-8 JSON; observable adapter checks route/accounting then decodeContextResponse applies the unchanged envelopeSchema finish_reason=stop requirement. The old telemetry copied path/type but lost the actual control reason. No response normalization was found on this path.
- Add bounded diagnostics only at rejected-envelope boundary: exact finite control literals, unknown string length/digest, choices type/count, content type/byte count, numeric finite error code/presence. No content, error prose, IDs, raw keys or headers. Rejection, semantic/canonical/evidence/oracle contracts remain unchanged.
- RED gateway integration tests must fail on absent telemetry, then GREEN with sensitive/oversized protection. Review C0/I0 and stable-source full check precede commit and a controlled fresh execution. No blind retry of the terminal historical run.

## Latest terminal provider-envelope gate

- Candidate/harness `d6729bffbaf272a3ba00baa96dc8b15e3a46ceef`: Fresh Pilot made exactly one request, then terminal-stopped at R01 TURN 0. HTTP 200 / generation `gen-1791365156-w9SMAtZ4fEV7VwoL0Chx`; provider reported cost USD 0.
- Existing structural diagnostics: PROVIDER_ENVELOPE_FAILED, `choices[0].finish_reason`, invalid_value / CONTROL_ENUM. Envelope requires literal stop; the actual invalid literal was not retained. No assertion about truncation, refusal or provider error is justified. No semantic proposal was admitted; zero DB reads or reminder mutations.
- Confirmed cumulative exact cost USD 0.26362793 (ledger ceiling 263780 microunits), unchanged UNKNOWN exposure 2109440 microunits, conservative remaining 2626780 microunits. Hash chain PASS; history preserved.
- Pilot remains FAIL, not PASS. No retry, Full, push, merge or deployment. Provider-envelope failure is outside the current count/offset semantic-ownership correction; report this distinct gate before changing provider protocol handling or issuing another diagnostic request.

## Explicit single cadence consistency

- Actual `13ce8ac1302b9531c35152db0110f170d5f3b99e` stopped at R04 TURN 1 after nine requests: grounded relation/offset passed, but explicit single cadence was omitted. No historical result changed.
- Removed two inconsistent unconditional cadence-omission instructions; omission now applies only to unstated cadence. No backend fill, validator/oracle/schema change. RED delivery regression; focused 101 PASS / 2 existing skips.
- Review identified the second contradictory instruction, fixed and re-reviewed C0/I0/M0. Interrupted preliminary full runs are not acceptance evidence. Final stable-source offline full and chained checks exited 0.

## Continuation ownership follow-up

- Fresh `ed21396e3ff2b1c8ddb4b2e2ec2e4fe324647d9a` Pilot stopped after 17 requests at R06 TURN 1: negated abandonment retained the draft but proposed a new clock despite no new supplied clock. Historical output and settled accounting remain immutable.
- RED prompt-delivery regression followed by generic continuation/no-operand guidance. No rewrite, validator/oracle/schema change. Focused: 100 PASS / 2 existing skips; independent review C0/I0/M0; full offline and all chained checks exit 0.

## Title fidelity follow-up

- Fresh `feca390b7a3bbe53c8a2a831206ac2e7c5f8dbcd` execution terminated at R05 TURN 2 after 15 attempts: notification-date ownership and draft creation passed; three oracle assertions failed on expanded title wording. Offline exact digest reproduction identifies the expanded task phrase. No historical result was changed.
- Generic title-fidelity instruction added after a RED delivery test; existing narrow exam normalization is preserved. No automatic title rewriting, validator/oracle relaxation or schema change.
- Focused prompt/fit: 99 PASS / 2 existing skips. Independent delta review C0/I0/M0. Full offline verification and all chained static/build/dry-run checks exited 0. UNKNOWN exposure unchanged at 2,109,440 microunits; accounting is derived again before the next live attempt.

- Actual `33c71019fefc93491b86412923d7498cb25f49a1` Fresh Pilot stopped at R05 TURN 2 after 15 provider attempts. Wire, canonical and evidence validation passed, but the model assigned a direct notification date to eventDate rather than reminderDate. Historical failure remains unchanged; no automatic field rewrite was performed.
- Added a RED prompt-delivery regression, then a generic notification-versus-event date ownership instruction. Canonical/evidence validators, oracle and ProviderWire remain unchanged.
- Independent delta review: Critical=0 / Important=0 / Minor=0. Focused prompt/fit: 98 PASS / 2 existing skips. Offline full verification, documentation check, typecheck, lint, build, Worker types check and dry-run exited 0. Live compliance remains unproven until the next Fresh Pilot.
