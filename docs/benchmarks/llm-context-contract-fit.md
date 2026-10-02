# LLM context contract: offline feasibility evidence

## Authority V3 candidate — 2026-10-02, local only

Approved §4.6 spec `904afe5` and implementation plan `598a59d` supersede the
documentation-only gate below. This unstaged A5+A6 candidate is based on
`68fac9b2b5e95ee57c53f0ac1f491210e153ed01`; grouped independent review is pending.
Machine evidence: [authority V3 measurements](llm-context-contract-authority-v3-measurements.json).
Historical measurements and failures below are not rewritten as current PASS.

The same recursive-all-object-array algorithm counts metadata arrays as nodes.
Wire9 bytes are proven identical to the schema golden read with `git show
899b1f25f38d4d4afcd7429ffbb10c91851c25e3:...semantic-gateway.test.ts`, not merely
matched by source hashes. That exact immutable serialized-schema SHA256 is
`840ad3ff121dc4a5ad61016ad65a37f37a5f5b0819851e6cdb04952fb12705ab`;
wire10 is `966fce193d323e996185f4f61846f2a9342c353e7fbacb1f99ad567773971c38`.
The JSON records immutable/current source hashes and every measured input,
request, output and complete encoded snapshot digest.

| Public schema metric | Immutable wire9 | Selected wire10 |
| --- | ---: | ---: |
| Serialized UTF-8 bytes / root keys | 12057 / 9 | 11118 / 7 |
| Recursive object/array nodes / maximum depth | 337 / 11 | 323 / 11 |
| Summed anyOf/oneOf branches / constant discriminators | 49 / 31 | 51 / 21 |
| Required entries / nullable nodes | 162 / 78 | 143 / 65 |
| Enum arrays / values / largest domain | 22 / 100 / 16 | 27 / 105 / 16 |
| References / definitions | 43 / 19 | 42 / 18 |
| Local raw-schema diagnostic tokens | 3190 | 2937 |

Instruction evidence causes some branch/enum counts to increase. Removed roots
`dialogueAct`, `continuation`, `controlEvidence` and advisory kinds
`PRESENT_PREVIEW`, `ANSWER_QUERY` do not return. No finite domain is widened to
arbitrary strings and these counts make no claim about Google's private states.

Seven production-service flows R02/R07/R14/D01/D02/D06/D07 provide 23 complete
encoded snapshots, maximum 13656 bytes. Actual healthy outputs from the complete
frozen FULL 80-script/158-turn expansion additionally provide canonical/wire
token measurements. Across 327 ordinary/comparison rows, known application text
input is at most 3674 tokens; the largest accepted output is D09's wire output,
1855 bytes / 493 local text tokens (not a universal worst-case guarantee).
All these accepted outputs fit 1536 and ordinary snapshots retain every detail.
The schema-only maximal notes/evidence probe is **not accepted**: wire output
80309 bytes / 26693 text tokens exceeds both limits. The actual selected gateway
and service reject it with zero mutation, no persisted fresh snapshot, no partial
patch or arbitrary truncation. It does not contribute ordinary PASS credit.

The pinned cached google-genai2.25.0/gemma3 artifact runs under OS network deny
plus Python audit guard; the child inherits only PATH and Python deterministic
flags, not application credentials. Missing/mismatched cache fails closed;
no install/bootstrap/provider/counting API is performed. The baseline schema
comparison intentionally uses the same V3 input and prompt to isolate schema
bytes; it is not a legacy runtime replay or old-dialogueAct conversion.
Full structured SDK counting is unsupported (`null`), server/route framing is
UNKNOWN, and actual token admission remains UNVERIFIED. Limits remain input12000,
output1536, raw32768, encoded snapshot16384. Local capability/fit PASS is neither
T11_ROUTE_ADMISSION nor live-model, UAT, staging or production acceptance.

```sh
CONTEXT_FIT_LOCAL_TOKENS=1 CONTEXT_FIT_V3_REPORT=1 pnpm exec vitest run tools/benchmark/context-contract-fit.test.ts
```

## Conversation guidance revision — 2026-09-29

Revision `conversation-guidance-v2` measures the complete canonical
`calenote-context-2` output contract and its unchanged input/state envelope.
This is implementation evidence awaiting the single amendment-bundle review,
not provider-route admission or live acceptance. Historical sections and the
original `llm-context-contract-local-measurements.json` remain unchanged.

Machine evidence:
[conversation-guidance-v2 measurements](llm-context-contract-conversation-guidance-v2-measurements.json).
It includes source, tooling, prompt, full schema, corpus, individual wire/output
and finalized encoded-state digests. Reproduce without provisioning or network:

```sh
CONTEXT_FIT_LOCAL_TOKENS=1 CONTEXT_FIT_AMENDMENT_REPORT=1 pnpm exec vitest run tools/benchmark/context-contract-fit.test.ts tools/benchmark/snapshot-identity-view.test.ts src/modules/conversation/context-contract
```

The existing pinned SDK/tokenizer/cache ran under the unchanged OS network deny
and audit guard. No application credentials were inherited, no API client was
created, no provider/counting endpoint was called, and post-self-check network
attempts were zero. Method revision: `pinned-local-tokenizer-offline-1`.

| Canonical component | Bytes | Local text tokens |
| --- | ---: | ---: |
| Prompt | 8,950 | 2,025 |
| Complete strict schema | 19,592 | 4,904 diagnostic only |
| Ordinary-guidance input JSON | 538 | 176 |
| Ordinary-guidance complete wire | 29,396 | 7,215 diagnostic only |

| Output/context specimen | Known input tokens | Output tokens | Output bytes | Final encoded context bytes |
| --- | ---: | ---: | ---: | ---: |
| Null missing-time reply | 2,201 | 162 | 636 | 4,738 |
| Ordinary eligible question | 2,201 | 171 | 689 | 4,738 |
| Exactly 400 NFC BMP code points | 2,201 | 563 | 1,843 | 4,738 |
| Exactly 400 supplementary code points | 2,201 | 563 | 2,243 | 4,738 |
| Escaping and Unicode | 2,217 | 190 | 729 | 4,780 |
| Four uncertainties with guidance | 3,191 | 433 | 1,592 | 12,215 |
| Three-field correction with guidance | 2,831 | 215 | 855 | 8,451 |
| Six turns retaining selected assistant wording | 3,272 | 80 | 336 | 14,424 |

The 11 unchanged required ordinary fixtures remain below the 12,000 known-input
and 1,536 output-token ceilings. Their largest known input/output is 5,226/987
tokens (900-code-point title/notes); finalized encoded state remains 9,107 bytes.
Original six-user/six-assistant state is 14,416 bytes; selected-wording variant
is 14,424, below 16,384. No semantic field or evidence was removed, clipped or
reclassified. Maximum title/notes and combined-detail negatives remain measured;
passing ordinary cases does not imply every combination of maxima fits.

For the identical two-turn-start semantic core, historical output was 140 tokens
and 543 bytes. The amended missing-field directive plus null reply is 162 tokens
and 636 bytes: +22 tokens/+93 bytes. Ordinary prose adds another 9 tokens/53 bytes;
the 400-code-point BMP proposal adds 401 tokens/1,207 bytes over null. Backend-only
specimens use null, with no unused factual prose budget.

Prompt SHA-256: `f1dfa650af32c63e80122addff2443d836175cb6ec0bce187bdf095fa4efada8`.
Schema SHA-256: `8f1b868f606fd39972adc8984666f62960bf6c6f5ad38ff64774997b8765ba2d`.
Corpus SHA-256: `1f988bc6024eacbc6196bdf6e04e93024152a71ec36d1686c0abbcdb2024cd55`.

Local engineering fit A: PASS for this revision; independent acceptance pending.
Full structured SDK count remains null because the full unchanged strict schema
uses unsupported keywords. Route framing and endpoint behavior remain UNKNOWN;
B is UNVERIFIED and live dispatch admission remains BLOCKED. Schema diagnostic
tokens are not secretly added to, or substituted for, an actual route count.
Application LLM calls = 0; provider counting calls = 0; production changed = NO.

CO-A–F exercise section parsing, source evidence, real T3 merge/resolution and
pure reply selection. Model text is never used for factual preview/query/control
or mutation/delivery results; these return a backend-composition handoff. The
selected-text codec/projection regression checks history isolation and forbids
assistant evidence. T4/T5/T7 must still implement receipt persistence, complete
factual reply composition, actual inbound one/zero dispatch assertions and no
second wording dispatch. This local bundle does not claim those integrations.

## Current amendment evidence — 2026-09-29

### T1 finalized-state remeasurement and acceptance

After the local T0 gate, T1 finalized the actual strict application state rather
than treating the literal T0 snapshot as production state. A runtime-safe
`calenote-context-storage-1` envelope interns repeated strings losslessly, with
strict reference/shape and resource validation. All logical content, source
maps, scope/order/claim, attempt digests, decision bindings and expiry survive.
The following complete pre-encryption sizes supersede the storage experiment for
future T2/T4 integration, without changing the historical measurements below.

| Original specimen | Final logical bytes | Final encoded bytes |
| --- | ---: | ---: |
| simple_create | 4835 | 4732 |
| two_turn_complete | 7369 | 7069 |
| exam_turn_4 | 13415 | 12348 |
| multi_field_correction | 8975 | 8451 |
| long_title_900 / long_notes_900 | 20138 | 9107 |
| maximum_location | 11144 | 7313 |
| maximum_title | 33644 | 11813 |
| maximum_notes | 36644 | 12413 |
| long_combined | 71240 | 21571 (storage refusal) |
| four_uncertainties_candidate | 12964 | 12215 |
| six_user_six_assistant | 15895 | 14416 |
| control_projection_literal | 8995 | 8536 |

Independent T1 acceptance: Critical=0 / Important=0. Verification: 87 focused
T1/T0 tests with offline-tokenizer enabled, 319 relevant regression tests,
1,963 full-suite tests passed and one opt-in case separately verified;
typecheck/scoped lint/diff PASS. Exact 16,384/16,385 encoded boundaries and
malicious expansion refusals are tested. The five existing Node localStorage
experimental warnings remain disclosed; this is not full `pnpm check` evidence.
Title/notes maxima now fit storage but their synthetic outputs remain above the
1,536-token limit. No classification is forced to fail just because it failed
the earlier representation. Full route remains UNVERIFIED, dispatch BLOCKED.
Prompt/schema digests remain unchanged. Runtime code never imports tokenizer
tooling. Persistence atomicity and semantic evidence validation remain T4/T2.

### Accepted T0 amendment checkpoint

Baseline and unchanged HEAD for this work: `e44b9a415b87b7471085bc683d20e55c0360d9e8`.
The owner's isolated-tooling/method amendment separates local engineering from
provider-route admission. The historical report below remains intact; its
BLOCKED result is not retroactively changed.

```text
HISTORICAL_T0_RESULT = BLOCKED_AT_E44B9A4
ISOLATED_TOKENIZER = PROVISIONED
LOCAL_TOKEN_COUNTING_SCOPE = EXACT_SUPPLIED_TEXT_AND_SDK_TEXT_PROJECTION
T0_LOCAL_ENGINEERING_GATE = PASS
LOCAL_CHECKS = PASS
FULL_ROUTE_TOKEN_BOUND = UNVERIFIED
LIVE_DISPATCH_ADMISSION = BLOCKED
APPLICATION_LLM_CALLS = 0
PROVIDER_COUNTING_CALLS = 0
PRODUCTION_CHANGED = NO
PUSH_OR_DEPLOY = NO
```

Independent acceptance on 2026-09-29 returned Critical=0, Important=0, Minor=1.
The minor test-strength observation concerns checking the original schema string
rather than the parsed object supplied to the SDK; inspection confirmed that the
complete schema is supplied unchanged. It does not invalidate these measurements.
Fresh complete unit regression: 99 files, 1,933 passed, one skipped; typecheck and
diff check passed. Five existing Node experimental localStorage warnings were
observed in the jsdom environment, not measurement or provider failures.
No `T0_FIT=PASS` or full-route feasibility is claimed.
T1/T4 must remeasure the actual complete state and implement the
storage representation proven here; the 900-CP sample has only 185 spare bytes.

### Tool provenance and counting scope

Official `google-genai[local-tokenizer]==2.25.0`, SentencePiece 0.2.2 and protobuf
7.36.2 run under isolated Python 3.12.14. All 56 installed dependencies are
exactly pinned in `tools/benchmark/tokenizer/requirements.in`; its generated
`requirements.txt` includes distribution SHA-256 hashes and was reinstalled
using `uv pip sync --require-hashes --reinstall`. Lock SHA-256:
`54f3fd178cd47f95f6c6f418697d498dc11e2816110b675df78ddfc50a63a097`.
SDK wheel SHA-256:
`2e8f3a5f76ed00d5ffc3153f6089bc7d3511054eed53ad9cfc6095a7dc59b028`
from [PyPI 2.25.0 distribution metadata](https://pypi.org/pypi/google-genai/2.25.0/json).

The installed official loader explicitly maps `gemini-2.5-flash-lite -> gemma3`.
Artifact: `gemma3_cleaned_262144_v2.spiece.model`, 4,689,074 bytes, at Google
commit `014acb7ac4563a5f77c76d7ff98f31b568c16508`; expected and actual SHA-256
`1299c11d7cf632ef3b4e11937501358ada021bbdf7c47638d13c0ee982f2e79c`.
The [official pinned artifact](https://raw.githubusercontent.com/google/gemma_pytorch/014acb7ac4563a5f77c76d7ff98f31b568c16508/tokenizer/gemma3_cleaned_262144_v2.spiece.model)
is a tokenizer, not full model weights. Installed implementation/loader SHA-256
and all package versions are in the machine-readable evidence.

Plan-owned ignored directories: `artifacts/context-contract-tokenizer/venv`,
`cache` and `uv-cache`. No application dependency/lockfile changes.
Bootstrap downloaded the official SDK/dependencies from PyPI/files.pythonhosted.org
and that one Google artifact from raw.githubusercontent.com. This was authorized
bootstrap networking, not inference or provider counting. The supported extra
also installs Torch/Transformers for other model families; no weights or
HuggingFace tokenizer are loaded for the selected gemma3 mapping.

Measurement ran in a fresh Python subprocess under macOS
`sandbox-exec -p '(version 1)(allow default)(deny network*)'`, covering imports
and counting. The bridge inherits no application credentials/environment. An
additional audit hook denies DNS/connect/sendto/bind during artifact load and
counting, with an intentional loopback-connect refusal self-test; subsequent
counting-phase network attempts were zero. urllib3's import-time IPv6 bind probe
is separate and denied by the OS sandbox. The tool verifies the cached hash
before SDK loading, creates no API client and never calls authenticated endpoints.

Four distinct quantities are retained:

1. Actual known application text: exact canonical prompt and exact input JSON
   content counted separately, summed once. Prompt = 7,306 bytes / 1,663 tokens.
   The SDK structured **text-only** call with system_instruction and user content
   gives the same result. Roles add no local text tokens in this implementation.
2. Raw serialized wire JSON diagnostic: the complete unchanged application JSON
   serialization counted as one text string. Full schema alone = 18,126 bytes /
   4,587 diagnostic text tokens. Neither diagnostic proves provider input count,
   and neither schema diagnostic is added again to the reported text projection.
3. Complete SDK structured projection: **UNKNOWN for every canonical specimen**.
   Supplying the full schema unchanged to `types.Schema` raises extra_forbidden
   for root `$schema`, root `definitions`, and `$ref` at each of the eight root
   properties (schemaVersion, intent, dialogueAct, continuation, changes, query,
   uncertainties, controlEvidence). No keyword is pruned or rewritten.
4. Provider/OpenRouter transformation, endpoint strict-schema support, wrapper
   and framing token accounting: **UNKNOWN**, never assumed zero.

Inspected SDK accumulator counts text parts/system instruction and, for a
supported Schema object, format, description, enum strings, required names,
property names, nested properties/items and example text. Type/title/default/
property_ordering are carried but contribute no token text. Union branches,
refs/definitions and numeric/cardinality/additional-property constraints are
not fully represented in this counting implementation; accepted-but-untraversed
fields must not be mistaken for accounted overhead. It ignores generation
options other than response_schema (max output tokens, MIME/config/HTTP fields
do not establish token overhead). No media is present. The artifact normalizer
is identity, add_dummy_prefix=false, remove_extra_whitespaces=false,
escape_whitespaces=true. Application NFC normalization is distinct; retained
original source remains unchanged.

### Original 18,904-byte specimen and lossless representation

The original T0 review package used `long_title_900` and `long_notes_900` as
ordinary admitted-size examples, with empty expected rejection reasons.
The later metadata correction changed them to rejection samples. The approved
plan requires long fields admitted independently; this amendment therefore
preserves their **ordinary required** classification and does not inherit that
reclassification. Spec §4.1/§6 requires content, provenance and mapping
preservation, but does not require storing identical source/view strings twice.

The only representation change is a versioned `identity-view-v1` JSON envelope:
inside each transcript turn, replace semanticView with viewFromSource=true
**only when it is exactly equal to text**. Decoder recreates that key at the same
position. Transformed NFC/control views stay separate. No value, source quote,
fact, decision, candidate, map, identity or expiry is removed or normalized.
All 40 samples roundtrip to byte-identical original canonical JSON. Malformed
marker values, collisions, absent sources, object-valued views and unknown
versions reject. This is a testable development representation boundary, not
completed persistence. The byte gate applies to the complete encoded JSON
**before encryption**, including envelope metadata; expanded JSON is diagnostic.

Required 900-CP title/notes: 18,904 expanded -> **16,199 encoded bytes**; expected
output **971 local text tokens**; known input text **4,864 tokens**. No contract,
schema, content, evidence or numeric limit was changed. The original 18,904-byte
result remains historical evidence. The max title/notes and combined independent
maxima remain aggregate negative cases; these were already negative originally.

### Updated specimen matrix

Input and output schema validity is true for all first 24 specimens; all retained
details and byte-identical decode checks pass. Current Unicode units and prompt/
schema/input/request/framing/output bytes remain the historical table's values
except for the explicitly named encoded snapshot bytes below. Complete numeric
rows, per-row encoded hashes, Unicode counts, schema validity and reasons are in
[local measurement data](llm-context-contract-local-measurements.json).
Every row still refuses actual dispatch with TOKEN_BOUND_UNVERIFIED.

| Specimen | Encoded snapshot B | Request JSON B | Known text tokens / SDK text projection | Raw JSON diagnostic tokens | Output JSON B / text tokens | Known local limitation |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| simple_create | 3874 | 26279 | 1840 | 6533 | 641 / 175 | No known byte rejection |
| two_turn_start | 3877 | 26282 | 1839 | 6532 | 543 / 140 | No known byte rejection |
| two_turn_complete | 6115 | 27977 | 2258 | 6995 | 339 / 94 | No known byte rejection |
| exam_turn_1 | 3910 | 26315 | 1851 | 6544 | 896 / 244 | No known byte rejection |
| exam_turn_2 | 7578 | 28636 | 2462 | 7204 | 626 / 157 | No known byte rejection |
| exam_turn_3 | 10284 | 29399 | 2690 | 7444 | 340 / 95 | No known byte rejection |
| exam_turn_4 | 11784 | 29823 | 2815 | 7579 | 348 / 98 | No known byte rejection |
| multi_field_correction | 7610 | 28668 | 2472 | 7214 | 678 / 179 | No known byte rejection |
| maximum_title | 27005 | 43854 | 7564 | 12294 | 5671 / 1871 | CONTEXT_SNAPSHOT_TOO_LARGE; expected output >1536 |
| maximum_location | 9005 | 30357 | 3064 | 7794 | 1174 / 371 | No known byte rejection |
| maximum_notes | 29405 | 45654 | 8164 | 12894 | 6271 / 2071 | CONTEXT_SNAPSHOT_TOO_LARGE; expected output >1536 |
| long_title_900 | 16199 | 35754 | 4864 | 9594 | 2971 / 971 | No known byte rejection |
| long_title_600 | 12599 | 33054 | 3964 | 8694 | 2071 / 671 | No known byte rejection |
| long_notes_900 | 16199 | 35754 | 4864 | 9594 | 2971 / 971 | No known byte rejection |
| long_notes_600 | 12599 | 33054 | 3964 | 8694 | 2071 / 671 | No known byte rejection |
| long_combined | 57421 | 65189 | 14638 | 19382 | 12766 / 4224 | CONTEXT_SNAPSHOT_TOO_LARGE; expected output >1536 |
| escaped_refs_1 | 3931 | 26343 | 1855 | 6551 | 405 / 109 | No known byte rejection |
| escaped_refs_2 | 3931 | 26343 | 1855 | 6551 | 484 / 131 | No known byte rejection |
| escaped_refs_3 | 3931 | 26343 | 1855 | 6551 | 563 / 153 | No known byte rejection |
| four_uncertainties_candidate | 11126 | 30192 | 2832 | 7620 | 1398 / 389 | No known byte rejection |
| six_user_six_assistant | 13871 | 30167 | 2889 | 7661 | 177 / 46 | No known byte rejection |
| snapshot_16384 | 14978 | 31242 | 3024 | 7796 | 179 / 47 | No known byte rejection |
| snapshot_16385 | 14979 | 31242 | 3024 | 7796 | 179 / 47 | No known byte rejection |
| control_projection_literal | 7706 | 28613 | 2462 | 7204 | 348 / 98 | No known byte rejection |

Both historical snapshot_16384/16385 rows measure the **old expanded** boundary;
they encode smaller. New independent encoded-boundary rows below exercise the
current representation at exactly 16,384 and 16,385. No boundary was moved.
Raw JSON diagnostic >12,000 is not evidence of actual route overflow. For the
combined-max specimen, actual supplied text alone is 14,638 tokens and the
snapshot/output gates also fail. Output sizes are synthetic expected objects;
they are not observed LLM behavior or semantic-accuracy evidence.

| Additional case | Current UTF16/CP | Encoded snapshot B | Known text tokens | Raw JSON diagnostic tokens | Output text tokens | Known rejection |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| INPUT_1799_NFC | 1799/1799 | 9255 | 3632 | 8325 | N/A | No known byte rejection |
| INPUT_1799_DECOMPOSED | 1799/1799 | 18256 | 3632 | 8325 | N/A | CONTEXT_SNAPSHOT_TOO_LARGE |
| INPUT_1799_SUPPLEMENTARY | 1799/900 | 7453 | 2733 | 7426 | N/A | No known byte rejection |
| INPUT_1800_NFC | 1800/1800 | 9258 | 3633 | 8326 | N/A | No known byte rejection |
| INPUT_1800_DECOMPOSED | 1800/1800 | 18264 | 3633 | 8326 | N/A | CONTEXT_SNAPSHOT_TOO_LARGE |
| INPUT_1800_SUPPLEMENTARY | 1800/900 | 7454 | 2733 | 7426 | N/A | No known byte rejection |
| INPUT_1801_NFC | 1801/1801 | 9261 | 3634 | 8327 | N/A | SEMANTIC_INPUT_TOO_LONG |
| INPUT_1801_DECOMPOSED | 1801/1801 | 18272 | 3634 | 8327 | N/A | SEMANTIC_INPUT_TOO_LONG, CONTEXT_SNAPSHOT_TOO_LARGE |
| INPUT_1801_SUPPLEMENTARY | 1801/901 | 7457 | 2734 | 7427 | N/A | SEMANTIC_INPUT_TOO_LONG |
| INPUT_2000_NFC | 2000/2000 | 9858 | 3833 | 8526 | N/A | SEMANTIC_INPUT_TOO_LONG |
| INPUT_2000_DECOMPOSED | 2000/2000 | 19864 | 3833 | 8526 | N/A | SEMANTIC_INPUT_TOO_LONG, CONTEXT_SNAPSHOT_TOO_LARGE |
| INPUT_2000_SUPPLEMENTARY | 2000/1000 | 7858 | 2833 | 7526 | N/A | SEMANTIC_INPUT_TOO_LONG |
| encoded_snapshot_16384 | 12/12 | 16384 | 3024 | 7796 | 47 | No known byte rejection |
| encoded_snapshot_16385 | 12/12 | 16385 | 3024 | 7796 | 47 | CONTEXT_SNAPSHOT_TOO_LARGE |
| oversized_output | 18/18 | 3874 | 1840 | 6533 | 16170 | OUTPUT_JSON_TOO_LARGE |
| truncated_output | 18/18 | 3874 | 1840 | 6533 | 16170 | OUTPUT_JSON_TOO_LARGE, OUTPUT_JSON_INVALID |

Decomposed 1799/1800 pass their **length gate only**, as expressly stated in
spec §8.2; unchanged original plus different NFC view can still exceed snapshot
capacity. These boundary negatives are not reclassified ordinary flows.
N/A output means no expected proposal is specified for that input-boundary
specimen. The large output is strict-schema-valid; truncated output is invalid.
Raw HTTP response 33,600 bytes still rejects at the later transport boundary
even when extracted JSON is only 641 bytes; that unchanged distinction remains.

### Refusal and limitations of proof

The dormant typed `preflightEnvelopeTransition` is pure and has no model,
persistence or canonical-mutation capability. On a 16,385-byte candidate it
returns REFUSE / CONTEXT_SNAPSHOT_TOO_LARGE / SHORTEN_OR_RESTART plus the
byte-identical prior valid snapshot, including all expiry fields. Truncated and
oversized output return no partial patch and keep that prior snapshot. It never
returns an admission while route proof is missing. This establishes the local
preflight refusal plan, not D1 atomicity, encryption overhead, CAS, rollback or
storage read-back. T4/T6 must integrate and test those actual boundaries.

### Verification

RED: two Python assertions for absent measurement scope, two codec assertions
for absent lossless elision/malformed-reference refusal, then two transition
assertions for missing context-overflow/output-invalid recovery. All failed for
the intended behavior before implementation. Final focused tests: **57/57**.
Relevant conversation regression plus probes: **12 files / 314 tests PASS**.
Python bridge tests: **3/3 PASS under OS network denial**. Typecheck, scoped
ESLint and diff checks are reported in the amendment implementer report.
The optional tokenizer test is explicitly skipped unless
CONTEXT_FIT_LOCAL_TOKENS=1; the evidence run enabled it.
The original canonical prompt/schema/wire are unchanged.

Reproduce using [tool instructions](../../tools/benchmark/tokenizer/README.md).
Full numeric/verification output is kept locally in
`artifacts/context-contract-tokenizer/verification.log`.
No full repository, live, staging, production or channel acceptance is claimed.

---

## Historical e44b9a4 report — preserved, not current methodology

Everything below records the original gate and measurements before the owner's
method amendment. Its unresolved combined gate and no-install statements are
historical, not descriptions of the newly provisioned tool.

Date: 2026-09-28. Baseline: `a2508f15b3180e7bd68beabe5cce4339c03edb78` on
`codex/llm-context-contract-design`, worktree `.worktrees/product-experience-v2`.
Specification: `docs/superpowers/specs/2026-09-28-llm-context-contract-design.md`
(approved content `e8f9e75f436a672b23387eb0054047da217ade23`). The owner's
2026-09-28 continuous-execution authorization supersedes the historical T0-only
stop, but does not waive the T0 technical prerequisite.

**OFFLINE_FIT_GATE = BLOCKED — TOKEN_BOUND_UNVERIFIED.** These measurements do
not establish that the model is infeasible. Measurement tests can pass while
model input/output token fit remains unknown. No application inference,
provider token-counting, credentials, network-dependent tests or deployment are
part of this probe. The four new modules are dormant and have no active imports.

## Artifacts and method

`contracts.ts` contains all 13 typed slot changes, explicit CLEAR, both evidence
variants, date/clock/query unions, typed uncertainty alternatives, full required
proposal and context roots, and local semantic refinements. `prompt.ts` is the
complete candidate canonical prompt. `wire.ts` serializes that same prompt and
schema; there is no smaller benchmark schema or shortened prompt. JSON Schema
uses reused definitions, retaining every structural branch. Provider support
for this complete schema dialect has not been demonstrated. Cross-field
refinements (including unique changed fields and intent/query ownership) remain
local validation requirements; JSON Schema is not proof of semantic entailment.

`admission.ts` measures the exact supplied strings with no clipping or mutation.
Every measurement is blocked until an applicable token/framing method exists.
Its `outputJson` argument is extracted model JSON, **not the provider HTTP body**.
Raw response bytes and finish reason cannot be certified from that argument.
The future gateway must check both before accepting an entire patch. Similarly,
the future T2 builder must check original and projected current text and preserve
all evidence; passing a snapshot byte count does not validate snapshot scope,
source maps or completeness. This probe does not implement T1 state management,
T2 projection/evidence validation, a provider adapter, or storage recovery.

Snapshots are explicitly synthetic serialization samples, not a completed T1
persistence schema. They include identity/order/claim, every slot, fact aliases
and provenance, per-slot original source-turn identity, quote/occurrence,
source/view code-point spans, source-map linkage and normalization version,
resolution method/version/reference/timezone/dependencies and proposal revision,
raw transcript, semantic view, source maps, delivery state,
questions, ambiguities, a scoped handle registry, preview binding, one decision
and optional candidate with source and per-field evidence spans, model-attempt binding, creation/idle/absolute/draft
expiry and capability version. Source text and view are both retained in these
samples; their duplicated bytes are counted. No supporting evidence is evicted.
The uncertainty/candidate and control samples retain the exact exam source
alongside their newer text. The candidate's exact “Mai 8h nhắc gọi mẹ” source is
retained at its own USER turn with correctly indexed case-sensitive quotes.
Assertions resolve every retained slot and candidate quote to its intended
unchanged source/view span. The control sample uses manually specified source/view spans and the decomposed
sample uses an explicit repeated 3-to-1 NFC composition run. These literals
measure overhead; they do not prove a working projector or conversation engine.

All valid specimens are parsed with the strict input/output schemas before their
sizes are reported. Overflow/truncated specimens are separately labelled. The
four exam outputs are hand-authored expected proposals, not model observations.
Tests check that the serialized fourth-turn input still contains Quang Trung,
nhớ mang giấy tờ, event date, count 2 and BEFORE_EVENT, while its proposed patch
changes only reminderTime. This is preservation in serialization, not multi-turn
acceptance, deterministic resolution or confirmed-reminder evidence.

Counts: `NFC(text).length` is UTF-16 units; `[...NFC(text)].length` is Unicode code
points. UTF-8 bytes are measured independently. Request bytes include prompt,
the complete response schema, input JSON, roles/options and all JSON escaping.
The `framing` column below is **serialized JSON byte overhead**, not a bound on
server token framing. Snapshot bytes are pre-encryption. Encryption overhead is
not a model-input component and remains a later storage concern.

## Numeric results

Canonical prompt: **7,306 bytes**. Full structural response schema: **18,126
bytes**. Input tokens, output tokens and server-framing tokens: **UNKNOWN for
every row**. Every row is aggregate BLOCKED, even when all measured size gates
pass. `CTX` indicates verified snapshot overflow above 16,384 bytes; `—` means
no measured constituent overflow, not admitted. Raw is a **synthetic minimal
OpenAI-shaped response body**, not an actual provider response or upper bound.

| Specimen | Current UTF16 / CP | Input JSON B | Snapshot B | Request B | Framing B | Output JSON B | Synthetic raw B | Size rejection |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Mai 8h nhắc gọi mẹ | 18 / 18 | 535 | 3,851 | 26,279 | 312 | 641 | 835 | — |
| mai nhắc tui gọi khách | 22 / 22 | 538 | 3,857 | 26,282 | 312 | 543 | 715 | — |
| Follow-up 9h | 2 / 2 | 1,991 | 6,135 | 27,977 | 554 | 339 | 477 | — |
| Exam turn 1 | 50 / 50 | 571 | 3,923 | 26,315 | 312 | 896 | 1,130 | — |
| Exam turn 2 | 38 / 38 | 2,566 | 7,677 | 28,636 | 638 | 626 | 808 | — |
| Exam turn 3 | 3 / 3 | 3,221 | 10,424 | 29,399 | 746 | 340 | 478 | — |
| Exam turn 4 | 12 / 12 | 3,585 | 11,977 | 29,823 | 806 | 348 | 486 | — |
| Multi-field correction | 62 / 62 | 2,598 | 7,741 | 28,668 | 638 | 678 | 868 | — |
| Maximum title 1,800 CP | 11 / 11 | 17,908 | 32,410 | 43,854 | 514 | 5,671 | 5,799 | CTX |
| Maximum location 300 CP | 11 / 11 | 4,411 | 9,910 | 30,357 | 514 | 1,174 | 1,302 | — |
| Maximum notes 2,000 CP | 11 / 11 | 19,708 | 35,410 | 45,654 | 514 | 6,271 | 6,399 | CTX |
| Long title 900 CP | 11 / 11 | 9,808 | 18,904 | 35,754 | 514 | 2,971 | 3,099 | CTX |
| Long title 600 CP | 11 / 11 | 7,108 | 14,404 | 33,054 | 514 | 2,071 | 2,199 | — |
| Long notes 900 CP | 11 / 11 | 9,808 | 18,904 | 35,754 | 514 | 2,971 | 3,099 | CTX |
| Long notes 600 CP | 11 / 11 | 7,108 | 14,404 | 33,054 | 514 | 2,071 | 2,199 | — |
| Combined independent maxima | 11 / 11 | 39,147 | 69,802 | 65,189 | 610 | 12,766 | 12,938 | CTX |
| Escaping + one evidence ref | 56 / 56 | 592 | 3,965 | 26,343 | 319 | 405 | 551 | — |
| Escaping + two evidence refs | 56 / 56 | 592 | 3,965 | 26,343 | 319 | 484 | 642 | — |
| Escaping + three evidence refs | 56 / 56 | 592 | 3,965 | 26,343 | 319 | 563 | 733 | — |
| Four uncertainties / two alternatives / candidate | 18 / 18 | 3,886 | 11,260 | 30,192 | 874 | 1,398 | 1,724 | — |
| Six USER + six ASSISTANT | 12 / 12 | 3,889 | 14,202 | 30,167 | 846 | 177 | 283 | — |
| Exact snapshot boundary | 12 / 12 | 4,964 | 16,384 | 31,242 | 846 | 179 | 285 | — |
| Snapshot boundary +1 | 12 / 12 | 4,964 | 16,385 | 31,242 | 846 | 179 | 285 | CTX |
| Literal control projection | 22 / 22 | 2,543 | 7,761 | 28,613 | 638 | 348 | 486 | — |

Exact required exam turns: “Ngày 11/10 đi thi ở Quang Trung, nhớ mang giấy tờ.”;
“Nhắc hai ngày liên tiếp trước hôm thi.”; “8h.”; “Đổi sang 9h.”.
Correction: “Đổi sang 9h, địa điểm ở Quang Trung, ghi chú nhớ mang giấy tờ.”.

Long fields use repeated `ế` (three UTF-8 bytes), with the full source still in a
prior USER turn, separate slot/fact values, and a short current “Giữ nguyên.”.
Their independent domain maxima need not fit a complete snapshot. After review
added omitted evidence metadata, the retained 900-CP title/notes samples exceed
the snapshot cap and remain as rejection probes; separate 600-CP samples pass
measured byte bounds, not unknown token bounds. The
combined maxima reject before dispatch on known snapshot bytes. Different
storage representations require remeasurement, not automatic extrapolation.

## Unicode and overflow boundaries

NFC samples repeat `ế`; decomposed samples repeat `e + U+0302 + U+0301`;
supplementary samples use `😀` pairs plus `ế` for an odd UTF-16 length.
The original decomposed text is retained unchanged. Duplicated original/view
storage makes some decomposed samples exceed context bytes even though the
current-message NFC length gate passes.

| Input | Variant | Original units / CP | NFC units / CP | Snapshot B | Request B | Known size rejection |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 1799 | NFC | 1799 / 1799 | 1799 / 1799 | 14,605 | 31,652 | — |
| 1799 | decomposed | 5397 / 5397 | 1799 / 1799 | 18,213 | 31,652 | CTX |
| 1799 | supplementary | 1799 / 900 | 1799 / 900 | 11,005 | 29,854 | — |
| 1800 | NFC | 1800 / 1800 | 1800 / 1800 | 14,611 | 31,655 | — |
| 1800 | decomposed | 5400 / 5400 | 1800 / 1800 | 18,221 | 31,655 | CTX |
| 1800 | supplementary | 1800 / 900 | 1800 / 900 | 11,007 | 29,855 | — |
| 1801 | NFC | 1801 / 1801 | 1801 / 1801 | 14,617 | 31,658 | SEMANTIC_INPUT_TOO_LONG |
| 1801 | decomposed | 5403 / 5403 | 1801 / 1801 | 18,229 | 31,658 | SEMANTIC_INPUT_TOO_LONG, CTX |
| 1801 | supplementary | 1801 / 901 | 1801 / 901 | 11,013 | 29,858 | SEMANTIC_INPUT_TOO_LONG |
| 2000 | NFC | 2000 / 2000 | 2000 / 2000 | 15,811 | 32,255 | SEMANTIC_INPUT_TOO_LONG |
| 2000 | decomposed | 6000 / 6000 | 2000 / 2000 | 19,821 | 32,255 | SEMANTIC_INPUT_TOO_LONG, CTX |
| 2000 | supplementary | 2000 / 1000 | 2000 / 1000 | 11,811 | 30,255 | SEMANTIC_INPUT_TOO_LONG |

All rows additionally carry TOKEN_BOUND_UNVERIFIED. A 2001-code-point retained
USER turn rejects CONTEXT_TURN_TOO_LONG. Seven USER or ASSISTANT entries reject
CONTEXT_TURN_COUNT_EXCEEDED. Exactly 16,384 snapshot bytes passes that byte gate;
16,385 fails it. The exact-boundary fixture fills a retained assistant source/view
and tunes the last few bytes with a synthetic request identifier, preserving
consistent map extents. Neither fixture evicts facts to fit.

A strict-schema-valid large proposal with 2,000-CP notes, three full quotes and
two typed alternatives is **48,630 bytes**; it rejects OUTPUT_JSON_TOO_LARGE.
Removing its final `}` produces **48,629 bytes** and also rejects
OUTPUT_JSON_INVALID. No parsed partial patch is returned. A **641-byte** output
placed in a synthetic response with extra metadata yields a **33,600-byte raw
body**: this illustrates why extracted JSON bytes alone cannot enforce the
32,768-byte raw-response ceiling. The test reports this distinction; it does not
claim a completed gateway transport guard or transactional recovery. No input
guard guarantees what a stochastic model will emit; output schema, completion,
token and raw-response validation remain independently required.

## Token applicability and aggregate admission

Method ID: `gemini-2.5-flash-lite:UNVERIFIED`. No unrelated tokenizer is used.
`UTF8(request)+1024` is not adopted as a proven Gemini upper bound. Token counts,
valid model-specific upper bounds and hidden provider/server framing are all
UNKNOWN. A byte count is not converted to tokens. Even a justified upper bound
above 12,000 would be inconclusive about actual overflow, not proof of it.

An official local tokenizer **does exist**. Google's loader maps
`gemini-2.5-flash-lite` to `gemma3`, pins the model artifact at commit
`014acb7ac4563a5f77c76d7ff98f31b568c16508`, and checks artifact SHA-256
`1299c11d7cf632ef3b4e11937501358ada021bbdf7c47638d13c0ee982f2e79c`.
It downloads the artifact if absent from its cache. [Google GenAI tokenizer
loader](https://raw.githubusercontent.com/googleapis/python-genai/main/google/genai/_local_tokenizer_loader.py).
The experimental local implementation accounts for `system_instruction` and
`generation_config.response_schema`; Google's token documentation describes
local counting. [Local tokenizer implementation](https://github.com/googleapis/python-genai/blob/main/google/genai/local_tokenizer.py),
[Vertex AI token documentation](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/list-token).

Controller read-only diagnostics found `python3` SentencePiece unavailable and
the loader's temporary `vertexai_tokenizer_model` cache absent; the repository
declares neither Google GenAI nor SentencePiece. No dependency was installed
and no tokenizer artifact was downloaded. Thus no installed, verified local
method was executed for these measurements. OpenRouter documents a normalized
request/response API and native token usage, but the inspected documentation
does not establish an offline bound covering this full schema and
`google-vertex/eu` route framing. [OpenRouter API overview](https://openrouter.ai/docs/api/reference/overview).
These sources were inspected by the controller on **2026-09-28**; they are
public-method evidence, not provider measurements.

The precise missing prerequisite is an installed, integrity-verified applicable
local tokenizer/artifact and a justified treatment of the complete selected
route's schema/system/user framing. Application APIs/counting endpoints remain
prohibited during T0. Permission to provision isolated non-runtime measurement
tooling/artifacts may resolve the first part; it would not itself prove the
route framing or authorize inference. No model or budget-cap change is proposed.

Aggregate admission is the conjunction of current source **and** semantic-view
NFC UTF-16 <=1,800; retained USER NFC code points <=2,000; USER<=6 and ASSISTANT<=6;
complete snapshot <=16,384 bytes; whole input <=12,000 tokens; strict schema and
evidence/authority validation; and, after dispatch, complete output <=1,536
tokens with raw response <=32,768 bytes and a successful finish reason. Existing
webhook transport cap is a separate inbound 32-KiB guard. No limit is raised.
This T0 artifact verifies measurable serialization constituents and always
refuses aggregate admission while proof is missing. Future integration must
not interpret a byte-only success as permission to dispatch or apply a patch.

Dependent tasks remain blocked. The next technical action is to obtain authority
for isolated non-runtime tokenizer tooling/artifact provision if necessary,
then establish offline token/framing applicability under the unchanged limits.
A specific owner-approved feasibility-method amendment is a separate option
if route framing cannot be proved. A schema/representation
optimization may be considered only with unchanged semantics and a rerun of
all measurements; ordinary request byte length alone is not proof one is needed.

## Reproduction and verification

Initial required command `pnpm exec vitest run tools/benchmark/context-contract-fit.test.ts`
produced **5 intentional assertion failures** against callable skeletons:
counts `{0,0}` versus `{3,2}`; zero versus two messages; missing oversize reason;
truncated output admitted; duplicate fields accepted. No missing import or
network failure was counted as RED. The initial pnpm invocation printed an
automatic up-to-date dependency check; no dependency/lockfile/configuration diff
resulted. Subsequent commands use installed local executables to avoid that
wrapper behavior.

An additional meaningful RED caught a boundary-sample map error (reported
source extent 21 versus actual 3535); the fixture was corrected to recalculate
maps and serialize the same semantic input. Independent review round 1 identified
two Important fixture omissions. Two additional RED assertions reproduced
missing retained-slot evidence and absent exam source text. After adding
per-field provenance/resolution metadata and restoring exam/candidate sources,
GREEN is **50 focused tests**. Numerical tables above supersede the earlier
incomplete snapshot measurements. Independent re-review accepted these corrected
artifacts as factual BLOCKED evidence: **Critical=0, Important=0, Minor=0**.
This review does not approve token feasibility or progression to T1.

```sh
CONTEXT_FIT_REPORT=1 ./node_modules/.bin/vitest run tools/benchmark/context-contract-fit.test.ts --silent=false --disableConsoleIntercept
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/modules/conversation/context-contract tools/benchmark/context-contract-fit.test.ts
git diff --check
```

The report mode emits numeric rows, per-specimen SHA-256 digests, canonical
prompt/schema and source digests; raw synthetic content is not logged. Typecheck
and scoped ESLint passed. The reviewed-fixture follow-up regression run passed
**11 files / 307 tests** across conversation modules and this probe. Only the four dormant modules, this test and this
report, plus the plan's execution metadata, are deliverables. V1/V2 schemas/prompts,
active composition, dependencies, configuration, migrations, UI and delivery are
unchanged. The controller reran the focused suite (50/50), typecheck and scoped
ESLint after the fixture fix. The complete repository check was not run at this
bounded offline gate; no full-repository or runtime acceptance is claimed.

Independent reviewer `context_t0_independent_review` inspected the actual final
fixtures, evidence/source maps, canonical module hashes and numeric output.
Both original Important findings (missing retained-field metadata and missing
source turns for candidate/uncertainty/control evidence) were closed after RED
tests and corrected measurements. The final assessment is quality PASS for
the probe/report only; **OFFLINE_FIT_GATE remains BLOCKED**. T1–T10 and the
whole-branch review have not started, and pilot/full evaluation are NOT_RUN.

Canonical artifact SHA-256:

| Artifact | SHA-256 |
| --- | --- |
| Prompt string | `1e06296c31482b5375e5cdc0d0bcd9278156f51db47977dbd8c67c94a88d2823` |
| Serialized full schema | `f18296b585a346dab57ec7a8f3dd8681d565784c29e8cd8b94348be17a6b3db2` |
| contracts.ts | `afcc978052f6c277c6f8775c5015923df7ee15c362308857bd52b1ded6320efb` |
| prompt.ts | `6b165a075d28c7c0fdd39600e19c22724368d0f52f03a6d5d98b768e54011281` |
| wire.ts | `6b38221434df819fcc8492741d1a3bd86bb77511f9758f7362ecb3ecdfcffabc` |
| admission.ts | `f85edf61c8584ac8d1a09f5a4fd3018bfe026d7442d5ea8669416ef36c370e11` |
| context-contract-fit.test.ts, corrected fixtures | `dfd9ca49ca6c1adcfaf9048d337e5182842d07fa0fa21bf05c2ce4bdece07919` |

Selected corrected specimen SHA-256 (the report command emits all 24):

| Specimen | SHA-256 |
| --- | --- |
| Simple create | `3c0bdbd272e018c1a77c4a2ccb096d60ff443c7b0bc4682fae79db5495ef9026` |
| Exam turn 4 | `55540f78b989486b9f7e9852b414945df4c8455a5e6fbc81624101de23caa9eb` |
| Uncertainties and candidate | `24c26738de5888a9dc0c61b9627e37b586940b2b0b201f2fda1e4f3f8a112361` |
| Control projection | `4250c8b7023814fd461bd68482a9ce2d001ea028b54641a59f31c2260a60f411` |
| Exact snapshot boundary | `5cb6c80b070c1cded99d77679f66038467a7d30df5727cf3260dc2441cd3b4ff` |

These exact versions require remeasurement after any material prompt/schema,
input/snapshot or wire change. Finite synthetic tests do not establish universal
conversational accuracy, live-model fit, UAT, storage correctness or deployment.
