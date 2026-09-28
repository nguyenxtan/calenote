# Conversation V2 evaluation evidence

## Latest boundary verification — 2026-09-28: FAIL / UAT ACTIVATION BLOCKED

Run `conversation-v2-boundary-verification-20260928-01`, source
`f290a24de8155cdb508de3094e5cbfa843d8e2c5`, evaluated the unchanged synthetic
22-case / 37-turn corpus through the actual gateway, service and encrypted
ephemeral local D1. All 37 turns executed, including the local-only greeting.
Eligibility was refreshed at `2026-09-28T01:21:46.668Z`: Gemini 2.5 Flash Lite,
`google-vertex/eu`, ZDR, strict output, no fallback or retries. Input/output
prices remained USD 0.10 / 0.40 per million tokens.

| Gate | Observed | Required |
| --- | --- | --- |
| Correct final outcomes | 32/37 | At least 36/37 |
| Schema validity | 36/36 model calls | 100% |
| Temporal evidence | 37/37 | 100% |
| Turns failing safety gates | 3 | 0 |
| Premature canonical reminder mutation | 0 observed | 0 |
| Provider-reported cost, rounded up per call | 4420 microunits / USD 0.004420 | Within allocation |
| Retained dispatch reservations | 46908 microunits | At most 500000 |

Residual failures (safe labels only):

- `abandon-pending`, turn 2: model HELP/ABANDON but continuation NO. The backend
  requires YES in addition to its explicit-abandonment evidence, so it asks
  clarification rather than closing the pending context. Categories:
  DIALOGUE, RUNTIME_OUTCOME, STATE.
- `ambiguous-abandonment`, turn 2: model CREATE/RESOLVED/CONTINUE/YES causes
  missing-field clarification rather than intent clarification. DIALOGUE.
- `read-only-list-suspends-context`, turn 2: model CREATE/CONTINUE/YES routes a
  list question into creation reconciliation and changes pending context.
  DIALOGUE, RUNTIME_OUTCOME, PRESERVATION.
- `ambiguous-title`, turn 1: model marks title RESOLVED, leading to a draft
  instead of clarification. DIALOGUE, RUNTIME_OUTCOME, STATE. This is an
  incorrect draft, not an observed canonical reminder mutation.
- `uncertain-intent`, turn 1: model CREATE/MISSING/NEW_REQUEST/NO asks for a
  title instead of clarifying intent. DIALOGUE.

The earlier calendar-reset and schema failures did not recur. Structural wire
validity does not prove semantic intent/title/continuation correctness; remaining
failures must not be hidden by changing corpus expectations or acceptance gates.
No alternate model or additional live run was attempted after this failure.

Sealed ledger:
`<shared-git-dir>/calenote-benchmark-authorizations/conversation-v2-live-20260927-repair-boundary-verification/authorization.jsonl`.
SHA-256: `2810b044607f2250cfcf9fe99ed8af10c8592eded1d5830eb802e5bfea3d3ad7`.
Cumulative seven-campaign reported cost is USD 0.014005; conservative retained
reservations total 171996 microunits, below the aggregate USD 2 ceiling.

Pre-run gates: 16/16 runner tests, full check 96 files / 1818 tests, typecheck,
build, Worker types, dry-run and diff check PASS; allocation review Critical 0 /
Important 0 / Minor 0. These local results do not override the failed live gate.
No remote D1 changes, secrets, master merge, Worker upload or deployment.

## Post-failure boundary repair — 2026-09-27: OFFLINE PASS / LIVE NOT RE-EVALUATED

The repair after `351ad01` addresses the three failures below without altering
the frozen corpus, expected outcomes, scoring comparisons, budget, provider or
fallback policy. Historical failed runs remain authoritative live evidence.

- Shared application turn evaluation checks standalone Gregorian temporal
  evidence before inheriting a pending calendar. A complete reminder clause
  with a grounded task/date/time can establish an independent request even
  when the model incorrectly suggests CONTINUE. EDIT/AMBIGUOUS cannot gain this
  reset authority; incomplete fragments still reconcile against pending facts.
- ABANDON requires positive whole-utterance pending-request cancellation
  evidence, not just model confidence. Ambiguous, negated, quoted or conditional
  wording clarifies intent. Pending unresolved fields are retained behind that
  question, including lunar year/leap-month state, so later answers can resume.
- Every emitted schema branch includes the complete object and title/null/
  target-intent consistency constraints, including nonblank resolved titles.
  Prompt version 4 removes repeated instructions to fit the unchanged 12000
  input bound; no input/output or monetary cap was raised.
- Runtime, offline evaluation and live diagnostic projection now share the
  same turn boundary. The scorer file changes only orchestration, not its
  comparisons or acceptance thresholds; future runs have new provenance.

RED evidence: wire schema accepted a null RESOLVED title; wrongly continued
new requests either rejected or selected lunar dates; confident ABANDON cancelled
ambiguous/negated/conditional requests. Review additionally exposed unconfirmed
prefixed edits becoming resets and intent clarification erasing unresolved lunar
fields; both were reproduced RED and corrected before fresh verification.

Fresh gates: focused **181/181**, full **96 files / 1816 tests**, separate
typecheck, build, lint (zero errors; 146 existing generated-artifact warnings),
Worker type check, dry-run and diff check PASS. Independent final review:
Critical 0 / Important 0 / Minor 0. Real local D1 tests verify preserved encrypted
context, Gregorian draft timestamp, no pre-confirmation canonical write and
exactly-one reminder after confirmation/replay. Mock corpus remains 37/37 and
is explicitly not live acceptance.

No new inference slot, live call, remote D1 operation, master merge or deployment
was performed for this repair. The last live result below remains FAIL;
UAT activation stays blocked pending a newly authorized bounded live evaluation.

## Latest semantic verification — 2026-09-27: FAIL / UAT ACTIVATION BLOCKED

Run `conversation-v2-semantic-verification-20260927-final-01`, source
`93e436f67dcba45b309622a185300d85ab9e545c`, evaluated the unchanged synthetic
corpus/scorer with prompt `conversation-v2-semantic-dialogue-3`. The real gateway,
service and encrypted local D1 path were exercised; no remote D1 or Zalo sends.
Route eligibility was refreshed at `2026-09-27T09:44:04.946Z`: Gemini 2.5 Flash
Lite, `google-vertex/eu`, ZDR, no fallback, zero retries.

| Gate | Observed | Required |
| --- | --- | --- |
| Correct final outcomes | 28/37; 31 executed, 6 not run after schema failure | At least 36/37 |
| Schema validity | 29/30 model calls | 100% |
| Temporal evidence | 30/31 executed turns | 37/37 |
| Safety-category failures | 3 | 0 |
| Premature canonical reminder mutation | 0 observed | 0 |
| Provider-reported cost, rounded up per call | 4535 microunits / USD 0.004535 | Within allocation |
| Conservative retained reservation | 39090 microunits | At most 500000 |
| Live accepted / deployment authorized | NO / NO | — |

Safe diagnostic evidence narrows three remaining boundaries:

1. `new-request-resets-calendar`, turn 2: the model returned CONTINUE/YES
   instead of identifying a new request. The service rejected the request;
   persisted calendar/date/time differed from the expected independent request.
   This is context-relation classification, not evidence that the temporal
   scanner independently failed or that the model calculated a date.
2. `ambiguous-abandonment`, turn 2: HELP/ABANDON/YES caused CANCELLED rather
   than clarification. A schema-valid relationship suggestion still allowed
   an ambiguous user closure to cancel pending context.
3. `ambiguous-title`, turn 1: the gateway rejected a `titleState/custom`
   refinement violation. No raw values were retained, so the exact field-value
   combination is unknown. Six remaining turns were not run. Existing title
   cross-field refinements are runtime-validated, not fully encoded in the wire
   schema; prompt guidance has not proved sufficient.

The urgent-exam three-turn series, date/time completion, lunar year/leap flows,
explicit abandonment, missing-title clarification and read-only LIST passed in
this run. These partial successes do not accept the whole V2 release. Safety
counts include failed state expectations, not three canonical reminder writes.

Before inference: focused 92/92; full `pnpm check` 95 files / 1784 tests;
typecheck, build, Worker types/dry-run and diff check PASS. Lint: zero errors,
146 pre-existing generated-artifact warnings. Independent repair review:
Critical 0 / Important 0; this is not a live-quality acceptance verdict.

Ledger: `<shared-git-dir>/calenote-benchmark-authorizations/conversation-v2-live-20260927-repair-semantic-verification/authorization.jsonl`.
SHA-256: `971852d0839e44af571ceb4efeb5fd9e4734518178f02caab7be86cbce66fa57`.
Provenance digests: prompt `5e9dfd72ef47f541eba746f5b33fb92c614a747e4bb06071e6934c43c8cd9832`,
schema `5483488e6c70cab31a551705e6a1fc2ea7ba66f85e6327b3c8a4cc02abdbc698`,
reconciliation `be1783ca434570f8cfd784ffc9166642757524a4b4193796970118f24347a01b`,
runtime `71a90968073f5e121a233cb1d506c35cbb1350571ea82e07fd1445d82a91ec92`,
runner `e381c9f0d38ffd360efa4065464c6d5ad2a3e94091b81817db4476874cd3d3ce`.

Both newly authorized semantic slots are now closed. Across all six campaigns,
provider-reported cost is 9585 microunits (USD 0.009585); retained reservations
total 125088 microunits. The USD 2 ceiling is unchanged, but unspent money is
not an unused campaign slot. Stop inference and UAT activation at this failed
gate; do not recycle ledgers, change scoring or silently choose another model.
No production secrets, migrations, master merge or Worker deployment changed.

## Semantic diagnostic before repair — 2026-09-27: FAIL

Run `conversation-v2-semantic-diagnostic-20260927-1522-01`, source
`3de9aabd585a342fb7126b667aba1d384789747a`: 11 requests, 10/11 executed
outcomes correct, schema 10/11, temporal 11/11; 26 turns not run. Failure:
`lunar-leap-completion` turn 1, `dialogueAct/custom`,
`CAPABILITY_ACT_MISMATCH`. Earlier schema success was not permanent proof.
Safe enum diagnostics also showed CONTINUE/YES on initial requests without
context. No raw model text, titles or private identifiers were retained.
Cost: 862 microunits; retained reservation: 14333 microunits.
Ledger: `<shared-git-dir>/calenote-benchmark-authorizations/conversation-v2-live-20260927-repair-semantic-diagnostic/authorization.jsonl`.
SHA-256: `b0353ad0a9cb968a370e26567961832b62b0d641d4e25fb355f8655354760978`.

## Historical live verification — 2026-09-27: FAIL / UAT ACTIVATION BLOCKED

Run `conversation-v2-verification-20260927-1240-01`, source
`cea6773bac445b98d721a79510584d217840ec55`, completed all 37 synthetic turns
through the real gateway/service and encrypted local D1 stores. Endpoint
eligibility was refreshed at `2026-09-27T06:13:01.362Z`: Gemini 2.5 Flash Lite,
`google-vertex/eu`, ZDR, no fallback, zero retries. Corpus and scorer unchanged.

| Gate | Observed | Required |
| --- | --- | --- |
| Correct final outcomes | 28/37 | At least 36/37 |
| Schema validity | 36/36 model calls | 100% |
| Temporal evidence | 36/37 | 37/37 |
| Safety-category failures | 7 | 0 |
| Premature canonical reminder mutation | 0 observed | 0 |
| Provider-reported cost, rounded up per call | 2798 microunits / USD 0.002798 | Within allocation |
| Conservative retained reservation | 46908 microunits | At most 500000 |
| Live accepted / deployment authorized | NO / NO | — |

The self-contained schema passed every model response in this run. This does
not make the end-to-end conversation correct. Exact residual boundaries:

| Case / turn | Failed categories |
| --- | --- |
| complete-one-off / 1 | REQUEST |
| lunar-year-completion / 2 | REQUEST |
| new-request-resets-calendar / 2 | TEMPORAL, DIALOGUE, RUNTIME_OUTCOME, STATE, REQUEST, DRAFT_PERSISTENCE |
| abandon-pending / 2 | DIALOGUE, RUNTIME_OUTCOME, STATE |
| ambiguous-abandonment / 2 | DIALOGUE |
| missing-title / 1 | DIALOGUE, RUNTIME_OUTCOME, STATE |
| ambiguous-title / 1 | DIALOGUE, RUNTIME_OUTCOME, STATE |
| uncertain-intent / 1 | DIALOGUE |
| unsupported-not-mutating / 1 | DIALOGUE, RUNTIME_OUTCOME, STATE, PRESERVATION |

In the missing/ambiguous-title cases the service created a **draft** instead
of clarifying; no canonical reminder was created. Explicit abandonment asked
another clarification instead of cancelling. A new request did not produce the
expected independent Gregorian draft. REQUEST mismatch reports alone cannot
identify which field differed or distinguish harmless title paraphrase from a
material change; raw model outputs were intentionally not retained. Do not
retroactively loosen these comparisons or claim an exact model-value root cause.
Safety-category totals include mismatched request/state/preservation, not seven
unauthorized reminders. The urgent-exam three-turn series passed unchanged.

All four exclusive campaign slots are now consumed. Cumulative provider cost:
4188 microunits = USD 0.004188; retained reservations: 71665 microunits.
The aggregate hard allocation remains USD 2. Do not delete/reuse ledgers or
dispatch additional inference merely because actual usage was below allocation.
Continue only offline diagnosis until an explicitly bounded new evaluation is
authorized. No production D1, secret, master or Worker deployment was changed.

Ledger: `<shared-git-dir>/calenote-benchmark-authorizations/conversation-v2-live-20260927-repair-verification/authorization.jsonl`.
SHA-256: `365bf3e8d157a384f4b6beb666c43be9f88859c2aea40f9288ebc01c9db3242c`.
Provenance digests: prompt `24d0107315a2ae190b3ff6cf26beb633fdfd9b40b82abe42e0dcef1120a3ee4d`,
schema `5483488e6c70cab31a551705e6a1fc2ea7ba66f85e6327b3c8a4cc02abdbc698`,
runtime `7c74d30557d7c31d7987ffcd9c8359d738f0dc37ea9554450281eeeb3a602782`,
runner `eb5d8a148823315684c5a3485534704e794410343d545b1faa876cb6bc0777ea`.

Pre-inference gates: focused 45/45; full `pnpm check` 95 files / 1773 tests;
typecheck/build/Worker types/dry-run/diff check PASS. Lint had zero errors and
146 existing generated-artifact warnings. Independent code review: Critical 0,
Important 0. These local gates did not substitute for live acceptance.

## First repair attempt — 2026-09-27: FAIL

Run `conversation-v2-repair-20260927-1126-01` at `cbd47d7a5e344e528c1f60f098b9cfded738e261`
stopped after one request: `complete-one-off` returned `SCHEMA_INVALID`.
Safe diagnostics: `title/invalid_type` and `invalid_value` for titleState,
targetIntent, dialogueAct, continuation and capability. No values were retained.
0/1 executed outcomes passed, schema 0/1, temporal evidence 1/1, one STATE
safety category, 36 turns not run; zero canonical reminders created.
Cost: 53 microunits; reservation: 1303 microunits. Cumulative actual cost across
three campaigns: USD 0.001390. No deployment or production mutation occurred.

The next correction makes each schema union branch independently complete:
all seven properties, required fields and strict extra-property rejection.
This preserves the standard JSON Schema accepted-value set. It removes reliance
on provider handling of sibling constraints around unions, but the safe failure
evidence alone does **not** prove provider schema lowering caused the failure.
Provider compatibility and quality still require the final verification slot.

Repair ledger SHA-256:
`97b37190976995ffdfdc6c03f8788ec76c6e2ad3a3dbf6a4ca53a05b4cc4a2e0`.
Location: `<shared-git-dir>/calenote-benchmark-authorizations/conversation-v2-live-20260927-repair-repair/authorization.jsonl`.

## Diagnostic reproduction and repair — 2026-09-27

Run `conversation-v2-diagnostic-20260927-1044-01` at `e6a2d91` reproduced
the original failure on request 9 (`lunar-year-completion`, turn 1). Safe
diagnostics recorded only `dialogueAct/custom` and `CAPABILITY_ACT_MISMATCH`:
the capability flag and dialogue act violated the backend's cross-field rule.
No raw response, user text, credential or arbitrary model field was retained.

Root cause: Zod's runtime `superRefine` constraints were not represented in
the JSON schema sent to the provider. The correction adds structural `anyOf`
dialogue/capability/HELP constraints to that same strict wire schema, retains
the runtime rejection, and clarifies that a lunar reminder instruction is not
a lunar-support question. Scheduling and calendar authority remain backend-only.
The new regression exhausts dialogue/capability/intent combinations against
both the emitted schema and the runtime validator. Other title refinements
remain backend-validated and prompt-defined; this is not a claim that arbitrary
Zod refinements serialize automatically.

Diagnostic result: 8/9 executed turns correct; 28 not run after failure;
schema 8/9; one STATE safety category; zero canonical reminder mutations.
Provider-reported cost rounded up per call: 659 microunits; retained reservation
11727 microunits. Cumulative original + diagnostic actual cost: USD 0.001337.
Aggregate authorized ceiling is USD 2 including the original run, enforced by
the four fixed campaign slots in the live profile. This diagnostic is not live
acceptance of the correction and does not authorize deployment.

Diagnostic ledger SHA-256:
`78b96130079e97f3f6b61450139d52a351f3458afda733611a79d39fc19cde42`.
Location: `<shared-git-dir>/calenote-benchmark-authorizations/conversation-v2-live-20260927-repair-diagnostic/authorization.jsonl`.
The original failed ledger below remains unchanged.

## Live evaluation — 2026-09-27: FAIL / UAT ACTIVATION BLOCKED

Run `conversation-v2-live-20260927-0953-01` used the frozen
[bounded live profile](conversation-v2-live-profile.md) at runner commit
`76a49dc1a20eddff570c190a5bd7070056a34d16`.
Model `google/gemini-2.5-flash-lite`, provider `google-vertex/eu`, ZDR,
no fallback and zero retries. Public route, structured-output support and
price caps were revalidated at `2026-09-27T02:54:10.262Z`.

| Evidence | Result |
| --- | --- |
| Authorized ceiling | USD 0.50 / 40 inference requests |
| Actual requests | 9 |
| Executed turns | 9 of 37 |
| Correct final outcomes | 8; remaining 28 NOT_RUN_AFTER_FAILURE |
| Schema validity | 8/9 attempted calls |
| Temporal evidence | 9/9 executed turns; full 37-turn gate NOT passed |
| Safety-category failures | 1 (STATE mismatch after rejected schema) |
| Provider-reported cost, rounded up per call | 678 microunits = USD 0.000678 |
| Conservative retained reservation | 11727 microunits = USD 0.011727 |
| Live acceptance / deployment authorization | NO / NO |

First failed boundary: `lunar-year-completion`, turn 1, `SCHEMA_INVALID`.
The actual gateway rejected the model result; the service returned `REJECTED`
instead of preserving the request and asking for the missing lunar year.
Downstream categories were DIALOGUE, RUNTIME_OUTCOME and STATE. There was no
premature canonical reminder mutation in any executed turn. The safety counter
records the failed expected state; it is not evidence of an unauthorized send.

Before the failure, complete one-off, time/date clarification completion, and
all three urgent-exam series turns passed. The latter persisted a proposal with
the exact three preceding dates and no canonical reminders. This is partial
evidence only, not acceptance of the remainder of the corpus.

No raw model response was logged or retained. Therefore the exact invalid field
cannot be reconstructed from this run; do not claim a prompt-vs-provider root
cause without additional safe diagnostic evidence. Do not loosen the schema or
edit expected outcomes to convert this failure into a pass.

Durable local ledger:
`<shared-git-dir>/calenote-benchmark-authorizations/conversation-v2-live-20260927/authorization.jsonl`.
SHA-256: `526f151903df51cb0a0bb863b2be94197a5026adcc95a89de70c45ca25a04cb5`.
Runner digest: `8ad45a7985756ebad44926ed31e537c10f6261ccc960ee033101e88c066fb950`.
All component digests in the historical table below remained unchanged.
Preserve this ledger; the campaign is closed, not silently resumable.

Pre-inference verification: 95 test files / 1769 tests PASS; typecheck, build,
lint (zero errors; existing generated-artifact warnings), Wrangler type check,
dry-run and diff check PASS. Independent runner review after corrections:
Critical 0 / Important 0. Actual CLI mock transport: 37/37 PASS, explicitly
not live evidence. Remote D1, secrets, master and UAT deployment were unchanged.

## Historical offline acceptance — 2026-09-26

Historical status: **OFFLINE_PASS / LIVE_MODEL_NOT_EVALUATED / NOT_DEPLOYED**.
This is not a replacement for a live Gemini evaluation. Historical Semantic V1
benchmark artifacts are unchanged and do not accept the new dialogue schema.

## Scope and evidence

Profile `conversation-v2-offline-1`, transport **MOCK**, synthetic data only.
22 scenarios / 37 turns: deterministic evidence 37/37, mocked-dialogue decisions
37/37, projected lifecycle/request/expansion checks 37/37; observed failures 0.
The model fixtures are independent semantic-only objects. Expected dates and
outcomes are literals, not computed using the implementation under test.

The corpus checks greeting plus request, capability without opt-in, Gregorian
reset, missing fields, deterministic continuation/edit/conflict/abandonment,
urgent exam series, full preceding-day expansion, lunar year/leap clarification,
malformed temporal islands, unsupported intent, and past-series rejection.
It does **not** claim to exhaust natural Vietnamese language or model accuracy.

`PROPOSE` in this pure corpus means a reconciliation decision, **not** a saved
draft or reminder. The historical lunar leap vector demonstrates conversion;
service-level future-time validation still rejects a past reminder. Every
fixture expects zero mutation because the runner has no persistence port.
That is not proof of database safety: actual canonical creation, encryption,
duplicate suppression, session/chat ownership and cancellation are tested
separately with the real local D1 stores and inbound composition.

Offline network policy: the runner imports no provider transport or credential
source; `fetch` throws `OFFLINE_NETWORK_FORBIDDEN` during corpus execution.
No live requests, account credentials or production data were used.

## Provenance

Implementation base: `4fa122036719a53f257568bd84370bfdccbdab86`.
Task 9 post-review working-tree content is bound by these SHA-256 digests, not falsely
attributed to the base commit. Recompute after any covered source change.

| Component | SHA-256 |
| --- | --- |
| corpus | `5e514ba2c1f53a4a8c06482597530a9eab361f828dc61f3fef5c1d7f6d055382` |
| canonical prompt | `c73a46d1481201ce523b4a501f4f43f7a43690f8fcb102e13ebcb03f70f06a37` |
| strict model schema | `87b6bb1dae63cd6e2671a3cc8abf33fb58d008d240d92d646fa0cca241aff27a` |
| calendar artifact file | `68e4cc28fad325ffaa56467b2b0639b6313f9f6899c497db431d21f216c59ff3` |
| reconciliation | `c274b8b76ebe619a7211ec716f7bdb2ea7293f580bbbe3b0ffa189a0cad42ee3` |
| scorer | `1a96efec63a37aee220906b9327c4b113a01b654987fcc737d4a8b67c0e92540` |
| runtime source tree | `7d6e52b4a3b1d209c3deea903ab11d65fc7fe722c55f9a32655677bc245a3625` |
| migrations tree | `03f06c154a9d937d48134b65e3523eb569a976e54b397b634329d82cf3ee8d8b` |
| canonical configuration | `c6ffbcff7bc3adf7773fe5518b9b9f0e3a7731b041256dcd645c2196d6d09fb0` |

Run the corpus/scorer/provenance tests:

```sh
pnpm exec vitest run tools/benchmark/conversation-v2.test.ts
```

The exported `runConversationCorpus` and `buildConversationProvenance` accept
only the mock profile and current repository root respectively. Results contain
case IDs, counts and failure categories, not user text or model payloads.
`liveModelAccepted` and `deploymentAuthorized` are always false.

## Local persistence and regression gates

The whole-branch release evidence in
[conversation-v2-progress.md](../implementation/conversation-v2-progress.md)
records fresh command results and the final review status. Real D1 coverage
includes all eight migrations on populated fixtures, transaction rollback,
web/Zalo concurrent confirmation, corrupt ciphertext, cross-owner isolation,
late confirmation, expired proposals and unchanged historical one-offs.

Rollback coverage runs the unchanged legacy scheduler/delivery predicates on
new series children. Cancelled children cannot be reclaimed, and claimed or
uncertain deliveries are not marked recalled. This proves local compatibility,
not a remote migration or current deployed rollback version.

## Live acceptance still required

The independent review of `cab27b6..07f2f6f` found four Important issues,
not a clean acceptance from green tests alone: unsupported cadence downgrade,
count-one event offset, transferred one-off dialogue gating, and incomplete
latency measurements. The author correction pass has dedicated failing-then-
passing service/D1/transport regressions, including transaction races and
rollback. The refreshed corpus above still passes 37/37, but does not itself
exercise every integration regression. See the execution evidence for final
whole-repository counts. No second independent review is claimed.

Same first candidate only: `google/gemini-2.5-flash-lite`, `google-vertex/eu`,
privacy/ZDR, no fallback. The subsequently authorized V2 profile was executed
on 2026-09-27 and failed as recorded above. The offline profile supplies no live
transport and does not accept that failure. Keep the capability disabled until
an independently validated correction and a separately recorded live acceptance;
real Zalo timing remains a separate user-facing verification.
