# Untrusted Wire Authority Reconciliation Amendment

Status: proposed architecture, awaiting owner written-spec review. No runtime implementation or paid execution is included in this document commit.

## Goal and binding constraints

Prevent a structurally safe but unsupported optional model LIST-period proposal from blocking independently grounded backend period authority. Unknown model values grant no authority. Final canonical schemas, security/evidence checks, confirmation and persistence remain strict. Never translate `DATE` into `MONTH`.

Baseline: `27cf8f4b6bda4e4ec9ebc79dda563878b33511a4`. Preserve A1–A6 accepted work, v12 evidence slots, uncertainty codebook, inactive-padding rules, historical executions and accounting. No provider, credential, migration, push, merge or deployment during architecture work.

## Repository findings and current ordering

1. `semantic-gateway.ts::decodeContextResponse` bounds the provider envelope/content, then calls `parseGoogleLiteEuContextSectionsV3`.
2. `context-provider-wire.ts::codec` resolves tagged branches from exact finite discriminants. Unknown `query.period.kind` throws `WireShapeFailure` before producing a proposal.
3. `parseGoogleLiteEuContextSectionsV3` injects application-owned protocol/status metadata, isolates advisory failures, then calls `contracts.ts::parseInterpretationSectionsV3`.
4. `parseInterpretationSectionsV3` performs strict semantic schema/refinement validation before returning `ParsedInterpretationV3`.
5. `service.ts::handle` refuses unsuccessful gateway results; only successful semantic results reach `validateEvidenceV3`.
6. `evidence.ts::validateEvidenceV3` validates exact references, then invokes `list-range-evidence.ts::explicitListPeriod` for current grounded LIST input. Supported deterministic periods supersede model ranges; unsupported ranges lose authority. Event-relation support filtering happens later in this function.
7. Validated evidence feeds `mergePatchV3`, `resolveRequest`/`resolveQuery`, query admission, effective directive, transition, state-store validation and confirmation/persistence.

Actual order: bounded HTTP/JSON -> strict wire discriminants -> strict semantic canonical proposal -> exact evidence/context -> deterministic period/support filtering -> merge/resolution -> application admission/state validation.

This conclusively prevents the existing deterministic parser from handling R01 with an invalid safe period token. It is an ordering defect relative to the new owner requirement, not proof that existing A1–A6 code violates its old specification.

The accepted authority matrix (§4.6.2 of `2026-09-28-llm-context-contract-design.md`) explicitly allows semantic structure/domain/ownership hard rejection. `output-authority.ts` sets semantic `canCauseHardReject=true`. This amendment changes a selected optional proposal boundary; SEMANTIC_UNTRUSTED never meant every invalid field could already be ignored.

## Five historical classes are not identical

| Observation | Proven boundary | Implication |
| --- | --- | --- |
| Active query evidence empty | Mandatory source representation invalid | Evidence is not optional semantic padding; preserve v12 required primary source and strict identity validation. |
| Count-only BEFORE_EVENT | Known semantic relation without support | Existing post-source support filter correctly removes authority; preserve it. |
| Explicit month versus REST_OF_MONTH | Structurally valid conflicting period | Existing deterministic USER-period precedence handles it. |
| Intent/target/uncertainty mismatch | Cross-field semantic refinement | Historical actual values remain unavailable. Do not infer which field was wrong or override intent/target. |
| DATE period token | Wire finite domain before reconciliation | Proven reachability gap for deterministic period authority. |

Common concern: optional proposal normalization currently depends on valid domain structure. This does not justify discarding mandatory evidence, unsafe operations, ownership mismatches or structural corruption.

## Three validation layers

- **Transport:** enforce envelope/byte limits, JSON object/array/primitive shape, closed keys, required slots, depth/count bounds and safe branch selection. Unknown optional period token must be represented without assigning it a canonical meaning. Wrong primitive type and malformed evidence remain failures.
- **Semantic proposal:** recognized values remain untrusted and require existing source/context support. Unsupported safe values are quarantined, not aliased. Classification does not grant read/write authority.
- **Canonical application candidate/state:** validate strict domains and cross-field invariants after authorized normalization. Only then permit validated merge/resolution and existing execution gates. Persistent state/confirmation schemas remain unchanged.

## Options

| Option | Complexity / reliability | Safety / authority | Compatibility / blast radius |
| --- | --- | --- | --- |
| A: bounded tolerant optional semantic tokens | Selected discriminator no longer needs a finite provider enum; less reliance on provider enforcement. Requires a separate local transport result. | Explicit KNOWN/UNKNOWN classification; unknown value never becomes canonical. | Narrowest compatible change for query periods; retains known semantics and v12 evidence machinery. |
| B: explicit rawKind wrapper | Clear wire naming, but new keys/version and two representations throughout gateway/harness. | Can be safe, but wrapper alone does not solve ordering. | Larger prompt/schema/fixture migration with no unique benefit for this boundary. |
| C: remove all model period fields | Smallest provider schema. | Deterministic-only range authority is simple. | Reject: backend grammar is not proven complete for every legitimate supported phrasing; removing model semantics could weaken product acceptance. |

Recommendation: A, limited to optional LIST-period discriminants/operands at this architectural boundary. Do not make every semantic enum a free string. Do not add aliases or speculative intent inheritance. B and C are not selected.

## Proposed source responsibilities

`context-provider-wire.ts`: separate structural transport decoding from canonical proposal parsing for the context gateway. Add a typed transport result distinct from `ParsedInterpretationV3`. Selected LIST-period state is KNOWN(canonical-shaped candidate), UNKNOWN_SAFE_TOKEN(no canonical value), or ABSENT. Unknown operands have no authority and must not be traversed as date semantics. Their transport keys, types and bounds still follow a closed reviewed shape; arbitrary keys/prototype-control keys cannot be rescued.

`semantic-gateway.ts`: return the transport-level proposal and its safe diagnostics without treating a safely quarantined optional semantic token as whole-turn failure. Keep usage settlement, one dispatch, envelope/refusal/size/protocol failures and privacy routing unchanged. No second model call.

New authority reconciliation boundary under `context-contract`: consume the typed transport result and the application's `built` context. Validate mandatory evidence identities independently before granting any recovery. Known root intent/query kind must satisfy existing semantic policy; unknown root intent or ambiguous operation cannot be overridden from a temporal phrase alone. Current pending QUERY state can establish continuation scope only under existing delivery/revision/source rules, not unconditional inheritance.

For a validated current LIST scope, run existing `explicitListPeriod` and its exact verifier. If supported, choose the USER-derived period. If unknown model period has no deterministic/trusted support, choose null with the existing queryRange missing clarification. Drop period alternatives rendered obsolete by this verified deterministic fact; do not discard unrelated uncertainties or evidence errors.

Rebuild a canonical semantic proposal exclusively from known supported proposals, application-owned constants and independently proven backend facts. Apply `SemanticPatchProposalV3Schema` unchanged to that result. Existing evidence validator validates all retained references/values before producing the branded validated patch; avoid granting execution from the preliminary transport object. Shared exact-source primitives may be extracted, never bypassed or weakened.

`service.ts`: explicit transport -> reconciliation -> strict canonical -> evidence/merge pipeline. The reconciliation boundary cannot directly invoke DB reads, mutate state, produce confirmation proofs or override application admission. Advisory parsing stays independent.

`protocol.ts`, `output-authority.ts`, benchmark provenance: version the changed wire/transport contract explicitly; retain canonical/storage versions when their accepted language is unchanged. Compare measured schema bytes, enum domains, tagged branches and definitions. Do not assume simplification proves Google route acceptance.

## Field audit and scope

| Field group | Role / early validation | Disposition |
| --- | --- | --- |
| Envelope, object/primitive shape, closed keys, required evidence slots, source identities | TRANSPORT_CRITICAL; identity/scope mandatory | SAFE_AS_IS; hard reject malformed/security-invalid input. |
| LIST optional period kind/operands | SEMANTIC_UNTRUSTED optional range | FIXED_BY_SHARED_CHANGE; only this subtree gains typed quarantine before canonical proposal construction. |
| Intent, query kind | SEMANTIC_UNTRUSTED root meaning | FOLLOW_UP; this amendment does not manufacture LIST from unsupported root labels. |
| requestTarget, operation, uncertainties | SEMANTIC_UNTRUSTED user instruction/alternatives | SAFE_AS_IS for current contract; unknown-target recovery is FOLLOW_UP pending exact evidence and explicit policy. Not application-owned pending-field metadata. |
| eventRelation known values | SEMANTIC_UNTRUSTED; post-source support filter | SAFE_AS_IS; count alone grants zero relation authority. |
| Unknown eventRelation/frequency/calendar/date controls | SEMANTIC_UNTRUSTED structural domain | FOLLOW_UP; temporal query recovery must not silently broaden reminder semantics or write eligibility. |
| leadOffsetDays/count/endDate | SEMANTIC_UNTRUSTED operand with schedule limits | SAFE_AS_IS; no clamping, unsupported recurrence or invented defaults. |
| conversationDirective/replyProposal | ADVISORY | SAFE_AS_IS; independently quarantine invalid advice. |
| Versions/codebook/status constants, pending field, effectiveDirective, confirmation/state | APPLICATION_OWNED | SAFE_AS_IS; model cannot select these. Unknown trusted binding is hard rejection. |

TRANSPORT_CRITICAL is a validation responsibility, not a fourth model-output authority class. Existing SEMANTIC_UNTRUSTED/ADVISORY/APPLICATION_OWNED classes remain.

## Security and diagnostic requirements

Reuse `projectControlEnum`/safe-control diagnostic projection: finite approved literals may be printed; arbitrary unknown strings are represented by type, bounded length and digest, never raw text. Unknown token classification must not log conversation/title/location/notes/evidence/owner identifiers. No retained raw provider response. Tokens resembling free text do not receive a "safe control" label just because they are strings.

Mandatory reference integrity is checked even for a discarded optional range when required by the current evidence policy. Invalid quote/source/scope is not rescued by finding "tháng này" elsewhere. Backend-created temporal proof is explicitly application-derived from authenticated current USER text, not fabricated model evidence.

## Required RED-first acceptance

- Actual gateway/service path, invalid DATE + scoped explicit "tháng này": unknown model period authority NONE, final MONTH(0), strict canonical PASS, REMINDERS_LISTED, one LIST read, zero reminders.
- Same invalid DATE without supported USER range: null range, clarification/rejection by existing policy, zero reads/writes.
- Unknown period + forged/missing/cross-scope evidence: hard rejection, zero reads/writes.
- Wrong primitive type, absent required transport slot, unknown key, oversize, invalid root intent or model mutation intent: no temporal rescue.
- Valid supported MONTH, REST_OF_MONTH and NEXT_7_DAYS retain semantics; negation/quotation/multiple-range ambiguity creates no new authority.
- R01 initial clarify and REST_OF_MONTH conflict; R02 43/43, count-only relation remains absent, explicit supported BEFORE_EVENT remains valid.
- Stage assertions prove reconciliation before strict final semantic canonical validation and reject a still-invalid canonical candidate after reconciliation.
- Safe diagnostic privacy, ownership/refusal/security/version, one-call and all R01–R16 local regressions remain intact.

## Implementation and release boundaries

After written-spec approval, prepare the canonical implementation-plan amendment with exact interfaces, RED tests, verification commands, file ownership and meaningful independent review boundaries. After plan approval, implement offline, run full checks and independent architecture review C0/I0, then commit one local corrected candidate. No paid Pilot or release in that implementation task. Historical diagnostics and ledger remain append-only and unchanged.

Expected corrected-candidate handoff: OWNER_REVIEW_OF_UNTRUSTED_WIRE_AUTHORITY_CORRECTED_CANDIDATE_BEFORE_FRESH_FORMAL_PILOT. Current documentation handoff: OWNER_REVIEW_OF_UNTRUSTED_WIRE_AUTHORITY_DESIGN.
