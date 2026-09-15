# Zalo production acceptance

## Classification

- **IMPLEMENTED:** the Worker/provider/D1/Queue flow documented below exists.
- **PROVEN_IN_PRODUCTION:** record each completed step with commit, Worker
  version ID, target, timestamp, and only safe metadata.
- **OPEN_INCIDENT:** the current Zalo real-message path is not accepted.
- **PLANNED:** no step below is satisfied by a future design or a local mock.

## Safety rules

Never place bot tokens, webhook URLs or path secrets, header secrets, connect
codes, message text, chat IDs, provider user IDs, raw payloads, or headers in
logs, tickets, screenshots, command history, or this runbook. Use production
only with explicit authorization. Do not remove a webhook manually for polling:
the provider secret cannot be recovered from `getWebhookInfo`.

## Deterministic acceptance sequence

A production Zalo integration is accepted only after every applicable step is
recorded successfully in order:

1. `getMe` — validate the submitted bot credential through Calenote; record
   only safe profile/operation result.
2. `setWebhook` — activate with Calenote's internally derived HTTPS URL and
   header secret; require provider verification success.
3. `getWebhookInfo` — verify the canonical production host and
   `/webhooks/zalo/` path prefix; do not record the full URL.
4. `testWebhook` — require API success and `result.ok` success. Mark only
   **webhook reachability**, not message E2E.
5. Send exactly one real private text from the intended Zalo account to the
   bot.
6. Observe safe Worker receipt diagnostic metadata.
7. Verify a new, owner-scoped encrypted inbound record in D1.
8. Verify the corresponding opaque Queue dispatch/process result.
9. Generate and send exactly one current `/connect` command in the private chat.
10. Verify the private chat identity is bound to the correct owned connection.
11. Verify the connection becomes `ACTIVE_BOUND`.
12. Trigger the existing safe outbound confirmation path and verify a provider
    receipt without exposing its message content or identifiers.

Failure at any real-message step leaves the integration unaccepted. Do not use a
green `testWebhook` result as a substitute for steps 5–12.

## Production deployment guardrail

Run this gate for every Worker promotion that changes Zalo provider transport,
webhook normalization, inbound persistence, encryption, queue processing, or
the conversational processor. It is deliberately separate from the generic
HTTP smoke check: a `200` at the app origin and a green `testWebhook` do not
prove real Zalo message delivery.

### Before promotion

1. Run the canonical repository gate, including provider, webhook, inbound,
   reminder-command, and D1 integration tests. A deploy must include the
   regression coverage for all of the following contracts:
   - Zalo provider requests use the HTTPS hostname allowlist, bounded response
     body, bounded timeout, and redirect fencing. The Zalo transport uses
     `redirect: "manual"`; do not restore `redirect: "error"` because that
     exact RequestInit combination failed before an upstream response in the
     production Worker runtime.
   - Zalo webhook normalization accepts the documented wrapped event and the
     real flat event shape. Authentication still happens before either shape is
     considered.
   - Persisted D1 encrypted BLOB values are normalized from D1's byte-array
     read representation before decrypting. Do not assume a production BLOB is
     an `ArrayBuffer`; do not migrate or rewrite existing encrypted values.
2. Confirm the narrowly scoped Cloudflare Configuration Rule remains active:

   ```text
   hostname = calenote.iconiclogs.com
   method = POST
   path starts with /webhooks/zalo/
   Browser Integrity Check = OFF
   ```

   This is a Zalo webhook ingress exception only. Never disable Browser
   Integrity Check globally and never widen the path or method match.
3. Preserve the canonical production bindings and secrets. Never re-enter,
   print, rotate, or place the bot token, `CALENOTE_MASTER_KEY`, webhook URL,
   path secret, or `X-Bot-Api-Secret-Token` in a command, log, deploy record,
   or test fixture.
4. Record the Git commit, immutable Worker version ID, target, UTC timestamp,
   and provider-free HTTP smoke/read-back before promotion. Do not apply D1
   migrations as part of this gate.

### After promotion: authorized real-message smoke

Provider activity is not a generic CI smoke test. With explicit authorization,
use one intended private Zalo chat and record safe metadata only:

1. Check `getWebhookInfo` for the canonical host and `/webhooks/zalo/` prefix,
   then run `testWebhook`. Treat both as reachability evidence only.
2. Send one harmless private text. Confirm, in order: Worker receipt, path and
   header authentication, accepted parser event, encrypted inbound D1 row,
   queue dispatch, D1 BLOB materialization, decryption, command parsing, and a
   terminal inbound state.
3. If the connection is not already bound, generate one current `/connect`
   command through the authenticated Calenote UI and send it once in that same
   private chat. Confirm one chat identity, `ACTIVE_BOUND`, one bind audit
   event, and an outbound confirmation receipt. A duplicate delivery or a
   second same-chat `/connect` must be idempotent; it must not create another
   identity, audit event, or partial bind.
4. Exercise one reminder draft and confirmation only when that side effect is
   explicitly authorized. Verify the draft, confirmation, persisted reminder,
   and provider receipt without recording title, text, identifiers, or secrets.

If any step fails, stop the acceptance run. Capture only the existing safe
diagnostic categories, preserve the known-good immutable Worker version, and
use the incident decision tree below. Do not guess by changing WAF, DNS,
credentials, webhook authentication, D1 data, or provider request shape.

### Failure isolation order

Use the observed boundary to avoid reopening already-proven infrastructure:

```text
no Worker event
  -> verify the narrow Browser Integrity Check exception and edge evidence
Worker event but parser rejected
  -> inspect wrapped/flat event-shape diagnostics; do not loosen authentication
inbound persisted but processor cannot map encrypted fields
  -> verify shared persisted-D1-BLOB normalization and byte-array coverage
decryption/command parsing fails
  -> inspect redacted processor category and the exact tested application boundary
bind fails
  -> inspect transaction/idempotency result; never consume or rotate a code manually
```

Never log or infer from raw provider payloads, message content, tokens,
identifiers, encrypted values, or secret-bearing webhook paths.

## Current open incident evidence

| Fact | Classification |
| --- | --- |
| `getWebhookInfo` reported the canonical Calenote host and webhook path prefix. | PROVEN_IN_PRODUCTION |
| `testWebhook` reported `webhook.ok`. | PROVEN_IN_PRODUCTION |
| A real private `/connect` produced no observed Worker event. | OPEN_INCIDENT |
| A real plain private text produced no observed Worker event. | OPEN_INCIDENT |
| Owner-scoped inbound count remained zero. | OPEN_INCIDENT |
| The first controlled polling result was inconclusive because its diagnostic parser expected `result` to be an array. | OPEN_INCIDENT |
| The polling diagnostic restored the webhook successfully. | PROVEN_IN_PRODUCTION |

The corrected diagnostic parser now expects the documented object-shaped
`getUpdates` result. This does not establish a provider root cause and does not
close the incident. A second live probe requires explicit authorization and may
run only once within the existing per-connection rate window.

## Incident decision points

- Provider 403 and no Worker event: inspect Cloudflare edge controls before
  altering handler authentication.
- Worker event observed: inspect route match, path/header authentication, body
  parsing, provider-payload recognition, and inbound persistence in that order.
- `testWebhook` success but no real message: retain the OPEN_INCIDENT and do not
  declare webhook E2E healthy.
- Polling diagnostic restore cannot be verified: stop immediately. Do not retry
  or mutate the provider again until restoration is reviewed.

## Deployment evidence

For a runbook action, record only: Git commit, immutable Worker version ID,
deployment target, timestamp, safe HTTP smoke/read-back result, and the
classification above. A Worker rollback never reverses D1 migrations; migrations
remain immutable and forward-only.
