# Controlled OpenRouter live E2E evidence

## Phase 5A status

- Date: 2026-09-14
- `LIVE_OPENROUTER_E2E`: `PARTIAL`
- Live OpenRouter HTTP requests: `2 / 5`
- `FREE_PRIMARY_LIVE`: `UNAVAILABLE_UNDER_PRIVACY_POLICY` (HTTP 404).
- `STRUCTURED_OUTPUT_LIVE`: not reached; no structured response returned.
- `CHEAP_FALLBACK_LIVE`: not executed.

`OPENROUTER_API_KEY` was loaded only from the ignored local `.dev.vars` file;
its value was not printed, logged, hashed, committed, or copied into this
document. The live harness used the actual gateway and real fetch transport
with synthetic Vietnamese reminder input, `AI_MODE=free`, `openrouter/free`,
no configured fallback models, and the existing timeout/input/output bounds.

Two total OpenRouter HTTP requests were made (within the five-request budget).
The recorded request received HTTP `404`, with no selected model/provider,
usage, or reported cost returned. The gateway correctly reduced it to
`UNAVAILABLE`. No additional request was sent: a free primary that has no
eligible endpoint under strict structured-output and privacy routing must not
cause a policy relaxation or a paid fallback attempt. This is live evidence of
`FREE_PRIMARY_LIVE = UNAVAILABLE_UNDER_PRIVACY_POLICY` rather than a successful
structured-output proof.

## Official API revalidation

OpenRouter's current official documentation confirms that:

- Chat Completions uses `POST /api/v1/chat/completions` with a Bearer API key
  and supports non-streaming requests.
- Strict structured output uses `response_format.type = json_schema` and
  `json_schema.strict = true`; `require_parameters = true` prevents routing to
  endpoints that cannot honor the sent parameters.
- `data_collection = deny` restricts routing to providers that do not collect
  user data, and `zdr = true` restricts it to zero-data-retention endpoints.
- `provider.max_price.prompt` and `.completion` are USD per million-token
  ceilings. `max_price.request` applies only to per-request-priced endpoints.

Sources: [chat-completions API](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion),
[structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs),
and [provider routing / max price](https://openrouter.ai/docs/guides/routing/provider-selection).

## Cost and privacy outcome

The audit found that the pre-Phase-5A gateway serialized
`AI_MAX_FALLBACK_PRICE` as `max_price.request`. That did not constrain a
token-priced fallback. The gateway now applies that existing scalar ceiling to
both `max_price.prompt` and `max_price.completion`; it does not set a
request-priced ceiling for text LLM requests. Regression coverage proves the
serialized request shape. This is a stricter, unit-correct cap and does not
expand the fallback allowlist.

Configured fallback model IDs are absent from the local runtime configuration,
so `CHEAP_FALLBACK_MODEL_STATUS = NOT_CONFIGURED`. No paid model was selected,
queried, or authorized. Existing mocked state-machine tests remain the
deterministic fallback evidence.

The live harness exercised synthetic `/connect` input through the actual
privacy admission boundary and recorded zero additional OpenRouter HTTP calls;
it produced no CommandDraft or reminder. The OpenRouter gateway emits no AI
logs; provider error bodies and completion text are reduced to `UNAVAILABLE`.
The retained live evidence contains only HTTP classification, nullable safe
model/provider/usage/cost metadata, latency, gateway classification, and the
zero-call privacy resultâ€”never prompt, completion, Authorization, or API key.

## Bounded live-smoke procedure when the local secret exists

1. Confirm `.dev.vars` is ignored or use a process/OS secret mechanism; never
   print the value.
2. Set `AI_MODE=free`, retain `openrouter/free`, no fallback model, bounded
   input/output configuration, and synthetic Vietnamese reminder text only.
3. Invoke `OpenRouterIntelligenceGateway` with the real fetch transport once;
   never use a curl-only bypass.
4. Record only classification, selected model/provider metadata, token usage,
   reported cost, and latency. Do not retain prompt, completion, Authorization,
   or provider error body.
5. Validate the returned JSON through the existing strict proposal schema and
   domain admission boundary. It must remain non-authoritative: zero reminders
   before confirmation.
6. Run the synthetic privacy-negative case with a transport counter; it must
   remain zero and does not consume the five-request budget.

An unavailable free response under the enforced privacy and structured-output
policy is valid evidence and must not relax the policy.
