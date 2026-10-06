# Optional LIST Period Authority Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native inline implementation with one independent whole-amendment architecture review. Steps use checkbox syntax. This document authorizes no implementation or provider execution by itself.

**Goal:** Let independently grounded backend LIST-period authority run before a structurally safe unknown model period can cause final canonical rejection, without giving that model token authority.

**Architecture:** Introduce a bounded transport-level LIST interpretation, separate from canonical `ParsedInterpretationV3`. Reconcile its optional period using the existing source resolver and USER grammar before unchanged strict canonical validation. Keep every other model field, evidence identity, operation, final state and execution boundary strict.

**Tech Stack:** TypeScript, Zod 4, Vitest, local workerd/D1 fixtures, existing OpenRouter gateway and canonical benchmark harness.

**Spec:** `docs/superpowers/specs/2026-10-06-untrusted-wire-authority-design.md`, documentation commit `2c1a1b1032b94dd1f436cf7380bcb2bdd84e9cd3`; written Option A approval supplied by the owner in this planning turn. The spec's old status line does not override that direct approval.

## Global constraints

- Optional primary LIST period only. No generic tolerant semantic decoder, aliases, fuzzy matching, new grammar, intent inheritance or eventRelation change.
- Model/runtime `google/gemini-2.5-flash-lite` / `google-vertex/eu`; stream=false, retry=0, fallback=none, strict=true, require_parameters=true, ZDR/data_collection=deny; input<=12000 tokens, output<=1536 tokens, raw response<=32768 bytes.
- Canonical schemas/refinement predicates, codebook and storage versions are unchanged. Unknown model tokens never enter canonical state.
- Existing v12 emitted Google schema remains byte-for-byte unchanged. This correction must tolerate nonconforming provider output locally, not enlarge the provider language. Preserve required evidence slots and inactive-padding behavior.
- Version the application decoder/wire contract as `google-gemini-2.5-flash-lite-vertex-eu-context-list-period-reconciliation-13`; record unchanged emitted-schema digest separately. This is not a claim of live v13 route acceptance.
- Current semantic baseline: `7db3fb3b9f4e0cde6a0c09519a242740b08758d8`; diagnostics/runtime baseline: `27cf8f4b6bda4e4ec9ebc79dda563878b33511a4`. Planning HEAD: `2c1a1b1032b94dd1f436cf7380bcb2bdd84e9cd3`.
- Fake/local transport only. Deny external network and Keychain during implementation checks; allow localhost for disposable D1 fixtures. No authority creation, accounting/history rewrites, UNKNOWN release, Pilot/Full, push, merge, migration or deployment.
- Native implementation, TDD at every boundary, one final independent review C0/I0. Do not dispatch implementer/reviewer per mechanical step.
- One final local runtime commit after all tasks pass and review findings are resolved; task commit boundaries below are integration checkpoints, not permission to ship incomplete interfaces.

## Current source map and ordering

`context-provider-wire.ts::codec` rejects unsupported period discriminants; `parseGoogleLiteEuContextSectionsV3` immediately invokes `contracts.ts::parseInterpretationSectionsV3`. `semantic-gateway.ts::decodeContextResponse` therefore exposes only canonical-parsed success. `service.ts::handle` reaches `evidence.ts::validateEvidenceV3` only afterward. That function calls `list-range-evidence.ts::explicitListPeriod` / `verifyListRangeEvidence`, then brands `ValidatedPatchV3`; `mergePatchV3` / `resolveQuery` drive the authorized read. `list-range-evidence.ts::temporalMatches` is private and must remain unchanged.

The runner additionally rejects a successful gateway result with `!interpretation.fullSchemaValid` before service execution. `context-contract-probe.ts` and service test support also type their gateways as `SemanticGateway<ParsedInterpretation,ContextInput>`. These consumers must accept the new staged result without treating transport validity as canonical acceptance.

New order for LIST: bounded transport -> period classification -> mandatory exact evidence/context validation -> deterministic/trusted period reconciliation -> unchanged strict canonical validation -> validated evidence patch -> existing merge/query admission/transition. Non-LIST order remains unchanged.

## File ownership / dependency graph

| Task | Runtime ownership | Test / integration ownership |
| --- | --- | --- |
| 1 | New `src/modules/conversation/context-contract/list-period-transport.ts`; `context-provider-wire.ts`; `protocol.ts`; `provider-wire-schema.ts` (derive version type from protocol) | New transport tests; existing ProviderWire parity/schema tests |
| 2 | New `src/modules/conversation/context-contract/list-period-reconciliation.ts`; narrow shared-source extraction in `evidence.ts` | New reconciliation tests; existing evidence/list-range/ownership tests |
| 3 | OpenRouter `semantic-gateway.ts`; context `service.ts`; `downstream.ts`; context `observability.ts` if event typing requires it | `service-test-support.ts`; new actual-path test; `context-contract-runner.ts`; `context-contract-probe.ts` and runner/oracle tests |
| 4 | No unrelated runtime changes; only fixes proven by verification/review | Complete regressions, review, documentation evidence and final local commit; downstream trace/version tests, coherent orchestration runtime fixture, historical seed comparison metadata normalization |

Dependencies: 1 -> 2 -> 3 -> 4. Task 1's new parser is dormant until Task 3; no intermediate candidate is evaluated. Evidence resolver extraction in Task 2 must be shared by reconciliation and existing validator, not copied.

## Interfaces and implementation decisions

All following new names are explicit planned additions, not claims that they already exist.

`list-period-transport.ts` owns:

- `type ListPeriod = Extract<QueryOperand,{kind:"LIST"}>["period"]`.
- `type ListPeriodProposal = {status:"KNOWN";value:NonNullable<ListPeriod>} | {status:"ABSENT"} | {status:"UNSUPPORTED";diagnostic:CanonicalValidationDiagnostics}`. Unsupported representation stores no raw token/operands and carries no canonical value.
- `type DecodedListCore = Omit<SemanticPatchProposalV3,"query"> & {query:Omit<Extract<QueryOperand,{kind:"LIST"}>,"period">}`; values are structurally decoded, not an admitted semantic patch. Ownership refinement still must run later.
- Opaque `UnreconciledListInterpretation`, issued by the decoder's factory and checked with `isUnreconciledListInterpretation(value:unknown):value is UnreconciledListInterpretation`; a private identity registry prevents forged transport wrappers.
- `type ContextGatewayInterpretation = ParsedInterpretationV3 | UnreconciledListInterpretation`. Only non-LIST uses the already-parsed arm; every LIST uses the staged arm, including known/absent periods.
- A closed decoder factory receives `DecodedListCore`, period classification and bounded raw guidance, and returns the opaque wrapper. The public accessor supplies detached core/period/guidance to reconciliation only. No cast makes this wrapper a canonical proposal or `ValidatedPatchV3`.

`context-provider-wire.ts` adds `decodeGoogleLiteEuContextTransportV3(raw,selected,observeInvalid?,observeWireInvalid?):{status:"PARSED";value:ContextGatewayInterpretation}|{status:"REFUSED";reason:"ENVELOPE_INVALID"|"SEMANTIC_PATCH_INVALID"}`. Keep existing strict `parseGoogleLiteEuContextSectionsV3` for compatibility/security tests and historical callers; the application gateway selects the new transport parser explicitly.

For `query.kind=LIST`, decode all non-period fields using existing codecs. Period null is ABSENT. Known period uses the existing exact branch codec. Only unknown **string discriminator** reaches quarantine; known-kind bad operands, non-string kind, missing slot, unknown key and wrong primitive shape remain hard failures. The unknown period must have exactly the existing flattened padding keys (`kind`, `date`, `offset`, `from`, `through`): offset null or finite JSON number, date/from/through null or structurally valid current date operand. Never derive date meaning or select a branch from unknown kind. Kind is bounded to 48 ASCII codepoints for safe-control quarantine; whitespace/free-text/control/oversized strings reject without echo. Other semantic discriminants, including uncertainty alternatives, retain existing strict decoding.

Use current `projectControlEnum`/`projectWireValidation` for diagnostics. Store only structural projected output; arbitrary free-text tokens are never retained. Preserve the existing sanitizer rather than defining a second one.

`evidence.ts` exports a narrow `resolveListQuerySourcesV3(query:Extract<QueryOperand,{kind:"LIST"}>,uncertainties:SemanticPatchProposalV3["uncertainties"],built:ReadyContextV2,observe?:DownstreamObserver)` returning a resolved query and independently verified deterministic period or the existing refused reason. Implement by extracting/reusing the existing V3 resolver closure (`quoteSource`, source/fact binding, `resolve`), not by reimplementing quote matching. Exact source/currentness/fact binding is checked internally; the result has no execution authority and only final `validateEvidenceV3` can brand an admitted patch.

For an unknown period, source validation uses the period-absent query; it must not invent a model ref or silently accept a CONTEXT_FACT that cannot bind that exact query. Current USER grounding allows deterministic replacement. Known period retains existing exact fact restoration/re-verification. No blind adoption of a previous range or pending intent; pending QUERY scope is checked under the existing sent/revision/expiry policy. If an unknown period cannot be bound from the existing refs, reject rather than borrow context.

`list-period-reconciliation.ts` adds `reconcileListPeriodV3(value:UnreconciledListInterpretation,built:ReadyContextV2,observe?:DownstreamObserver):InterpretationSectionsV3`. Resolve mandatory sources first. Reuse `explicitListPeriod` and exact span verifier for backend-derived current USER period. Otherwise keep a known proposal for the existing evidence verifier, or use null plus queryRange MISSING for unsupported/absent period. Missing-range uncertainty is backend-computed; do not fabricate alternatives.

Validate every supplied queryRange alternative's source even if deterministic authority later makes it obsolete. Remove only verified-obsolete queryRange alternatives/uncertainties; unrelated uncertainties remain unchanged. Construct the resulting canonical object, independently parse advice, and call unchanged `parseInterpretationSectionsV3`. Existing `validateEvidenceV3` still validates the retained result and alone creates `ValidatedPatchV3`. No read/write/confirmation or mutation inside reconciliation.

## Review focus

1. A forged transport wrapper or alternate root mutation intent cannot gain LIST admission (Tasks 1/2).
2. Valid temporal words cannot rescue fabricated mandatory evidence or stale/cross-scope facts (Task 2).
3. Discarded queryRange alternatives still undergo identity validation; source indices for other fields cannot shift (Tasks 2/3).
4. Known inactive padding stays discarded; unknown-kind padding must not smuggle fields into canonical state (Task 1).
5. Harness observes post-reconciliation canonical acceptance without ignoring malformed advice or weakening frozen oracles (Task 3).

### Task 1 — Typed optional-period transport quarantine

**Files:** create `list-period-transport.ts` and `list-period-transport.test.ts` in `src/modules/conversation/context-contract/`; modify `src/modules/intelligence/infrastructure/openrouter/context-provider-wire.ts`, its `context-provider-wire-parity.test.ts`, and `src/modules/conversation/context-contract/protocol.ts`.

**Purpose/behavior:** permit only the selected safe unknown period subtree as noncanonical data; retain strict transport/security and unchanged emitted Google schema.

- [x] RED: test `DATE yields UNSUPPORTED with no canonical period`; test known MONTH/REST_OF_MONTH/NEXT_7_DAYS and null classification; forged wrapper is rejected. Assert strict compatibility parser still rejects DATE.
- [x] RED security matrix: missing padding/primary evidence, extra/prototype key, kind number/object, whitespace/private/control/49-character token, known MONTH invalid offset and unknown reminder frequency all refuse. Valid known inactive padding remains ignored as before.
- [x] Run `pnpm exec vitest run --maxWorkers=1 src/modules/conversation/context-contract/list-period-transport.test.ts src/modules/intelligence/infrastructure/openrouter/context-provider-wire-parity.test.ts`. Expected RED: new transport parser/classification is absent or rejects DATE, not unrelated fixture encoding errors. Mutate a valid encoded wire object after encoding; never pass invalid canonical input to `encodeFixtureV3`.
- [x] Implement the interfaces and narrow codec hook above; do not relax generic `codec` or strict parser. Build period classification before canonical semantic refinement only for LIST.
- [x] Assert provider schema SHA256 remains `eb1dd33768911fdad7cd1e957c427882515b0dee56a6256102a0e96d0c8cca08`; canonical digest remains `43b6689ce9c4874c4d532652ea212b52aa7d7f222cddd55377e59d483f5c444b`. Measure bytes/definition/branch/enum counts equal to v12. Stamp decoder contract v13 without modifying emitted schema or codebook/storage versions.
- [x] GREEN: focused command above plus `pnpm exec vitest run --maxWorkers=1 src/modules/intelligence/infrastructure/openrouter/provider-wire-schema.test.ts src/modules/intelligence/infrastructure/openrouter/context-query-evidence-compact.test.ts src/modules/conversation/context-contract/authority-contract.test.ts`; expected zero failures. Refactor only after green.
- [x] Commit boundary: stage this coherent transport slice for the final amendment commit; do not activate gateway or publish an intermediate candidate.

### Task 2 — Grounded reconciliation before final canonical validation

**Files:** create `list-period-reconciliation.ts` and `.test.ts` under context-contract; modify `evidence.ts` for the shared narrow source resolver; test existing `evidence.test.ts`, `list-range-evidence.test.ts`, `list-range-authority.test.ts`, `ownership-value-diagnostics.test.ts`.

**Purpose/behavior:** independently prove period authority from existing sources/grammar, then build and strictly validate the canonical proposal; unsupported token itself contributes nothing.

- [x] RED: `DATE plus current authenticated tháng này produces MONTH(0)`; assert resulting canonical parse succeeds, original unknown token absent, and source provenance corresponds to the actual current USER phrase.
- [x] RED: `DATE without supported range produces null plus queryRange MISSING`; `genuine remaining-month wording remains REST_OF_MONTH`; valid supported MONTH/NEXT_7_DAYS remain valid. No aliasing from the token.
- [x] RED: forged quote, wrong role/alias/occurrence, missing/cross-scope evidence, stale pending context and invalid alternative ref each reject despite explicit month words. Wrong root intent/requestTarget ownership and still-invalid final canonical state reject unchanged.
- [x] RED: quoted/negated/ambiguous month creates no deterministic authority; discarded range alternatives cannot erase another field's failure or shift provenance.
- [x] Run `pnpm exec vitest run --maxWorkers=1 src/modules/conversation/context-contract/list-period-reconciliation.test.ts`; expected RED due to absent reconciliation, not an intentionally invalid canonical encoder.
- [x] Extract shared V3 exact-source resolution without semantic changes, implement the specified resolver/reconciler, and validate mandatory refs before dropping obsolete range proposals. Reuse private grammar via its existing public functions; do not export or rewrite `temporalMatches`.
- [x] GREEN: `pnpm exec vitest run --maxWorkers=1 src/modules/conversation/context-contract/list-period-reconciliation.test.ts src/modules/conversation/context-contract/evidence.test.ts src/modules/conversation/context-contract/list-range-evidence.test.ts src/modules/conversation/context-contract/list-range-authority.test.ts src/modules/conversation/context-contract/ownership-value-diagnostics.test.ts`; expected all pass, source/scope failures unchanged.
- [x] Commit boundary: stage the resolver/reconciler slice; no independent runtime candidate or paid request.

### Task 3 — Actual gateway/service path and truthful harness acceptance

**Files:** modify `src/modules/intelligence/infrastructure/openrouter/semantic-gateway.ts`, `src/modules/conversation/context-contract/service.ts`, `downstream.ts`, `service-test-support.ts`; update event typing in `observability.ts` only if needed; create `src/modules/conversation/context-contract/list-period-ordering.integration.test.ts`; modify `tools/benchmark/context-contract-runner.ts`, `context-contract-probe.ts`, `context-contract-runner.test.ts`, `context-oracle-diagnostics.test.ts`. Preserve all manifest/fixture expectations.

**Interfaces:** gateway/probe/runner generic becomes `SemanticGateway<ContextGatewayInterpretation,ContextInput>`; service checks the opaque transport guard and calls Task 2's reconciler for LIST, leaving parsed non-LIST unchanged. The generic `SemanticAttemptResult` need not change.

- [x] RED actual-path two-turn R01: encode valid turn 0 / turn 1, mutate turn 1 wire period.kind to DATE, use existing fake HTTP response through the real gateway/service. Assert CLARIFICATION_REQUESTED then REMINDERS_LISTED; range exactly September 1–October 1 2026 in Asia/Ho_Chi_Minh, one LIST read, zero reminders, two eligible dispatches total and no repair call.
- [x] RED twin: unsupported token with no supported temporal phrase yields clarification or existing hard evidence rejection, range null, reads/mutations zero. REST_OF_MONTH conflict yields MONTH(0); genuine remaining-month wording stays REST_OF_MONTH.
- [x] RED ordering trace: add bounded downstream stages `TRANSPORT`, `PERIOD_RECONCILIATION` before `CANONICAL`; successful recovery records model authority NONE and backend selection, not raw unknown text. Still-invalid canonical result rejects before read. No duplicate/second model dispatch.
- [x] RED harness: a staged transport result is not prematurely marked SCHEMA_INVALID; post-reconciliation canonical full-envelope status is still required by the frozen oracle. Invalid directive/reply does not acquire Pilot acceptance merely because period recovery succeeded. Existing direct canonical failure artifact remains retained.
- [x] Run `pnpm exec vitest run --maxWorkers=1 src/modules/conversation/context-contract/list-period-ordering.integration.test.ts tools/benchmark/context-contract-runner.test.ts`; expected RED at current early decoder/harness boundary.
- [x] Switch context gateway to the new transport parser. Retain usage/provider evidence and response bounds; store quarantine diagnostics as diagnostic-only data, not a canonical-failure status. Service performs reconciliation after dispatch/settlement and before canonical/evidence events. Keep budget/claim/failure settlement unchanged.
- [x] Replace runner's pre-service fullSchemaValid check for LIST with post-reconciliation full-envelope acceptance captured from existing service observation. Do not force it true or remove frozen assertions. Non-LIST/advisory/security failures retain current campaign stopping policy. Single-target semantic-state diagnostics only read an actual canonical result, never transport core.
- [x] Add a **test-only** optional wire-output transformer to `scriptedGateway`/`harness` so malformed wire fixtures can use real transport without failing the strict canonical encoder first. Runtime factories get no test hooks.
- [x] GREEN: preceding focused command plus `pnpm exec vitest run --maxWorkers=1 src/modules/conversation/context-contract/deterministic-period-authority.test.ts src/modules/conversation/context-contract/service.test.ts src/modules/conversation/context-contract/transition-boundary-service.test.ts tools/benchmark/context-oracle-diagnostics.test.ts src/worker/composition-root.test.ts`; expected all pass; R02 frozen turn-zero 43/43 remains eventRelation=null, pendingField=reminderTime.
- [x] Commit boundary: stage complete gateway/service/harness integration; no schema-oracle weakening, historical output rewrite or campaign execution.

### Task 4 — Final compatibility gate, architecture review and one local candidate

**Files:** runtime changes only for proven review/test findings inside Tasks 1–3; this plan's evidence section; no unrelated historical plan or ledger edits.

**Purpose:** verify the whole amendment, including unchanged eventRelation, authority/accounting mechanisms, canonical strictness, schema complexity and complete local acceptance.

- [x] RED for any uncovered boundary finding before fixing it; name the failure, verify its expected failure and implement the minimal scoped correction. Never fix an unrelated product feature to make the suite green.
- [x] Run `pnpm exec vitest run --maxWorkers=1 src/modules/conversation/context-contract/event-relation-evidence.test.ts src/modules/conversation/context-contract/event-relation-integration.test.ts src/modules/conversation/context-contract/output-authority.test.ts src/modules/conversation/context-contract/authority-contract.test.ts src/modules/conversation/context-contract/canonical-constraints.test.ts src/modules/conversation/context-contract/confirmation.test.ts tools/benchmark/context-contract-single-replay.test.ts tools/benchmark/context-contract-candidate-validation.test.ts tools/benchmark/context-bounded-pilot.test.ts tools/benchmark/context-seed.test.ts`; expected zero failures, count-only relation absent and explicit BEFORE_EVENT still supported, historical authority/accounting unchanged.
- [x] Run normal `pnpm check` under external-network/Keychain denial with localhost enabled for fixtures; expected full tests including R01–R16 PASS with existing skips only, documentation/typecheck/lint/build/Worker types/deploy dry-run PASS. Dry-run is local and cannot upload/promote. Do not increase test timeouts; if contention recreates the known prefix timeout, run full suite with `--maxWorkers=1`, then the exact remaining check stages.
- [x] Serial alternative: `pnpm exec vitest run --maxWorkers=1 && node --test docs/architecture/current-state.test.mjs && pnpm typecheck && pnpm lint && pnpm build && pnpm exec wrangler types --check && pnpm exec wrangler deploy --dry-run`. Read every exit/result; never combine a failed latest gate with a passing stale claim.
- [x] Run `git diff --check`; inspect exact changed file set and canonical/provider-schema hashes. No prompts, bindings, migrations, workflow/accounting, manifest expectations or reminder/confirmation semantics may change.
- [x] Independent whole-amendment architecture review: transport versus semantic validation, exact evidence before recovery, strict canonical afterward, no-support fail-closed, unknown privacy, schema identity/complexity, R01/R02 and harness acceptance. Require C0/I0; fix C/I inside this task with RED->GREEN and rerun appropriate/full checks. Review and test evidence are local, not provider acceptance.
- [x] Record verification, rulings and actual file ownership. Selectively stage plan plus actual task-owned changes; commit once as `fix(context): reconcile optional LIST period before canonical admission`. The resulting immutable runtime SHA is the NEW evaluation candidate; harness SHA is the same unless a later tooling-only commit is separately recorded. Preserve historical labels and consumed grants.
Post-commit required gate, per the owner's subsequent execution instruction: continue immediately into read-only `prepareBoundedPilot` plus `assertLoadedCandidateModules` preflight. No credential access, network, paid request, authority record or reservation. Ask once for fresh Formal Pilot authority only if every readiness gate passes. Historical runs never receive new acceptance credit. Record that post-commit evidence in the execution ledger so the candidate stays immutable.

## Self-review / handoff coverage

- Spec Option A covered by Tasks 1–3; B/C not reintroduced. Transport factory is opaque and cannot admit reads/writes.
- Required DATE, conflicting REST_OF_MONTH, genuine remaining month, no-support, valid period and final-strictness cases map to Tasks 1–3. R02 43/43 and relation/security siblings map to Tasks 3–4.
- Every task has RED reason, exact interface, focused command, expected GREEN and commit boundary. New file names are declared additions; existing source symbols/paths were inspected.
- Provider schema complexity/digests unchanged; decoder contract version changes explicitly. Canonical authority, grammar and evidence matching remain unchanged.
- Historical candidate/authority/accounting tests map to Task 4; runner correction does not reset budgets or weaken frozen Pilot assertions.
- This approved offline execution ends at `FRESH_FORMAL_PILOT_OWNER_AUTHORIZATION` only after the corrected local candidate and read-only readiness PASS; otherwise report the exact engineering/preflight blocker. Fresh paid execution requires separate authority.

## Implementation evidence and review rulings

- Transport RED->GREEN: 11 initial failures; provider parity group 2997 PASS. Privacy regression failed before unsupported raw-token projection was removed. Final transport suite: 13 PASS.
- Reconciliation RED->GREEN: seven initially rejected valid cases; reconciliation/evidence/range/ownership group 1759 PASS. Review added three fact-binding regressions; final reconciliation suite: 16 PASS.
- Actual gateway/service R01 DATE regression failed before activation, then passed with exactly one authorized read and zero reminder mutations. Frozen runner/oracle remains strict; fake transports are not live acceptance.
- Independent review identified C0/I1: reconstructing a query changed key order and replacing a period invalidated old exact fact references. Fixed by unchanged QueryOperandSchema normalization before original source validation, then retaining only already-authenticated current USER references for an independently derived period replacement. No validator changes. Rereview: C0/I0, no Minor findings.
- Preliminary root ownership uses the original strict canonical parser. Optional-period reconciliation cannot rescue a different intent, requestTarget or changes. A future broader ownership amendment requires a separate boundary.
- Invalid guidance remains independently rejected for frozen full-envelope evaluation; runtime guidance remains advisory. This does not grant semantic authority to guidance.
- Historical seed content is immutable. Only the decoder-dependent observation hash is normalized in semantic checkpoint comparison, alongside pre-existing attemptId/proof normalization; its hexadecimal assertion does not independently prove the binding digest. Dedicated identity/binding tests remain authoritative.
- Emitted v12 schema remains hash-identical: 11655 bytes, 18 definitions, 51 union branches, 105 enum members, unchanged before/after. Canonical schema hash remains unchanged. Decoder contract label is v13, not a claim of live provider admission.
- First full run: 8130 PASS / 34 FAIL / 2 existing skips. Failures included stale decoder/trace assertions, hybrid runtime/tooling fixtures, decoder-bound historical observation hashes, and candidate source changes during immutable snapshot execution. Evidence retained; this run is not acceptance credit. Final verification uses frozen runtime bytes.
- Live provider acceptance, credentials, deployment and production behavior were outside this offline review; they remain unverified. No declined offline behavior or Minor finding is silently deferred.
- Final focused suite: 9 files / 4786 PASS. Final full serial suite: 167 files / 8167 PASS / 2 existing skips. Documentation check, typecheck, lint (zero errors, 168 pre-existing ignored-scratch warnings), build, Worker types check, local deployment dry-run and diff check PASS under credential/network denial. R01 DATE recovery, conflicting/genuine REST_OF_MONTH, no-range fail-closed and frozen R02 expectations PASS locally.

## Subsequent approved evidence-representation correction (2026-10-06)

The owner approved a bounded offline batch after the single R02 turn-one diagnostic execution against `4457271af007ad5365f44e428b9f7dcb0e644e2d` rejected `requestTarget.evidence`: actual count six, canonical bounds one through three. That execution stopped before semantic evidence validation. It does not establish the offset evidence path in the earlier generation, and no historical result is replaced.

### Transport correction and invariants

- Apply the already-accepted compact query representation uniformly to active V3 `requestTarget.evidence` and `changes[].evidence`: mandatory `primaryEvidence` plus bounded `additionalEvidenceJson`. Canonical arrays still contain one through three exact references in primary-then-extra order.
- Decoder rejects absent/null primary references, legacy arrays, malformed/non-array JSON extras, more than two extras, oversized JSON, unknown keys and invalid individual references. It never clips, pads, repairs, invents evidence or invokes another provider call.
- Canonical schema, field/value grounding, request targeting, merge/conflict policy, uncertainty codebook and historical V2 transport remain unchanged. JSON-encoded uncertainty alternatives retain canonical evidence arrays and strict canonical validation.
- Classify new exact transport paths as `SEMANTIC_UNTRUSTED` in the closed authority registry. No transport evidence field authorizes a read or write.
- Wire v14 explicitly identifies the new representation. Selected schema digest: `b17e442e441628b1909c65b7dbeec20761936a3124d9c9859f2e66e1e8fc75d3`. Selected prompt digest: `d8a7bad4da59e8bf761480f5b697afe1a66fef51cb1965163840c100798b38c7`. Canonical schema digest remains `43b6689ce9c4874c4d532652ea212b52aa7d7f222cddd55377e59d483f5c444b`.
- Local emitted-schema measurements: 41 objects, 167 properties/required properties, 12 nullable unions, 19 unions, 51 branches, 27 enums/105 members, 17 definitions, 41 references, three arrays and maximum object depth three. Existing V3 complexity ceilings remain intact. These metrics do not establish Google's private state count or live v14 acceptance.

### Verification coverage and remaining acceptance boundary

- RED tests reproduce the missing uniform representation for one, two and three references; independent public-schema validation and decoder/canonical round trips cover the replacement.
- Regression layers cover malformed/excess evidence, inactive padding, compact codebook, advisory quarantine, finite enums, exact quote/source/field/value binding, authoritative LIST periods, canonical ownership, preserved pending state, concurrency/idempotency, accounting/authority and the frozen R01–R16 application harness.
- Historical context checkpoint bytes remain immutable. Semantic comparison normalizes separately asserted decoder-dependent observation and prompt stamps, not facts, fields, sources, revisions or expected results.
- R02 turn-one remains an explicitly unresolved live acceptance issue: the frozen DAILY/count-two conversation expects a relation-only proposal with offset null; a directly supported offset-two proposal instead raises the existing `COUNT_OFFSET_CONFLICT`. Offline relation-only fixture acceptance does not prove the real model will choose it. Do not change oracle or suppress that conflict to obtain a green campaign.
- End this batch at local full verification and independent review. No credential access, provider call, fresh authority, budget change, UNKNOWN release, remote migration, push, merge or deployment belongs to this batch. Any subsequent live v14 acceptance requires a fresh candidate-bound owner grant and the existing trusted accounting/admission mechanism.
- Final frozen `pnpm check`: 169 files / 8214 PASS / two existing skips; documentation check, typecheck, lint (zero errors, 168 warnings), build, Worker types check and deployment dry-run PASS under network/credential denial. First full run retained 8213 PASS / one failed stale prompt pin / two skips; the selected digest was corrected and the complete workflow rerun. Independent delta review after correction: C0/I0/M0. No live acceptance credit is claimed.

## Owner-authorized v14 schema debug loop (2026-10-06)

The later direct owner decision authorizes repeated controlled provider probes and new immutable candidates through Fresh Formal Pilot PASS, under a total USD 5 ceiling. It additionally approves conservative UNKNOWN exposure admission instead of the one-prospective-UNKNOWN veto. It does not authorize Full, push, merge, remote migrations or deployment.

- [x] Reproduce the prior v14 HTTP 400 from sanitized historical evidence. The provider rejected schema compilation before model output; no canonical/evidence/oracle relaxation is justified.
- [x] Compare v13 and v14 in memory: emitted bytes 11,655 to 13,200; reference-expanded object nodes 66 to 75. The change adds nested primary-evidence objects in request targeting and eight change branches. These counts are not Google's private compiler-state metric.
- [x] TDD an opt-in conservative cost inspector: confirmed ceiling costs plus all historical/PILOT/FULL UNKNOWN bounds plus next-request exposure must fit USD 5. Preserve original V1 readers, history and UNKNOWN classification; no reset, release or invented zero settlement.
- [x] Add pinned reusable debug-loop authority with immutable owner/record digests and an existing-campaign binding. Child executions bind actual application/harness bytes, candidate, mode, frozen manifest and durable deterministic consumption identity. Probes contain only R01 turn zero and cannot earn Pilot credit.
- [x] Complete independent admission review C0/I0 and local full verification before secure credential access: 171 files / 8,233 PASS / two existing skips, documentation, typecheck, lint, build, Worker type check and deployment dry-run PASS under network/credential denial. Final affected preparation/admission regressions: 84 PASS. Review fixed total-account FULL exposure and an obsolete V1 launcher-preparation coupling; final C0/I0/M0.
- [x] Probe the minimum evidence ablations needed to isolate Google schema-state failure. Preserve route, strict output, privacy/ZDR, stream=false, retry=0, fallback=none and response/token ceilings. Record sanitized results, request/schema digests and actual/UNKNOWN costs; never store provider content or credentials.
- [x] TDD the smallest proven provider-wire correction without changing canonical/evidence/oracle authority, then run focused regressions, full check, independent review C0/I0 and commit locally.
- [ ] Execute a fresh frozen Formal Pilot for the resulting immutable candidate. Stop each failed execution, preserve it, and only start another child after offline correction under the same reviewed root grant/cumulative cap. No failed campaign is resumed or relabeled PASS.
- [ ] Stop at Formal Pilot PASS, conservative cap exhaustion or genuine credential/security/provider/production boundary. Report actual provider calls, accounting, historical integrity and final candidate/review evidence; do not run Full or release.

### Minimal real schema isolation and v15 correction

Four separately terminal one-request probes evaluated application `b1210fe0e686d6e39955be03634405a0be9a5cc5` with harness `7a244f553b71440ebb80d0b1d30f97b299624a4d`. QUERY_ONLY (prior array representations for request target and changes) returned HTTP 200, canonical/evidence acceptance and R01 turn-zero clarification; actual cost USD 0.0003381. Adding the nested evidence object only at request target (NO_CHANGE_EVIDENCE), only at changes (NO_REQUEST_TARGET), or only at the text-change branch (CHANGE_TEXT_ONLY) each returned HTTP 400 `Schema state limit exceeded`. Each unknown cost remains UNKNOWN at the normal conservative request bound. No probe earns formal Pilot credit.

The evidence isolates provider schema compilation complexity from the newly nested primary evidence union: even one of these slots crosses the observed threshold on this schema baseline. It does not expose Google's private state count. No model output or canonical failure exists for those HTTP 400 responses.

- V15 retains mandatory `primaryEvidence` and bounded `additionalEvidenceJson`, but encodes the primary reference as a bounded JSON string. JSON decoding is strict and traverses the original wire reference codec, canonical cardinality and exact semantic evidence validator. No truncation, padding, inference, repair or invented evidence is introduced.
- Canonical schema, evidence validator, oracle, model/provider, privacy policy and retry/fallback remain unchanged. Historical V2 representation remains unchanged.
- New schema digest: `5ae993826dffda6629ee599b5c9bd21353192b10a088d5adc1a2822ea070e906`; prompt digest: `fbe0c29b71b504b8151c4bb103440e4e4e24444479deba77f3dbf5268b8958e1`. Emitted schema decreases from 13,200 to 12,491 bytes, references 41 to 27, objects 41 to 39 and unions 19 to 18. These public metrics are not a substitute for live compiler admission.
- RED tests establish mandatory primary JSON representation; GREEN coverage preserves exact one/two/three-reference parity, malformed/oversized (including UTF-8 multibyte) rejection and sanitized diagnostics. Existing evidence-layer fixtures explicitly parse/mutate/re-encode rather than accidentally testing wire rejection.
- Independent delta review closed stale fixture findings: C0/I0. Focused wire/gateway/fit suite 3,297 PASS/two existing skips; fixture regressions 38 PASS. Full verification and live v15 admission remain required before any Pilot claim.
- Derived accounting after these probes: confirmed actual USD 0.01713491; conservative retained USD 1.704706, remaining USD 3.295294 under the USD 5 root ceiling. Historical UNKNOWN USD 1.265664 remains unchanged; prospective UNKNOWN USD 0.421888 stays retained. Future admission must freshly derive these values, never inject this checkpoint.
- Final v15 `pnpm check` completed successfully under network/credential denial: full tests, documentation checks, typecheck, lint, build, Worker type check and deployment dry-run PASS. The earlier full run retained one R13 action-test failure; its isolated reproduction passed, then the complete suite was rerun successfully. No failed local run is relabeled PASS. No live v15 or formal Pilot acceptance is implied by these local gates.

### V15 live compiler acceptance and V16 canonical evidence JSON

V15 candidate `3e81f8a606beb966f938217f2236a2be9115d5f9` compiled successfully and returned HTTP 200 in the single R01 turn-zero canary, generation `gen-1791273492-LzNftLZeiqGlPyaRJ9Py`, actual cost USD 0.0003363. The application rejected `query.evidence.primaryEvidence.ref` as missing: encoded USER_QUOTE used its canonical active keys without the legacy wire union's inactive `ref:null` padding. No LIST read or reminder mutation occurred; this canary is separately terminal and has no Pilot credit.

V16 keeps the successfully compiled public schema unchanged, but declares encoded evidence JSON to be canonical references. Primary and extra references require all selected active keys; discriminator enums and unknown-key rejection remain strict. Optional known legacy inactive padding is discarded without authority, as before; all non-JSON provider objects and V2 retain their existing required-key behavior. No value is fabricated, padded or repaired. Canonical and evidence validators are unchanged.

- [x] RED: canonical USER_QUOTE and CONTEXT_FACT encoded without inactive padding reproduced two failures; existing invalid/malformed/oversize cases remained rejected.
- [x] GREEN: exact canonical JSON encode/decode plus missing-active-key, bad-discriminator and unexpected-key rejection; focused wire/parity tests 3,102 PASS.
- [x] Independent delta review C0/I0; frozen full `pnpm check` 171 files / 8,245 PASS / two existing skips, documentation, typecheck, lint, build, Worker types check and local deployment dry-run PASS under network/credential denial. An interrupted earlier run changed fixtures during execution and is not accepted verification evidence.
- V16 prompt SHA256: `67a47b298367b2f223c5a6a27762c711d0cec8f92c25d2fab20ec8cc706f7b6e`; schema remains `5ae993826dffda6629ee599b5c9bd21353192b10a088d5adc1a2822ea070e906`. Fresh Formal Pilot, not a redundant compiler probe, is the next acceptance gate under the same USD 5 root authority.

### First V16 Formal Pilot and numeric-clock prompt correction

Candidate `e7d2df2b7ea67da9c4972e394f3cff61ba586ad4` Formal Pilot issued five provider requests, all HTTP 200. R01 turns zero/one and R02 turns zero/one passed the frozen application oracle. R02 turn two created a preview but failed the sole assertion `fields.reminderTime.qualifier`: expected H24, actual AM for the frozen `8h.` operand. Generation `gen-1791274228-XxYrfoiR4NpG57i33IpZ`; total five-request confirmed cost USD 0.0021525. The failed execution remains terminal with no Pilot acceptance credit.

The approved spec/frozen canonical example treats numeric clock notation as H24; the prompt did not explicitly distinguish it from a model-inferred meridiem. Add a general rule: numeric h/HH:mm without an explicit day-part uses H24; AM/PM requires a scoped explicit user operand or exact retained fact. Genuinely approximate/ambiguous operands remain unresolved. No live result is rewritten or repaired and schema/canonical/evidence/oracle semantics are unchanged.

- [x] RED prompt-policy regression; GREEN focused 68 PASS/two existing skips.
- [x] Final independent review C0/I0 including explicit day-part exception; final source-frozen `pnpm check` 171 files / 8,246 PASS/two existing skips, documentation/typecheck/lint/build/Worker type check/local dry-run PASS. Earlier pre-final-wording workflow was interrupted, not accepted as final evidence.
- Current prompt SHA256 `e6b55e019a392baf7e796de01d63689d6bb74df41780eeaaf745b098600a41d5`; provider schema and V16 protocol unchanged. Continue fresh immutable-candidate Formal Pilot under the existing debug grant and current conservative accounting.

### R02 title-omission diagnostic preparation

Clock candidate `cf6dec61eb8720a31155058f2803e98463afa5cf` fresh Formal Pilot passed both R01 turns, then stopped after its third provider call: R02 turn zero retained other expected fields but title was null and pending field was title. Generation `gen-1791274856-ciss0Ow8JtfF8rG8pr32`, HTTP 200. Historical artifact lacks the semantic patch/uncertainty summary, so it cannot establish whether title was omitted or made uncertain. No speculative runtime fix is justified.

Enable the existing bounded `captureValidationSemanticState` (finite field/operation/intent/uncertainty controls, counts and value digests only) for all successful evaluated semantic outputs. Add a single R02 turn-zero diagnostic mode through the existing frozen single-target executor under the same root debug authority. This is an intentional one-request diagnostic, not a retry, cannot earn Pilot credit, and keeps duplicate consumption, actual candidate proof, immutable history and conservative accounting.

- [x] RED unavailable-mode regression; GREEN 17 debug-loop tests including one request/terminal/duplicate/sanitized summary and full 76-request fake Pilot.
- [x] Independent review C0/I0; full `pnpm check` 171 files / 8,247 PASS/two existing skips, docs/typecheck/lint/build/Worker type check/local dry-run PASS. Application runtime, wire, canonical/evidence/oracle and prompt remain unchanged for this tooling commit.
- Evaluate the already-committed application candidate `cf6dec61eb8720a31155058f2803e98463afa5cf` with the new separate harness revision. Preserve the three-call failed Formal Pilot as terminal; use the new sanitized evidence before any further semantic correction.

### R02 explicit-subject completeness correction

The single diagnostic at application `cf6dec61eb8720a31155058f2803e98463afa5cf` / harness `38d1b791acbe33a265792abdb7815556756098fd` returned HTTP 200, generation `gen-1791275398-EGGk9w3x1RJTRebI8jcg`, confirmed cost USD 0.0005534. Its sanitized semantic summary proves the model omitted title and emitted no uncertainty; other date/location/cadence/count proposals survived merge. This is new diagnostic evidence, not reconstruction of the historical provider payload. The execution remains terminal and earns no Pilot credit.

Add general prompt guidance to account for an explicitly supplied task/event subject independently of missing scheduling information. No backend subject fabrication, schema/evidence/oracle change or phrase-specific fixture logic is introduced.

- [x] RED prompt-policy test; GREEN focused 69 PASS/two existing skips.
- [x] Independent delta review C0/I0/M0. Frozen full `pnpm check`: 171 files / 8,248 PASS/two existing skips, docs/typecheck/lint/build/Worker types/local dry-run PASS under network/credential denial.
- Prompt SHA256 `ab8e1c6d76d1958c28257f5cfc51e5b7cb817133c2662fa2f5d687ff8696d665`; accepted V16 schema remains unchanged. Continue a fresh immutable-candidate Formal Pilot under the same USD 5 root authority, with freshly derived conservative accounting and immutable failed execution history.

### Retained-series continuation semantics

Candidate `37fe0ed1a82f1d0d3cedd5442029546456bacdd6` issued four requests before its Formal Pilot stopped at R02 turn one. R01 and R02 turn zero passed. Generation `gen-1791275923-aw7xLs2deqZ8cpcyVMDx` returned HTTP 200 with a semantic proposal containing only leadOffsetDays=2; BEFORE_EVENT was omitted. Canonical/evidence validation passed but the frozen oracle rejected the offset and missing relation. The retained DAILY/count=2 conversation expects the preceding consecutive series, not a separately authored single-offset schedule. This failed execution remains terminal.

Add contextual prompt guidance distinguishing preceding notification count from an independently specified lead offset. Preserve genuinely separate offset/count operands for backend conflict computation; do not infer either from a bare number. Canonical/evidence/oracle behavior is unchanged.

- [x] RED prompt-policy test; GREEN focused prompt/fit/oracle regressions 89 PASS/two existing skips.
- [x] Independent review C0/I0/M0; full `pnpm check` 171 files / 8,249 PASS/two existing skips, docs/typecheck/lint/build/Worker types/local dry-run PASS under network/credential denial.
- Prompt SHA256 `05a802a5dd24c3fb145570c290f26a95843797b46697a8b9d881a4258ac10aee`. Fresh Formal Pilot remains necessary; no failed execution is relabeled or resumed.

### Query continuation ownership prompt clarification

Candidate `4715f1185980db16a0ccd59f37970d2a7f14ee10` stopped after two requests. R01 turn one generation `gen-1791276507-9pZ3xxHyzAvNv2lu05XN` returned HTTP 200 but canonical validation correctly rejected REQUEST_TARGET_INTENT_OWNERSHIP: LIST_REMINDERS, CURRENT target, LIST query, zero changes/uncertainties. No database read or reminder mutation occurred. The failed execution is terminal; no schema/evidence/oracle relaxation is justified.

Explicitly guide query continuations to retain query intent and null requestTarget even when application context is present. Period answers fill query.period, not a reminder target. This mirrors the existing canonical ownership rule without changing runtime authority.

- [x] RED prompt-policy test; GREEN focused prompt/fit/oracle regressions 90 PASS/two existing skips.
- [x] Independent review C0/I0/M0; full `pnpm check` 171 files / 8,250 PASS/two existing skips, documentation/typecheck/lint/build/Worker types/local dry-run PASS under network/credential denial.
- Prompt SHA256 `242a67e5376c055dc5069fde62e6b19fad3b15f37f1dffe017bdf2055982e2d4`. Public provider schema remains unchanged; continue fresh Formal Pilot within the existing conservative USD 5 debug cap.

### Optional event-clock clarification

Candidate `b0b0f57d3f1a798ff861af3ed2ad210c3a195249` stopped after three requests at R02 turn zero. Generation `gen-1791277008-E6ROjdzuOhbQPzq9igzn` returned HTTP 200 with grounded reminder facts but a model-authored eventTime MISSING uncertainty. The sole frozen assertion failure was pendingField eventTime instead of reminderTime. An absent event clock is optional for this day-based operation, not a missing required notification clock. Preserve the terminal failure and its accounting.

Clarify MISSING as a required operand preventing the operation, not every absent optional property. Preserve genuine optional-value ambiguity and explicit lunar year/leap requirements. Canonical/evidence/oracle and resolver behavior remain unchanged.

- [x] RED prompt-policy test; GREEN focused 91 PASS/two existing skips.
- [x] Independent review C0/I0/M0; full `pnpm check` PASS including documentation/typecheck/lint/build/Worker types/local dry-run under network/credential denial.
- Prompt SHA256 `d2dd7f73a33e2eaf7c1954b78d38f32cad74f36bf214f3f588dd3fd3e699a26a`; continue fresh Formal Pilot within the existing debug cap without retrying the terminal execution.

### Required unresolved-query uncertainty

Candidate `671684955618e1a14c2733a4e5268036a546469a` stopped after one request at R01 turn zero. Generation `gen-1791277541-HMTwXW8ak0fvhUvh0PCt` returned HTTP 200 but canonical rejected UNRESOLVED_QUERY_TARGETED_UNCERTAINTY: incomplete query without the required semantic uncertainty. No LIST read or reminder mutation occurred; accounting settled known USD 0.0003743 and the execution is terminal.

Clarify that a genuinely missing LIST range with period=null requires queryRange uncertainty on the provider wire, fieldCode14/reasonMISSING/alternatives[]. Conversational advice cannot substitute for semantic uncertainty. Supplied ambiguous/conflicting ranges retain their appropriate targeted reasons and grounded alternatives; resolved ranges do not retain stale MISSING. This preserves canonical/evidence/oracle behavior.

- [x] RED prompt-policy test; GREEN focused 92 PASS/two existing skips.
- [x] Independent review found and closed one Important overbroad-MISSING instruction; final C0/I0/M0. The interrupted earlier full run is not final evidence.
- [x] Frozen final full `pnpm check` 171 files / 8,252 PASS/two existing skips, docs/typecheck/lint/build/Worker types/local dry-run PASS under network/credential denial.
- Prompt SHA256 `7ca87117863d61e7f5e1b6298a43bec10408cc973b3c388e833c7797e92d5da5`; public provider schema remains unchanged. Continue fresh Formal Pilot under the same conservative debug cap.

### Selected directive-branch diagnostics

Candidate `56ab6af7ebe2a01187607a3bb26de15295e3fe26` stopped after one R01 turn-zero request, generation `gen-1791278279-C8MqYStmBAumxxYUyqIh`, HTTP 200. Its diagnostic blamed conversationDirective.kind while reporting the valid ASK_FOR_DISAMBIGUATION token. The raw payload was not retained, so the actual historical invalid reason/field is not recoverable.

Offline RED reproduction proves closest-tag ties can choose an unrelated directive branch and blame a valid kind when the selected branch has an invalid reason. Prefer the uniquely selected primary-discriminator branch for diagnostic failure projection only. Neither rejection/quarantine logic nor schema/prompt/canonical/evidence/oracle behavior changes. Historical results remain terminal and immutable.

- [x] RED reproduction; GREEN wire/parity focused 3,092 PASS.
- [x] Independent review C0/I0/M0; full `pnpm check` PASS with documentation/typecheck/lint/build/Worker types/local dry-run under network/credential denial.
- Continue controlled live validation under the existing root debug authority; do not claim the historical invalid reason was MISSING merely because the offline example used it.

### Series state-transition worked example

Candidate `808f0b41eb14e40d013bc366e60601c9bb64dd6a` single R01 canary passed (generation `gen-1791278966-gIT2WhDTooTz5Kp2vbMR`, USD 0.0004258); it earns no Pilot credit. Its separate Formal Pilot then stopped after four requests at R02 turn one. Generation `gen-1791279035-brakWclnFfywTYR76778` proposed BEFORE_EVENT and leadOffsetDays=2 for the retained DAILY/count2 series. The frozen oracle rejects the duplicate offset and resulting leadOffsetDays clarification. Both executions are separately terminal and their history is retained.

Expand the general series guidance with an abstract three-day worked state transition: accepted DAILY/count3 plus the three preceding notification days means relation only, not count copied into offset. Backend still expands dates, and independently supplied start offsets keep their own evidence/conflict handling. Canonical/evidence/oracle/provider schema remain unchanged.

- [x] RED prompt-policy test; GREEN focused 93 PASS/two existing skips.
- [x] Independent review C0/I0/M0; full `pnpm check` PASS including docs/typecheck/lint/build/Worker types/local dry-run under network/credential denial.
- Prompt SHA256 `8fa39d2984472a557b2f7f85506d6e34c6183210df4a02e25068a103ed8d66e0`. Continue fresh Formal Pilot under the existing conservative debug cap, not the terminal failed execution.

### Event versus notification clock ownership

Candidate `0782290cf9a920a94685b827fa2711fe9f73bd9d` Formal Pilot passed R01–R03 then stopped after eight requests at R04 turn zero. Generation `gen-1791279603-sKmBYq5BsbbKkvndZDSq` returned HTTP 200 but omitted the event-predicate subject and put its event-owned clock into reminderTime instead of eventTime. The application safely clarified; the frozen oracle failed four assertions. The execution is settled and terminal.

Clarify clause ownership: event predicates supply eventTime and a concise grounded task subject; only notification instructions or answers to the reminderTime question supply reminderTime. Illustrative distinct exam/meeting subjects and 9h-event/7h-notification clocks do not authorize invented detail or backend duplication. Canonical/evidence/oracle/schema remain unchanged.

- [x] RED prompt-policy test; GREEN focused 94 PASS/two existing skips.
- [x] Independent review C0/I0/M0; full `pnpm check` PASS with docs/typecheck/lint/build/Worker types/local dry-run under network/credential denial.
- Prompt SHA256 `d5ca906ef8af24624dd01b979b8704b6264daee602c549035b7ad5e0513e6a8c`. Continue fresh Formal Pilot under the existing conservative debug cap.

### Current-turn request targeting index

Candidate `f82c5273f90c2705294089c7b90af6fb53b4c087` stopped after five requests at R02 turn two, generation `gen-1791280165-B6IfjKlDpjwYN3Oi58mQ`, HTTP 200. Semantic state had one SET reminderTime, CURRENT target, null query and no uncertainties. The prior R02 turns both passed with pending reminderTime, so operation-candidate adoption is inapplicable. The sole applicable CURRENT_USER_EVIDENCE_REQUIRED branch is requestTarget evidence not referring exclusively to the supplied current USER turn. The exact historical index/quote is not retained.

Clarify target ref turn=input.currentTurn, counting USER and ASSISTANT entries and grounding short continuations in their current fragment rather than earlier subject/date facts. No evidence/validator/schema/oracle semantics change.

- [x] RED prompt-policy test; GREEN focused 95 PASS/two existing skips.
- [x] Independent review C0/I0/M0 with adoption-path qualification verified; full `pnpm check` PASS with docs/typecheck/lint/build/Worker types/local dry-run under network/credential denial.
- Prompt SHA256 `f8ea2883d9b53fb3c25231cb895f42e5519ed04a1770ee0a579655af305d1f74`. Continue fresh Formal Pilot under the same debug cap, preserving terminal failures and UNKNOWN exposure.

### Encoded evidence structural diagnostics

Candidate `0b154b309509b520c85cd053294c9f41b7366aad` stopped after four requests at R02 turn one, generation `gen-1791280696-OFXDZ9cptw4BJ9NHakcZ`, HTTP 200. Wire decode rejected `requestTarget.evidence.additionalEvidenceJson[0]`; existing telemetry incorrectly traversed the encoded JSON string as an object and reported undefined. The historical element value/type is not reconstructible.

Project only safe type/classification through bounded, known evidence JSON transport slots. No decoding acceptance, canonical/evidence semantics, prompt, or oracle changes. Never persist the decoded values.

- [x] RED four type-projection regressions; GREEN focused 129 PASS, sensitive sentinel absent from diagnostics.
- [x] Independent delta review C0/I0/M0.
- [x] Full verification with one worker: 171 files / 8261 PASS / two existing skips; docs/typecheck/lint/build/Worker types/local dry-run PASS. Initial concurrent run had 13 timeout/local connection-reset failures; preserved as failed evidence, not relabeled PASS. No timeout/assertion relaxed.
- [x] Continue a new immutable candidate Formal Pilot under the existing conservative debug cap; historical execution remains terminal.

### Complete encoded USER_QUOTE keys

Candidate `585570ce333957e51b1af9b6f6ccc274f7419e82` Formal Pilot stopped after one provider timeout; its conservative UNKNOWN bound remains retained. An independently admitted canonical-wire diagnostic execution then returned HTTP 200, generation `gen-1791293313-giQPqbFvR9xuY6g54cGy`, and safely rejected missing `query.evidence.primaryEvidence.occurrence` (REQUIRED_PROPERTY). No database reads or mutations occurred. Both executions remain terminal; diagnostic execution earns no Pilot credit.

Make required occurrence explicit even for a single match, with a non-fixture structural example and verification instruction for all active keys. Extra evidence must be complete, distinct grounded references, never null/primitives/nested encoded strings. No backend fabrication, schema relaxation or oracle change.

- [x] RED prompt-policy test; GREEN focused 131 PASS.
- [x] Independent review C0/I0/M0; prompt-policy assertions do not prove model compliance.
- [x] Full local verification: 171 files / 8262 PASS / two existing skips; docs/typecheck/lint/build/Worker types/local dry-run PASS.
- Prompt SHA256 `0d75f8e52eb7726e64719c2ecaf01b7436f67579093c4258e7f5282bbcdb3751`. Continue fresh Formal Pilot within the unchanged root debug cap.

### Target evidence ordinal projection

Candidate `edda8efe48ee118feae6f7a3e865f480bf310a4d` passed R01 and R02 turns zero/one, then stopped on R02 turn two after five requests. Generation `gen-1791294209-Z0NbDlfrR1XC9uUzGCmy` was canonical-valid but rejected CURRENT_USER_EVIDENCE_REQUIRED. Its precise target ordinal was not retained.

Add tooling-only bounded targetEvidence diagnostics: finite kind and numeric turn/occurrence, excluding quotes and fact identities. This does not change validation, evidence matching or oracle behavior.

- [x] Valid canonical fixture RED missing targetEvidence; GREEN focused 37 PASS. Initial invalid fixture and interrupted full run retained separately.
- [x] Independent review C0/I0/M0.
- [x] Full serial local verification PASS: docs/typecheck/lint/build/Worker types/local dry-run included. Continue new Formal Pilot within existing root authority/accounting.

### Pending relation question and retained count

Candidate `a27ae60941fcec583d524dc6d9b7f53c33ed41e5` stopped at R02 turn one after four requests, generation `gen-1791295267-FC4Fs2TId0R6ahOy5iig`. Target ordinal was correct, but the model emitted relation plus offset copied from the preceding series count. Canonical/evidence accepted its explicit phrase; backend conflict clarification preserved safety, while the frozen oracle failed two assertions. Historical execution remains terminal.

Strengthen contextual guidance: a short relation answer matching retained DAILY/count fills relation only, whereas independent start offsets/corrections remain grounded operands and genuine ambiguity stays uncertainty. No canonical/evidence/oracle changes.

- [x] RED prompt-policy test; GREEN focused 132 PASS.
- [x] Independent review C0/I0/M0.
- [x] Full serial local suite and docs/typecheck/lint/build/Worker types/dry-run PASS.
- Prompt SHA256 `d789dffc54291e6ccd34a21bdf76b25416033d89f51116ddd1d1bf0e7004e37c`. Continue fresh Formal Pilot in the same debug accounting root.

### Concrete proposed-slot context

Candidate `a1823fede287cd7d54c1cfff4c421fc9ffcf2742` again stopped after four requests at R02 turn one, generation `gen-1791296166-TroyKBsCQeWaH7DQCMA0`, with the same count/offset over-inference and safe backend conflict clarification. Preserve that terminal result.

Make the actual activeRequest.slots paths and PROPOSED/RESOLVED meanings explicit. Non-conflicting proposed draft values supply conversation context without waiting for confirmation; CONFLICT stays unresolved, and no slot use authorizes persistence. Whether this distinction explains the previous model behavior remains a hypothesis, not a claim about hidden reasoning.

- [x] RED prompt-policy test; GREEN focused 133 PASS.
- [x] Independent review C0/I0/M0.
- [x] Full serial local verification, docs/typecheck/lint/build/Worker types/dry-run PASS.
- Prompt SHA256 `cae2669c1c64b3ec15928a0e23b85c4fd826c699fa05f0e5edde9cc0d0cbd0fa`. Fresh live acceptance remains required; no canonical/evidence/oracle change.

### Final targeting source check

Candidate `58f11db71d99162942a1fa22729ef75e7bbc5a1e` stopped after four requests at R02 turn one, generation `gen-1791297086-rBXtggw9fzuCKQ1sGHrr`. Offset was absent, but targetEvidence reported USER_QUOTE turn zero instead of the current second USER turn at index two. Canonical validation passed and strict evidence correctly rejected CURRENT_USER_EVIDENCE_REQUIRED.

The authority matrix classifies source selection SEMANTIC_UNTRUSTED and not application-derivable. Therefore do not auto-substitute the target turn in decoding. Add a final source check in the model instruction, independently for primary/extras, preserving eligible historical non-target operand sources.

- [x] RED prompt-policy test; GREEN focused 134 PASS.
- [x] Independent review C0/I0/M0.
- [x] Full local suite and docs/typecheck/lint/build/Worker types/dry-run PASS.
- Prompt SHA256 `493d6ed6632a056feefaf1422d483d6c09238b6ffe72561f7544c279fe1dd191`. No authority/schema/validator/oracle relaxation; continue fresh live validation under the same root budget.

### V17 string constant dialect equivalence

Candidate `fa5241ab3460d2ad71e4a9ef0ff772764c907eb5` stopped on its first R01 turn, generation `gen-1791298077-LieHpjaTNQHxDEU31KSe`: query.kind was LIST_REMINDERS, whereas emitted branches constrain LIST/CALENDAR_DATE/CAPABILITY through string const. Strict decoding rejected it without DB reads or mutations.

[Google's structured-output documentation](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output) lists string enums, not const, and warns unsupported schema fields can be ignored. This motivates an equivalent outgoing V3-only const-to-singleton-enum conversion after normalization; it does not establish OpenRouter's private transformation. Canonical decoder predicates, evidence validation and legacy V2 stay unchanged.

- [x] RED outgoing dialect test: one fail/103 PASS; GREEN focused/parity 3122 PASS.
- [x] Independent review C0/I0/M0.
- [x] Full serial local verification and docs/typecheck/lint/build/Worker types/dry-run PASS.
- Wire version 17; emitted bytes 12491 to 12507, schema SHA256 `d6ba953e5e677d00a9d3f151077953238c2704f8e00a7c6322c241e035f2a888`. Finite domains unchanged. Live compiler/state-limit admission remains required under the unchanged root cap.

### V18 query-only discriminator dialect isolation

V17 candidate `66e419d071e3a75dc1c80a2e2cdf8c978ed48ea6` canary terminal-stopped after one HTTP 400 with `Schema state limit exceeded`. No authoritative cost was returned; the existing conservative policy retained UNKNOWN 105472 microunits. Historical records remain immutable. This does not prove the provider's private internal state calculation.

Restrict the outgoing equivalent singleton-enum conversion to LIST/CALENDAR_DATE/CAPABILITY query discriminators only. Restore all other outgoing string constants to the previously compiler-admitted representation, without changing the original decoder, canonical/evidence validators, prompt, or oracle. This is a minimal compiler-isolation hypothesis, not a live acceptance claim.

- [x] RED scoped outgoing-schema regression: one fail/103 PASS; GREEN focused 320 PASS.
- [x] Independent delta review C0/I0/M0; generated singleton enums occur only at the three query-kind paths.
- [x] Full serial offline suite 171 files/8267 PASS/2 existing skips; docs/typecheck/build/Worker types/local dry-run PASS; lint zero errors/168 existing warnings; diff check PASS.
- Wire version 18; outgoing schema 12494 bytes, SHA256 `efd4d8ff583f332cb42d407a9f172cd2a8ae34949c2e276169be4b0b89dc2dee`. Continue one canonical-wire canary, then fresh Formal Pilot only if admitted, under unchanged root authorization/accounting.

### Exam task title normalization

V18 candidate `9ab5404c6a265a7caeae7e1fb3fb86eb0ea8fb0e` canary passed canonical/evidence/application R01 turn zero (generation `gen-1791300213-Jm88RxdaiyIubPYT6OrH`, confirmed USD 0.0007243). Formal Pilot then terminal-stopped after eight requests at R04 turn zero (generation `gen-1791300266-UmfnjCOpdov8eSfa1smt`). Wire/canonical/evidence passed, dates/clock remained correctly scoped, but frozen title equality failed. Offline hashing of synthetic candidate phrases proves the observed value digest matches the bare exam predicate, not the expected normalized task phrase. Do not change that oracle or rewrite history.

Clarify the existing model instruction: normalize the exam predicate to the concise task phrase, while keeping evidence verbatim and prohibiting invented details. No runtime repair, canonical/evidence/oracle relaxation or wire change.

- [x] RED serialized-policy delivery test one fail/15 PASS; GREEN focused 136 PASS. This test proves instruction delivery only, not real-model compliance.
- [x] Independent review C0/I0/M0.
- [x] Full serial offline suite 171 files/8268 PASS/2 existing skips; docs/typecheck/build/Worker types/local dry-run PASS; lint zero errors/168 existing warnings; diff check PASS.
- Prompt SHA256 `4a9953202090cceae8a3685163d623d775f344b6e5103046d379ee94e2772962`. Continue fresh Formal Pilot under the same conservative root grant; all earlier failed executions remain terminal.

### Typed event-only normalization example

Candidate `ae6e0fc94a7817a083a6f2907c3142e030a280cf` again stopped after eight requests at R04 turn zero, generation `gen-1791301110-e125TUmpSEeML8wRN8kj`, with the same bare-predicate title digest and otherwise valid event operands. It is terminal and settled. Source consistency review found no concrete prompt/wire instruction forcing title to equal the evidence substring; do not invent an internal model-reasoning explanation.

Add a compact typed example with different synthetic date/hour operands to distinguish normalized task title, eventDate/eventTime, and absent reminder clock. Require verbatim original evidence and forbid copying example operands. This tests a guidance hypothesis, not a backend normalization rule.

- [x] RED policy example test one fail/16 PASS; GREEN focused/fit 202 PASS/2 existing skips; tests prove instruction delivery only.
- [x] Independent delta review C0/I0/M0; no source-level title/evidence contradiction proven.
- [x] Full serial offline suite 171 files/8269 PASS/2 existing skips; docs/typecheck/build/Worker types/dry-run PASS; lint zero errors/168 existing warnings; diff check PASS.
- Prompt SHA256 `fc6ad68e0d9c610896f8e0f20debf609268186f616666097961fb1859458cbd8`; wire v18 and canonical/evidence/oracle unchanged. Continue fresh Formal Pilot under the existing root debug grant/accounting.

### Explicit one-time cadence versus lead distance

Candidate `8b61122749c5720aeda6a0e73f00b34412bb4994` passed R04 turn zero but stopped after nine requests at R04 turn one, generation `gen-1791301902-JAJJvfgLJEEaOXmPSs1H`. Observed controls were DAILY/count1/BEFORE_EVENT/offset2 for an explicit one-time lead reminder. Canonical/evidence passed; backend rejected the unsupported schedule and no reminder mutation occurred. Execution is terminal and confirmed cost settled.

Clarify the existing single-offset rule with a different synthetic meeting example: explicit one-time cadence is ONCE, lead distance is leadOffsetDays, and it must not manufacture DAILY/count1. Preserve retained series context, independently evidenced conflicts, exact evidence and the frozen oracle.

- [x] RED policy test one fail/17 PASS; GREEN focused/fit 203 PASS/2 existing skips, delivery-only assertions.
- [x] Independent delta review C0/I0/M0.
- [x] Full serial offline suite 171 files/8270 PASS/2 existing skips; docs/typecheck/build/Worker types/dry-run PASS; lint zero errors/168 existing warnings; diff check PASS.
- Prompt SHA256 `882fc4e46082d75008f779741bf5188f8f53d6627c0d7c8ac4210c5aa23efc15`; wire/canonical/evidence/oracle unchanged. Continue fresh Formal Pilot under the existing root cap.

### Literal quote case-preservation guidance

Candidate `003e9a38057e9581550ca3f4578ca955abe01657` stopped after three requests at R02 turn zero, generation `gen-1791302688-qEz8ey0Rro3a4KjNq8qa`. Strict target evidence rejected QUOTE_NOT_FOUND; diagnostics show case-folded match true and exact match false, with valid retained USER binding. Do not claim raw quote contents or weaken matching. Execution terminal, cost settled, zero mutations.

Strengthen the final source-copy check across all USER_QUOTE refs, with a different synthetic lowercase/capitalized example. Keep semantic normalization distinct from literal evidence, require independently supported shortest exact spans and correct occurrences, and prohibit any source-index repair.

- [x] RED policy test one fail/18 PASS; GREEN focused/fit 204 PASS/2 existing skips; instruction delivery only.
- [x] Independent delta review C0/I0/M0.
- [x] Full serial offline suite 171 files/8271 PASS/2 existing skips; docs/typecheck/build/Worker types/dry-run PASS; lint zero errors/168 existing warnings; diff check PASS.
- Prompt SHA256 `a793647e34f8c7ad6ede4de193e8a74d64b5e062c4a63640aace3adede1d244e`; wire/canonical/evidence/oracle unchanged. Continue fresh Formal Pilot under the unchanged root grant/accounting.

### Current-turn continuation target example

Candidate `29e548a203a60a9c9bf2196c72c86b3d8679d95a` passed R02 turns zero/one but stopped after five requests at turn two, generation `gen-1791303486-O1FlVJFmFivEB9pFgEgF`. Model target evidence referenced turn zero instead of the current fourth payload entry and the quote still differed by case. Strict evidence rejected it; no DB reads or mutations. Execution terminal, known cost settled.

Add a continuation example with three preceding USER/ASSISTANT pairs, explicitly separating current targeting evidence from retained old task facts. The earlier turn-zero structural example must not become a default. Use actual request indices and clock, never the example operands. Do not rewrite model indices in backend.

- [x] RED policy test one fail/19 PASS; GREEN focused/fit 205 PASS/2 existing skips, instruction delivery only.
- [x] Independent review C0/I0/M0.
- [x] Full serial offline suite 171 files/8272 PASS/2 existing skips; docs/typecheck/build/Worker types/dry-run PASS; lint zero errors/168 existing warnings; diff check PASS.
- Prompt SHA256 `e8d124ac78cd64b1bde2403a447cfbc5773f366dd92284b2634209e8778be5b1`; wire/canonical/evidence/oracle unchanged. Continue fresh Formal Pilot under the same root authorization.

### Provider-envelope rejection observability

Candidate `680143d2b28c64b37c6b1877d7c2179aecc354a0` passed R01/R02/R03 and stopped after eight requests at R04 turn zero, generation `gen-1791304352-zIB7CP1eeA1Fa2hErbdY`. HTTP 200 was not application acceptance: SCHEMA_INVALID occurred before canonical/wire diagnostics were populated. The bounded raw response was 1187 bytes; no raw payload was retained. Execution terminal, provider-reported zero cost settled, no query reads or reminder mutations. A subsequent read-only generation metadata request confirmed total_cost zero but exposed no finish reason; it does not prove the rejected envelope shape.

Retain bounded structural validation diagnostics at the provider-envelope boundary, using the existing sanitized projection and payload digest. Preserve hard rejection, response category, usage accounting, one-call behavior, canonical/evidence/oracle and prompt/wire unchanged. Trusted envelope path names are allowed; unknown keys and user values remain redacted.

- [x] RED two failing tests/133 PASS; GREEN focused validator/gateway/runner regressions 199 PASS.
- [x] Independent delta review C0/I0/M0.
- [x] Serial offline full verification completed with exit zero: 171 files/8274 PASS/2 existing skips; docs/typecheck/build/Worker types/dry-run PASS; lint zero errors/168 existing warnings; diff check PASS. Continue fresh Formal Pilot after the local diagnostic commit under the unchanged root grant/accounting.
