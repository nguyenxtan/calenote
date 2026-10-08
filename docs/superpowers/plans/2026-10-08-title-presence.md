# Title Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Prevent omission of explicitly grounded exam task subjects without synthesizing model values.

**Architecture:** Share a bounded title coverage predicate between semantic completeness and request-specific generation capability. A versioned strict-object title carrier transports the model's own change and original array position into the unchanged canonical/evidence pipeline; missing, duplicate or malformed authority fails closed.

**Tech Stack:** TypeScript, Zod, JSON Schema, Vitest, existing OpenRouter Google Vertex gateway and trusted benchmark tooling.

**Spec:** docs/superpowers/specs/2026-10-08-title-presence-design.md

## Global constraints

- Same google/gemini-2.5-flash-lite through google-vertex/eu; stream=false, retry=0, fallback=none.
- No backend title filling, fuzzy evidence, output repair, general parser, canonical/evidence/oracle relaxation or extra inference.
- Preserve USD5 accounting, immutable history and UNKNOWN; no Full or production publication.
- Freeze all source/tests before full verification; application identity is distinct from harness identity.

## Review focus

- A query mentioning an exam must not become a forced reminder.
- Quotation/negation/hypothetical/control markers must not manufacture subject authority.
- CURRENT retained title cannot leak into NEW; changed subjects must remain real conflicts.
- Carrier round-trip must preserve model value, exact pointer and change order, not repair duplicates.
- Capability, actual request schema and measured prompt must agree; no silent fallback to old wire.

## One coherent implementation boundary

Files: context-contract/semantic-completeness.ts/.test.ts, evidence.ts and evidence diagnostic finite reason declarations; field-capability.ts/.test.ts; openrouter/context-provider-wire.ts/.test.ts and evidence-pointer.ts only if boundary integration requires it; context-contract/protocol.ts, prompt.ts/.test.ts; benchmark runner/fit tests and exact reviewed digest declarations. Existing approved specs/plans may receive narrow implementation references. No frozen fixture/oracle changes.

Interfaces: a bounded subject coverage predicate returns presence/coverage only; GenerationFieldCapability adds the application-owned title presence obligation; the wire exposes nullable indexed title SET carrier, encode/decode restore explicitly generated canonical changes without modification. Existing validators remain authoritative.

- [ ] Write failing bounded title coverage and application R05 omission tests; observe SEMANTIC_TITLE_OMITTED expectation fail on current code.
- [ ] Write failing carrier schema/codec tests: missing/null required title, original index/order, duplicate, invalid position, existing title REPLACE/CLEAR without obligation, absent unrelated/query/continuation obligations.
- [ ] Implement shared presence/coverage predicate and semantic guard; implement versioned carrier, request specialization and exact reversible mapping before evidence materialization.
- [ ] Update protocol/prompt representation and exact digest pins; include model-authored pointer source checks, complexity and actual outbound-schema/token binding tests. Do not weaken pin verification.
- [ ] Run focused completeness/capability/codec/gateway/runner/fit tests and typecheck; fix regressions, then freeze.
- [ ] Independent meaningful-boundary review C0/I0; fix findings and rerun covering tests.
- [ ] Run full offline pnpm test --maxWorkers=2, docs architecture test, pnpm typecheck, pnpm lint, pnpm build, git diff --check. Report all failures and retain old skips.
- [ ] Selective local commit after full/review PASS; trusted preflight/actual identity/budget/credential gates, then Fresh Formal Pilot within existing authority. Settle terminal before fixing new failures; no blind retry or history rewrite.

Focused command: pnpm exec vitest run src/modules/conversation/context-contract/semantic-completeness.test.ts src/modules/conversation/context-contract/field-capability.test.ts src/modules/intelligence/infrastructure/openrouter/context-provider-wire.test.ts src/modules/intelligence/infrastructure/openrouter/semantic-gateway.test.ts tools/benchmark/context-contract-runner.test.ts tools/benchmark/context-contract-fit.test.ts --maxWorkers=2

Acceptance: grounded title generated with exact USER pointer and required presence; wrong/missing authority rejected; original R01-R16 expectations preserved; full green, independent C0/I0, immutable local commit, then actual Fresh Pilot evidence. Commit is not a stop condition.

Request-bound primary source enum follow-up (design only until controller technical review):

Exact-fit refinement: TDD actual request contains one shared strict two-slot evidence object, all identical reachable copies reference it; preserve primary source enum and extras string, both-required/noextra language. Initial conservative actual-request maximum13521 is FAIL, not admission; deduplicate request-only evidence object before considering redundant prompt compacting. Keep12000 unchanged and base codec untouched.

- [ ] Review proposed wire32 source-availability amendment; no runtime edits before review.
- [ ] RED actual serialized R02 request primary strings permit ASSISTANT turn1; require exact USER index0/2 strings across every known primaryEvidence slot, including carriers. Prove shared pointer-string representation and literal canonical parity.
- [ ] RED controlled USER_SEGMENT/nonblank catalogue and existing CONTEXT_FACT alias availability; preserve unchanged downstream current target/correction/NEW/query/fact-scope validation and extra-pointer rejection. No array-of-all-combinations enum.
- [ ] Implement pure source availability helper and optional validated request-input specialization; production serializer always supplies exact ContextInput, no unconstrained fallback/default or auto-selected pointer. Empty domain fails closed before dispatch.
- [ ] Advance wire32 request contract/prompt and exact pins; emit one shared short-named $defs enum with refs, never branch repetition or a duplicate input catalogue. Measure ordinary/maximal source domains, complexity and exact actual-request network-denied token fit across the frozen matrix, including near-cap R02/2. Preserve12000 cap; no valid-source truncation or private provider admission claim.
- [ ] Focused pointer/capability/transport/gateway/runner/fit plus typecheck/diff, freeze; controller scoped review/full/commit/live.

Proposed files/interfaces: evidence-pointer.ts/.test.ts (pure availability helper reuses existing catalogue, materialization unchanged); context-provider-wire.ts/.test.ts (optional primaryEvidenceInput specialization only); context-contract/wire.ts and field-capability.test.ts (actual request binding, no GenerationFieldCapability shape change); prompt.ts/.test.ts, protocol.ts; benchmark runner/fit pins and necessary transport tests. Existing output-authority classification already marks model-authored primary strings untrusted; no authority expansion. Canonical/evidence guards, frozen fixture/oracle source, model/provider/budget remain unchanged. Large controlled-source enums are an explicit complexity/admission risk to measure, not a reason to invent fallback sources.

Wire31 position clarification follow-up: RED serialized prompt contract lacks explicit emitted-total arithmetic; add bounded zero-based N rule for all non-null carriers simultaneously and current proposal only, with structural examples. Keep strict index decoder and schema/wire identity unchanged; update exact prompt pins, focused transport/runner/prompt regressions and network-denied token fit/typecheck/diff, then freeze for controller review/full/commit/live. Invalid live index4 for total4 is proven; provider motive is not.

R05 reminder singleton follow-up (controller design review before runtime edits):

- [ ] Quick-review the bounded two-field spec amendment.
- [ ] RED schema permits ordinary reminderDate/reminderTime ownership; require nullable indexed roots, all operations, clock exclusions and reversible original-position reconstruction across title/date/time carriers.
- [ ] RED missing/malformed/null index, colliding positions, ordinary duplicate/bypass and wrong evidence source; preserve authored values and canonical guards without repair.
- [ ] Implement three-carrier transport helper, closed ownership paths, wire31 identity/prompt/pins and necessary authored test adapters; no frozen fixture/oracle edits.
- [ ] Measure base/request complexity and network-denied token fit; focused transport/capability/evidence/gateway/runner regressions, typecheck/diff, then freeze source/tests.
- [ ] Controller review/full suite/commit/live verification; mitigation remains unverified until Fresh Pilot passes.

Planned files: openrouter/context-provider-wire.ts/.test.ts; context-contract/output-authority.ts/.test.ts, protocol.ts, prompt.ts/.test.ts and validation-diagnostics.ts/.test.ts only for new finite transport paths/reasons; benchmark/context-pointer-fixtures.ts and relevant authored transport fixture tests; benchmark runner/fit identity and complexity pins. Existing field-capability semantics, evidence/canonical validators and frozen scenario/oracle files remain unchanged.

Wire30 availability follow-up: RED actual R04 specialized schema REPLACE/CLEAR on absent CURRENT title; add versioned titleCorrectionAllowed from occupied active title slot only; prune ordinary title branches when unavailable. Preserve real CURRENT PROPOSED/RESOLVED/CONFLICT corrections, missing/null and historical/query-fact exclusions; no claim of target-specific generation ownership across the shared root. Qualify prompt, update exact pins, run focused/date/evidence plus offline token fit/typecheck/diff, then freeze for review/full/live. Decoder still hard-rejects duplicate ownership without repair.

Wire29 dialect follow-up: TDD simulate unsupported const omission at actual specialized R04 schema, reject ordinary title SET using singleton string enums, retain legal non-obligated REPLACE/CLEAR and existing decoder/canonical constraints. Convert outgoing string constants only after specialization; numeric constants unchanged. Update exact version/schema/request digest pins and complexity metrics; run focused, network-denied local token fit and typecheck/diff before freeze/review/full/live. Never claim knowledge of private provider transformations.

R03 follow-up scope: TDD reject explicit single Gregorian civil day/month mismatch using the existing scanner after USER source binding; preserve exact fact reuse, lunar/relative/ambiguous/unknown and LIST behavior. No generated values or arithmetic. Add literal event-date fidelity prompt instruction and update only prompt digest pins (wire28 schema unchanged), then focused evidence/date regressions, typecheck and freeze for controller review/full/live.

Wire33 bounded target-presence follow-up: RED actual title-obligated request schema accepts targeted operation/null carrier and non-target operation; specialize only existing titlePresenceRequired requests to non-null requestTarget and targeted tuple subset0/1/2/9/10/11. Preserve all six authored targeted meanings without choosing one, non-obligated full domains/query/HELP, unchanged CURRENT availability/NEW factscope vetoes and strict decoder refusal. Files: context-provider-wire.ts; field-capability.test.ts and protocol identity/pins in protocol.ts, wire tests and benchmark runner/fit as necessary. No decoder/canonical/evidence/oracle edit, Cartesian schema union or prompt expansion. Measure exact request complexity/token limits unchanged, focused/typecheck/diff then freeze for controller review/full/commit/live.

Wire34 mutating-source follow-up: RED actual currentTurn4 schema accepts frequency REPLACE historical primary turn0; require current eligible primary for all REPLACE/CLEAR ordinary/indexed field-change nodes, preserve SET full domain/extras and exact existing backend ANY-current rule. Shared current domain/evidence object once, split only operation nodes; empty current domain removes mutating branches without empty enums/default. Tests historical/fact negatives/current and controlled-segment positives, SET/fact/query preservation, absent-domain and indexed carriers, downstream current/NEW scope guards. Files: evidence-pointer.ts/.test.ts, context-provider-wire.ts/.test.ts, field-capability.test.ts, protocol identities/benchmark fit/runner pins; diagnostic debug schema compatibility only if shared evidence ref requires the existing exact resolver extension. Actual fit<=12000 and complexity report precede freeze/review/full/live; no canonical/evidence/codec/oracle/provider change.

Wire35 follow-up: RED literal R02/1 retained DAILY/count2 “Nhắc trước 2 ngày.” capability and actual request schema still offer leadOffsetDays. Add shared reject-only whole-answer predicate to lead-offset-evidence.ts, tested independently; apply only to the no-series NEW probe in field-capability.ts when exact retained series and no occupied lead exist. Whole answer only; unknown suffix/independent new task/start/single/different offset/retained lead/NEW without series remain available. Do not change supportsLeadOffset acceptance or downstream ownership. Files: lead-offset-evidence.ts/.test.ts; field-capability.ts/.test.ts; capability/version pins in context-provider-wire.ts/protocol.ts and existing benchmark/schema tests as needed. Capability3/wire35 identify generation availability; no prompt growth, source/canonical/codec/oracle changes. TDD contrast matrix and actual schema membership, focused guard/date/evidence/regression and unchanged12000 actual fit, typecheck/diff then freeze for controller review/full/immutable live candidate.

Wire36 follow-up: TDD actual R02 USER/ASSISTANT index4 clock-only answer + active draft + bound REMINDER/reminderTime question admits eventTime today; restrict only that current source to reminderTime using whole finite h/HH:mm plus existing scanner RESOLVED/EXACT_TIME boolean. No value extraction/field filling/target rewrite/prompt growth/new parser. Contrast explicit event/NEW/correction/unknown suffix/multiple/quoted/control, unbound or QUERY questions and earlier/occupied eventTime sources. Files: field-capability.ts/.test.ts and existing capability/protocol/schema/benchmark identity pins. Capability4/wire36, base/prompt unchanged. Prove actual eventTime branch absent and authored reminderTime carrier available, preserve strict source/ownership guards, measure unchanged actual326 request fit, typecheck/diff then freeze for controller review/full/commit/live. Do not claim complete value fidelity.
