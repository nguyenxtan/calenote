# Calenote Production MVP Design

**Date:** 2026-09-03  
**Status:** Approved for implementation by the user's instruction to complete and deploy the product without further clarification  
**Production origin:** `https://calenote.iconiclogs.com`

## 1. Outcome

Deploy a production MVP in which a person can create a Calenote account with
their own Zalo or Telegram bot, bind one private chat, create a one-time
reminder by chatting, confirm the parsed time, manage reminders in a web
dashboard, and receive the reminder from the same bot around the scheduled
minute.

The deployed instance will be bootstrapped with the user's existing Zalo Bot
Platform token. The token must never be committed, returned by an API, written
to logs, or stored in plaintext.

## 2. Product scope

### Included

- Personal workspace only.
- BYOB connections for Zalo Bot Platform and Telegram Bot API.
- Real provider token verification and webhook registration.
- Private-chat binding with a short-lived, one-use `/connect` code.
- Bot-delivered one-time login code for returning users.
- One-time reminders created from deterministic Vietnamese commands.
- Explicit chat confirmation before a reminder becomes active.
- Dashboard list, manual creation, and cancellation.
- Cloudflare D1 persistence, Queue background processing, and a minute Cron
  Trigger for due reminders.
- Structured, secret-free operational logs and a health endpoint.

### Deferred

- Group chat, team workspaces, pair/couple workspaces, shared calendars.
- Recurring reminders, task projects, attachments, AI/LLM interpretation.
- Income/expense tracking and native iOS/Android applications.
- Calendar-provider synchronization and notification channels other than the
  connected bot.

The UI and docs must label deferred features as roadmap items rather than
shipping claims.

## 3. Supported conversation

The first grammar is deliberately narrow and auditable. Examples:

- `mai 8h nhắc tui gọi cho mẹ`
- `hôm nay 15:30 nhắc tôi gửi báo cáo`
- `ngày 10/09 lúc 9h nhắc mình đóng tiền điện`
- `nhắc tôi mai 20h uống thuốc`

The parser accepts `hôm nay`, `mai`, `ngày kia`, or an explicit `DD/MM` or
`DD/MM/YYYY`, plus a 24-hour time. The initial deployed timezone is
`Asia/Ho_Chi_Minh`. Past times, impossible dates, missing times, and commands
more than 366 days ahead are rejected with a help response.

A valid command creates a `PENDING_CONFIRMATION` draft and the bot replies with
the normalized local date/time. `có`, `ok`, `1`, or `xác nhận` activates it;
`hủy`, `huỷ`, `không`, or `2` cancels it. A new valid command replaces an older
unconfirmed draft for the same chat.

## 4. Account and chat binding

### First-time onboarding

1. The user provides display name, email, timezone, provider, and bot token.
2. The Worker verifies the token with the provider's `getMe` API.
3. The Worker creates a user, personal workspace, encrypted bot connection,
   and opaque browser session.
4. The Worker registers the production webhook with a derived webhook secret.
5. The response returns normalized bot metadata and one `/connect CODE`
   command. It never returns the token or encrypted credential.
6. The user sends the command in a private chat with their bot. A valid code
   binds that provider chat to the account.

Possession of a valid, unclaimed bot token is the proof used for first-time
account creation. A provider bot token fingerprint is globally unique so one
bot cannot be attached to multiple accounts.

### Returning login

The login page asks for email. If an active bound bot exists, Calenote creates
a six-digit, hashed, one-use code with a ten-minute lifetime and sends it to the
bound private chat. The web form exchanges the code for an opaque session.
Responses to code requests are intentionally generic to prevent email account
enumeration. Login requests and verification attempts are rate-limited.

Sessions use a random 256-bit bearer value in an `HttpOnly`, `Secure`,
`SameSite=Lax` cookie. D1 stores only an HMAC digest. Logout and expiry revoke
the database row.

## 5. Runtime architecture

The Next.js pages are static-exported into `out/`. A single module Worker serves
those assets and implements three entry points:

```text
fetch      -> API routes, provider webhooks, static asset fallback
queue      -> inbound command processing and outbound reminder delivery
scheduled  -> claim due reminders and enqueue delivery jobs every minute
```

Cloudflare resources:

- Worker: `calenote`
- D1: `calenote-production`
- Queue: `calenote-jobs`
- Dead-letter queue: `calenote-jobs-dlq`
- Custom Domain: `calenote.iconiclogs.com`
- Secret: `CALENOTE_MASTER_KEY`

Static assets run directly except `/api/*` and `/webhooks/*`, which invoke the
Worker first. The Worker uses bindings for D1, Queue, and assets; it never calls
Cloudflare's REST API at runtime.

This static-plus-Worker design is preferred over vinext or OpenNext for this
MVP because the current pages require no SSR, all authenticated state is loaded
client-side, and the Worker needs native `fetch`, `queue`, and `scheduled`
handlers. It preserves the existing visual implementation while minimizing
framework runtime surface at the security-sensitive boundary.

## 6. Canonical data model

D1 uses foreign keys, `STRICT` tables, UTC epoch-millisecond timestamps, and
opaque random IDs.

- `users`: email, display name, timezone.
- `workspaces`: one `PERSONAL` workspace per MVP user.
- `memberships`: user/workspace ownership.
- `sessions`: HMAC digest, user, expiry, revoked time.
- `bot_connections`: provider, public ID, provider bot ID, display name,
  encrypted token, IV, token fingerprint, state, credential version.
- `connect_codes`: HMAC digest, connection/user, expiry, consumed time.
- `chat_identities`: connection, provider user ID, private chat ID, display
  name, linked time.
- `login_codes`: HMAC digest, user, expiry, attempts, consumed time.
- `inbound_updates`: unique provider/connection/message identity, minimal
  normalized fields, processing state. Raw webhook bodies are not stored.
- `command_drafts`: identity, title, scheduled UTC time, status, expiry.
- `reminders`: workspace, identity, title, scheduled UTC time, timezone,
  lifecycle status.
- `reminder_deliveries`: one delivery per reminder, attempt state, provider
  receipt or safe error category.
- `audit_events`: actor, action, target IDs, result; no chat body or secrets.
- `rate_limits`: hashed subject, bucket, count, expiry.

The database is the source of truth. UI state, Queue delivery, and provider
responses never substitute for committed D1 state.

## 7. Credential and webhook security

`CALENOTE_MASTER_KEY` is a random 32-byte base64url Worker secret. HKDF-SHA-256
derives domain-separated keys for AES-256-GCM credential encryption, token
fingerprints, sessions, one-time codes, and webhook path/header secrets.

Each token is encrypted with a fresh 96-bit IV. AES-GCM additional authenticated
data contains connection ID, provider, and credential version. A fingerprint is
an HMAC, not a raw hash. Webhook path/header secrets are deterministic HMAC
derivations from the connection public ID and can be reconstructed without
plaintext storage.

Webhook handling must:

- match a known random public connection ID and path secret;
- compare the provider secret header in constant time;
- enforce content type, body size, and read deadline before parsing;
- accept only documented private text-message shapes;
- insert a deduplicated `inbound_updates` row before returning `2xx`;
- enqueue only the internal row ID, never the webhook body or bot token;
- avoid logging URL path parameters, headers, chat text, codes, or identifiers.

Mutating browser API requests require an authenticated session, same-origin
`Origin`, JSON content type, bounded bodies, and rate limits where abuse is
plausible.

## 8. Provider boundary

Both providers implement a normalized interface:

```ts
interface BotProviderAdapter {
  verifyToken(token: string): Promise<BotProfile>;
  setWebhook(token: string, input: WebhookRegistration): Promise<void>;
  parseWebhook(payload: unknown): InboundTextMessage | null;
  sendText(token: string, chatId: string, text: string): Promise<SendReceipt>;
}
```

Outbound requests have a fixed allowlisted hostname, no redirects, an absolute
eight-second deadline, and a 64 KiB response cap. Provider URLs and raw errors
are never logged because tokens are embedded in provider API paths.

Zalo uses `bot-api.zaloplatforms.com`; Telegram uses `api.telegram.org`.
Provider 401/404 credential failures suspend a connection. A received 429 may
be retried with bounded Queue backoff. Network timeouts and ambiguous transport
failures are marked `UNCERTAIN` and are not blindly retried.

## 9. Queue and scheduling semantics

The webhook commits a deduplicated inbound row, publishes
`{ type: "PROCESS_INBOUND", inboundId }`, then returns `200`. Queue delivery is
at-least-once, so every consumer rechecks D1 state before side effects.

Cron runs every minute in UTC. It conditionally claims due `PENDING` reminders
in bounded batches and publishes `{ type: "DELIVER_REMINDER", reminderId }`.
Conditional state transitions prevent concurrent cron invocations from claiming
the same reminder. A failed Queue publish returns the reminder to `PENDING`.

Before sending, the consumer creates or claims a unique delivery row. Success
stores the provider message receipt and marks the reminder `SENT`. A known quota
response requests bounded retry. An ambiguous timeout marks both delivery and
reminder `UNCERTAIN` for operator review instead of risking duplicate messages.

Product copy promises delivery around the scheduled minute, not exact-second
delivery.

## 10. UI surfaces

- `/`: session check, onboarding wizard, durable provider activation, and
  one-time `/connect` instruction.
- `/login`: email plus bot-delivered code flow.
- `/dashboard`: real connection status, upcoming reminders, recent delivery
  status, manual reminder form, cancel action, logout.
- `/docs`: accurate Zalo and Telegram setup/pipeline documentation.

Every loading, empty, success, and safe error state is keyboard accessible and
responsive. Tokens use password inputs and are cleared immediately after a
request settles.

## 11. Failure handling and observability

Public errors use stable codes and Vietnamese messages without provider bodies
or implementation details. Logs are structured allowlists containing operation,
provider, status category, duration, and random internal correlation ID only.

Health has two levels:

- `GET /api/health`: Worker process/config readiness without leaking bindings.
- authenticated dashboard health: connection state and last safe delivery
  category.

The dead-letter queue is configured so exhausted jobs are retained rather than
discarded. The dashboard exposes reminders in `FAILED` or `UNCERTAIN` state.

## 12. Test and release gates

- Unit tests for crypto, parser, provider normalization, session/codes, and
  state transitions.
- Route tests for auth, CSRF, request limits, webhook secret, dedupe, and safe
  errors.
- D1 migration applied locally and production schema queried after deploy.
- Worker type generation, TypeScript, ESLint, Vitest, Next static build, and
  Wrangler dry run all pass.
- Production health, static pages, session endpoints, provider `getMe`, webhook
  registration, and D1 state are verified live.
- The real Zalo token is scanned against repository/build output and must have
  zero matches.
- Full chat-to-notification proof requires the owner to send `/connect CODE`, a
  reminder command, and its confirmation from Zalo. Until those external user
  actions occur, deployment is reported as ready but not end-to-end proven.

## 13. Rollback

Retain the previously deployed Worker version. A bad code deployment rolls back
with Wrangler version rollback. D1 migrations are additive in this MVP; rollback
does not delete data. If webhook activation must be reversed, call the provider's
delete-webhook operation with the encrypted credential, mark the connection
`SUSPENDED`, and stop Cron/Queue consumers before reverting code.
