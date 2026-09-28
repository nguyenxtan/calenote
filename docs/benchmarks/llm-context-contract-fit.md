# LLM context contract: offline feasibility evidence

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
