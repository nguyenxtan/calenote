# Ownership Value Diagnostics Implementation Plan

> **For agentic workers:** Execute inline with test-driven development and one independent delta review. The owner authorized continuous local implementation, then preflight and one fresh paid-authorization boundary.

**Goal:** Capture safe actual cross-field ownership state at the rejecting canonical predicate without changing acceptance.

**Architecture:** A trusted in-process issue-params identity carries a bounded finite-control snapshot captured by the actual refinement. The existing diagnostics projector emits that snapshot; raw payloads and forged issue metadata never supply diagnostic values.

**Tech Stack:** TypeScript, Zod 4, Vitest, existing application-path benchmark harness.

**Spec:** `docs/superpowers/specs/2026-09-28-llm-context-contract-design.md` §4.6.2; current owner REQUEST_TARGET_INTENT_OWNERSHIP investigation instructions.

## Contract investigation (before implementation)

1. CREATE_REMINDER requires non-null CURRENT/NEW/UNRESOLVED. AMBIGUOUS permits null or a non-null target only with an operation uncertainty. All other intents require null. Uncertainties do not waive CREATE's requirement; only operation uncertainty qualifies the AMBIGUOUS exception.
2. Frozen R01 turn 1 is LIST_REMINDERS, target null, uncertainties empty when its range is resolved. An uncertainty may still propose an unresolved semantic issue; it cannot create read authority.
3. Pending QUERY context establishes scope, not every linguistic intent. The accepted architecture does not allow blindly inheriting/overriding current intent.
4. requestTarget describes CURRENT/NEW/UNRESOLVED reminder targeting, not queryRange/reminderTime or the next question. It can carry new semantic information (replacement versus current request).
5. A user may start a different request while answering clarification. Model targeting is only an untrusted proposal, requiring current USER evidence and validated contextual scope; it cannot hijack pending state itself.
6. Uncertainties are SEMANTIC_UNTRUSTED typed unresolved meaning and grounded alternatives, not advisory prose. Actual missing/conflict/directive decisions are application-owned.
7. Typed uncertainties may describe different fields; operation uncertainty determines the AMBIGUOUS target exception. Cross-field invalid combinations remain hard rejection.
8. Backend owns the actual pending question/field, bound state, source scope, effective directive and execution admission. It does not own arbitrary CURRENT/NEW user meaning by default.
9. ProviderWire/decoder structurally admit independent finite fields; canonical superRefine enforces their correlation. The latest live error is exactly this rejection, but actual finite values were not retained.
10. Preserve prompt, ProviderWire v12, decoder, schema domains/predicates, evidence, period grammar/reconciliation, eventRelation support, merge/transition and provider/accounting policy.

Evidence: `contracts.ts` SemanticPatchProposalV3Schema predicate; `prompt.ts` roots/queries/fragments paragraphs; `output-authority.ts` registry; implementation plan lines 719–749; spec authority matrix; `evidence.ts` current-source targeting; `merge.ts` validated query branch and reminder target branch; frozen fixture R01 and existing R01/R02 oracle regressions.

**Finding:** Prompt ownership is CLEAR_AND_CONSISTENT with the canonical contract. Spec explicitly keeps semantic targeting model-proposed; no evidence proves an application-owned target defect. Historical actual values are unavailable. Choose diagnostics-only, not a semantic fix.

## Global constraints

- No provider/credential access during local stages; old terminal Pilot/authority/history immutable.
- No change to validators' accepted language, prompt, ProviderWire, model/provider or periods.
- Diagnostics retain only exact closed enums, null, bounded counts and field/reason summaries; no alternative values, refs, quotes, IDs, title/location/notes or explanatory strings.
- No isolated replay; after local commit continue read-only Formal Pilot preflight, then ask once for fresh bounded authority.

## Review focus

- Forged params must not leak even plausible enum-shaped private data.
- Mutation of source/diagnostic objects must not alter captured predicate state.
- AMBIGUOUS with/without operation uncertainty must have distinguishable safe summaries.
- Valid LIST/reminder clarification and confirmation remain unchanged.
- Invalid/malformed uncertainty/free text must not be serialized; no whole-payload serializer.

## One coherent diagnostics delta

Files: `canonical-constraints.ts`, `contracts.ts`, `validation-diagnostics.ts`, new `ownership-value-diagnostics.test.ts`, and actual-path regression tests only if needed.

Interfaces: optional safe ownership state on trusted canonical issue metadata; `CanonicalValidationIssue.ownershipState` contains intent, requestTargetKind, uncertaintyCount and bounded field/reason/alternativeCount summaries. Existing gateway/runner forwarding remains unchanged.

- [x] Write RED tests for invalid pairings, operation uncertainty, valid combinations, privacy, forged metadata, mutation isolation and generic query ownership.
- [x] Run `pnpm exec vitest run src/modules/conversation/context-contract/ownership-value-diagnostics.test.ts`; confirm missing diagnostics failures.
- [x] Capture/project safe state only at rejecting ownership predicates; keep predicate expressions unchanged.
- [x] GREEN focused tests, canonical diagnostics, gateway, ProviderWire, pending/intent/uncertainty/confirmation and frozen R01/R02 regressions.
- [x] Run the complete `pnpm check` verification stages with external network and credential access denied; run `git diff --check`.
- [x] Independent read-only delta review; resolve Critical/Important findings and reverify.
- [x] Selective local commit; report semantic baseline separately from diagnostics candidate/runtime SHA.
- [ ] Fresh read-only `prepareBoundedPilot` plus loaded-runtime proof, manifest, accounting/hash-chain/schema gates; no credential/network/claim.
- [ ] If READY ask fresh Formal Pilot authority once. Paid execution is a later boundary, never implied by this plan.

## Execution evidence

- RED: eight missing-snapshot assertions failed before implementation; ten existing acceptance/privacy assertions passed.
- Independent delta review: Critical=0, Important=0, Minor=0; fresh 269 relevant tests and 19 oracle tests passed. Historical actual values and live provider behavior were explicitly not inferred.
- Initial full test phase: 164 files, 8135 passed, two existing skips; subsequent typecheck identified two intentional-invalid-input test casts, corrected without runtime changes. Reviewer confirmed the test-only correction preserves C0/I0.
- Concurrent focused/full repeats each encountered one five-second prefix-harness timeout, not an assertion mismatch. Final serialized focused run: 13 files, 3308 passed; final complete serialized suite: 164 files, 8135 passed, two existing skips. The prefix test passed in 3699 ms; no timeout limit or acceptance rule changed.
- Complete remaining check stages passed: documentation/current-state tests, typecheck, lint, Next build, Wrangler types check and local deploy dry-run. External network and Keychain access were sandbox-denied; only localhost was available for disposable D1 fixtures.
- Final diff check passed. Scope is three diagnostic runtime files, three test files and this document; no prompt, wire schema, canonical acceptance predicate, period, eventRelation or production-configuration change.
- Ruling: requestTarget is semantic reminder-request targeting, not the application-owned pending conversational field. Preserve the predicate and accepted authority design; without historical actual values, a semantic fix would be speculative. Cost if wrong: the new finite-control evidence must drive a later correction.
- Reviewer did not assess paid readiness. Main execution must independently verify the committed runtime, manifest, accounting, historical hash chain and schema before requesting fresh authority.
