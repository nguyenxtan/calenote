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
