# Controlled OpenRouter live E2E evidence

## Phase 5A status

- Date: 2026-09-14
- `LIVE_OPENROUTER_E2E`: `PROVEN`
- Live OpenRouter inference requests: `6` (`5` under the original budget,
  then `1 / 2` under the separately authorized timeout-closure budget)
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
a 15-second gateway timeout and the same 15-second Vitest deadline; the test
harness therefore ended before it could distinguish the gateway abort outcome
from the harness deadline.

Read-only ZDR endpoint metadata then showed `google-vertex/global/flex` at
roughly 6.985 seconds p50 and 7.170 seconds p99 latency (at the time checked),
making the former 5-second default too low. Privacy mode now defaults to the
existing hard maximum of 30 seconds; `AI_TIMEOUT_MS` remains configurable only
within that 30-second bound, and the gateway continues to abort its `fetch`
through its `AbortController`.

The first request under the separately authorized timeout-closure budget used
the unchanged exact model, endpoint, ZDR policy, strict schema, and $1.50/M
prompt/completion ceiling. It returned HTTP 200 in 7.667 seconds. Safe response
metadata identified `google/gemini-3.5-flash-lite` and Google, included usage,
and reported a cost of $0.00010145. The response passed the existing strict
structured-output schema. The existing domain guard then rejected its semantic
proposal rather than admitting a reminder, which is the required fail-closed
outcome; no raw proposal was retained. A synthetic credential-like input made
zero outbound HTTP calls. No second timeout-closure request was sent.

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

## Outcome

Phase 5A live transport, routing, strict-output validation, privacy admission,
and semantic fail-closed behavior are proven. No deployment, Cloudflare
mutation, remote migration, or production change occurred.
