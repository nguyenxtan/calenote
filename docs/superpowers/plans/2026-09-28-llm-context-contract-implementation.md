# LLM Context Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Neither this recommendation nor this document authorizes execution.

**Goal:** Make Vietnamese reminder conversations preserve intent and details through evidenced model patches, deterministic resolution, explicit decisions, encrypted confirmation, and truthful delivery.

**Architecture:** One LLM call proposes typed semantic changes and conversational guidance together. Application-owned context, validation, merge/calendar resolution, effective directive, reply eligibility, decision binding, transactions and delivery remain authoritative. A separately versioned successor is developed dormant; V2 remains active until all acceptance and release gates permit activation.

**Tech Stack:** TypeScript 6.0.3, Zod 4.5.4, Next.js 16.3.4/React 19.2.8, Cloudflare Workers/D1/Queues, existing keyring encryption, Vitest 4.1.11, Miniflare and node:sqlite test stores, pnpm 11.19.0/Node >=22. Canonical lunar artifact is already local; no runtime astronomy dependency is added.

**Spec:** `docs/superpowers/specs/2026-09-28-llm-context-contract-design.md` (S below). Original approved content at `e8f9e75f436a672b23387eb0054047da217ade23`; post-T3 amendment at `fb5331378d71e9f8eb8e63bc0447bd62f129fc50`; Model Output Authority Consolidation approved at `904afe5a56d7f82530b44b07d775d6d3cc2467bf`. Implementation acceptance remains a separate measured/reviewed gate.

**Current planning status (2026-10-01): MODEL_OUTPUT_AUTHORITY_PLAN_READY_FOR_OWNER_REVIEW.**
The normative A1–A6 amendment below supersedes conflicting future instructions,
output interfaces and automatic continuation in the historical T0–T11 plan.
Its written-spec gate has passed; the current gate is OWNER_REVIEW_OF_AUTHORITY_IMPLEMENTATION_PLAN.
This turn changes documentation only. No implementation, executable tests,
provider calls, migrations, push, PR, merge or deployment are authorized by
writing or committing this plan. Accepted T0–T10 and T11 history are preserved.

**Current inspected baseline:** `904afe5a56d7f82530b44b07d775d6d3cc2467bf`, clean `codex/llm-context-contract-design`, worktree `/Users/bichtuyen/code/calenote/.worktrees/product-experience-v2`. Latest runtime commit is `899b1f25f38d4d4afcd7429ffbb10c91851c25e3`; older planning/runtime SHAs below are historical, not current live-state evidence.

**Historical initial status:** READY_FOR_OWNER_REVIEW; at initial planning all tasks were NOT_STARTED. Current acceptance and the post-T3 owner-review gate below supersede this historical state.

### Execution progress (historical checkpoint 2026-09-28)

- PLAN_OWNER_APPROVAL=APPROVED; approved plan reference `a2508f15b3180e7bd68beabe5cce4339c03edb78`.
- Owner authorization `1dac4827-7d8f-4172-a2b1-8e2e91e78f03` supersedes the earlier `443a5a1f-2c25-44ee-86a8-b92f93c8eb3d` T0-only stop. Scope: T0–T10 sequential subagent implementation with independent reviews and conditional T11 pilot/full (USD0.50/USD1.00, combined USD1.50), not remote release.
- T0: offline artifacts and measurements implemented; independent re-review accepted the factual BLOCKED evidence with Critical=0 / Important=0. Fit remains BLOCKED on unverified Gemini token/full-route framing evidence, not demonstrated model infeasibility. Final focused verification: 50 tests PASS; relevant regression: 307 tests PASS; typecheck/scoped lint/diff PASS. This is not feasibility acceptance or authorization to start T1. See [measured evidence](../../benchmarks/llm-context-contract-fit.md).
- T1–T10: NOT_STARTED, blocked by T0 prerequisite. T11 evaluation: NOT_RUN. No application inference/counting calls, remote migrations, push/merge or deployment performed.
- Routine per-task continuation approval is not required. Technical fit/test/review gates remain mandatory. Remote inspection/mutation and exact-master-SHA deployment remain separate authorization gates.
- Ledger: `.superpowers/sdd/2026-09-28-llm-context-contract-implementation/progress.md` (plan-specific local recovery record).

### Current methodology and dependency amendment (2026-09-29)

- Owner amendment `6af13f1c-4203-4fec-a724-c147d6a793ec` retains the preceding
  checkpoint as `HISTORICAL_T0_RESULT=BLOCKED_AT_E44B9A4`. Baseline was freshly
  verified clean on `codex/llm-context-contract-design` at `e44b9a415b87b7471085bc683d20e55c0360d9e8`.
- T0 is now two dimensions per S §8.2.1: local engineering feasibility A and
  provider-route/live admission B. A must pass measurements and independent
  review before T1; B alone cannot block dormant T1–T10 work. B still blocks real
  successor dispatch and activation. Never equate A PASS with full T0 fit.
- Isolated pinned development-only tokenizer provisioning is authorized; no
  runtime dependency changes, credentials, inference/counting calls or model
  weights. Measurements run network-blocked after verified bootstrap/cache.
- T0 local engineering A=PASS after independent acceptance (Critical=0,
  Important=0, Minor=1); 57 focused tests, three offline Python tests and fresh
  complete unit regression (99 files / 1,933 passed / one skipped), typecheck and
  diff check PASS. T1 accepted below; T2–T10 continue sequentially.
  Full-route token bound B remains UNVERIFIED, live dispatch BLOCKED.
  Existing conditional
  T11 caps/approval remain, subject to verified actual-route admission and all
  local gates. Push/merge, remote migrations and deploy remain unauthorized.
- No per-task owner reapproval is required. Preserve all task boundaries,
  test-first implementation and independent review. Keep the plan ledger.

### Current task acceptance

- Owner observable-admission amendment (2026-09-30), S §8.2.4, supersedes
  the private-transform/token-bound methodological stop for T11. T10 accepted
  at `8f521abd0f60574eedb314f6dc1d125b3d0402a1`, local C0/I0; historical
  pending status below is retained. Complete production gateway/transport and
  isolated runner with TDD and independent review before inference. First
  pilot semantic request is the only route canary, stream=false; no additional
  calibration/debug request. Freeze canonical digests and source, reserve
  conservatively, dispatch one then gate the next on exact schema, usage,
  bounded bytes, selected model/provider and real application evidence. Any
  failure stops with actual spend and sanitized request ID; no cap or schema
  weakening. Passing canary counts as case1, then existing pilot/full/release
  authorization continues. No private upstream-body equivalence is claimed.
- Current controlling owner authorization (2026-09-30),
  `31ddd6df-b74c-41ab-87f1-4e71284e935e`, supersedes earlier T10-only/external
  stop permissions, while preserving technical gates. Complete the narrow
  lossless snapshot-fit amendment S §8.2.3 and all unfinished T10 harness work;
  fresh T10 review Critical=0/Important=0 precedes its commit. Implementation
  and review agents use GPT-6.1 Sol Medium. Retain existing work and artifacts.
  T4–T9 acceptance below is unchanged; T10 is currently NOT_ACCEPTED.
  After T10 acceptance continue T11 automatically, with actual-route admission,
  official provider preflight and isolated synthetic actual-service pilot/full
  under existing USD0.50/USD1.00/combinedUSD1.50,192/480calls,20/45minutes,
  retry0/no-fallback limits. Only full live PASS permits compatibility/release
  preflight, exact reviewed additive migration, reviewed push/PR/CI/merge and
  deployment of the exact reviewed resulting master SHA under this conditional
  owner authorization. No gate is inferred from a prior phase's green result.
  Preserve compatible immutable rollback and controlled-account UAT; stop at
  failed acceptance, credentials/billing/privacy/budget, incompatible migration,
  red CI, unsafe rollback or deployment/runtime mismatch. No routine per-stage
  approval is requested; no current external action has occurred.
- Controlling owner authorization `6dd6ddd5-b02d-48f3-9285-3c5cc06940f4` approves
  the amendment and T1A -> T2A -> T0A as ONE TDD/review/commit bundle, then
  automatic T4–T10 continuation when accepted. It supersedes the historical
  documentation-only stop below. No per-subtask owner approvals or independent
  reviewers; one consolidated amendment review, with scoped fixes/re-review.
  Strong independent review remains mandatory for T4, T7, T10 and whole branch.
  No push, PR, merge, remote migration, Cloudflare change, customer data access
  or deployment. T11 prerequisites and caps remain unchanged.
- Bundle dependency allocation: owner now requires CO-A–F and effective-directive
  selection before T4. Pull forward only reusable pure `guidance.ts`/tests from
  T5, consuming real T3 results. T5 retains decision/lifecycle integration;
  T7 retains actual inbound dispatch-count proof. Do not equate a pure/injected
  test with the not-yet-built full service. Ordinary T0A fit failure blocks T4.
- T1A/T2A/T0A LOCAL_IMPLEMENTATION_ACCEPTED as one bundle: 605 combined tests,
  typecheck/scoped lint/diff PASS; independent consolidated review and scoped
  correction re-review Critical=0 / Important=0 / Minor=0. Scope-aware unresolved
  uncertainties precede factual handoff; terminal binding IDs are protected.
  Local fit PASS (ordinary guidance171, max400CP563 output tokens); full-route
  B remains UNVERIFIED. T3 algorithms unchanged. T4 may proceed dormant only.
- T4 LOCAL_IMPLEMENTATION_ACCEPTED: 64 focused tests; final canonical `pnpm check`
  passed 114 files / 2246 tests with one intentional opt-in skip, including
  architecture/typecheck/lint/build/Worker types/dry-run; diff check PASS.
  Independent storage/security review and scoped correction review: Critical=0,
  Important=0; pre-existing verification warning noise remains a documented Minor.
  Non-save approval after edits and preview-order atomic fencing regressions are
  closed. Migration 0009 exists locally only; no runtime activation or remote
  migration. Test file concurrency is bounded to two; no assertion/timeouts were
  weakened. T5 may proceed locally; full-route B remains UNVERIFIED.
- T4 delivery integration correction accepted: prepared UNCERTAIN preview,
  decision and selected outbound may persist consistently, but only actual SENT
  receipt enables confirmation. No new fields or looser confirmation guards.
  Focused74 and fit66 tests PASS; hash-verified isolated source full check PASS
  (114 files/2254 tests,1 opt-in skip), all remaining gates PASS. Independent
  scoped review Critical=0/Important=0. Unfinished untracked T5 RED files were
  preserved outside that isolated T4 validation; T5 is not yet accepted.
- T5 LOCAL_IMPLEMENTATION_ACCEPTED: 349 context tests PASS; fresh canonical
  check passed 117 files / 2317 tests with one opt-in skip, including all
  downstream static/build/Worker dry-run gates. Independent task and scoped
  correction review Critical=0/Important=0; pre-existing warnings remain Minor.
  Replacement adoption preserves revision binding: bare approval cannot save a
  replaced preview; exact current token or delivered reply reference is required.
  T4 confirmation guards remain unchanged. T6 may proceed dormant only; actual
  full-route admission remains UNVERIFIED, no provider or remote actions.
- T6 LOCAL_IMPLEMENTATION_ACCEPTED / LIVE_ADMISSION_PENDING: final focused146
  and relevant regression606 tests PASS; typecheck/scoped lint/diff PASS.
  Before the narrow token-counter correction, full2377 tests+1skip and local
  tokenizer/regression856 passed; these are not post-fix full-suite claims.
  Independent review and scoped correction review Critical=0/Important=0.
  Known token overflow cannot be hidden by a malformed sibling usage field.
  Exact canonical successor wire and section parsing remain dormant; real
  callable transport refuses admission, copied declarative fixtures only.
  T7 may proceed locally; full-route proof B remains UNVERIFIED.
- T7 LOCAL_IMPLEMENTATION_ACCEPTED: final focused 189 tests PASS; fresh complete
  check passed 120 files / 2456 tests with one intentional opt-in skip and all
  architecture/static/build/Worker types/local dry-run gates. Independent actual
  service/security review found three Important issues; scoped TDD correction
  and same-reviewer re-review closed all three, Critical=0/Important=0. Numeric
  clarification is semantic, local decline remains available at context capacity,
  and explicit uncertain-preview recovery requires a separate bound confirmation.
  Bare SAVE requires positive complete delivery history; pruning fails closed.
  Existing generated-artifact warnings are disclosed, not new source errors.
  Successor remains dormant; worker entrypoint/configuration/migrations unchanged,
  no provider or remote actions. T8 may proceed locally; route B is UNVERIFIED.
- T8 LOCAL_IMPLEMENTATION_ACCEPTED: prescribed focused48 and additional116
  context/store/service regressions PASS; fresh complete check124files2472tests
  PASS with one opt-in skip, all downstream gates PASS. Independent API/security
  review Critical=0/Important=0/Minor=2: narrow evidence wording corrected;
  inherited generated-artifact warnings deferred. Strict OWNER details and
  bounded complete previews use live WEB authority/shared T4 CAS. WEB DECLINE
  retains request/facts/expiry with a bounded encrypted application-only receipt
  (backward-compatible optional field, never provider input); replay horizon
  ends at expiry/replacement/next settlement. Stable opaque context handles are
  references, not proof; revision/hash/token/expiry remain separately validated.
  Historical detail reads retain owner/session scope after connection suspension,
  while mutations still require ACTIVE_BOUND. No migration/config/entrypoint,
  provider or remote action; successor dormant. T9 may proceed locally, BUNVERIFIED.
- T9 LOCAL_IMPLEMENTATION_ACCEPTED: final focused57 and fresh full127files/
  2492tests PASS with one opt-in skip, all downstream gates PASS. Independent
  Calendar/API/delivery review and two scoped correction rounds closed all
  findings, Critical=0/Important=0/Minor=0. Per-version uncertain controls remain
  blocked; partial0009 schema fails closed; strict API uncertainty/unavailability
  stays distinct. Complete details use shared confirmation/delivery rendering.
  Real isolated Chrome375x812 local built-artifact evidence verifies dual-date
  seven-column grid and reachable preview/detail controls, including hidden/
  overflow negative controls. This is not live auth/browser UAT/deployed evidence.
  Six Node localStorage and146 inherited generated-artifact warnings disclosed;
  task-scoped lint clean. Source/config/migration activation unchanged, zero
  provider/remote actions. T10 may proceed locally; route B remains UNVERIFIED.
- Historical owner boundary, superseded by the authorization above:
- Latest owner boundary (2026-09-29), attachment
  `42c83974-4755-4a90-87fa-4f43ce227e96`: targeted documentation amendment only,
  local commit, then STOP BEFORE T4. Verified clean start at accepted T3
  `37d0f7ba7221dd1f7641ca5078e95d50004890e4`; source, reports and review inspected.
  NEXT_GATE=OWNER_REVIEW_OF_AMENDED_SPEC_AND_PLAN. Conversation ownership
  direction is approved, written amendment awaits owner review. No runtime or
  executable test edits, scoped amendment implementation, provider calls,
  migration, push or deploy in this turn. Historical acceptance below remains
  for the old interface, not proof of the amended envelope or reply safety.
- T1 LOCAL_IMPLEMENTATION_ACCEPTED: strict finalized contracts/application state
  and lossless runtime storage codec, independent Critical=0 / Important=0.
  T1/T0 87 tests PASS (offline tokenizer enabled); relevant regression 319 PASS;
  complete unit suite 102 files / 1,963 passed / one separately verified opt-in
  skipped. Typecheck, scoped lint and diff PASS. Five existing Node experimental
  localStorage warnings disclosed. No full `pnpm check` claim for T1.
  Final ordinary 900-CP state is 9,107 encoded bytes, exact roundtrip; complete
  six USER/six ASSISTANT state is 14,416 bytes. See benchmark evidence below.
  All real-dispatch/release restrictions remain.
- T2 LOCAL_IMPLEMENTATION_ACCEPTED: scoped context projection, stable Unicode
  source maps and evidenced backend-resolved operands; independent Critical=0 /
  Important=0 / Minor=0 after two structural fix rounds. Final T2/T1/T0 suite
  158 PASS (71 T2; offline tokenizer enabled), relevant regression 390 PASS;
  typecheck, scoped lint and tracked/new-file whitespace checks PASS. No full
  build/check or live-route acceptance claim. T3 consumes resolved operands and
  their retained source-time authority, not projected proposal placeholders.
- T3 LOCAL_IMPLEMENTATION_ACCEPTED: deterministic evidenced merge, schedule/
  calendar/query resolution, complete detail rendering and separate scoped
  read-only D1 query. Independent Critical=0 / Important=0 / Minor=0 after two
  structural fix rounds. Final T3 suite 117 PASS; T0/context 263 PASS with the
  offline tokenizer enabled; conversation regression 495 PASS. Typecheck,
  scoped lint and whitespace checks PASS. Derived-policy conflicts retain
  their exact fact authority without invented quotes; fact-only echoes cannot
  clear a pending conflict. No full `pnpm check`, live-model, active runtime,
  persistence/confirmation transaction or UI acceptance is claimed for T3.
  T4 NOT_STARTED; stop at the owner-review gate above.

## Global constraints

- Follow AGENTS.md. Before future code work read relevant installed Next.js guides; before Worker config/Wrangler work load Workers best-practices/Wrangler skills. Preserve existing work and legacy tests.
- No second general-language parser, model tools/IDs/SQL/confirmation, parser/provider fallback or model shopping. Bounded model guidance is allowed only by S §4.5; backend owns factual/transactional text. One eligible semantic call, no extra wording/repair call.
- Keep `AI_MODE=privacy`, `google/gemini-2.5-flash-lite`, `google-vertex/eu`, ZDR, deny data collection, required strict structured output, 30s timeout, retry=0. Historical prices are NOT newly verified.
- Production hard budgets remain 50 owner calls/day, 500000 owner monthly microunits, 2000000 global daily microunits. Evaluation caps do not alter these.
- S §8.2: current input 1800 NFC UTF-16 units; retained user turn 2000 NFC code points; six USER and at most six ASSISTANT turns; snapshot <=16384 serialized UTF-8 bytes before encryption; complete input <=12000 tokens; output <=1536 tokens and raw response <=32768 bytes. Webhook raw transport cap remains 32768 bytes.
- Retain 30-minute idle/2-hour absolute context lifetime and 10-minute draft lifetime. Queries/recovery/failed admission do not renew a pending draft. Never evict evidence supporting retained facts to fit.
- Gregorian default; explicitly requested Vietnamese lunar only; Asia/Ho_Chi_Minh receipt-time arithmetic. No inferred event time or implicit event-day notification. Executable schedules: ONCE or finite DAILY, count 2–30; future occurrences within 366 days.
- Preserve encryption, auth, tenant/chat isolation, shared terminal fences, source-draft and series occurrence uniqueness. Exactly-once canonical transaction is not exactly-once external messaging.
- First-in-flight targeted abandonment without persisted draft is unsupported. Annual recurrence is understood but not executed. Monthly results can be partial and must say so. Finite tests do not prove universal conversational accuracy.
- Exclude annual engine, burst batching, new orchestration/flag platform, admin, email/ICONIC, team, billing, mobile, long-term memory, snooze, completion tracking and unrelated UI work.
- Execution approval, provider spending, remote migrations, push/merge and exact-master-SHA deployment are distinct gates. No current permission carries forward automatically.

## Review focus

1. A valid “Có.” approving replacement/alternative/resume must never save an older preview (T5/T7 integration).
2. Unicode normalization/control projection can preserve visible wording while corrupting evidence positions or leaking handles (T0/T2).
3. A successful reminder insert followed by failed detail storage or lost response must not leave partial children or duplicate confirmation (T4/T7).
4. An old Worker/old strict web client can remain in flight after a new version is ready (T4/T8/T11).
5. Calendar source/output calendar, browser timezone and receipt-time midnight may disagree without obvious UI failure (T3/T9).
6. A valid patch plus bad guidance must retain facts without enabling preview/save; a matching directive does not prove prose semantics. T1A/T2A and T5/T7/T10 test independent validation, actual reply selection and transactional-claim rejection, not only JSON.

## Implementation map and dependency order

Paths below are repository-relative. Existing paths were inspected; paths explicitly marked **new** do not exist yet. `C` abbreviates `src/modules/conversation/context-contract/` only in prose; commands use full paths.

| Boundary | Reuse / existing integration point | New deliverable and owner |
| --- | --- | --- |
| Contract and wire request | `conversation/contracts.ts`, `conversation/prompt.ts` stay legacy; generic `intelligence/semantic-gateway.ts` interface | C `contracts.ts`, `prompt.ts`, `wire.ts`, `admission.ts` (T0/T1/T6) |
| Scoped context/evidence | existing ConversationScope, keyring, encrypted context/outcome patterns | C `state.ts`, `context.ts`, `projection.ts`, `evidence.ts` (T1/T2) |
| Structured arithmetic | `conversation/lunar-calendar.ts`, `semantic/validation.ts`, finite series arithmetic | C `resolve.ts`, `query.ts`, `merge.ts` (T3) |
| Durable state/confirmation | D1 context, command and series stores; common order fences | C `store.ts`, `infrastructure/d1/store.ts`, `confirmation.ts`; additive migration (T4) |
| Question/control authority | existing whole-message controls and reply send boundary | C `decisions.ts`, `responses.ts`, `guidance.ts` (T5); effective directive and selective guidance, backend factual text |
| Runtime path | `reminders/command-service.ts`, `inbound/processor.ts`, `worker/composition-root.ts` | C `service.ts`, `observability.ts`; successor gateway/config factory (T6/T7) |
| Authenticated web | strict `contracts/api/reminders.ts`, Worker routes, `lib/client-api.ts` | explicit V2 API contracts/routes and preview service (T8) |
| Calendar/details/delivery | `CoreScreenExperience.tsx`, lunar adapter, reminder delivery | shared lunar presentation, complete preview/detail rendering (T9) |
| Acceptance | `tools/benchmark/conversation-v2-probe.ts`, existing budget/ledger patterns | separate context-contract probe, manifest/scorer/runner (T10) |
| Release | Worker capability parameters, `worker/index.ts`, reviewed config/runbooks | dormant/compatible then activated exact version, no new flag system (T11) |

Dependency graph: T0 local engineering A -> T1 -> T2 -> T3 -> T4 -> T5 -> T6 -> T7 -> T8 -> T9 -> T10; T0 route admission B plus T10/whole-branch acceptance -> conditional T11 evaluation. This conservative order prevents competing interpretations of shared contracts. After T1, T3's pure arithmetic and T2 projection could be independently implemented; after T8, Calendar presentation and delivery tests could be split. Prefer sequential reviewed commits initially; never concurrently edit shared contracts/store/service.

**Current amended dependency:** accepted T0–T3 -> approved written amendment ->
accepted T1A/T2A/T0A bundle + relevant T3 regression -> T4 -> T5–T10.
T1A/T2A/T0A are scoped follow-ups, not reopening completed tasks. Their single
consolidated independent acceptance gate passed after one scoped fix round.
T3 behavior/acceptance stays valid; no new schedule/query policy is introduced.
Route B and all remote/activation gates remain separate and unresolved.

### Interface ownership

All new public symbols below have an owning task. T1–T3 implementations exist;
their accepted evidence is above. Amended/future signatures are planned, not
claims that guidance, persistence, gateway or active composition already exists.

- **T0/T1 `contracts.ts`:** `ConversationInterpretation`, `ContextInput`, `FieldChange`, `EvidenceRef`, `DateOperand`, `QueryOperand`, matching strict Zod schemas and `InterpretationJsonSchema`. T1A amends output literal to `calenote-context-2` (accepted historical output is `calenote-context-1`); input remains `calenote-context-input-1`. All S §4.1 keys required, exactly 13 slot names, <=13 unique changes, <=4 uncertainties/two alternatives, 1–3 evidence refs where required. Add strict `ConversationDirective`, nullable `ReplyProposal` (400 NFC code points), and semantic-core `SemanticPatchProposal` validation per §4.5. No CONFIRMED output or execution action.
- **T0 `wire.ts`:** `serializeContextRequest(input: ContextInput): {messages, response_format, stream:false, max_tokens:1536}` using the one canonical prompt/schema; route/auth supplied separately by gateway. **`admission.ts`:** `measureEnvelope(input: ContextInput, snapshotJson: string, outputJson?: string): EnvelopeMeasurement`; returns NFC units/code points, bytes by component, token upper bound/method ID and admitted/reason. Do not call a provider here.
- **T1 `state.ts`:** `ContextSnapshotV1` (payload version `calenote-context-state-1`) holds existing scope identity, contextRevision, draftRevision, lifecycle, 13 typed slots/provenance, reminder/query questions, exact encrypted transcript entries with receipt/delivery state, one decision/candidate, preview receipt, bounded control registry/maps, created/expiry instants. `Slot<T>` has state MISSING/PROPOSED/RESOLVED/CONFLICT, value or null, evidence and EXPLICIT_USER/DERIVED_POLICY provenance. A resolved pending fact is not confirmed. `CanonicalDetailsV1` (version `calenote-reminder-details-1`) holds separate location, notes, eventDate/eventTime, calendar provenance and resolution version; title retains its existing separate encrypted column.
- **T1 state types:** `ContextObservation` is an opaque store-issued presence/absence observation bound to owner/chat, inbound order/claim, context revision and last accepted terminal outcome. `PendingDecision` has the five S §5.1.1 kinds and all specified bindings. `PreviewReceipt` carries previewId, draftRevision/hash, owner/chat, issued-after order, expiry and SENT/FAILED/UNCERTAIN status. `ControlAuthority` is CHAT with authenticated ConversationScope or WEB with validated SessionPrincipal and owner-bound chat; never provider input.
- **T2:** `buildContextInput({message, context, snapshot, observation}): ContextBuildResult` consumes existing `BoundChatMessage`/`BoundChatContext` and T1 state; returns READY `{input, evidenceIndex, sourceMap, observation}` or REFUSED `{reason}`. After T2A, `validateEvidence(proposal: SemanticPatchProposal, built): EvidenceValidation` yields fully scoped `ValidatedPatch` or one reason; no partial changes. Its brand covers semantic operands only, not directive/reply approval. `projectSemanticView` remains internal to this builder; T2A adds `validateGuidancePrivacy(proposal, built)` with categorical pass/refusal, never returning a redacted sendable replacement.
- **T3:** `mergePatch(previous: ContextSnapshotV1|null, patch: ValidatedPatch): MergeResult` returns a candidate plus changes/uncertainties or rejection; no IO. `resolveRequest(candidate, now, calendar: LunarCalendarAdapter): RequestResolution` returns CLARIFY `{fields,reasons}`, UNSUPPORTED `{capability}`, or READY `{resolvedSlots, resolvedFacts, occurrences: SeriesOccurrence[], details}`. Preserve accepted `resolvedSlots`/`resolvedFacts` together. Occurrences are backend-created. `resolveQuery(query: QueryOperand, receipt: number, calendar): QueryResolution` returns RANGE `{start,end,label,scopeLabel}`, CALENDAR_DATE `{solar,lunar,convention}`, CAPABILITY or CLARIFY/REJECTED. `query.ts` exports successor query/result types including status and `hasMore`. `src/modules/reminders/detail-presentation.ts` owns `renderReminderDetails(title, details, schedule): RenderResult`, COMPLETE `{text}` or TOO_LONG/INVALID; T4/T5/T9 reuse it for full channel-fit checks. No guidance field changes these accepted behaviors.
- **T4 `store.ts`:** `ContextContractStore.observe(scope): Promise<{observation,snapshot}|{failure}>`; `apply(scope, observation, transition: StoredTransition): Promise<AppliedTransition>`; `confirm(authority, proof: DecisionProof): Promise<ConfirmationResult>`; `readOutcome(authority, operationKey): Promise<ConfirmationResult|null>`; `recordDelivery(scope, receipt): Promise<'RECORDED'|'STALE'>`; `purgeExpired(now, limit): Promise<number>`. Observe distinguishes absent/invalid/expired/unavailable. AppliedTransition distinguishes APPLIED/IDEMPOTENT/STALE/INVALID/UNCERTAIN. ConfirmationResult is COMMITTED/IDEMPOTENT with canonical public IDs/child count, or STALE/EXPIRED/REJECTED/UNCERTAIN, never success on unknown state.
- **T4:** `StoredTransition` contains expected versions, new encrypted-state candidate, proposed canonical preview data if READY, terminal operation if any and inbound outcome. `DecisionProof` contains application decisionId/kind/target/revision/hash, bound reply/token proof and operation dedupe key; no model-created field is authority. `confirmation.ts` validates future occurrences/detail equality against preview before constructing the transaction.
- **T5:** `selectControl(text, decision, authority): ControlSelection` returns NONE, scoped decision action, DECLINE, ABANDON or AMBIGUOUS_TARGET; no prefix matching. `transitionConversation({snapshot, interpretation, merge, resolution, control, now}): StoredTransition|ReplyOnly` is pure; not every input branch supplies a model. `computeEffectiveDirective(applicationOutcome): EffectiveDirective`, `validateDirective(modelDirective, effectiveDirective): DirectiveValidation`, and `selectGuidance({effectiveDirective, directiveValidation, replyProposal, privacyValidation}): GuidanceSelection` live in `guidance.ts`; they consume S §4.5 and return MODEL_GUIDANCE `{text}` or BACKEND `{reason}`. `composeContextReply(outcome, guidance): ReplyPlan` includes actual selected complete text, source, typed question/preview/control spans or bounded render failure. Model prose is possible only on eligible guidance surfaces, never confirmation or factual results. `ReplyReceipt` is SENT with message ref when available, FAILED or UNCERTAIN; unavailable provider receipt must not be promoted to SENT.
- **T6:** `createContextContractGateway(config, transport): SemanticGateway<ParsedInterpretation,ContextInput>` preserves prepare/one-shot dispatch. Wire response is still the one strict `ConversationInterpretation` schema; the application return type carries T1A independently parsed sections, never casts malformed guidance to that wire type. Envelope/core failure is gateway refusal; valid core plus bad guidance reaches T5 fallback with fullSchemaValid=false. `parseContextContractRuntimeConfig(env)` stays separate from unchanged V1/V2 defaults. `ContextObservationEvent` is a content-free union; `observeContextEvent(event):void` never accepts arbitrary payloads.
- **T7:** `createContextContractService(deps)` implements existing `conversation.handle(message,context)` and `ownsPendingDraft` integration plus explicit contract ownership routing. Dependencies are T4 store, T6 gateway, existing SemanticBudgetStore/keyring/calendar, successor scoped query function, clock, `reply(ReplyPlan):Promise<ReplyReceipt>`, feedback and event sink. Production and live harness use this same factory, not a benchmark-only reconciliation path.
- **T8:** `ReminderDetailsResponseV2`, `ReminderListResponseV2`, `PreviewResponseV1` and `PreviewDecisionRequestV1` are strict public schemas. `ContextApiOperations` lists owner-authorized detailed reminders and previews and decides an authenticated revision-bound preview through T4; it does not reuse a chat inbound identity as web auth.
- **T9:** `calendarDayPresentation(solarDate:string)` returns lunar label/full accessible text or unavailable using existing adapter; delivery and web consume T3's detail projection so confirmation cannot admit unsendable details.
- **T10:** `createContextContractProbe(config,transport,fixture)` creates an isolated actual-service harness; `turn(text,receipt,deliveryFault?)` returns observed service reply, sanitized decision/event IDs and authorized state/API read-back; `dispose()` closes only its synthetic store. `scoreContextCampaign(manifest,observations)` never invokes domain evaluators to reconstruct what happened.

## Common task execution protocol (future only)

For each ordinary task: add named failing tests; run the listed focused command and record intended assertion failure (resolve import/test setup errors separately); implement minimum coherent behavior; rerun focused tests; run `pnpm typecheck`, relevant integration tests and `git diff --check`; inspect diff; independent acceptance with Critical=0/Important=0; selectively stage only task paths and commit. At T4, T7, T9 and T10 additionally run full `pnpm check` with provider transport disabled/blocked and synthetic local DB only. It includes build, lint, typecheck, Worker type check and deploy dry-run, not deployment. Inspect scripts/environment before executing it. No green mock suite substitutes for live approval.

All commands below are future commands run from the verified worktree. New-path commands become runnable only after that task creates the named files. No live CLI is authorized by appearing in this plan.

### T0 — Offline feasibility before dependent implementation

**Current amendment:** Apply S §8.2.1 and the 2026-09-29 owner amendment above.
The original checklist below is historical evidence of the combined gate;
its prohibition on provisioning and its full-framing dependency are superseded
only as explicitly described here. Reuse the existing probe/canonical artifacts.
Complete isolated pinned local tokenizer provenance, network-blocked measurement
and scoped counts; investigate original 18,904-byte specimens without changing
their required/negative classification to pass. Independently review A. Commit
useful tooling/evidence and targeted methodology update; start T1 automatically
only when A passes. B remains separately unresolved until established.

**Purpose / dependencies:** First task after plan/execution approval; none. Prove ordinary flows fit, or stop with measured bounded amendment. Do not activate code, install a dependency or acquire credentials just to run this probe.

**Create:** C `contracts.ts`, `prompt.ts`, `wire.ts`, `admission.ts` as minimal isolated contract/serialization artifacts; `tools/benchmark/context-contract-fit.test.ts`; evidence `docs/benchmarks/llm-context-contract-fit.md`. No composition imports yet. T1 promotes these same artifacts, avoiding a second mock schema.

**Consumes/produces:** S exact unions/bounds -> T0 interfaces above and measured evidence. Minimal literal internal snapshots cover T1's planned fields/maps/decision metadata; mark them serialization probes, not multi-turn acceptance or completed persistence.

- [ ] Write `fit_reports_units_bytes_and_method_separately`, `ordinary_flows_fit_or_block`, `oversize_never_clips`, `truncated_patch_never_admitted`; run `pnpm exec vitest run tools/benchmark/context-contract-fit.test.ts`. RED must identify absent serialization/admission, not external network failure.
- [ ] Serialize the full strict schema, canonical prompt, input and representative output. Measure UTF-16 after NFC, code points, JSON UTF-8 bytes, raw envelope bytes, context bytes, schema/prompt/framing separately. Include exact internal source text plus maps, scoped registry and decision candidate in context cost.
- [ ] Probe: (a) “Mai 8h nhắc gọi mẹ”; (b) “mai nhắc tui gọi khách” -> “9h”; (c) all four S §4.4 turns; (d) “Đổi sang 9h, địa điểm ở Quang Trung, ghi chú nhớ mang giấy tờ.” against retained facts; (e) admitted long title/location/notes independently and combined rejection; (f) 1–3 refs with quotes, backslashes/newlines and repeated phrases; (g) four uncertainties/two typed alternatives plus pending replacement candidate; (h) six USER/six ASSISTANT entries, exact 16KiB boundary and supporting maps; (i) JSON/raw response overflow and truncated final object; (j) NFC Vietnamese, decomposed equivalents and supplementary characters at INPUT_1799/1800/1801/2000.
- [ ] Select and document a justified model-specific local token measure or conservative upper bound, including schema/server framing. Existing gateway's `UTF8(request)+1024` is a candidate assumption, NOT established Gemini-token proof. Record source/evidence validating the bound; unrelated tokenizers can be diagnostics only. No counting endpoint/provider call. If an applicable bound or framing proof is unavailable, report TOKEN_BOUND_UNVERIFIED and stop dependent work rather than label estimated fit PASS.
- [ ] Define aggregate admission as the conjunction of all S §8.2 gates, using the verified token method; outputs also meet 1536 and 32KiB. Explain long-field combinations rejected before dispatch where detectable, and atomic recovery after model overflow. No input guard can guarantee what a stochastic model will output: output validation still applies.
- [ ] Rerun focused test and `git diff --check`; independently review measurement assumptions. Evidence records source/artifact/method digests, per-case measurements, admitted/rejected reason, retained-detail assertions and all limits. PASS only if ordinary required cases fit, full overhead is counted and essential details never disappear. Independent maxima need not fit together.
- [ ] Commit `test(conversation): establish offline context contract feasibility` only after review. If ordinary cases/bound cannot pass, commit factual probe evidence if useful, keep T1–T11 blocked, propose only a bounded amendment for owner approval. **Current status: NOT_RUN.**

### T1 — Final versioned contracts and application state

**Depends:** T0 local engineering A PASS with independent review. B may remain pending. **Deliverable:** strict provider/application types without changing active legacy schemas.

**Create:** C `state.ts`, `contracts.test.ts`, `state.test.ts`, `prompt.test.ts`. **Modify:** T0 C `contracts.ts`, `prompt.ts`, `wire.ts`, `admission.ts` only as needed to finalize measured artifacts; materially changed bytes rerun T0.

**Interfaces:** Produces all T1 types above; consumes T0 measured admission. State changes are in-memory schema definitions only.

- [ ] Add `all_root_keys_required`, `duplicate_changes_reject_atomically`, `omission_keeps_clear_requires_null`, `query_changes_forbidden`, `civil_source_calendar_required`, `no_model_authority_fields`, `context_and_detail_versions_distinct`. Assert each of 13 slots, typed SET/CLEAR, 13/4/2/ref bounds, quote bounds and unknown-key rejection. Fields timezone/epoch/IDs/confirmation/actions are rejected, not stripped.
- [ ] Run `pnpm exec vitest run src/modules/conversation/context-contract/contracts.test.ts src/modules/conversation/context-contract/state.test.ts src/modules/conversation/context-contract/prompt.test.ts`; record RED, implement strict unions and full schema parity tests. Prompt teaches event/notification roles, count/offset, preservation and untrusted operands, not calendar arithmetic or backend success.
- [ ] Cover null/unsupported cadence versus default ONCE, calendar mismatch, no changes for LIST/CALENDAR/CAPABILITY, HELP/UNSUPPORTED/ABANDON, multiple actions ambiguous, title/location/notes limits, current-turn edit rules and no free-form summary.
- [ ] Repeat focused/T0/static checks; verify no imports from active composition and old V2 tests unchanged. Independent contract review then commit `feat(conversation): define versioned evidenced context contract`.

### T2 — Private context projection and evidence binding

**Depends:** T1. **Create:** C `context.ts`, `projection.ts`, `evidence.ts` and corresponding `.test.ts` files. **Consumes:** T1 snapshot/input/proposal and T0 admission. **Produces:** ContextBuildResult, ValidatedPatch and source maps. No DB mutations.

- [ ] RED tests `controls_absent_in_every_provider_string`, `mixed_correction_survives_projection`, `quote_matches_exact_supplied_user_view`, `facts_are_payload_scoped`, `overflow_preserves_prior_state`.
- [ ] Run `pnpm exec vitest run src/modules/conversation/context-contract/context.test.ts src/modules/conversation/context-contract/projection.test.ts src/modules/conversation/context-contract/evidence.test.ts`.
- [ ] Build bounded role-labelled input from accepted state/actual delivery receipts. Use per-call f1… aliases scoped REMINDER/QUERY, never IDs. Keep exact internal transcript, NFC semantic view and unchanged-segment source mapping distinct. Use known control spans/scoped registry, reserved token marker, fixed placeholder; validate all serialized strings including facts/notes/alternatives/escaped and URL-encoded handles. Unknown control-shaped ambiguity refuses dispatch; ordinary URLs/numbers remain.
- [ ] Test false USER roles, stale aliases/old edits, assistant approval, repeated quotes with occurrence2, accent/surrogate mapping, quote across a removed span, token collision, token embedded in location, cross-owner/chat/draft snapshot, failed/uncertain assistant sends. Current replacement/CLEAR needs current quote; CONTEXT_FACT cannot change value or cross query scope. Notes SET retains existing details unless evidenced replacement/removal; ambiguous loss requires clarification.
- [ ] INPUT1799/1800 pass only length;1801/2000 refuse before dispatch and never append/renew draft. Seventh supporting turn, >6 assistant entries or >16KiB snapshot refuses rather than evicts essential evidence. A source turn near midnight keeps its original receipt.
- [ ] Rerun focused/T0/static checks, independent privacy/evidence review, commit `feat(conversation): build bounded private context and evidence maps`.

### T3 — Deterministic merge, schedule and query resolution

**Depends:** T2. **Create:** C `merge.ts`, `resolve.ts`, `query.ts` and their `.test.ts` files; `src/modules/reminders/detail-presentation.ts`/`.test.ts`. **Modify:** `src/modules/reminders/infrastructure/d1/semantic-query-store.ts` with a separately named successor `listContext` method; add `src/modules/reminders/infrastructure/d1/semantic-query-store.integration.test.ts`. Existing `list` behavior remains for legacy. **Interfaces:** T3 methods above; `listContext({message,context,range,referenceTime})` returns authorized rows/statuses plus hasMore or categorical invalid/unauthorized/stale failure. No empty-on-invalid successor response.

- [ ] Add RED tests for R01–R04/R07/R09/R11/R12/R16 and named `event_date_is_not_default_notification`, `query_calendar_does_not_inherit_draft`, `month_31_days_includes_sent`, `list_never_writes_reminders`.
- [ ] Run `pnpm exec vitest run src/modules/conversation/context-contract/merge.test.ts src/modules/conversation/context-contract/resolve.test.ts src/modules/conversation/context-contract/query.test.ts src/modules/reminders/detail-presentation.test.ts src/modules/reminders/infrastructure/d1/semantic-query-store.integration.test.ts`.
- [ ] Merge only validated operations. EDIT advances draftRevision for any material detail; conflict without EDIT retains accepted value/alternatives. Preserve omitted fields. Query operations never edit reminder facts. Compute missing fields after merge, not per utterance.
- [ ] Implement S §5 arithmetic directly on operands: E-count..E-1, E-count+1..E, S..S+count-1; ONCE lead offset separate; start/end derives inclusive DAILY count and supplied count must match. Reuse calendar/validation utilities, not raw-text scanner. Reject unsupported frequency, unknown hour, impossible dates, >30 count, >366 offset/horizon and any past child at preview/confirm; do not skip/roll.
- [ ] Implement the shared complete-detail renderer before confirmation consumes it: separate event and notification roles, title/location/notes preserved, safe encoding, <=2000 UTF-16 units including delivery prefix. Test all detail fields, hostile markup, exactly-boundary and one-unit-over cases. A full preview additionally accounts for every occurrence and later T5 decision instructions; neither renderer clips essential text.
- [ ] Test Gregorian missing year current/next by month/day, Feb29 invalid-year clarification, source receipt midnight/retry, lunar explicit year/leap ambiguity/coverage, source/output calendars in both directions with opposite-calendar draft unchanged. Query interval tables cover day/week/weekend/month/rest/next7/upcoming30/date bounds, year rollover, leap February, reversed/span/endpoints >366.
- [ ] Successor SQL keeps authenticated owner/workspace/bound-chat and terminal ordering checks; includes six selected statuses, excludes CANCELLED/drafts, orders scheduledAt/id, fetches6/displays5 with exact partial notice. Zero reminder/proposal writes and no pending TTL extension; failures are not empty. Test same-owner other-chat exclusion and early-month SENT results.
- [ ] Review pure functions and real scoped D1 query assertions; rerun static checks; commit `feat(conversation): resolve structured schedules and scoped calendar queries`.

### T1A — Scoped output-contract amendment (ACCEPTED_IN_BUNDLE)

**Depends:** owner approval received at fb53313; consolidated bundle gate above. **Modify:** C `contracts.ts`,
`contracts.test.ts`, `prompt.ts`, `prompt.test.ts`, `wire.ts`; T0 specimen builders
in `tools/benchmark/context-contract-fit.test.ts` only for changed canonical
keys. Preserve legacy active contracts. Do not redo T1 state/storage design.

**Interface:** strict `ConversationInterpretation` version `calenote-context-2`
adds exactly the six-kind directive and nullable 400-code-point reply from S
§4.5. Export strict semantic-core `SemanticPatchProposalSchema` from the same
field definitions; it is not another provider schema. Add
`parseInterpretationSections(raw: unknown): InterpretationSections`, where
`InterpretationSections` is REFUSED `{reason}` or PARSED `{value: ParsedInterpretation}`.
`ParsedInterpretation` contains `semantic: SemanticPatchProposal`,
`directive: {status:'VALID', value:ConversationDirective} | {status:'INVALID'}`,
`reply: {status:'VALID', value:ReplyProposal} | {status:'INVALID', reason}`,
and `fullSchemaValid:boolean`. Only the two guidance properties may be
quarantined; all other root/core failures reject atomically. The core contains
the amended version and every old semantic root key, no guidance or new
authority. T2 receives `semantic`, T5 receives separate section results; the
gateway returns ParsedInterpretation rather than pretending all wire fields
passed. No repair of raw/truncated JSON.

- [ ] RED: `guidance_fields_required_and_unknown_keys_rejected`, `six_directives_have_no_authority`, `reply_400_401_unicode_boundary`, `bad_guidance_preserves_valid_core`, `invalid_core_not_rescued_by_guidance`. Assert schema-invalid full response remains schema-invalid despite core recovery. Null reply is schema-valid; omitted reply is not.
- [ ] Run `pnpm exec vitest run src/modules/conversation/context-contract/contracts.test.ts src/modules/conversation/context-contract/prompt.test.ts tools/benchmark/context-contract-fit.test.ts`; record meaningful RED before implementation.
- [ ] Implement shared field definitions, section parser and exact strict JSON Schema parity. Update canonical prompt from “No replies”/application owns all questions to one-call untrusted guidance with backend-only facts and execution. Add §4.5 prose constraints, typed next issue, no CoT, null factual-surface reply, no arbitrary IDs or calendar arithmetic.
- [ ] Rerun focused checks, `pnpm typecheck`, scoped lint and `git diff --check`; independent contract review, then selective local commit. Intermediate dependent test fixtures may receive only mechanical version/new-key adaptation; no T3 algorithm change. No T4 until T2A/T0A also pass.

### T2A — Independent evidence and guidance privacy (ACCEPTED_IN_BUNDLE)

**Depends:** T1A. **Modify:** C `evidence.ts`/`.test.ts`, `projection.ts`/`.test.ts`,
`context.ts`/`.test.ts`; C `state.test.ts` for selected-text codec regression only
if needed. The existing encrypted state/transcript shape is sufficient unless
a measured interface requirement proves otherwise; do not add raw proposal state.

**Interface:** `validateEvidence` consumes only parsed semantic core and produces
the existing branded resolved patch. `validateGuidancePrivacy` checks every new
string against T2 protected material/projection rules; pass is privacy-only,
not semantic truth or directive compatibility. T5 owns those separate gates.

- [ ] RED: `invalid_directive_does_not_erase_grounded_patch`, `reply_controls_rejected_not_redacted_for_send`, `all_guidance_strings_checked`, `selected_assistant_view_never_becomes_user_evidence`, `discarded_reply_not_retained`. Test NFC/JSON/percent-escaped controls and internal IDs; sentinel credential material must never appear in retained/logged/sent output.
- [ ] Run `pnpm exec vitest run src/modules/conversation/context-contract/context.test.ts src/modules/conversation/context-contract/projection.test.ts src/modules/conversation/context-contract/evidence.test.ts src/modules/conversation/context-contract/state.test.ts`; verify RED then implement narrow separation. Valid core survives guidance rejection; invalid core retains existing refusal semantics.
- [ ] Rerun the above plus T3 focused command, `pnpm typecheck`, scoped lint and `git diff --check`. Verify immutable source anchors, same-value conflict rules, expiry and query scope unchanged. Independent privacy/evidence review and local commit; do not label T5 selection implemented here.

### T0A — Amended-envelope measurement revision (LOCAL_FIT_ACCEPTED_IN_BUNDLE)

**Depends:** T1A/T2A. **Modify:** `tools/benchmark/context-contract-fit.test.ts`,
`tools/benchmark/snapshot-identity-view.test.ts` only if a changed retained-text
specimen requires it; C `wire.ts`/`admission.ts` only if canonical shape accounting
requires it; `docs/benchmarks/llm-context-contract-fit.md` and a new versioned
measurement artifact alongside `llm-context-contract-local-measurements.json`.
Preserve the original artifact and historical required/negative classifications.

- [ ] Add RED accounting assertions for both new fields and full prompt/schema digests, then update exact canonical serialization specimens per S §8.2.2. No reduced mock schema or semantic fact removal.
- [ ] Run `CONTEXT_FIT_LOCAL_TOKENS=1 pnpm exec vitest run tools/benchmark/context-contract-fit.test.ts tools/benchmark/snapshot-identity-view.test.ts src/modules/conversation/context-contract` using the existing pinned network-blocked local tooling. Include ordinary/null/max guidance, escaping, patch-plus-prose, selected transcript/control maps, long details and six-turn capacity. No provider/counting call or dependency bootstrap is authorized by this step.
- [ ] Record revision `conversation-guidance-v2`, source/prompt/schema/wire/specimen/tokenizer digests, measured bytes/local tokens and separate A/B status. Output cap stays1536, input12000, context16384; budgets unchanged. Ordinary-flow failure stops this gate with exact measurements and smallest remedy; no quiet reclassification/clipping.
- [ ] Rerun schema/prompt checks, T3 focused regression, `pnpm typecheck`, scoped lint and `git diff --check`; independent feasibility review then local commit. Require local A Critical=0/Important=0 before T4. B remains UNVERIFIED unless separately established; this does not authorize real calls.

### T4 — Additive encrypted persistence, shared fences and atomic confirmation

**Depends:** accepted T3 and reviewed T1A/T2A/T0A after owner approval. NOT_STARTED.
This is a security/transaction review boundary, not a deployment task.

**Create:** `migrations/0009_llm_context_contract.sql` (number recheck before future creation; stop for naming collision, never rewrite existing migration); C `store.ts`, `confirmation.ts`, `confirmation.test.ts`, `infrastructure/d1/store.ts`, `infrastructure/d1/store.integration.test.ts`, `infrastructure/d1/compatibility.integration.test.ts`.

**Modify:** `src/modules/security/keyring.ts`/`.test.ts`; `src/modules/semantic/infrastructure/d1/conversation-order.ts`; legacy D1 `conversation/context-store.ts`, `conversation/runtime-store.ts`, `reminders/command-store.ts`, `reminders/series-store.ts` under their existing `infrastructure/d1/` directories for version-aware guards only; `src/testing/sqlite-d1.test-support.ts`; `src/modules/db/d1-workerd.integration.test.ts`. Do not replace legacy behavior or uniqueness.

**Storage design:** Reuse `conversation_contexts` identity/lifecycle and common outcomes, adding explicit SQL `contract_version` defaulting to legacy plus version-gated reads/writes; successor ciphertext uses distinct keyring purpose and strict payload version. Add owner/chat-scoped companion draft/reminder/series detail rows (FKs to existing canonical identities, version, key version, IV/ciphertext, binding identity). Retain legacy title/calendar columns and source-draft/series occurrence unique indexes. Add bounded per-chat contract ownership and transaction-scoped write permits to prevent old SQL treating successor state as empty; this is a storage fence, not message orchestration.

Name the new tables `command_draft_context_details` (draft_id PK/FK), `reminder_context_details` (reminder_id PK/FK), `reminder_series_context_details` (series_id PK/FK), `conversation_contract_ownership` (chat_identity_id PK/FK, owner_id, context_id UNIQUE/FK, contract_version), and `conversation_contract_write_permits` (chat_identity_id PK/FK, context_id, marker UNIQUE, operation, source_inbound_id or web session identity). Detail rows contain owner_id/chat_identity_id, encryption_entity_id, payload_version, ciphertext/12-byte IV/key_version with existing keyring conventions; no location/notes plaintext. Store strict encrypted versioned proposal content using existing proposal lineage. Bound companion ciphertext by the separately measured detail envelope; do not conflate it with context's16384-byte snapshot. A lost/failed permit batch leaves no permit; reject orphaned permits rather than trusting a previous transaction marker.

**Fence mechanics:** Successor apply/confirm batch acquires a permit only after scope, claim/order, observation, revision and decision checks; all dependent statements use the unique winning marker. SQL triggers reject legacy draft/context/proposal creation or confirmation against an owned successor chat without that permit. Remove permit in the same atomic batch; failure rolls everything back. Ownership is released only by a fenced terminal transition. Preserve cleanup/delivery of already canonical rows. Versioned reads, different encryption purpose and triggers together provide isolation; JSON tags alone do not. Add contract discriminator to proposal reads so old parsers never silently reinterpret a successor proposal.

**Interfaces/state:** T4 store/proof/transition interfaces above. One-off still uses command_drafts/source_draft_id, series uses existing proposals/series/occurrences; successor confirm validates its versioned payload, not the old PendingRequestSchema. Shared outcome fences cover both contracts, including absence observations and web decisions. Context/proposal/detail changes coupled to each other use one D1 batch.

- [ ] RED tests `details_and_all_children_rollback_together`, `old_sql_cannot_confirm_or_create_overlapping_request`, `none_observation_cannot_overwrite_new_state`, `owner_bound_ciphertext_swap_rejected`, `uncertain_commit_readback_is_truthful`.
- [ ] Run `pnpm exec vitest run src/modules/conversation/context-contract/infrastructure/d1/store.integration.test.ts src/modules/conversation/context-contract/infrastructure/d1/compatibility.integration.test.ts src/modules/conversation/context-contract/confirmation.test.ts src/modules/security/keyring.test.ts src/modules/db/d1-workerd.integration.test.ts` against disposable local stores only.
- [ ] Implement migration and stores, reusing keyring AEAD with owner/chat/entity/version binding. No plaintext details, control registry or evidence columns. Existing records without companions return null; no backfill inference. New detail purposes are explicit additions to SensitiveContentPurpose.
- [ ] Confirm exact preview hash/revision/decision type, delivery/order, future schedule and channel fit; commit canonical rows, all details, lineage, decision consumption and terminal outcome atomically. Encrypt before batch. Preserve D1 statement/binding bounds (existing grouped insert pattern <96 bindings); test N=1,2,30 with real workerd and injected final-detail failure.
- [ ] Exercise concurrent web/chat confirmation, duplicate key, lost reply after commit, no-op CAS, permit rollback/cleanup, expiry, corrupt ciphertext, inactive ownership/session, delayed edit after persisted cancellation and terminal metadata after payload purge. Separate first-in-flight/no-draft test: no cancellation claim, zero canonical writes; normal newer-terminal fencing is not a cancellation receipt.
- [ ] Delivery-receipt recording is a narrow CAS on the exact previously selected outbound/decision revision, not a replay of a now-terminal inbound mutation. Test receipt arrival after inbound completion, after a newer edit, and twice: only the still-applicable receipt changes visibility metadata; no receipt resurrects a decision, extends expiry or creates a reminder. Shared outcome/order checks remain authoritative.
- [ ] Persist actual selected assistant text/kind and receipt in existing encrypted transcript, whether source is eligible model guidance or backend fallback. Add `selected_reply_roundtrips_encrypted`, `rejected_reply_not_history`, `reply_receipt_not_mutation_authority`, `assistant_projection_still_removes_controls`; enforce existing context size/TTL without evicting facts. Raw model directive/reply is not reminder state and cannot set decision proofs. Existing failed/uncertain send semantics remain.
- [ ] Run legacy context/command/series safety suites plus full `pnpm check`, diff check and independent storage/security review. Validate old-code SQL against migrated fixture as well as new store. No remote migration. Commit `feat(conversation): persist versioned context and details atomically`.

### T5 — Pending decisions, effective directives and selective natural guidance

**Depends:** T4 and amended T1A/T2A interfaces. **Create:** C `decisions.ts`, `responses.ts`, `guidance.ts`, `decisions.test.ts`, `responses.test.ts`, `guidance.test.ts`. **Consumes:** T1 decision/receipt types, T3 resolutions, T4 StoredTransition/proof, independently validated guidance/privacy. **Produces:** T5 transition/reply/control interfaces; no autonomous persistence.

- [ ] RED tests `replacement_yes_never_saves_A_or_B`, `one_time_offer_yes_is_not_save`, `query_return_requires_reissued_decision`, `decline_is_not_abandon`, `third_nonprogress_preserves_draft`.
- [ ] RED CO-A/B/C/D and `unsupported_guidance_cannot_enable_capability`, `absent_oversize_reply_falls_back_preserving_facts`, `model_query_preview_success_text_discarded`, `matching_kind_wrong_field_rejected`, `reply_lint_is_not_semantic_proof`. Use table variants for six kinds, backend missing/alternative/READY/query/unsupported/control/failure states, and output claim/control obfuscation, not input phrase parsing.
- [ ] Run `pnpm exec vitest run src/modules/conversation/context-contract/decisions.test.ts src/modules/conversation/context-contract/responses.test.ts src/modules/conversation/context-contract/guidance.test.ts`.
- [ ] Implement `computeEffectiveDirective`, exact typed compatibility, privacy/length/plaintext/output-lint eligibility, and model-or-fallback selection per S §4.5. Preserve valid semantic facts on bad guidance. Backend-only outcomes cannot select raw prose regardless of model kind. Compose exact dates, alternative values, capability facts, controls and query/mutation/delivery outcomes from application data. Unknown mapping fails closed. No new LLM/parser or arbitrary-language truth claim.
- [ ] Implement one current decision, all five kinds, exact whole NFC/case/outer-space controls with at most one terminal period/exclamation. Separate SAVE “xác nhận <token>” from non-save “đồng ý <token>”; mixed “Có, nhưng đổi sang 9h” returns NONE for local control. Scope tokens/replies to current question/target/revision/expiry. Unknown/uncertain reference requires scoped proof, never search history.
- [ ] Test positive/negative/escape transitions for each kind. REPLACE adopts only encrypted candidate B; alternative acceptance with A asks separate replacement; RESUME reissues question; RESTART discards identified unconfirmed state only. “không”/“2” preserves otherwise valid draft; explicit “Bỏ.” only one known target, ambiguous offer+draft asks which. Model ABANDON_PENDING asks for local escape, cannot delete. “Đừng bỏ.” and quoted notes never match.
- [ ] Record failed/uncertain preview sends, invalidate previous handles on edit/new question, reject stale edited-preview bare yes/cross-chat yes. Query retains draft revision/TTL but suspends bare save until question reissued. Provider/config failures do not advance no-progress counter; actual progress resets it; second no-progress summarizes, third offers chat recovery. No web-review link for CLARIFYING state because this plan does not add that editor.
- [ ] Model may naturally phrase one missing/ambiguous issue; backend composes known-fact recap, annual limitation/one-off decision controls, monthly scope/status/partial result and specific budget/context/size failures. Test optional prose dropped before authoritative details when combined output exceeds2000 UTF-16; never clip facts. Review all decision and guidance transitions then commit `feat(conversation): validate guidance against application-owned decisions`.

### T6 — Bounded successor provider gateway and observations

**Method amendment:** Consume the typed admission boundary, not local Python as
runtime enforcement. While actual-route proof is missing, preparation for real
dispatch must refuse. Test-only admission observations exercise injected fake
transports only and cannot select real networking. Report
LOCAL_IMPLEMENTATION_ACCEPTED / LIVE_ADMISSION_PENDING when appropriate; do not
reserve the historical per-call amount from an unverified full-token premise.

**Depends:** T5 and T0 local engineering A still valid; B may remain pending for local implementation only. **Modify:** `src/modules/intelligence/infrastructure/openrouter/semantic-gateway.ts`, `config.ts` and their existing `.test.ts` files; `src/modules/intelligence/semantic-gateway.ts` only for categorical types needed by successor. **Create:** C `observability.ts`/`.test.ts`. **Consumes:** canonical T1 wire and T2 context, typed route-admission boundary with measured local scope kept separate; **produces:** T6 factory/config/events. No active composition switch.

- [ ] RED `context_gateway_uses_exact_prompt_schema_and_route`, `full_request_bound_checked_before_prepare_ready`, `legacy_gateway_defaults_unchanged`, `prepared_is_not_dispatched`, `no_control_or_secret_in_body`.
- [ ] Assert one response carries semantic core+uncertainties+directive+reply using amended canonical schema. Apply T1A section parser without generic gateway prematurely discarding valid core for guidance-only defects; preserve fullSchemaValid=false metric. Test `guidance_failure_never_redispatches`, `truncated_json_never_salvaged`, and separate categorical patch/directive/reply observations; no extra wording gateway.
- [ ] Run `pnpm exec vitest run src/modules/intelligence/infrastructure/openrouter/semantic-gateway.test.ts src/modules/intelligence/infrastructure/openrouter/config.test.ts src/modules/conversation/context-contract/observability.test.ts` with fake transport only.
- [ ] Remove generic helper's universal `Input extends {text:string}` assumption by supplying contract-specific input admission; preserve legacy exported factories. New factory consumes ContextInput, exact canonical wire, new config 12000/1536/32768, 1800 current-turn admission, primary-only pinned ZDR route and 30s retry0. No broad change to legacy output defaults or generic privacy parser to enable it implicitly.
- [ ] Test tools/functions/function_call/tool_choice/fallback absent, stream false, exact max_price, Authorization outside JSON, bounded streamed response reading, finish_reason truncation rejected, invalid aliases/fields atomic, dispatch callable once. Recomputed maximum-cost reservation includes validated full input/output bound and documented billable overhead; historical ceilings yield ceil(1814.4)=1815 microunits minimum, not price verification.
- [ ] Events follow S §8.1 exactly, random trace IDs/safe versions/categories only; unknown route/usage remains unknown. Sentinel content, ciphertext, tokens, exception bodies and identities must never serialize into events. Rerun T0, focused/static checks, review then commit `feat(ai): add bounded context contract gateway without activation`.

### T7 — Actual inbound composition and observable state transitions

**Depends:** T6. **Create:** C `service.ts`, `service.test.ts`; `src/modules/inbound/context-contract.integration.test.ts`. **Modify:** `src/modules/reminders/command-service.ts`/`.test.ts`, `src/modules/inbound/processor.ts`/`.test.ts`, `src/worker/composition-root.ts`/`.test.ts`, `src/modules/conversation/processing-feedback.ts`/`.test.ts` only as integration requires.

**Interfaces:** T7 factory above; extend existing capability injection with optional literal `contextContract:'calenote-context-2'` to bind the amended output contract. Omitted keeps V2. Test/harness injection may select successor; deployed `worker/index.ts` stays unchanged until T11. Typed reply receipts adapt real provider SendReceipt; no inferred delivery success from swallowed exceptions.

- [ ] RED integration tests `all_successor_natural_turns_use_one_gateway`, `successor_confirmation_cannot_fall_into_legacy`, `reply_captured_after_fenced_transition`, plus full R02/R07/R08/R11/R13/R14 sequences.
- [ ] Run `pnpm exec vitest run src/modules/conversation/context-contract/service.test.ts src/modules/inbound/context-contract.integration.test.ts src/modules/reminders/command-service.test.ts src/worker/composition-root.test.ts src/modules/conversation/processing-feedback.test.ts`.
- [ ] Authenticate/bind/dedupe first; dispatch exact successor-owned controls before legacy confirm branch. Drain real legacy drafts using existing guarded path, never migrate/reinterpret them. Invalid successor context/config never routes to old parser. Side queries and natural continuations get one actual gateway call after context/admission; local greeting/help/controls get explicit bypass observation.
- [ ] Start best-effort typing before waiting for LLM; failures affect no business state. Claim durable attempt bound to observation/prompt/contract/input digest, reserve budget before dispatch, mark dispatched once, retain uncertain reservation. Context -> one call -> envelope/core/evidence validation -> T3 merge/resolve -> effective directive -> guidance validation/selection -> fenced state transition -> actual send/receipt. Query data comes from authorized read, never another model call. Recheck revision before transition and outbound selection; do not send a precomputed stale reply. No second wording call.
- [ ] Actual-service tests CO-A–F plus missing/oversized reply and unsupported guidance capture selected text, accepted facts, privacy-safe reasons and dispatch count. Bad guidance preserves grounded state; mixed correction is not local confirmation. Backend remains authoritative for preview/query/control/mutation text and T3 semantics; persist only actual selected reply and receipt. Existing deterministic bypasses stay zero-call.
- [ ] Use real D1 stores in integration for two owners/chats, duplicate inbound, provider timeout, out-of-order accepted turn, queued confirmation before preview, pre/post-midnight receipt, side query/no TTL extension, legacy drain, restart and corruption. Assert zero canonical mutation on every clarify/preview/query; exact child counts only after separate confirmation. Inject uncertain storage/send; authorized read-back recovers without duplicate INSERT or blind retry.
- [ ] Full check, independent end-to-end/security review, commit `feat(conversation): compose evidenced context through real inbound path`. Keep deployed capability unchanged.

### T8 — Versioned authenticated API and genuine route/client compatibility

**Depends:** T7. **Create:** `src/contracts/api/reminders-v2.ts`/`.test.ts`, `src/contracts/api/conversation-previews.ts`/`.test.ts`; `src/modules/reminders/details-api-service.ts`/`.test.ts`; `src/worker/routes/reminders-v2.ts`, `conversation-previews.ts`, `context-contract-api.integration.test.ts`.

**Modify:** `src/worker/routes/operations.ts`, `src/worker/router.ts`/`.test.ts`, `src/worker/composition-root.ts`, `src/modules/reminders/infrastructure/d1/api-store.ts`/`.test.ts`, `src/worker/routes/reminders.ts`, `src/lib/client-api.test.ts`. Keep existing `/api/reminders` successful strict V1 JSON shape unchanged.

**Contract:** `GET /api/v2/reminders` -> `{data:{schemaVersion:'reminders-2',reminders:[legacy fields plus details:CanonicalDetailsV1|null],hasMore:boolean,scope:'OWNER'}}`; fetch101/show100, stable ordering, no exact total. Also bound the serialized complete response to the existing client 128KiB ceiling: return the largest complete-record prefix with hasMore=true, never split/truncate a record. Version2 title validation uses contract bound. For legacy V1, unchanged representable records retain the exact old success shape; a record outside the old 500-unit title limit produces an explicit HTTP409 `CLIENT_UPGRADE_REQUIRED` in the existing `{error:{code,message}}` envelope, rather than malformed success JSON, clipped title or silently omitted record. Existing `apiRequest` accepts this error envelope before any strict success-schema parse. Test this compatibility limitation and refresh guidance; the new UI uses V2. Do not lower the approved semantic title/preservation limit to fit an old client.

`GET /api/v2/conversation-previews` -> `{data:{schemaVersion:'conversation-previews-1',previews:[publicId,draftRevision,previewHash,expiresAt,title,details,occurrences,decisionToken],hasMore}}` for authorized complete previews only, bounded10+sentinel. No raw context/evidence/internal IDs. `POST /api/v2/conversation-previews/decision` accepts strict `{schemaVersion,publicId,draftRevision,previewHash,decisionToken,action:'SAVE_PREVIEW'|'DECLINE',idempotencyKey}`; same-origin and live session checks precede T4 confirm. Token is not authentication. These schemas are new, not optional extra keys on old strict responses.

- [ ] RED `real_route_response_parses_with_client_schema`, `old_client_shape_unchanged`, `forged_cross_user_preview_rejected`, `web_and_chat_confirmation_one_winner`, `legacy_details_null`.
- [ ] Add `untrusted_guidance_absent_from_canonical_api`; expose only application-accepted state, never raw directive/reply as reminder fields. No transcript endpoint or incomplete-draft web editor is introduced by this amendment. Existing authorized surfaces may display actual selected guidance only if their reviewed contract explicitly carries it.
- [ ] Run `pnpm exec vitest run src/contracts/api/reminders-v2.test.ts src/contracts/api/conversation-previews.test.ts src/modules/reminders/details-api-service.test.ts src/worker/routes/context-contract-api.integration.test.ts src/worker/routes/api-contract.test.ts src/modules/reminders/infrastructure/d1/api-store.test.ts`.
- [ ] Implement authenticated operations/strict schemas, bounded list/detail decryption, real route integration wired to stores. Test expired session, CSRF, stale revision/token, altered hash, unsupported action, owner without bound connection, no cross-chat approval via bare controls and read-only GET. Dormant-compatible release can expose detailed read APIs for legacy records; successor preview list is empty and successor decision POST unavailable until explicit capability activation. There is no automatic fallback on arbitrary API errors.
- [ ] Verify 100/101 result notice metadata, separate location/notes/event time, encoded hostile text and corrupt details safe error rather than legacy fallback. No incomplete-context web editor/recovery claim. Review then commit `feat(api): expose versioned reminder details and bound previews`.

### T9 — Calendar lunar parity, complete web previews and delivery

**Depends:** T8. **Create:** `src/modules/conversation/calendar-presentation.ts`/`.test.ts`; `src/features/core-screens/ContextPreviewPanel.tsx`/`.test.tsx`; `src/features/core-screens/context-contract-ui.integration.test.tsx`. **Extend tests:** T3 `src/modules/reminders/detail-presentation.test.ts`.

**Modify:** `src/features/core-screens/CoreScreenExperience.tsx`, `.module.css`, `.test.tsx`; `src/modules/reminders/delivery.ts`/`.test.ts`, `src/modules/reminders/infrastructure/d1/delivery-store.ts`; T4 confirmation render admission. No unrelated navigation/auth/settings redesign.

**Interfaces:** T9 presentation functions, T8 strict endpoints. RenderResult is COMPLETE `{text}` or TOO_LONG/INVALID, never shortened silently. Outbound channel maximum stays 2000 UTF-16 units including prefix and full details. Preview includes every occurrence, separate event date/time, source calendar and decision instructions; if not representable ask shortening before confirm, not multiple notifications.

- [ ] RED `calendar_and_chat_share_lunar_conversion`, `browser_timezone_does_not_move_vietnam_today`, `details_survive_confirmation_api_delivery`, `oversize_preview_cannot_confirm`.
- [ ] Test `selected_guidance_not_canonical_details`: on any surface carrying selected guidance, render as escaped assistant text, not HTML, schedule, confirmation or canonical detail. No raw model proposal exposed; preview/calendar/detail/delivery remain backend-owned. Do not invent a new UI/API surface solely to display prose.
- [ ] Run `pnpm exec vitest run src/modules/conversation/calendar-presentation.test.ts src/modules/reminders/detail-presentation.test.ts src/features/core-screens/CoreScreenExperience.test.tsx src/features/core-screens/ContextPreviewPanel.test.tsx src/features/core-screens/context-contract-ui.integration.test.tsx src/modules/reminders/delivery.test.ts`.
- [ ] Calendar uses Vietnam civil year/month/day for navigation/today, existing lunar artifact/version; primary solar, secondary lunar day, day/month on lunar day1/first visible cell, “nhuận”, full selected-day convention. Retain markers/details; outside coverage solar remains and lunar says unavailable. Test 13 reference vectors ±1day, all artifact month boundaries, coverage1900-01-31..2101-01-28 ±1, leap examples2004-03-21/2004-04-18.
- [ ] Consume actual Worker route responses via strict client schemas in UI integration, not frontend-only fixture agreement. Show OWNER list partial notice and explicit distinction from chat scope; render title/location/notes/event/notification times and complete preview, stale errors and double-click protection. Test keyboard selection, accessible dual-date/count names, narrow layout and loading/error states.
- [ ] Delivery loads companion details with existing authorized context; legacy missing rows stay legacy. Present complete details with safe encoding. Corrupt expected new details fail before send rather than silently omitting; no blind retry on uncertain delivery. Same render function used for admission proves successful confirmed payload is deliverable; tests inspect the actual fake transport body after real confirmation/store read.
- [ ] Full check plus independent Calendar/API/delivery review; commit `feat(calendar): show lunar dates and preserve reminder details end to end`.

### T10 — Acceptance harness, frozen manifests and offline verification

**Depends:** T9; no paid run yet. **Create:** `tools/benchmark/context-contract-probe.ts`, `context-contract.ts`, `context-contract-live.ts`, `context-contract.test.ts`, `context-contract-live.test.ts`, `run-context-contract-live.mjs`; `src/modules/conversation/context-contract/benchmark/regressions.json`, `development.json`, `heldout.json`; `docs/benchmarks/llm-context-contract-results.md` (NOT_RUN sections).

**Reuse:** existing conversation loader, Miniflare/SQLite D1 and crypto fixture patterns, gateway transport and reservation ledger concepts. Keep historical V1/V2 runner/data/results intact. Held-out creation must be separate from prompt tuning; disclosed cases are development data only.

**Interfaces/data:** T10 probe and scorer above. Manifest holds exact texts/receipt/order/setup/user-turn count/expected call or bypass/fault schedule/field-state and mutation assertions. Real service builds every multi-turn context. Synthetic preseed allowed only for declared single-turn preconditions; not a substitute for R02/R07/R08/R11 or closure setup. The eight closure scripts must fit <=6 real user turns; if not, fail manifest admission, not silently expand caps.

- [ ] RED `probe_records_selected_reply_not_reconstructed_decision`, `all_planned_assertions_in_denominator`, `pilot_full_cross_resume_rejected`, `campaign_caps_enforced_before_dispatch`, `preflight_and_offline_tests_zero_network`.
- [ ] Add S §9.4.2 CO-A–F plus unsupported/null/oversized/control-contaminated reply tests through actual selection/service/store path. Assert actual selected reply source/meaning, independent patch/directive/reply categories, facts retained despite mismatch, one eligible dispatch/zero wording calls, backend-only factual/transaction text. An observed false save/capability claim fails guidance acceptance even when no mutation occurred; do not score fluent prose alone.
- [ ] Run `pnpm exec vitest run tools/benchmark/context-contract.test.ts tools/benchmark/context-contract-live.test.ts`. Offline transport fixtures exercise the exact service/context/gateway/validation/store/confirmation/API path; only messaging/provider transport replaced. Capture selected ReplyPlan/actual sink receipts and per-turn state/read-back; never call evaluateConversationTurn afterward to pretend it was the service decision.
- [ ] Freeze original16, development16 (eight mandatory closure variants, two mandatory natural-guidance variants per S §9.4.2, six other paraphrases), heldout32 and repetitions. Pilot16+16=32; full16+16+32+16=80. Repeats are two extra executions of R02/R03/R05/R06/R07/R08/R11/R13, not best-of selection; maximum6 user turns each, including setup. R04's two comparisons have explicit reset within its script; R15/R16 layer-specific expansions follow S §9.4. CO-B/C/D fault injections stay offline; do not spend calls eliciting bad output or relabel disclosed fixtures held-out. If CO-F needs clarifying turns, freeze them; fail manifest admission if six cannot suffice.
- [ ] Implement score: pilot32/32 and schema100%; full>=76/80, heldout>=31/32, schema>=99%; all mandatory originals/repetitions/eight closure/two guidance variants pass, detail assertions100%, safety0. Turn denominator all planned turns; healthy-call schema denominator all planned healthy model turns incl missing/timeout; separately raw valid/actual dispatched; expected bypass/injected refusal excluded only from schema. Full-schema failure stays failure even when valid core survives via fallback. Unexecuted assertions fail; unexecuted scripts NOT_RUN do not shrink denominator.
- [ ] Append-only campaign ledger binds source/prompt/contracts/context/calendar/resolver/storage/migrations/scorer/corpus/config/route. Pilot<=192 calls/$0.50/20m, full<=480/$1/45m, total new campaign<=USD1.50, retry0/no fallback. Reserve worst-case before each dispatch; abort at deadline/stop and retain uncertain reservations; new run IDs never erase prior authorization/spend. Test crash/resume, corrupt provenance, cross-profile state and missing reservation; cleanup only runner-owned synthetic directory, never original ledgers.
- [ ] Bind cumulative existing authorized/spent amounts at later approval, not guessed zero. Implement future CLI `node --experimental-strip-types --import ./tools/benchmark/register-conversation-loader.mjs tools/benchmark/run-context-contract-live.mjs --preflight` as guaranteed no-network/no-secret-read admission; live execution requires separately validated authorization file, immutable source/profile and explicit enable flag. Default CLI never runs inference. Unit-test every reject path.
- [ ] Full local check, independent harness/security review, commit `test(conversation): add actual-path context contract acceptance harness`. Record Layer1 evidence only; Layer2/3 NOT_RUN. STOP for explicit evaluation authorization.

### T11 — Separately authorized evaluation and compatible release

Owner amendment (2026-10-01): before resuming R01, implement the bounded LIST-only
temporal-range evidence verifier at the existing source-map evidence boundary.
Verify every approved QueryPeriod/date-operand variant with explicit bounded
productions, never infer reminder fields or intent. Unsupported/ambiguous ranges
become period:null plus backend queryRange clarification before any list-store
read. Re-prove historical QUERY source on scoped pending LIST continuation; do
not trust old quote-only EXPLICIT_USER stamps. Preserve canonical validator,
prompt, wire contract, frozen benchmark manifests/oracles, reminder ownership,
receipt anchoring and the original 20-case RED diagnostic/history. Add permanent
20-case regressions, THIS_WEEK attempts, valid explicit/range-only controls and
source-context ambiguity/inheritance controls. Require focused T3/T5/T7/T10,
full pnpm check, typecheck/lint/diff and one independent Critical=0/Important=0
review before committing or resuming the previously authorized live sequence.
Local correction evidence is recorded in the task-11-list-range-verifier report;
it alone grants no live, release or deployment acceptance credit.

**Depends:** T10/local review PASS and explicit next-gate authorizations. Not an automatic extension of implementation approval.

**Modify later:** `docs/benchmarks/llm-context-contract-results.md`, `docs/runbooks/conversation-v2-release.md`, `docs/runbooks/cloudflare-deployment.md`, `docs/runbooks/zalo-production-acceptance.md`, `docs/architecture/current-state.md`; activation only `src/worker/index.ts`, `src/worker/v2-activation.test.ts`, `src/worker/composition-root.ts`/`.test.ts`, reviewed `wrangler.jsonc` and generated Worker types if needed. No new infrastructure. Respect legacy docs as historical evidence, not active-contract authority.

- [ ] Submit evaluation request naming immutable candidate, prompt/input/output versions/digests, exact pilot/full manifests, synthetic identities, isolated persistence, non-production credential source, caps/deadlines/stops, cleanup and cumulative authorized/spent/reserved totals. Do not obtain credentials first. Revalidate official provider metadata/prices/strict-schema compatibility/ZDR/required parameters before any later live run; this is not a license for a compatibility inference call.
- [ ] After explicit provider approval run Layer2 pilot; safety/mandatory/provider/route/isolation/cap failure stops. Only pilot PASS plus covered full authorization permits full. No another model, parser rescue, new budget or tuning on held-out without replacement and reauthorization. Evidence captures actual application replies/state/delivery sink/API, not only JSON.
- [ ] If full fails, preserve ledger/results and stop release. If full passes, obtain additive migration/remote inspection authorization; fresh branch/HEAD/status/remote refs/exact-head CI, secret names only, Worker/D1/Queue/cron/bindings/domain and migration state. Revalidate no material drift since benchmark; no arbitrary historical SHA/version assumed safe.
- [ ] Stage compatibility before activation: dormant successor plus storage fences, local migrated-old/new SQL tests, then separately authorized migration and compatible Worker promotion as needed. Drain/finish or explicitly expire/restart legacy pending state; quiesce affected inbound work during transition without changing Queue topology. Verify no older process can write around SQL guards; absence of a safe quiescence/compatible version is a release blocker, not permission for a mixed-version split.
- [ ] Only after all required pieces exist switch the existing composition capability to contextContract in reviewed source; gateway unavailable remains categorical refusal, not V2 fallback. Activation is a separate tested commit, exact-head CI and review. Upstream PR/merge and remote migration require authorization; deployment requires approval of resulting immutable master SHA. Upload once and promote that recorded version only under that approval.
- [ ] Before activation record an actually compatible rollback Worker that recognizes contract ownership/fences and rejects successor pending state rather than reinterpreting it. Test old delivery with new canonical rows. Rollback does NOT revert D1, cancel confirmed reminders, reschedule/reinterpret children or undo external sends. Optional detail omission by older delivery is allowed only if explicitly accepted; otherwise that version is not an eligible rollback.
- [ ] Layer3 after authorized deploy: exact active Worker/source read-back, health/auth/D1/Queue/cron/webhook, controlled authorized Zalo R01–R16/closure subset and Calendar vector/UI acceptance; verify expected canonical counts, complete details and partial lists. Human typing visibility separately YES/NO. Record UI, live provider, local and deployed evidence separately; only then claim channel acceptance.

## Acceptance traceability: original exact fixtures

Fixed initial receipt: 2026-09-28 10:00 Asia/Ho_Chi_Minh unless specified; E=2026-10-11 for supplied context. Each row owns deterministic tests in the named tasks and a T10 manifest entry with the same ID. Clarification/preview/query always zero canonical mutation. T11 owns later channel evidence, not current execution.

| ID | Exact fixture / condition | Task-owned assertions |
| --- | --- | --- |
| R01 | “Có lịch nào ko?” then “Tháng này có lịch gì ko?” | T3/T7: pending query -> Sep1–Oct1 scoped list; no repeated range question/create |
| R02 | “Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.” → “Nhắc trước 2 ngày.” → “8h.” | T2/T3/T7: title/location/E/count2 preserved; after turn2 only time missing; Oct9/10 08:00 preview |
| R03 | Pending relation question; “Nhắc trước sự kiện.” | T3/T7: BEFORE_EVENT, retained E/count/title, only missing field, not abandonment menu |
| R04 | “Nhắc một lần trước ngày thi 2 ngày.” versus “Nhắc 2 ngày liên tiếp trước ngày thi.”; E and08:00 | T3/T7: two independent branches/reset: Oct9 once vs Oct9/10 daily |
| R05 | Unconfirmed request; “Bỏ.” | T4/T5/T7: terminal scoped cancellation, no saved cancellation/menu, new request possible |
| R06 | “Đừng bỏ.” then “Ghi chú là: đừng bỏ quên giấy tờ.” | T2/T5/T7: no abandonment, preserved details, grounded note |
| R07 | “Ngày 11/10 đi thi ở Quang Trung, nhớ mang giấy tờ.” → “Nhắc hai ngày liên tiếp trước hôm thi.” → “8h.” → “Đổi sang 9h.” | T2/T3/T4/T7/T9: title=đi thi/location=Quang Trung/notes=nhớ mang giấy tờ; Oct9/10; only clock edit, old revision invalid; API/delivery preservation |
| R08 | After08:00 preview: “Có, nhưng đổi sang 9h.” | T5/T7: no save;09:00 fresh preview/proof required |
| R09 | “Hôm nay là ngày mấy âm lịch?” | T3/T7/T9: canonical receipt-date conversion, read-only, not capability help |
| R10 | “Ngày 15/6 âm lịch hằng năm, nhắc ngày giỗ người thân.” | T5/T7: annual unsupported; explicit one-off acceptance then year/time, no downgrade/save |
| R11 | Pending draft; “Tháng này có lịch gì?” then return | T3/T5/T7: draft/details/version/expiry unchanged; reissue decision before save |
| R12 | “Mai 8h nhắc gọi mẹ” received Sep28 23:59, processed/retried Sep29 00:01 | T2/T3/T7: Sep29 08:00; original receipt, replay no model dispatch |
| R13 | Persisted pending, older interpretation delayed, later “bỏ” accepted | T4/T7: terminal CAS/order fence, no resurrection/stale preview; separate no-draft truthful limitation test |
| R14 | Duplicate confirmation; reply lost after commit | T4/T7/T8: one transaction, expected child count; read-back, no duplicate claim |
| R15 | Malformed object/unsupported field/fabricated evidence/timeout/budget refusal | T1/T2/T6/T7: five distinct deterministic injections, no patch/mutation/fallback; T10 one declared injection in live script |
| R16 | Same solar/lunar dates through chat and Calendar | T3/T9: shared converter, complete boundary/vector suite; T10 one live query+presentation, T11 actual UI |

| Closure family | Concrete test owner / mandatory full-development slot |
| --- | --- |
| A -> replacement question -> “Có.” never saves A/B | T5/T7 `replacement_yes_never_saves_A_or_B`; D01 |
| Annual offer with unrelated A, accept then separately replace/save | T5/T7 `one_time_offer_yes_is_not_save`; D02 |
| “Ngày 15/6/2027 âm lịch là ngày dương nào?” | T3/T7 `lunar_source_solar_output`; D03 |
| Gregorian query while lunar draft; lunar query while Gregorian draft | T3/T7 `opposite_calendar_draft_unchanged`; D04/D05 |
| Mixed real token plus time correction; controls absent from all strings | T2/T6/T7 `mixed_correction_survives_projection`; D06 |
| Query return/resume and restart bind non-save decision | T5/T7 `resume_and_restart_do_not_save`; D07/D08 |
| INPUT_1799/1800/1801/2000 incl Unicode/escaping | T0/T2/T6 length/admission tests; no paid boundary probing |
| Persisted cancellation vs first-ever inference in flight | T4/T7 separate race tests; no false cancellation receipt |
| Unknown/expired/corrupt/no context; two/three no-progress answers | T2/T4/T5/T7 lifecycle/loop tests; no fake web recovery |

### Conversation-ownership acceptance mapping (development, not held-out)

Exact Vietnamese input/wording fixtures remain in S §4.5.3/9.4.2; R01–R16 above
are unchanged. No executable fixture was edited by this documentation amendment.

| Case | Owning tasks / assertion |
| --- | --- |
| CO-A missing time, matching directive | T1A/T5/T7/T10: eligible natural question; only reminderTime requested |
| CO-B wrong eventDate question | T2A/T5/T7/T10: discard prose, effective reminderTime fallback, retain facts |
| CO-C incomplete premature preview | T5/T7/T10: no preview authority/save; backend clarification |
| CO-D “Đã lưu lịch cho bạn.” | T5/T7/T10: forbidden output not selected, zero save; transactional paraphrases and obfuscation tested, no universal lint claim |
| CO-E “Có, nhưng đổi sang 9h.” | T5/T7/T10 plus original R08: one dispatch, old preview invalid, new backend preview, no implicit confirm |
| CO-F three exact progressive turns | T3 regression/T5/T7/T10: retained details, offset/count and approximate-clock clarification when needed, application occurrences/preview; never force Oct9/10 without grounds |
| Null/missing/oversized/invalid guidance, invalid semantic core | T1A/T2A/T5/T6/T7/T10: independent validity, factual fallback, no schema-score laundering or second call |
| Selected versus proposed text | T2A/T4/T7/T8/T9/T10: selected encrypted receipt/history only; sanitized next context, not canonical facts or raw API authority |
| Canonical preview/query/controls/mutation/delivery | T4/T5/T7/T8/T9/T10: backend composition only, no model rows or success authority |

## Specification coverage

| Approved section | Owning tasks |
| --- | --- |
| §1–3 responsibility/supersession/actual processing | T1,T6,T7,T11 |
| §4.1 schema/evidence/typed calendars | T0,T1,T2,T3 |
| §4.2–4.4 slots/confirmed object/preservation | T1,T3,T4,T7,T8,T9 |
| §4.5 directive/reply/effective selection and progressive semantics | T1A,T2A,T5,T7; T4 selected history; T6 one gateway; T8/T9 accepted surfaces |
| §5/5.2 merge/time/count/reference | T3,T4,T7 |
| §5.1/5.1.1 lifecycle/decisions/controls/recovery | T1,T4,T5,T7,T8 |
| §5.3 query scope/status/partial results | T3,T7,T8,T9 |
| §6/6.1/6.1.1 privacy/context/projection | T0,T1,T2,T4,T6,T7 |
| §6.2 concurrency/uncertain results/no-draft limitation | T4,T5,T7,T8 |
| §7 lunar UI/capability/annual exclusion | T3,T5,T7,T9 |
| §8/8.1/8.2 route/bounds/events/fit | T0,T2,T6,T7,T10 |
| §8.2.2 revised canonical-envelope measurements | T1A,T2A,T0A; route B unchanged |
| §9.1 three evidence layers | T1–T9 Layer1; T10 tooling/T11 authorized Layer2 and Layer3 |
| §9.2–9.4.1 scoring/manifests/closure | T10, fixture ownership above |
| §9.4.2 conversation-ownership regressions | T1A/T2A/T5–T10; original fixtures preserved |
| §9.5 migration/compatibility/release | T4,T8,T11 |
| §10 policies/exclusions | Global constraints, T5/T10/T11 gate boundaries |

## Gate summary, risks and execution recommendation

This final historical summary is retained for provenance. The current A1–A6
gate and review cadence below control the authority consolidation; do not use
the historical per-task review/automatic T11 text as execution permission.

1. **Authorization:** prior plan/execution method approved; current documentation-only amendment awaits OWNER_REVIEW_OF_AMENDED_SPEC_AND_PLAN. No T4/implementation continuation in this turn. Documentation checks prove neither amended fit nor implementation.
2. **Local:** historical T0 A and T1–T3 accepted; scoped T1A/T2A/T0A precede T4–T10 after owner review, independent Critical=0/Important=0 at boundaries. Keep successor dormant; isolated fake transports only until actual-route admission is established.
3. **Provider:** separately verified route admission B, conditional bounded owner authorization, fresh official compatibility/prices, pilot then full, immutable provenance, all stops/caps retained. Currently NOT_RUN.
4. **Remote:** separate inspection/migration/merge permissions, compatible rollback, exact-head checks and exact-master-SHA deploy approval.
5. **Channel:** actual Zalo/Calendar/UAT evidence after deployment, human review. Currently NOT_RUN.

Actual unresolved execution facts: amended1536 envelope/local measurements and
full-route framing; complete preview/control/channel fit and old-client upgrade
response; D1 batch/trigger compatibility on workerd; channel receipt certainty;
compatible rollback; six-turn manifest fit; endpoint metadata/prices/credential
eligibility. Free natural prose cannot receive a universal semantic safety proof
from structural checks/lint; S §4.5.2 constrains selection and requires actual
reply acceptance, not a second language parser. Review this residual-risk boundary
alongside the written amendment. If a required guarantee cannot be met, stop that
dependency with evidence and the smallest policy correction, not a broad redesign.

Preserve the approved **subagent-driven, sequential per task with a fresh
independent reviewer at each boundary**, then whole-branch review. No agents
or tasks are dispatched during this documentation amendment. Stop at
OWNER_REVIEW_OF_AMENDED_SPEC_AND_PLAN; do not ask to reselect the execution
method or treat the older automatic-continuation approval as clearing this gate.

## Model Output Authority Consolidation implementation amendment (2026-10-01)

**Controlling scope:** implement S §4.6 only after owner review of this plan.
Planning baseline is clean `904afe5a56d7f82530b44b07d775d6d3cc2467bf` in
`/Users/bichtuyen/code/calenote/.worktrees/product-experience-v2`; runtime source
is unchanged from `899b1f25f38d4d4afcd7429ffbb10c91851c25e3`.
Use GPT-6.1 Sol Medium for implementation/review. Preserve the existing chosen
execution method. Six coherent tasks have three boundary reviews: A1+A2,
A3+A4, A5+A6, followed by one whole-amendment review. Do not dispatch a fresh
reviewer for each mechanical edit or reopen accepted T0–T10 tasks.

### Source map verified before assigning A1–A6

All paths below exist except those explicitly labelled create. `C` below means
`src/modules/conversation/context-contract/`; `O` means
`src/modules/intelligence/infrastructure/openrouter/`. Commands use full paths.

| Existing boundary | Current finding | Amendment owner |
| --- | --- | --- |
| C `contracts.ts`, `wire.ts`, `prompt.ts` | canonical context-2 has act/continuation/controlEvidence and six directives; generic serializer emits canonical schema | A1 successor schemas; A5 serialization/prompt switch |
| O `context-provider-wire.ts`, `provider-wire-schema.ts` | wire field-codebook-9; schemaVersion injected; fixed DEFAULT statusScope still generated; compact uncertainty codebook; guidance quarantine only two fields | A1 new versioned codec; A5 gateway default switch |
| C `evidence.ts`, `merge.ts`, `list-range-evidence.ts` | EDIT affects notes/replacement evidence/conflicts; labels control replacement/reject and inherited LIST admission | A3 semantic authority, existing bounded LIST verifier preserved |
| C `query.ts`, `resolve.ts` | typed query/calendar/arithmetic; no general-language edit parser | A3 type integration and regression, no arithmetic policy change |
| C `decisions.ts`, `control-proof.ts`, `preview-control.ts`, `responses.ts`, `guidance.ts`, `transition.ts` | exact controls and explicit proofs; transition converts some merge rejects into decisions; backend factual composition | A4 semantic outcomes and optional guidance |
| C `state.ts`, `context.ts`, `store.ts`, `runtime-store.ts`, `confirmation.ts`, `infrastructure/d1/store.ts` | state-1 embeds context-2 pending proposals; encryption identity context-2; SQL/fences hardcode numeric contract_version=2 | A2 successor codec/isolation; A4/A5 transaction consumers |
| `migrations/0009_llm_context_contract.sql` | CHECK versions(1,2), ownership CHECK=2, shared triggers/permits | Preserve immutable migration; numeric2 remains storage fence family, never label it canonical schema3 |
| C `service.ts`, `observability.ts`, `downstream.ts`, `validation-diagnostics.ts`; O `semantic-gateway.ts` | contract/prompt version2 binding in attempts/events; real production-shaped provider adapter differs from generic/offline path | A5 same successor codec/authority on every dispatch path |
| `tools/benchmark/context-contract{,-fixtures,-fit.test,-probe,-runner,-live}.ts` and benchmark JSON | declarative proposals author old labels; actual-service read/write observations; prefix reuse intentionally disallows semantic changes | A6 migrate proposals, retain exact user scripts/oracles; no reuse of historical R01 prefix |
| `tools/benchmark/context-schema-diagnostics.ts` | generic constant250000 differs from authorized diagnostic driver cap300000 | A5 explicit authority-bound cap; preserve prior charges and failed/unknown reservations |

### Concrete interfaces and version policy

A1 owns these successor types, initially exported with `V3` suffix alongside
the existing dormant context-2 contract. A5 switches the existing generic
contract exports/service consumers to these types and removes superseded
runtime proposal functions. Do not cast a context-2 proposal to V3 or bridge it
through fabricated semantic instructions.

```ts
type RequestTargetV3 = {
  kind: 'CURRENT' | 'NEW' | 'UNRESOLVED'; evidence: EvidenceRef[];
};
// Existing 13 field/value unions remain; REPLACE is a semantic instruction.
type FieldOperationV3 = 'SET' | 'REPLACE' | 'CLEAR';
// SemanticPatchProposalV3: application-bound schemaVersion + intent +
// requestTarget + changes + query + uncertainties; no guidance/control labels.
// query.statusScope is canonical DEFAULT, never model-authored.
type ModelDirectiveV3 =
  | { kind: 'ASK_FOR_FIELD'; field: IssueField }
  | { kind: 'ASK_FOR_DISAMBIGUATION'; field: IssueField;
      reason: 'AMBIGUOUS' | 'CONFLICT' | 'UNSUPPORTED_COMBINATION' }
  | { kind: 'HELP'; topic: 'GENERAL' | 'REMINDERS' | 'LUNAR' | 'FINITE_SERIES' }
  | { kind: 'EXPLAIN_UNSUPPORTED'; issue:
      'CAPABILITY' | 'REQUEST_COMBINATION' | 'DOMAIN_LIMIT' | 'ASSISTANT_SCOPE' };
```

`requestTarget` is required non-null for CREATE_REMINDER; it is allowed only
for CREATE_REMINDER or AMBIGUOUS with a targeted operation uncertainty, otherwise
null. CURRENT means the sole retained request, never a model ID. With no retained
request, CURRENT is valid unresolved meaning and clarifies; NEW starts a fresh
candidate. With A present, NEW stages B without copying A facts and requires
REPLACE_PENDING. UNRESOLVED preserves A and retains separately grounded candidate
facts for a scoped operation clarification. Evidence is 1–3 current USER_QUOTE
refs for NEW/UNRESOLVED or explicit CURRENT targeting; context-only echoes cannot
approve targeting. No cancellation, greeting, success, confirmation or arbitrary
action value is added. A current short reply such as “8h.” grounds a CURRENT
candidate in the application-bound pending reminder question; no new phrase
parser interprets it.

SET proposes a missing value, exact reuse or non-destructive addition; an
occupied differing scalar becomes an evidenced conflict, never silent overwrite.
REPLACE asserts explicit current user replacement of that field; CLEAR asserts
explicit removal, retains literal null and makes required fields incomplete.
Both require current USER_QUOTE evidence; retained facts/old quotes alone cannot
replace/clear. Notes SET must contain prior notes intact, and append genuinely
grounded new detail; REPLACE/CLEAR are the only destructive notes operations.
REPLACE targeting a missing field clarifies operation rather than converting to
SET. A current REPLACE answering a retained conflict can resolve it; exact fact
echoes cannot. Model operation meaning remains untrusted like every semantic
operand: exact matching quotes prove source identity, not universal entailment;
preview/confirmation and actual semantic evaluation address residual risk.

Remove root `controlEvidence`: its surviving semantic purpose is represented
by `requestTarget.evidence`, per-change evidence and typed operation alternative
evidence. `uncertainties.field=operation` alternatives become CURRENT/NEW
request-target meanings with refs, never old DialogueAct values. Combined-action
uncertainty has zero executable changes, grounded requestTarget UNRESOLVED and
UNSUPPORTED_COMBINATION; backend asks which request to handle. No model value
authorizes abandonment; only existing exact application controls/proofs do.

Application protocol descriptor is immutable:

```ts
type ContextProtocolV3 = {
  canonicalVersion: 'calenote-context-3';
  promptVersion: 'calenote-context-3';
  inputVersion: 'calenote-context-input-2';
  stateVersion: 'calenote-context-state-2';
  wireVersion: 'google-gemini-2.5-flash-lite-vertex-eu-context-authority-10';
  codebookVersion: 'context-uncertainty-fields-1';
  storageFenceFamily: 2;
};
```

Input version advances because input ambiguities also contain the changed
operation alternative shape. Canonical reminder detail/preview payloads retain
their independent unchanged versions. Codebook entries0–15 retain existing
field meaning; codebook1 cannot be reordered. New transport version10 reflects
material structure/authority change; protocol3, prompt3, input2 and state2
are not model values. No change to model/provider/capability version or budgets.

Numeric storage family2 means the already-reviewed SQL ownership/permit/fence
namespace for this dormant subsystem. It is intentionally independent of
canonical output3 and encrypted state2. A2/A5 retain its SQL CHECK/trigger
semantics and one-owner/chat ownership row. Encryption identity adds the selected
canonicalVersion: application-selected V3 store uses context-3 only. An explicitly
invoked read-only legacy codec uses context-2/state-1 only and returns an opaque
legacy result, never ContextSnapshotV2/ValidatedPatchV3. Active V3 observe returns
OTHER_CONTRACT for legacy ownership/data; it must not treat it as absent/start
over. No auto dual runtime, model-selected decoder or automatic conversion.
Future cutover quiesces/drains pending context-2 work or expires/restarts it with
notice; confirmed records/details/delivery stay intact. No migration is needed
for retaining numeric family2; do not edit0009. Any later storage change requiring
DDL is a separate reviewed forward migration/release gate, not implied by this plan.

### Amendment global constraints and review focus

All original numeric, privacy, calendar, TTL, confirmation, channel and envelope
limits remain. No generic input parser, new provider/model, repair/wording call,
tools/SQL/IDs, provider fallback or silent schema relaxation. One bounded semantic
call, retries0. Runtime remains dormant; no production activation/config writes.
Exact provider constraints remain `google/gemini-2.5-flash-lite`,
`google-vertex/eu`, `stream=false`, `retry=0`, `fallback=none`,
`provider.require_parameters=true`, approved ZDR/data-collection-deny routing,
and strict structured output. Input ceiling is 12000 tokens, output ceiling
1536 tokens, and raw provider response ceiling 32768 bytes. No task changes
these limits or treats advisory success as canonical semantic validation.
No network/tokenizer provisioning is needed for the offline task commands below.
The cache-backed tokenizer fails explicitly if unavailable; do not install silently.

For **every A1–A6 commit**, run its named focused command, then the shared
relevant-regression command:
`pnpm exec vitest run src/modules/conversation/context-contract src/modules/intelligence/infrastructure/openrouter tools/benchmark/context-contract.test.ts tools/benchmark/context-contract-runner.test.ts`.
Run these sequentially, not concurrently with the full suite; record counts,
skips and exit status. New tests must first fail on intended assertions, not
tooling/import setup. Each task's acceptance also requires `pnpm typecheck`
and `git diff --check`; no commit follows a failing gate.

Review these five likely boundary failures; each is pinned by the named task:

1. Natural correction versus unrelated task shares similar SET values: A3
   `current_replace_differs_from_new_candidate` and A4 replacement decision test.
2. Innocent new notes text loses retained detail: A3 `notes_set_preserves_old_text`
   and `notes_replace_requires_current_source`.
3. A missing advisory key is mistaken for malformed semantic outer structure:
   A1 `isolated_guidance_failure_keeps_core` versus `outer_failure_rejects`.
4. Row family2 is mistaken for canonical2, letting a legacy reader mutate V3:
   A2/A5 `family2_is_not_protocol_selection` and mixed-version store tests.
5. R01 passed under older semantics is counted for the changed candidate or an
   unknown reservation disappears on new run: A6 `semantic_change_invalidates_prefix`
   and `new_source_retains_all_unknown_reservations`.

### A1 — Successor semantic/advisory contract and deterministic transport

**Files:** create C `output-authority.ts`, `output-authority.test.ts`,
`protocol.ts`, `authority-contract.test.ts`; modify C `contracts.ts` and
O `context-provider-wire.ts`, `provider-wire-schema.ts`; tests O
`context-provider-wire.test.ts`, `context-provider-wire-parity.test.ts`,
`context-protocol-metadata.test.ts`, `context-uncertainty-codebook.test.ts`.
Existing active/dormant context-2 exports retain behavior at this commit.

**Interfaces:** export strict `SemanticPatchProposalV3Schema`,
`ConversationInterpretationV3Schema`, `ContextInputV2Schema`, matching types and
`parseInterpretationSectionsV3(raw: unknown): InterpretationSectionsV3` from C
`contracts.ts`. Canonical version3 includes statusScope DEFAULT injected by
decoder. `ParsedInterpretationV3` retains semantic/directive/reply/fullSchemaValid
section-result separation. O exports
`googleLiteEuContextWireSchemaV3(): ProviderWireSchemaV3`,
`encodeGoogleLiteEuContextV3(canonical: ConversationInterpretationV3): unknown`,
`parseGoogleLiteEuContextSectionsV3(raw: unknown, selected: ContextProtocolV3): InterpretationSectionsV3`.
No model payload can select `selected`; unsupported descriptor rejects.

`output-authority.ts` is the sole **executable** typed registry; S §4.6 remains
the human normative matrix, not another manually synchronized docs registry.
Export `OutputAuthorityClass`, `OutputAuthorityRule` (class, modelAuthorshipReason,
evidencePolicy, mergePolicy, canAffectMerge, canCauseHardReject, canCauseClarify,
canAuthorizeRead, canAuthorizeWrite, applicationDerivable), `OUTPUT_AUTHORITY_REGISTRY_V3` and
`classifyOutputPathV3(path: OutputFieldPathV3): OutputAuthorityRule`. Field paths
are derived from the V3 types, including array/value/evidence/alternative branch
paths; category prefix rules cannot overlap and every canonical/generated leaf
must match exactly one rule. Semantic discriminants inherit SEMANTIC_UNTRUSTED;
four-kind directive/reply leaves ADVISORY; protocol/status constants
APPLICATION_OWNED. Fixed codebook mapping/version is owned, proposed fieldCode
semantic. Known inactive padding is shape-only owned transport material.
Use this registry to generate the table-driven test cases for every root and
meaningful nested path; do not maintain a second manually copied test matrix.
Read/write booleans describe independent field authority and must always be
false; backend admission remains separate. Advisory rows cannot affect merge
or cause hard rejection; an unknown outer key is a transport violation, not
an advisory row. Schema inspection must reject every newly added unclassified
root, nested active branch or meaningful generated category.

- [ ] Write RED `authority_paths_are_exhaustive_and_nonoverlapping`,
  `new_wire_has_no_dialogue_or_owned_metadata`, `replace_is_typed_semantic`,
  `isolated_guidance_failure_keeps_core`, `outer_failure_rejects`,
  `invalid_active_discriminator_rejects`, `inactive_padding_never_enters_core`,
  `all_16_codes_roundtrip_and_unknown_code_rejects`. Assert no act/continuation/
  controlEvidence/version/statusScope in generated model properties, no two
  backend-only directive kinds, mandatory semantic keys/unknown-root failures,
  strict duplicate13-field/4-uncertainty/2-alternative/1–3-ref bounds.
- [ ] Run `pnpm exec vitest run src/modules/conversation/context-contract/authority-contract.test.ts src/modules/conversation/context-contract/output-authority.test.ts src/modules/intelligence/infrastructure/openrouter/context-provider-wire.test.ts src/modules/intelligence/infrastructure/openrouter/context-provider-wire-parity.test.ts src/modules/intelligence/infrastructure/openrouter/context-protocol-metadata.test.ts src/modules/intelligence/infrastructure/openrouter/context-uncertainty-codebook.test.ts`.
  Record intended assertion RED; fix setup/import failures separately.
- [ ] Implement the above strict V3 interfaces using existing typed slot/operand
  definitions. Flatten only unambiguous active branches; decode metadata locally.
  Keep complete JSON/root/core hard failure separate from advisory quarantine.
  Invalid mandatory evidence shapes remain semantic failure, never quarantine.
- [ ] Rerun the focused command, `pnpm typecheck`, `git diff --check`; existing
  context-2 consumers compile and accepted tests remain unchanged at this stage.
- [ ] Selectively stage named A1 files and commit
  `feat(conversation): define authority consolidated context contract`.
  A1 stays unaccepted until the combined A1+A2 review; no reviewer per substep.

### A2 — Versioned pending-state codec and legacy isolation

**Depends:** A1 local green. **Files:** create C `legacy-state-reader.ts`,
`legacy-state-reader.test.ts`; modify C `state.ts`, `context.ts`, `store.ts`,
`runtime-store.ts`, `infrastructure/d1/store.ts`; tests C `state.test.ts`,
`context.test.ts`, `infrastructure/d1/compatibility.integration.test.ts`,
`infrastructure/d1/store.integration.test.ts`. No migration change/execution.

**Interfaces:** export `ContextSnapshotV2Schema`, `ContextSnapshotV2`,
`encodeContextSnapshotV2(value: ContextSnapshotV2): string`,
`decodeContextSnapshotV2(encoded: string): ContextSnapshotV2` and
`buildContextInputV2(args: ContextBuildArgsV2): ContextBuildResultV2`.
`ContextBuildArgsV2` is `Omit<ContextBuildArgs, 'snapshot'>` with
`snapshot: ContextSnapshotV2 | null`; `ReadyContextV2` preserves every existing
ReadyContext member, replacing input with ContextInputV2 and candidateSnapshot
with ContextSnapshotV2. `ContextBuildResultV2` is ReadyContextV2 or the existing
REFUSED `{reason}`. These types live in C `context.ts`.
State2 pending candidates use SemanticPatchProposalV3; input2 uses matching
operation ambiguity types. Preserve slot/provenance/maps/receipt/decision bounds.
State2 additionally has nullable `pendingSemanticCandidate` containing the
existing bounded V3 candidate shape plus `baseContextRevision` and `questionId`.
It preserves an unresolved-target proposal alongside the actual operation
question; it has no acceptedReplies, token or confirmation authority. Its
question must match the actual retained operation question, revision must match
the post-store context revision, and expiry is capped by existing draft/idle/
absolute lifetimes. Both incoming and retained candidate source maps must fit
16KiB without evicting supporting evidence. Subsequent current semantic targeting
can select this exact bound candidate only after original sources are revalidated
and no newer correction/terminal revision supersedes it. No model internal ID
or control approval adopts it. A changed target/candidate receives a new revision.
Extend `contextContractEncryptionIdentity(scope, id, protocol)` to bind only
application-selected canonical version; protocol mandatory on V3 path. Export
`readLegacyContextState(encoded: string): LegacyContextReadResult` with VALID
opaque legacy record or INVALID; no mutation/adoption/ValidatedPatch methods.
Keep only the bounded legacy proposal/state decoding definitions needed for
state1, sharing unchanged value/evidence primitives rather than duplicating
the full old contracts/prompt/gateway API. V3 store/runtime factory requires
`protocol: ContextProtocolV3`; family2 SQL cannot supply or change it.

- [ ] RED `state2_roundtrips_new_and_replace_candidates`,
  `family2_is_not_protocol_selection`, `legacy_reader_never_produces_v3_state`,
  `v3_legacy_owner_is_other_contract_not_absent`, `cross_protocol_ciphertext_refused`,
  `old_reader_cannot_confirm_v3`, `one_family_ownership_prevents_parallel_request`,
  `corrupt_state_rejects`, `state_capacity_retains_evidence_or_refuses`,
  `unresolved_candidate_is_nonapprovable_and_revision_bound`.
  Assert state1/state2 candidates rejected by the opposite strict codec,
  unchanged16KiB maximum and no pending TTL renewal from read/refusal.
- [ ] Run `pnpm exec vitest run src/modules/conversation/context-contract/state.test.ts src/modules/conversation/context-contract/context.test.ts src/modules/conversation/context-contract/legacy-state-reader.test.ts src/modules/conversation/context-contract/infrastructure/d1/compatibility.integration.test.ts src/modules/conversation/context-contract/infrastructure/d1/store.integration.test.ts`.
  Use isolated synthetic local stores; no Wrangler remote command.
- [ ] Implement the independent codec/protocol selection and read-only legacy
  boundary. Preserve ownership permits, inbound ordering, CAS and storage family2.
  Keep existing context-2 store default callable until A5 consumer switch;
  successor path cannot reinterpret old observation/proofs as current authority.
- [ ] Rerun focused command, `pnpm typecheck`, `git diff --check`.
- [ ] Review A1+A2 once for registry completeness, unambiguous decode, core versus
  guidance failure, protocol identity/storage-family safety; fix scoped findings
  with RED/GREEN and re-review only findings. Accept at Critical0/Important0.
- [ ] Selectively stage A2 files and commit
  `feat(conversation): isolate successor state and protocol ownership`.

### A3 — Evidenced semantic targeting, replacement and merge outcomes

**Depends:** A1+A2 accepted. **Files:** modify C `evidence.ts`, `merge.ts`,
`query.ts`, `resolve.ts`, `list-range-evidence.ts` only for scoped continuity
integration; tests C `evidence.test.ts`, `merge.test.ts`, `query.test.ts`,
`resolve.test.ts`, `list-range-authority.test.ts`, `list-range-evidence.test.ts`,
`quote-classification.test.ts`, `evidence-diagnostics.test.ts`.

**Interfaces:** add `validateEvidenceV3(proposal: SemanticPatchProposalV3, built: ReadyContextV2, observe?: DownstreamObserver): EvidenceValidationV3`.
Its `ValidatedPatchV3` separately carries resolvedChanges/query/uncertainties,
application-bound change/alternative evidence, `requestTargetEvidence` and
validated requestTarget, observation and ContextSnapshotV2 candidate. Brand
cannot be constructed by casting/JSON and never includes guidance. Export
`mergePatchV3(previous: ContextSnapshotV2 | null, patch: ValidatedPatchV3): MergeResultV3`;
results MERGED (candidate, changedFields, uncertainties, query/referenceTime),
NEEDS_REPLACEMENT (retained candidate plus separately grounded proposed NEW
patch), CLARIFY_OPERATION (retained candidate plus grounded pending meaning),
or REJECTED (security/structure/state reason). Neither expected semantic decision
uses REJECTED; no advisory field enters the signature. Reuse deterministic
resolve/query calculations with V2 state, preserving resolved slots/facts paired.

- [ ] RED `current_replace_differs_from_new_candidate`,
  `set_on_occupied_field_keeps_conflict`, `replace_resolves_only_current_grounded_conflict`,
  `fact_echo_cannot_resolve_conflict`, `notes_set_preserves_old_text`,
  `notes_replace_requires_current_source`, `clear_requires_current_source`,
  `unresolved_target_keeps_facts_and_clarifies`, `new_candidate_cannot_copy_A_facts`,
  `query_inheritance_needs_scope_and_original_range_source`,
  `valid_ref_unsupported_range_clarifies_but_fabricated_ref_rejects`.
  Assert CURRENT/NEW/UNRESOLVED, missing-field REPLACE, no existing target,
  mixed correction, explicit notes replacement, old-source edits, non-USER,
  cross-owner/chat/context and invalid operation-alternative refs. Retain all
  verifier variant/negation/quotation/receipt/Unicode controls; no broadened parser.
- [ ] Run `pnpm exec vitest run src/modules/conversation/context-contract/evidence.test.ts src/modules/conversation/context-contract/merge.test.ts src/modules/conversation/context-contract/query.test.ts src/modules/conversation/context-contract/resolve.test.ts src/modules/conversation/context-contract/list-range-authority.test.ts src/modules/conversation/context-contract/list-range-evidence.test.ts src/modules/conversation/context-contract/quote-classification.test.ts src/modules/conversation/context-contract/evidence-diagnostics.test.ts`.
- [ ] Implement validated semantic instructions and explicit merge outcomes;
  retain accepted facts while unresolved targeting/conflicts block preview.
  CURRENT relation/calendar/time operands remain model interpreted, backend
  evaluated; do not add a Vietnamese edit/new-request classifier. Evidence refs
  resolve via the existing exact source map; mandatory invalid refs hard-reject.
  Current QUERY answer plus exact pending scope and reverified original source
  permits inheritance without act/continuation. Valid unsupported range nulls
  only that policy-defined optional period; no generic partial-patch salvage.
  CLARIFY_OPERATION stages pendingSemanticCandidate without editing A; CURRENT
  or NEW semantic answers use current targeting evidence and only that exact
  question/revision-bound candidate's revalidated original sources. A later
  replacement or cancellation invalidates it before merge/adoption.
- [ ] Rerun focused command, `pnpm typecheck`, `git diff --check`; retain
  context-2 functions until A5 migrates consumers, no old-to-V3 authority bridge.
- [ ] Selectively commit A3 files as
  `feat(conversation): merge only grounded semantic instructions`.

### A4 — Backend decisions, independent guidance and confirmation safety

**Depends:** A3 local green. **Files:** modify C `guidance.ts`, `transition.ts`,
`decisions.ts`, `responses.ts`, `control-proof.ts`, `preview-control.ts`,
`confirmation.ts`, `store.ts`, `infrastructure/d1/store.ts`; tests C
`guidance.test.ts`, `decisions.test.ts`, `responses.test.ts`, `confirmation.test.ts`,
`transition.integration.test.ts`, `infrastructure/d1/store.integration.test.ts`.

**Interfaces:** `computeEffectiveDirectiveV3(applicationOutcome: ApplicationOutcomeV3): EffectiveDirective`
consumes ValidatedPatchV3/MergeResultV3/resolution/query/control/persistence
results, never model directive. `validateDirectiveV3(model: ParsedInterpretationV3['directive'], effective: EffectiveDirective): DirectiveValidation`;
`selectGuidance` keeps existing independently checked reply contract. Add
`transitionConversationV3(input: TransitionInputV3): Promise<ConversationTransitionV3>`
with ContextSnapshotV2, ValidatedPatchV3, explicit merge outcomes and existing
ControlSelection/authority/result dependencies. Compose through existing
`composeContextReply`; EffectiveDirective retains PRESENT_PREVIEW, ANSWER_QUERY
and BACKEND_ONLY. `validDecision`/`validateConfirmation` consume V2 state and
existing proof/preview shapes; caller-selected protocol remains application data.
`ApplicationOutcomeV3` has semantic `ValidatedPatchV3`, merge `MergeResultV3`,
optional `RequestResolution`, `QueryResolution`, `ContextQueryResult` and the
existing optional BACKEND_ONLY reason; export it from `guidance.ts`.
`TransitionInputV3` retains `TransitionInput`'s control/authority/time/channel/
guidance/failure/query members, replacing snapshot/received with
`ContextSnapshotV2`, interpretation with `ValidatedPatchV3` and merge with
`MergeResultV3`. Stored transition V3 replaces its snapshot with
`ContextSnapshotV2`; the ReplyOnly/proof/receipt shapes stay unchanged. These
types are owned by `transition.ts` and `store.ts`, not implicit casts.

- [ ] RED `advisory_variations_never_change_merge_or_execution`,
  `new_request_yes_only_replaces_pending`, `mixed_yes_replace_never_confirms`,
  `one_time_acceptance_then_replacement_then_save`,
  `unresolved_target_without_prior_draft_clarifies`,
  `exact_abandon_control_cancels_but_negated_or_note_does_not`,
  `invalid_guidance_retains_valid_facts`, `backend_factual_surfaces_ignore_reply`,
  `stale_old_preview_and_duplicate_confirmation_preserve_one_transaction`.
  Observe actual decision kind, revision/hash, selected text and transaction
  counts; malformed advisory kind/field/text cannot mutate or block valid facts.
  Controls remain exact whole utterances, not model labels; uncertain delivery
  cannot create SENT proof; first-in-flight/no-draft abandon stays truthful.
  For removed legacy labels, test the semantic merge interface's independence
  using separately supplied quarantined advisory metadata (AMBIGUOUS/UNCERTAIN,
  wrong EDIT/NEW/ABANDON), never insert removed keys into an accepted V3 wire.
  A1/A5 additionally assert actual extra root dialogueAct/continuation in V3
  fail unknown-root validation; no stripping, legacy decode or provider fallback.
  Those wire rejections preserve prior context, not an allegedly accepted patch.
- [ ] Run `pnpm exec vitest run src/modules/conversation/context-contract/guidance.test.ts src/modules/conversation/context-contract/decisions.test.ts src/modules/conversation/context-contract/responses.test.ts src/modules/conversation/context-contract/confirmation.test.ts src/modules/conversation/context-contract/transition.integration.test.ts src/modules/conversation/context-contract/infrastructure/d1/store.integration.test.ts`.
- [ ] Map NEEDS_REPLACEMENT to scoped REPLACE_PENDING, CLARIFY_OPERATION to a
  real operation question/RESUME_PENDING when applicable, never terminal semantic
  rejection of grounded intent. NEW staging keeps A untouched until its bound
  approval; then issue a distinct SAVE_PREVIEW. Apply REPLACE updates before
  computing new preview and invalidate old decision. Unsupported YEARLY still
  asks explicit one-time acceptance; exact cancellation fences delayed edits.
  Remove model ABANDON special routing. Fallback selects actual backend issue;
  no directive/prose can choose missing facts, query admission or confirmation.
- [ ] Rerun focused command, `pnpm typecheck`, `git diff --check`.
- [ ] Review A3+A4 once for source/evidence/merge semantics and all control,
  notes-loss, conflict, replacement and transaction safety. Fix findings with
  scoped RED/GREEN; accept Critical0/Important0 before next bundle.
- [ ] Selectively commit A4 files as
  `feat(conversation): compute decisions independently of model guidance`.

### A5 — Actual service/gateway switch and cumulative admission binding

**Depends:** A3+A4 accepted. **Files:** modify C `contracts.ts`, `wire.ts`,
`prompt.ts`, `context.ts`, `service.ts`, `state.ts`, `runtime-store.ts`,
`store.ts`, `observability.ts`, `downstream.ts`, `validation-diagnostics.ts`,
O `context-provider-wire.ts`, `semantic-gateway.ts`, `failure-diagnostics.ts`,
`tools/benchmark/context-schema-diagnostics.ts`; corresponding existing tests,
C `service.test.ts`, `protocol-metadata-service.test.ts`, `observability.test.ts`,
`downstream.test.ts`; O `semantic-gateway.test.ts`, `failure-diagnostics.test.ts`;
`tools/benchmark/context-schema-diagnostics.test.ts`.

**Interfaces:** switch public generic aliases to V3/V2; existing
`createContextContractGateway(config, transport, admission)` returns
`SemanticGateway<ParsedInterpretationV3, ContextInputV2>` and requires a selected
`ContextProtocolV3` in its application configuration. The serializer emits the
V3 generation transport on offline and real transport paths; fake fixtures
also cross encode/decode/canonical validation. `createContextContractService`
uses V3 validation/merge/transition and protocol3 attempt/event digests. Keep
legacy *read-only* codec isolated; remove superseded interpretation functions
after every consumer migrates, without touching deployed legacy Conversation V2.
Diagnostics admission consumes a named owner-authorized cap record with hash
and prior cumulative retained amount, never a model/runtime-env arbitrary cap.

- [ ] RED `every_gateway_path_uses_same_authority_wire`,
  `one_dispatch_no_guidance_retry`, `service_metadata_bound_by_application`,
  `new_protocol_digest_invalidates_old_attempt`, `wrong_model_version_has_no_authority`,
  `service_read_requires_verified_range_not_directive`,
  `family2_is_not_protocol_selection`, `diagnostic_cap_uses_authorization_provenance`,
  `new_source_retains_all_unknown_reservations`. Inject invalid outer/core,
  valid core plus invalid guidance, wrong scope/capability/receipt and all old
  T11 failure classes through real service with fake transport. Reserved holds
  survive timeout/no-cost settlement/restart; no retry or second wording call.
- [ ] Run `pnpm exec vitest run src/modules/conversation/context-contract/service.test.ts src/modules/conversation/context-contract/protocol-metadata-service.test.ts src/modules/conversation/context-contract/observability.test.ts src/modules/conversation/context-contract/downstream.test.ts src/modules/intelligence/infrastructure/openrouter/semantic-gateway.test.ts src/modules/intelligence/infrastructure/openrouter/failure-diagnostics.test.ts tools/benchmark/context-schema-diagnostics.test.ts`.
- [ ] Switch dormant consumers together; update prompt3 only to teach semantic
  CURRENT/NEW/UNRESOLVED and SET/REPLACE/CLEAR/evidence, four advisory kinds and
  application metadata omission. Do not tune to R02 wording or change model/
  provider. Update all schema/prompt/input/state/wire/codebook observation and
  binding defaults, categorical diagnostics and source-freeze paths. No schema
  version is chosen by provider text. Preserve bounds/secret/control sanitization.
  Reconcile generic250000 diagnostic constant with authorized300000 through
  explicit cap provenance; never reset historical retained debt or borrow PILOT.
- [ ] Rerun focused/shared regression commands, `pnpm typecheck`,
  `pnpm exec eslint src/modules/conversation/context-contract src/modules/intelligence/infrastructure/openrouter tools/benchmark/context-schema-diagnostics.ts tools/benchmark/context-schema-diagnostics.test.ts`
  and `git diff --check`; actual composition stays dormant, no Worker
  configuration/provider dispatch is changed by local integration.
- [ ] Selectively commit A5 files as
  `feat(conversation): bind consolidated authority through service and gateway`.

### A6 — Complete acceptance mapping, envelope proof and resumption gates

**Depends:** A5 local green. **Files:** modify `tools/benchmark/context-contract.ts`,
`context-contract-fixtures.ts`, `context-contract.test.ts`,
`context-contract-fit.test.ts`, `context-contract-probe.ts`,
`context-contract-runner.ts`, `context-contract-runner.test.ts`,
`context-contract-live.ts`, `context-contract-live.test.ts`,
`run-context-contract-r01-replay.mjs` only where protocol/preflight consumers
require; C benchmark `regressions.json`, `development.json`, `heldout.json`
only for schema-dependent structured setup, never user wording/oracles;
documentation `docs/benchmarks/llm-context-contract-{fit,results}.md`, local
measurement JSON and tracked progress/review reports. Verify each existing test
path before execution; no provider CLI is run as an offline check.

**Interfaces:** retain actual-service `createContextContractProbe`, manifest
scorer and existing runner signatures with V3 input/proposal/result types.
`preflightContextCampaign`, sourceFreeze and authorized intent admission bind
new protocol/schema/prompt/source/corpus digests and actual cumulative ledger
hashes. `verifyPilotPrefix` rejects the old source's R01 prefix for this amendment;
no new compatibility whitelist hides semantic changes. A fresh candidate starts
R01 then R02 while retaining financial history. Add source-bound complexity
measurements to existing fit artifact, not a parallel mock acceptance engine.

- [ ] RED `all_R01_R16_keep_original_words_and_oracles`,
  `semantic_change_invalidates_prefix`, `whole_service_I1_I10_authority_controls`,
  `wire_complexity_before_after_is_source_bound`,
  `fresh_run_cannot_reset_budget_or_unknown_reservations`,
  `revised_heldout_data_requires_replacement`. Registry test walks every branch
  in actual generation/canonical JSON schemas; I1/I2/I5/I6/I7/I8 additionally
  observe actual state/read/write/reply effects, not only registry labels.
- [ ] Run `pnpm exec vitest run tools/benchmark/context-contract.test.ts tools/benchmark/context-contract-fit.test.ts tools/benchmark/context-contract-runner.test.ts tools/benchmark/context-contract-live.test.ts src/modules/conversation/context-contract/output-authority.test.ts` with fake/blocked transport and isolated synthetic stores. No live command.
- [ ] Adapt declarative outputs: first new request NEW, follow-ups CURRENT,
  genuine corrections REPLACE, ambiguous D07 UNRESOLVED, null advisory for
  backend-only surfaces. Preserve original scripts, all fields/revisions/TTL,
  zero-mutation/read authority oracles, delayed replay/actions and five R15
  deterministic expansions. Scorer observes actual selected service behavior;
  safe fallback never launders full-output failure as schema PASS.
- [ ] Measure baseline wire9 versus successor10 from immutable schema artifacts
  (use `git show 899b1f25f38d4d4afcd7429ffbb10c91851c25e3:<path>` for baseline,
  do not switch checkout). Record each schema/canonical/request digest, bytes,
  object/array nesting, branch/discriminator count, finite-enum count and largest
  domain, required field/padding counts, definitions/$refs and exact serialized
  ordinary/worst accepted outputs. Record baseline/target input/output/snapshot
  tokens/bytes with method provenance. Assert removed root fields/kinds/constants
  and fewer redundant branch conditions; report increases caused by explicit
  instruction evidence rather than asserting smaller by definition. All original
  12000/1536/32768/16384 limits and no-detail-loss ordinary flows must pass.
  Google full-route/schema admission remains separately measured, not implied
  by offline complexity counts. No finite enum/domain/codebook weakening.
  The freshly inspected baseline wire9 has12057 serialized UTF-8 bytes,
  nine root model keys,337 recursive object/array nodes,49 summed anyOf/oneOf
  branches,22 enum arrays and100 enum values, maximum object/array depth11.
  These count all schema object/array nodes including metadata arrays and are
  not Google's private state count. Reproduce baseline and successor with the
  same algorithm in Vitest compilation, which supports TypeScript parameter
  properties; direct Node strip-only imports of the module are not sufficient.
- [ ] Read applicable Cloudflare Workers/Wrangler guidance and inspect the
  canonical scripts, then run a fresh complete `pnpm check`, followed by
  `git diff --check`, with provider transport blocked. `pnpm check` includes
  full tests, documentation test, typecheck, lint, build, Worker type check and
  local deploy dry-run; dry-run is not deployment. Record exact immutable source,
  counts/skips and exit status; do not reuse earlier partial runs.
- [ ] Review A5+A6 once for actual-path observations, all invariants and corpus/
  fit/source/budget fidelity. Accept Critical0/Important0; selectively commit
  `test(conversation): verify consolidated authority and frozen acceptance`.
- [ ] Perform whole-amendment independent review after local full checks;
  fix only scoped findings using RED/GREEN, rerun affected/full checks when
  justified by the change, and record immutable final candidate. Do not enter
  live admission on a partial/review-pending candidate.

### R01–R16, invariants and T11 failure traceability

| Original case | Tasks / exact preserved obligation |
| --- | --- |
| R01 | A1/A3/A5/A6: generic LIST clarification then verified current-month query; invalid range no read; advisory cannot veto inheritance |
| R02 | A3/A4/A5/A6: exam/location/event/count2 retained; BEFORE_EVENT then only time missing; Oct9/10 08:00 preview/no commit |
| R03 | A3/A4/A6: actual fixture has time/count/event already; relation answer completes preview, no escape menu |
| R04 | A3/A6: separate reset branches ONCE/offset2 versus DAILY/count2; eventTime distinct from reminderTime |
| R05 | A2/A4/A5/A6: exact Bỏ cancels only bound pending; next NEW works, no canonical cancellation |
| R06 | A3/A4/A6: negated cancellation preserves facts, quoted note remains notes; destructive notes requires REPLACE/CLEAR current source |
| R07 | A2/A3/A4/A6: CURRENT REPLACE09:00 preserves title/location/notes/count; revision/preview invalidation |
| R08 | A3/A4/A5/A6: mixed yes+time correction never proof; new09:00 preview needs fresh bound confirmation |
| R09 | A3/A4/A6: actual receipt-date lunar conversion, backend query facts, no capability-help misrouting |
| R10 | A3/A4/A6: YEARLY unsupported, explicit alternative approval separate from replacement and save, no downgrade |
| R11 | A2/A3/A4/A6: side query keeps reminder facts/version/TTL; CURRENT resume truthful, unresolved target clarifies |
| R12 | A2/A3/A5/A6: original Sep28 receipt anchors tomorrow; replay no dispatch or mutation |
| R13 | A2/A4/A5/A6: persisted cancellation/ordering defeats delayed edit; separate first-in-flight limitation |
| R14 | A2/A4/A5/A6: current SAVE proof only; one transaction/child lineage; replay/read-back no duplicate send promise |
| R15 | A1/A3/A5/A6: five deterministic failures remain explicit and distinct; actual TIMEOUT injection unchanged; isolated advisory-invalid case separate |
| R16 | A3/A4/A6: shared lunar/solar converter and UI vector parity, no model arithmetic |

I1/I2/I5/I6/I7/I8: A3/A4/A5/A6 actual-service controls. I3: A1/A2/A5
metadata/ciphertext/protocol tests. I4/I9: A1/A3/A5 strict core/evidence and
decode parity. I10: A1/A6 exhaustive nonoverlapping registry/schema walk.
CO-A–F, D01–D10 and mandatory closure cases retain their original obligations;
fresh labels alone cannot count as semantic proof. No acceptance expectation
is weakened or held-out data used for tuning without replacement.

| Discovered T11 class | Preventing task / observation |
| --- | --- |
| Model schemaVersion/protocol choice | A1/A2/A5 omitted generation tags, application descriptor, wrong-version rejection |
| Inactive padding changes canonical state | A1/A5 exact active decode, discarded known padding, unknown-root/active errors fail |
| Large finite enum/schema-state explosion | A1/A6 fewer redundant kinds/control domains, measured branch/domain bytes, separate real-route gate |
| Wire/canonical finite-domain drift | A1/A6 16-code registry/parity, unsupported code/alternative fail before merge |
| Unsupported LIST range authority | A3/A5 scoped source verifier, period-null clarify, zero read; mandatory fabricated refs hardreject |
| Advisory ambiguity terminal rejection | A3/A4/A5 backend clarification from semantic uncertainty, retained facts even without prior draft |
| Advisory continuation terminal rejection | A1 removes label; A3/A4 scoped semantic target and pending state own continuity |
| Field only exists because canonical contains it | A1/A6 registry reason and transport projection excludes versions/statusScope/backend-only kinds |
| Prefix reuse hides material semantic change | A6 new source-bound R01/R02, old evidence retained only historically |

### Resume sequence and financial/release gates (future, not executed)

Local full PASS → whole-amendment review PASS → immutable candidate freeze →
material wire10 route/schema admission → R01 → R02 → remaining frozen pilot →
pilot acceptance → separately admitted full → separately authorized release.
The first production-shaped R01 semantic call can be its route canary and
counts once as case1; do not add a sacrificial debug/calibration request.
R01 historical PASS is not reusable acceptance under the changed semantics.

Read-only financial audit supplied at planning checkpoint:

| Account | Authorized microunits | Retained microunits | Unknown holds included in retained | Remaining |
| --- | --- | --- | --- | --- |
| PILOT | 1500000 | 1060966 | 1054720 | 439034 |
| DIAGNOSTIC | 300000 | 269424 | 267181 | 30576 |
| FULL | 1000000 | 0 | 0 | 1000000 |

These are inspected historical charges/holds, not new spending. Before any
future dispatch recompute every relevant append-only ledger hash chain, cap
authority/source/config/corpus bindings, dispatched/settled/unknown reservations
and remaining balance. New run/source cannot reset them; no account borrowing
or optimistic release of unknown holds. At current105472 production-shaped
reservation, PILOT remainder fits only four such reservations; this does not
prove the full revised pilot fits. Diagnostics remainder is less than that
reservation and is not production inference authority. Determine actual worst
case for its specifically authorized diagnostic operation before admitting it;
otherwise report budget block. FULL stays untouched until pilot PASS and its
own current authorization/admission. Stop before exceeding cost/calls/deadline;
no automatic cap increase or repeated T11 compatibility spending.

Preserve original 32/80 executions, 192/480 call caps, 20/45-minute deadlines,
retries0/no fallback, safety/mandatory failure stops and cumulative authorization.
Official current price/route/ZDR/structured-schema metadata and isolated
non-production credentials must be reverified before dispatch. Do not print
secrets or use production authority in synthetic tests. A route failure stops
before R02; an R01 failure stops before R02; R02 failure stops remaining pilot;
pilot failure blocks full; full failure blocks release. New artifacts bind
source, wire10/canonical3/prompt3/input2/state2, decoder/codebook1, scorer and
all observed application outputs. Historical wire9 and ledgers remain immutable.

Only after full live PASS may a separately authorized release reconcile
quiescence/drain or explicit legacy pending expiry/restart, compatible immutable
rollback, exact-head CI and reviewed master SHA, resource/migration preflight,
remote mutations and upload-once/promotion of that exact Worker version. No
numeric-family migration or activation is hidden in A1–A6. Worker rollback does
not undo D1 or confirmed reminders; old reader cannot confirm successor data.
After authorized release, fresh deployed read-back and controlled channel/UI
acceptance remain distinct from offline/live-model gates.

Future release execution checklist, only after full PASS and applicable owner
authorization; none of these operations is authorized by this planning turn:

- [ ] Run fresh read-only Git/runtime/security/resource preflight and migration review.
- [ ] Apply only separately authorized pending migrations if required; verify state and forward-only rollback compatibility.
- [ ] Push the reviewed feature normally and create its canonical feature-to-master PR.
- [ ] Require all required remote CI checks to pass, then merge normally.
- [ ] Record immutable resulting master SHA and obtain exact-master-SHA deployment authorization.
- [ ] Record active rollback version, upload once from that master SHA, and promote that exact immutable Worker version.
- [ ] Verify deployed infrastructure/configuration read-back and controlled production channel/UI UAT before declaring release readiness.

### Planning self-review and stop

Coverage: S §4.6.1–2→A1/A2; §4.6.3→A3/A4; §4.6.4→A4/A5;
§4.6.5→A1/A5/A6; §4.6.6–7→A6; §4.6.8→A2/A5/release gates.
Interfaces are owned above; no unspecified rename, new approval question or
general-language backend classifier is needed. Concrete schema choice preserves
unique semantic edit/target meaning and omits all advisory/control catchalls.
No task has executed in this planning turn; named RED/GREEN commands are future
implementation instructions. Do not mark A1–A6 accepted from static plan checks.

NEXT_GATE=OWNER_REVIEW_OF_AUTHORITY_IMPLEMENTATION_PLAN.
Stop after the local documentation commit. No runtime source/executable test
change, LLM provider call, migration, push, PR, merge or deploy in this turn.
