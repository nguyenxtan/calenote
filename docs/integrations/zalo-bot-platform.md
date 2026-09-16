# Zalo Bot Platform integration

Calenote integrates with **Zalo Bot Platform** as a BYOB provider. It does not
use Zalo OA OpenAPI. This page distinguishes current production evidence from
historical incident evidence.

## Status and safety

- **IMPLEMENTED:** Zalo onboarding, encrypted credential persistence, webhook
  registration, inbound parsing/persistence, `/connect`, reminder delivery, and
  recovery APIs.
- **PROVEN_IN_PRODUCTION:** `getMe`, `getWebhookInfo`, `testWebhook`, real
  private webhook ingestion, flat payload parsing, encrypted D1 persistence,
  Queue/inbound processing, and the bound-chat reminder create/confirm flow
  have completed under controlled production evidence.
- **HISTORICAL_INCIDENT:** Earlier missing-Worker-event observations and the
  inconclusive polling investigation are retained for forensic context only.

The bot token appears in Zalo's provider request path. Calenote never logs,
returns, stores in browser storage, places in an application URL, or exposes the
token. The provider adapter uses the fixed HTTPS host
`bot-api.zaloplatforms.com`; it never accepts a user-provided provider URL.

## Implemented provider operations

All operations are server-side `POST` requests to
`https://bot-api.zaloplatforms.com/bot<BOT_TOKEN>/<operation>`. Request and
response bodies remain inside the adapter unless explicitly converted to the
safe domain result below.

| Operation | Implemented Calenote use | Safe outcome |
| --- | --- | --- |
| `getMe` | Validate submitted credential during onboarding/recovery. | Normalized bot profile only; token is never returned. |
| `setWebhook` | Register a derived canonical URL and derived header secret after validation. | Activation succeeds only if the provider reports successful verification. |
| `getWebhookInfo` | Verify configured webhook during an explicitly authorized production read-back. | Configured/exact/host/path-prefix booleans only. |
| `testWebhook` | Provider webhook reachability test. | `apiOk` and `resultOk` only. |
| `sendMessage` | Send an outbound reminder/login/confirmation to a bound chat. | Provider message receipt ID is retained internally. |

Official API references: [getMe](https://docs.zaloplatforms.com/docs/BOT/apis/getMe),
[setWebhook](https://docs.zaloplatforms.com/docs/BOT/apis/setWebhook),
[getWebhookInfo](https://docs.zaloplatforms.com/docs/BOT/apis/getWebhookInfo),
[testWebhook](https://docs.zaloplatforms.com/docs/BOT/apis/testWebhook),
[sendMessage](https://docs.zaloplatforms.com/docs/BOT/apis/sendMessage).

## Webhook contract

**IMPLEMENTED:** Calenote derives a per-connection HTTPS webhook URL and a
separate secret header value internally. It checks the path secret and then
compares `X-Bot-Api-Secret-Token` in constant time before reading the bounded
JSON body. It never logs the URL, its path secret, or the header secret.

The documented Zalo webhook envelope is an object, not an array:

```json
{
  "ok": true,
  "result": {
    "event_name": "message.text.received",
    "message": {
      "message_id": "provider-message-id",
      "date": 0,
      "from": { "id": "provider-user-id", "is_bot": false },
      "chat": { "id": "private-chat-id", "chat_type": "PRIVATE" },
      "text": "message text"
    }
  }
}
```

The normal parser accepts only `message.text.received` private, non-bot
messages with required identifiers/timestamp/text. It immediately encrypts
accepted text and persists a deduplicated inbound record before an opaque queue
job. Other event types do not establish chat identity or create a reminder.
The canonical payload contract is documented by [Zalo Webhook](https://docs.zaloplatforms.com/docs/BOT/webhook).

## Retired incident diagnostic

The prior owner-only polling diagnostic, including `deleteWebhook` and
`getUpdates`, was retired during the trusted-machine master cutover. It was an
incident investigation mechanism, not a product capability, and no longer
exists in the application, Worker schedule, or deployable configuration.

## `/connect` lifecycle

**IMPLEMENTED:** After a connection reaches `ACTIVE_UNBOUND`, Calenote creates
an expiring one-use `/connect <code>` command. Only a digest is persisted.
The user sends the command in a private chat with the correct bot. A valid
inbound private message consumes the code atomically, fences ownership in D1,
binds the provider user/chat identity, and transitions to `ACTIVE_BOUND`.

- `ACTIVE_UNBOUND`: active connection, no trusted private chat yet; code can be
  generated/rotated through the authenticated owner UI.
- `ACTIVE_BOUND`: private chat is bound; reminders and login-code delivery can
  select it. There is no reconnect action in the current UI.
- `WEBHOOK_FAILED`: retry the webhook path without requesting the bot token
  again.
- `SUSPENDED`: credential requires review; it must not use the webhook-retry
  flow as a substitute for credential replacement.

## Production interpretation

`testWebhook` returning success proves that Zalo's webhook verification reached
an acceptable endpoint. It **does not prove** Zalo dispatches real private
message events to the Worker, that Calenote accepts/parses them, that D1 receives
an inbound row, or that `/connect` reaches `ACTIVE_BOUND`.

The current production state is PROVEN_IN_PRODUCTION: a real private Zalo
webhook reached the Worker, passed path/header authentication, used the flat
payload shape, persisted encrypted inbound data, traversed Queue/inbound
processing, and completed the bound-chat reminder create/confirm/outbound reply
flow. `testWebhook` remains reachability evidence, not a substitute for this
separate observed flow. The older missing-event incident is historical only.
