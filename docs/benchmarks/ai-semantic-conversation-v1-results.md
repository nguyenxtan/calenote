# AI Semantic Conversation V1 — Benchmark and Selection Evidence

## Current result

Status: `NOT_RUN` — this checkpoint creates offline preparation only. No
candidate, provider route, credential, or production data has been used.

The reproducible dry-run command is:

```sh
pnpm benchmark:semantic-v1:offline
```

It loads only `src/modules/semantic/benchmark/semantic-v1.json`, verifies the
frozen synthetic fixture, and prints aggregate metrics with no candidate
execution. The current fixture version is `semantic-v1-synthetic` with 216
synthetic Vietnamese cases.

## Candidate evidence template

Complete one record per proposed candidate immediately before any enablement.
Evidence belongs to the later separately authorized benchmark run; this file
does not select a model or configure a route.

| Field | Required evidence | Current value |
| --- | --- | --- |
| Candidate ID | Stable review label | `UNSELECTED` |
| Model / provider | Explicit pinned model and provider endpoint | `UNSELECTED` |
| Capability evidence date | Current official structured-output capability evidence | `NOT_RECORDED` |
| Privacy evidence date | Current official data-collection and ZDR evidence | `NOT_RECORDED` |
| Limits | Verified input, output, timeout, and rate limits | `NOT_RECORDED` |
| Prices | Current input/output caps and units | `NOT_RECORDED` |
| Fixture | Version and exact case count | `semantic-v1-synthetic / 216` |
| Fixture content digest | Reviewed SHA-256 | `7cb1b003e6ad481bbf01205b669cce95567b69bb63a6bb7645759e7f5492b37c` |
| Schema-valid metric | Aggregate result and review-approved threshold | `NOT_MEASURED / NOT_APPROVED` |
| Intent/date/time/title/clarification metrics | Aggregate results and review-approved thresholds | `NOT_MEASURED / NOT_APPROVED` |
| P95 latency / estimated cost | Aggregate result and review-approved ceilings | `NOT_MEASURED / NOT_APPROVED` |

## Selection gate

Every one of these gates must pass before a free or paid semantic route is
configured:

1. Explicit spend authorization covers the exact candidate run.
2. Only the frozen synthetic fixture is supplied.
3. Current official capability, provider, privacy/data-collection, and ZDR
   evidence is recorded and independently reviewed.
4. Current limits and price caps are recorded.
5. All review-approved accuracy, latency, cost, and strict-schema thresholds
   pass.
6. Result evidence contains aggregate metrics only: no fixture messages,
   expected semantic objects, candidate interpretations, credentials, or
   authorization values.

Until then, the semantic capability remains `off`. A future authorization may
select an approved paid-only mode only after the same gates pass; this evidence
template does not authorize that configuration.
