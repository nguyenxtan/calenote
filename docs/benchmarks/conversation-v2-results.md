# Conversation V2 offline acceptance — 2026-09-26

Status: **OFFLINE_PASS / LIVE_MODEL_NOT_EVALUATED / NOT_DEPLOYED**.
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
privacy/ZDR, no fallback. Before inference, approve a **new** V2 live profile,
corpus, metrics, maximum requests, cost ceiling and retry policy. This offline
profile supplies no live transport and consumes no historical authorization.
Then evaluate actual semantic/dialogue output through the backend and test
real Zalo timing separately. Keep the capability disabled until accepted.
