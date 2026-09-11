# Controlled OpenRouter live E2E evidence

## Phase 5A status

- Date: 2026-09-11
- `LIVE_OPENROUTER_E2E`: `BLOCKED_MISSING_LOCAL_SECRET`
- Live OpenRouter HTTP requests: `0 / 5`
- `FREE_PRIMARY_LIVE`: not executed.
- `STRUCTURED_OUTPUT_LIVE`: not executed.
- `CHEAP_FALLBACK_LIVE`: not executed.

`OPENROUTER_API_KEY` was absent from the local process environment. No local
secret file was present. The repository now ignores Wrangler's supported
`.dev.vars` local-secret file; no value was created or read. The key must be
supplied through a local secure mechanism before a controlled live smoke may
run. It must never be pasted into chat, committed, logged, or copied into
documentation.

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

The existing privacy admission tests use a gateway spy and prove credential-like
text, known sensitive values, and `/connect` content result in no gateway call,
no CommandDraft, and no reminder creation. The OpenRouter gateway emits no AI
logs; provider error bodies and completion text are reduced to `UNAVAILABLE`.
No live log was produced because no request left the process.

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
