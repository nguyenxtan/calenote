# LLM Context Contract — acceptance evidence

## T11 inactive provider-wire padding policy — 2026-10-01

Owner authority `26b5a178-f64e-4be9-b917-e91d2c417aac` approves treating
known inactive padding as transport noise. After exact fixed-shape key and
discriminator checks, the decoder projects only the selected branch's active
properties. It never reads or traverses inactive values. Required inactive
keys must still be present, unknown keys still reject, and active values,
including active null semantics, remain strictly validated. This applies to
query periods, query operands, typed dates, evidence and directives everywhere
they appear, including change values. Field/operation change branches have no
inactive top-level properties; SET/CLEAR value constraints remain active.

The public wire generation schema still requires null padding and rejects
populated inactive values. Decoder admission of that noise is therefore
separate from generation-schema validity. `fullSchemaValid` describes the
projected canonical interpretation, as before. The fixed uncertainty envelope
and JSON alternatives are unchanged and have no inactive wire padding; their
complete canonical objects still undergo canonical/evidence validation.

The generic codec replaces the inactive-null rejection with discriminator
projection. The observed inactive `query.period.date.calendar` regression,
599 active-shaped inactive mutations, 438 bounded-noise equivalence cases and
73 unreadable-value cases establish 1111 inactive-padding controls. Strict
controls cover 903 malformed/missing active fields, five discriminator switches,
599 missing inactive keys and 73 unknown-key refusals. The synthetic R01 runner
also exercises noise through clarification and an authorized month read with
zero reminder mutations. These local results do not establish live acceptance.

Canonical validator, canonical prompt, wire-6 schema/version and its 11,853-byte
complexity boundary are unchanged. Schema SHA256 remains
`e6d27cd9b798b0a3e07dabd2e98f2e1502714bee00b8c91fa42758c9a927fe06`.
Independent review, full-check evidence and subsequent live/release disposition
are recorded separately; this policy amendment does not claim those gates pass.

## T11 pilot authorization amendment — 2026-10-01

Owner authority `24f2bfbf-fe14-4c5b-80ba-67f84f2a0a63` increases the PILOT
reservation ceiling to USD1.50. FULL remains USD1.00; the combined ceiling is
USD2.50. Diagnostic authority remains separate at USD0.30. These are
authorization ceilings, not observed spending.

The preserved PILOT historical exposure is 951000 microunits, including
UNKNOWN holds. The new leg may authorize only the remaining549000; a
105472 reservation fits, leaving443528 until authoritative cost settlement.
Historical ledgers and replay authorities remain immutable. No diagnostic or
FULL authority transfers into PILOT. This amendment alone does not establish
live R01, pilot, FULL, release, or production acceptance.

## T11 uncertainty state-limit isolation — 2026-10-01

Owner authority `a1a07a22-7725-4d6d-a7b0-a9bb718faedc` adds USD0.05
diagnostic-only, raising that campaign to USD0.30. At that checkpoint,
PILOT/FULL remained USD1.00
each; UNKNOWN reservations remain held and cannot transfer across campaigns.
Historical local fixture results below are not live acceptance.

The controlled minimal pair used the complete surrounding wire-5 schema:

| Probe | Schema SHA256 | Result |
| --- | --- | --- |
| alternative-empty | `0ecbbdfabf4eca079c9c1f5e15c8e2572bec3428d99832798215e4ef381db620` | HTTP200, structured output valid |
| alternative-value | `d3dee174a57326f21104ee61611da49aafcc8cb27dfeb26670a819bc3dbde7e2` | HTTP400, Schema state limit exceeded |

Sole meaningful delta: add required `value` using the already-reachable plain
string `#/$defs/__schema3` to the uncertainty alternative's empty strict object.
This adds one property, one required entry and one ref; no definitions change.
All non-schema request parameters have the same SHA256
`66481bb1cb74945802ed644c4949b8a9cd85caeb6f48f73a8dec368d5918508d`.
PASS generation: `gen-1790831102-b2I7fL4kcQSVhdwk01tv`.
FAIL safe trace: `a438ee5f88cee2e2-HKG`.
Confidence HIGH for this measured tipping delta in its surrounding schema,
not a universal incompatibility of string/ref fields or knowledge of Google's
private state count.

The complete simplified prototype uses a fixed `field/reason/alternatives`
uncertainty object: field is a string checked by the unchanged canonical enum,
reason keeps its four-value enum, and each alternative is a JSON string
encoding the complete canonical `{value,evidence}` object. The deterministic
decoder checks the envelope/count/size, parses once and submits the complete
object to the unchanged canonical validator and later evidence validator.
Invalid combinations remain hard rejection, not repair or partial acceptance.
Changes/query/directive representations and application authority are unchanged.

Prototype schema SHA256:
`e6d27cd9b798b0a3e07dabd2e98f2e1502714bee00b8c91fa42758c9a927fe06`.
HTTP200, structured-output valid; generation
`gen-1790831283-Tl9TATO2QqWZma9VZ2DB`.
Local metrics: 11,853 bytes, 163 required / zero optional properties,
19 definitions, 43 refs, 17 anyOf / zero oneOf, 49 union branches,
expanded depth11. These are regression measurements, not a provider state-limit
formula. Provider admission with an empty synthetic uncertainty array does
not prove uncertainty inference quality or application pilot acceptance.

After ten new diagnostic requests, cumulative diagnostic evidence is:
52 HTTP requests, 268271 microunits retained, 31729 remaining, 35 UNKNOWN
reservations. Six new successful requests report USD0.0000391 each
(USD0.0002346 known subtotal); four new failures have UNKNOWN cost.
Total actual spend remains UNKNOWN. Sanitized append-only artifacts are in
`.superpowers/sdd/2026-09-28-llm-context-contract-implementation/diagnostic-uncertainty-*-a1a07a22/`.
No raw provider/user content or secrets are retained there.

The wire-6 implementation matches the prototype digest. Fresh focused
verification: 30 files / 3255 tests PASS. Complete `pnpm check`: exit0,
138 files / 5242 PASS / one existing skip, architecture test PASS,
typecheck/lint/build/Worker types/dry-run PASS; lint162 warnings / zero errors.
Separate fresh typecheck and diff check PASS. One independent GPT-6.1 Sol
Medium review accepted the delta: Critical0 / Important0 / Minor0. The reviewer
independently checked every unchanged non-uncertainty schema branch, derived
adversarial controls and recomputed both campaigns' historical holds.
A subsequent diagnostic
must admit the complete committed wire before a production-shaped R01 canary.
At that checkpoint PILOT retained 951000 of 1000000 microunits, leaving49000, less than
the next production-shaped reservation105472. No borrowing from diagnostics
or FULL is authorized; no production canary may dispatch past that gate.
Production is untouched.

## Current scoped review correction — 2026-09-30

**Local fixture gates complete; same-reviewer delta acceptance pending.** The Important role-grounding finding in the owner-completion table below is corrected without production changes. R04 retains original event08 and both original count/offset requests, clarifies missing notification time, then collects explicit “Nhắc tôi lúc 8h sáng.” in each reset branch (six USER total). D06 retains event08, collects notification08 before issuing the genuine preview token, and edits only notification time to09 with that token. H29's unchanged heldout sentence retains eventDate21/10 and missing reminderDate/reminderTime. Oracles are independently hand-authored, not taken from observed output; original reports/hashes remain preserved as superseded.

| Current ordinary-service profile | Scripts | USER turns | Healthy full-schema | Raw-valid/dispatch | Complete factual assertions | Replay/race actions | Safety failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Pilot | 32/32 | 84/84 | 76/76 | 76/77 | 2043/2043 | 5/5 | 0 |
| Full | 80/80 | 158/158 | 144/144 | 144/145 | 3941/3941 | 5/5 | 0 |

All64 identities,32 heldouts,mandatory scripts,≤6 USER bound, thresholds and live caps remain unchanged; three genuine notification-clock collection turns expand real USER/call/assertion denominators. Focused21files561PASS/1skip; exact full-check output/warnings/exits and updated314-file freeze are in `task-10-owner-fix-review1-report.md` and its new fix-review1 artifacts. D02 remains16808→13588 post-binding,2796headroom (delivery13624), unchanged codec. R16 is precisely **all13 shared converter/Calendar checks and12 actual-service nonnegative-time cases**;1900-01-31 is converter/Calendar-only because production budget time rejects negative Unix time. No clock semantics changed. Real-provider/deployed Layers2/3 and T11 remain NOT_RUN; routeB UNVERIFIED. This is not live acceptance/UAT/deployment. Same-reviewer delta acceptance (`task-10-owner-fix-review1-review.md`): **T10 ACCEPTED_LOCAL, Critical0/Important0/Minor1; whole branch ACCEPTED_LOCAL, Critical0/Important0/Minor2**. Remaining nonblocking qualifiers are inherited warning debt and previously disclosed T8 coverage; no provider or release gate is waived.

## Preserved owner-completion table — superseded by scoped review correction

Current disposition (2026-09-30 owner-authorized completion): **Layer 1 complete local fixture evidence; awaiting independent review.** Required D02 now closes to authenticated preview with lossless storage v2: complete post-model-binding snapshot 16,808 → 13,588 bytes (3,220 saved, 2,796 headroom); persisted delivery snapshot 13,624. Legacy v1 read compatibility and strict corrupt/bomb/duplicate-key refusal are tested. No logical schema, provider prompt or root semantics changed. Matching eligible HELP/unsupported optional guidance is now composed while factual capability/preview/query surfaces remain backend-owned.

| Current ordinary-service profile | Scripts | USER turns | Healthy full-schema | Raw-valid/dispatch | Complete factual assertions | Replay/race actions | Safety failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Pilot | 32/32 | 82/82 | 74/74 | 74/75 | 1991/1991 | 5/5 | 0 |
| Full | 80/80 | 155/155 | 141/141 | 141/142 | 3863/3863 | 5/5 | 0 |

All 64 static factual oracles declare all slot values, occurrences, pending field, revisions/lifetimes, query range, transaction/child/send counts and preview/canonical details independently of runtime output. Canonical admission rejects sparse facts. Full includes all 32 heldouts; mandatory scenarios and thresholds are unchanged. Added actual after-midnight same-inbound replay, delayed older response rejection, same-key lost-reply redelivery and real issued mixed-control correction account for the updated counts; eligible unsupported guidance adds one development turn. Separate actual-path tests cover confirmed finite-series transaction/replay, all six guidance directives and mismatch/control/Unicode/receipt matrices, R15 five faults and R16 thirteen Calendar vectors. Scored paths never load the diagnostic measurement hook.

Focused verification: 21 files, 558 PASS/1 skip; fresh complete `pnpm check` evidence, exact warnings and source freeze are recorded in `.superpowers/sdd/2026-09-28-llm-context-contract-implementation/task-10-owner-resume-report.md`. Source base remains `a3fd106a0a1c5c2f4b1ecc9bca27f2474759abf7`; final extended file hashes are `task-10-owner-final-source-hashes.json`. These are local/mock results only, not real-model acceptance, UAT or deployment. Route B `UNVERIFIED`; Layers 2/3 and T11 `NOT_RUN`.

The historical blocked and sparse 32/80 figures below are preserved, superseded evidence, not current acceptance. Earlier D02 fit rejection and partial fixes remain in `task-10-fix1-blocked-report.md`.

## Preserved pre-review report (superseded)

Status at 2026-09-30: **Layer 1 offline fixture rehearsal PASS; Layer 2 live model NOT_RUN; Layer 3 deployed channel NOT_RUN.** This is not provider acceptance, UAT, staging, or production evidence. Route B is `UNVERIFIED`; the live CLI blocks before any credential read or network request.

## Layer 1 — isolated actual-service fixture rehearsal

The probe invokes `createContextContractService`, the real context gateway with its `OFFLINE_FIXTURE` exchange, D1 context/runtime/budget/query stores, canonical confirmation, encrypted selected-reply read-back, authenticated preview/detail API stores, and the shared Calendar converter. Only the provider exchange and outbound messaging receipt are substituted. Frozen declarative fixtures propose wire objects; the service, not a benchmark reconciler, chooses status, reply, persistence, query results, and mutation. A green result therefore proves this service path with those frozen proposals, not that a real model will propose them.

| Profile | Scripts passed/planned | Real USER turns passed/planned | Healthy full-schema | Raw-valid/dispatch | Field/detail assertions | Safety failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pilot offline | 32/32 | 80/80 | 71/71 | 71/72 | 127/127 | 0 |
| Full offline | 80/80 | 152/152 | 137/137 | 137/138 | 190/190 | 0 |

The 16 originals preserve the canonical Vietnamese text. Pilot is originals 16 plus two extra executions of each of R02/R03/R05/R06/R07/R08/R11/R13. Full adds development 16 and separately authored heldout 32, retaining those 16 repetitions. All 64 unique scripts fit in at most six real USER turns, including setup; R04 explicitly resets its two branches. Eight closure slots D01–D08 and both guidance slots D09–D10 are mandatory and passed on this fixture path. R14 includes an uncertain delivery receipt after the committed confirmation, a repeated “Có.” as a fresh inbound with zero second mutation, and authenticated detail read-back; identical provider-message-ID redelivery is covered by accepted runtime tests, not this manifest. R15 five deterministic refusal injections and R16 all 13 Calendar reference vectors are separate Layer 1 tests; the one declared R15 live-script injection is not counted as healthy schema. Invalid full-wire guidance can retain a core fact for fallback, but does not count as full-schema success.

`pnpm exec vitest run tools/benchmark/context-contract.test.ts tools/benchmark/context-contract-live.test.ts` passed 27/27. Six focused accepted-path suites passed 194/194. Typecheck and scoped lint passed. The sanitized, source-frozen full `pnpm check` exited 0; its exact combined output is in `.superpowers/sdd/2026-09-28-llm-context-contract-implementation/task-10-check-output.txt`. It performed only a Wrangler dry-run, not deployment. Repository-wide lint emitted 146 warnings and no errors.

## Layer 2 — real provider

`NOT_RUN` and all planned live denominators remain **0 observed / 32 pilot planned** and **0 observed / 80 full planned**. Neither the offline pilot nor the offline full PASS may be promoted to live acceptance. Provider route B has no verified callable transport, live authorization, or credential in this task. The CLI default and `--preflight` read zero secrets and make zero network requests; any run attempt is blocked while admission remains `UNVERIFIED`. A future-run request must explicitly enable live mode and supply a file matching source SHA, provenance, profile, run ID, expiry, and cumulative authority; validation is syntactic only while route/transport remain blocked. The planned caps are pilot 192 calls/USD 0.50/20 minutes, full 480 calls/USD 1.00/45 minutes, and combined USD 1.50. The append-only local ledger tests reservation-before-dispatch, provenance, restart clock, crash lock, cross-profile/run denial, deadline-before-dispatch, and retained uncertain reservations; no real paid call was made.

## Layer 3 — deployed channel

`NOT_RUN`. No Zalo/customer-data run, migration, Cloudflare activation, remote inspection, push, PR, merge, or deploy occurred. Human typing visibility and live UI/Calendar acceptance are unverified.

Frozen provenance: accepted base `a3fd106a0a1c5c2f4b1ecc9bca27f2474759abf7`; aggregate SHA-256 `8d7f4c5d2e3e60fa6e8a8d7865991af6de521291cd03839fa54b2d4ae7c8aad9` over 45 files. The exact file-level SHA-256 manifest is `.superpowers/sdd/2026-09-28-llm-context-contract-implementation/task-10-source-hashes.json`. If any listed file changes, the evidence must be rerun and the digest replaced.
