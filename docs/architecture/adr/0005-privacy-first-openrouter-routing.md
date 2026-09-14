# ADR 0005: Privacy-first OpenRouter routing

## Context

The generic `openrouter/free` router returned no endpoint under required Zero
Data Retention (ZDR). User-derived reminder and source content is
privacy-sensitive by default, so lowering privacy to preserve free inference is
not acceptable.

## Decision

Use `AI_MODE=privacy` for the only currently eligible live route. It requires
an explicit model, exact provider endpoint, and token price ceiling. The
approved candidate is `google/gemini-3.5-flash-lite` pinned to
`google-vertex/global/flex`, with ZDR, `data_collection=deny`,
`require_parameters=true`, strict JSON Schema, and no automatic fallback.

`AI_MODE=free` remains a future option only after an explicit safe/redacted
input classification proves an eligible route. Until then it fails closed.

## Consequences

The optional capability stays disabled without complete privacy configuration.
Model output remains a validated non-authoritative proposal. No generic paid
fallback can bypass an unavailable privacy route.

## Status

Accepted; live endpoint responsiveness remains unproven.
