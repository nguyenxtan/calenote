# Controlled OpenRouter live E2E evidence

## Phase 5A status

- Date: 2026-09-14
- `LIVE_OPENROUTER_E2E`: `PARTIAL`
- Live OpenRouter inference requests: `5 / 5`
- Raw prompts, completions, Authorization headers, and API keys: never retained.

The first three synthetic requests used `AI_MODE=free` and `openrouter/free`.
The router returned HTTP 404 with the safe classification `no endpoint matching
Zero Data Retention`; no provider was selected and no output was admitted.

Catalog discovery then proved that `google/gemini-3.5-flash-lite` has current
ZDR endpoints supporting `structured_outputs`, `response_format`, and
`max_tokens`. The approved explicit endpoint was
`google-vertex/global/flex`, at catalog pricing $0.15/M prompt and $1.25/M
completion. The live gateway request pinned that endpoint and retained
`zdr=true`, `data_collection=deny`, `require_parameters=true`, strict JSON
Schema, `allow_fallbacks=false`, and a $1.50/M prompt/completion ceiling.

Request four timed out at the existing 5-second runtime timeout before an HTTP
response envelope. Request five repeated the identical policy and endpoint with
the valid 15-second timeout configuration; it also timed out before an HTTP
response envelope. No sixth request is authorized. Therefore no selected
provider/model, usage, reported cost, structured output, or domain admission is
claimed. Both attempts are recorded only as bounded transport timeouts.

## Policy outcome

Calenote is **PRIVACY-FIRST / FREE-WHEN-ELIGIBLE**. User-derived content uses
only an explicit, pinned ZDR route with data collection denied, required
parameters, strict schema, and an explicit maximum token price. The generic
`openrouter/free` router is not a universal production primary while mandatory
ZDR has no eligible endpoint. No current safe/redacted input boundary has been
implemented, so free mode fails closed at runtime configuration rather than
downgrading privacy or selecting a paid fallback.

The gateway emits no provider logs and reduces failures or malformed output to
`UNAVAILABLE`. The synthetic credential-like privacy admission test retains its
zero-outbound-call evidence.

## Next authorized live action

Do not send more OpenRouter requests under this Phase 5A budget. Review the
provider timeout/availability evidence and explicitly authorize a fresh bounded
live budget before further diagnosis or retrying the candidate.
