# Zalo Bot Platform integration

Calenote integrates with **Zalo Bot Platform** as a BYOB provider. It does not
use Zalo OA OpenAPI. This page distinguishes implemented contracts from the
unresolved production inbound incident.

## Status and safety

- **IMPLEMENTED:** Zalo onboarding, encrypted credential persistence, webhook
  registration, inbound parsing/persistence, `/connect`, reminder delivery, and
  recovery APIs.
- **PROVEN_IN_PRODUCTION:** `getMe`, `getWebhookInfo`, and `testWebhook` have
  completed against the production connection under controlled evidence.
- **OPEN_INCIDENT:** Real private messages have not been observed at the Worker;
  do not call the inbound path accepted until the real-message checklist passes.

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
| `getWebhookInfo` | Verify configured webhook before a temporary polling diagnostic or incident read-back. | Configured/exact/host/path-prefix booleans only. |
| `testWebhook` | Provider webhook reachability test. | `apiOk` and `resultOk` only. |
| `deleteWebhook` | Temporary owner-only polling diagnostic after an exact-match pre-delete fence. | No provider body exposed. |
| `getUpdates` | Temporary, bounded 22-second polling diagnostic only. | `updateReceived`, allowlisted event name, and private-chat boolean only. |
| `sendMessage` | Send an outbound reminder/login/confirmation to a bound chat. | Provider message receipt ID is retained internally. |

Official API references: [getMe](https://docs.zaloplatforms.com/docs/BOT/apis/getMe),
[setWebhook](https://docs.zaloplatforms.com/docs/BOT/apis/setWebhook),
[getWebhookInfo](https://docs.zaloplatforms.com/docs/BOT/apis/getWebhookInfo),
[testWebhook](https://docs.zaloplatforms.com/docs/BOT/apis/testWebhook),
[deleteWebhook](https://docs.zaloplatforms.com/docs/BOT/apis/deleteWebhook),
[getUpdates](https://docs.zaloplatforms.com/docs/BOT/apis/getUpdates), and
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

## `getUpdates` diagnostic contract

Zalo documents `getUpdates` response message data as a JSON object similar to a
Webhook payload. For Calenote's temporary diagnostic, a valid object result maps
immediately to:

```text
updateReceived = true
eventName = message.text.received | message.unsupported.received | NONE
privateChat = result.message.chat.chat_type === "PRIVATE"
```

An empty/missing/non-object result maps to `updateReceived = false` and
`eventName = NONE`. Raw provider update objects, message text, chat ID, user ID,
token, webhook URL/path, and headers cannot leave the provider adapter. The
diagnostic does not change connection state or rotate a connect code.

Polling and webhook delivery are mutually exclusive at the provider. The
temporary diagnostic therefore performs an exact-match `getWebhookInfo`
pre-delete fence, deletes only Calenote's expected webhook, long-polls once,
and restores the exact derived webhook in `finally`; it retries restoration once
and verifies restoration. It is owner-only, same-origin, Zalo-only,
`ACTIVE_UNBOUND`-only, rate-limited to one probe per connection per ten minutes,
and not a regular product capability.

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

The current production incident is OPEN: `getWebhookInfo` is canonical and
`testWebhook` is `webhook.ok`, but a real `/connect` and a plain private text
were not observed by the Worker and inbound count stayed zero. The first polling
probe is inconclusive solely because its prior diagnostic parser expected an
array. Webhook restoration was proven successful. See
[zalo-production-acceptance.md](../runbooks/zalo-production-acceptance.md) for
the required real-message evidence before acceptance.
