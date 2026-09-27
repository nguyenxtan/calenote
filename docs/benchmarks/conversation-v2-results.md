# Conversation V2 evaluation evidence

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
