# AI Semantic Conversation V1 — Benchmark and Selection Evidence

## 2026-09-16 live synthetic selection run

Status: `COMPLETE — NO_MODEL_SELECTED`. This evidence is limited to the frozen
synthetic fixture and safe aggregates. It does not configure a production
model, route, credential, or feature flag.

| Field | Value |
| --- | --- |
| Run ID | `semantic-v1-model-selection-20260916-02` |
| Fixture | `semantic-v1-synthetic` / 216 cases |
| Fixture content digest | `7cb1b003e6ad481bbf01205b669cce95567b69bb63a6bb7645759e7f5492b37c` |
| Requests | 432 serial requests; no retries |
| Hard request cap | 450 |
| Projected / retained cost | $0.478008 / $0.478008 |
| Hard cost cap | $0.500000 |
| Source data | Canonical synthetic fixture only; no production or user conversations |

### Revalidated exact endpoint contract

Current OpenRouter endpoint metadata was checked immediately before preflight.
Both calls used the frozen Semantic V1 instruction, strict response schema,
reference time, timezone, context, token bounds, timeout, scoring contract,
and privacy routing: exact `provider.only`, no fallback,
`require_parameters=true`, `data_collection="deny"`, and `zdr=true`.

| Candidate | Exact endpoint | Reasoning request field | Endpoint price per 1M tokens | Structured output / response format / ZDR |
| --- | --- | --- | --- | --- |
| `qwen/qwen3-30b-a3b-instruct-2507` | `siliconflow/fp8` | Omitted | input $0.09; output $0.30 | verified / verified / eligible |
| `nvidia/nemotron-3.5-lightning` | `phala` | disabled and excluded | input $0.08; output $0.20 | verified / verified / eligible |

### Safe aggregate results

Percentages use all 216 fixture cases unless a metric has its documented
eligible denominator. A missing case therefore reduces reliability rather than
being excluded from a quality gate.

| Candidate | Scored / missing | Schema validity | Intent | Date | Time | Title | LIST range | Clarification | P95 | Measured successful-request cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Qwen 3 30B A3B Instruct 2507 | 216 / 0 | 100.00% | 61.11% | 14.08% | 100.00% | 47.89% | 8.33% | 0.00% | 11,623 ms | $0.260928 |
| Nemotron 3.5 Lightning | 17 / 199 | 7.87% | 6.02% | 0.00% | 9.86% | 2.82% | 4.17% | 0.00% | 10,522 ms | $0.017085 |

### Safe provider-failure summary

Qwen completed all 216 cases without a provider-failure category. Nemotron had
198 `RATE_LIMITED` failures across the synthetic categories `today`,
`tomorrow`, `explicit-date`, `daypart`, `colloquialism`, `filler`,
`reordered-syntax`, `implicit-request`, `missing-or-ambiguous`, `past-time`,
`typo`, and `multi-turn-continuation`, plus one `TIMEOUT` in
`missing-or-ambiguous` (`synthetic-missing-or-ambiguous-157`). The durable
ledger contains only synthetic case IDs and safe error categories; it contains
no raw prompt, response, credential, or hidden reasoning in this evidence.

### Selection decision

`MODEL_SELECTED = NONE`.

Qwen satisfies the schema-validity gate (100.00%), but exhibits systematic
business-critical semantic failures: date (14.08%), LIST range (8.33%), and
clarification (0.00%) accuracy are below acceptable selection quality.
Nemotron fails the required 99% schema-validity gate because 199 of 216 cases
ended in endpoint rate limiting or timeout. Privacy eligibility alone does not
override these quality and availability failures.

No migration, deployment, production OpenRouter configuration, or model
enablement follows from this result. The required next decision is
`CANDIDATE_RECONSIDERATION`.
