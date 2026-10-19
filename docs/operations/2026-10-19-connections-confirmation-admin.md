# Connections, chat confirmation and admin — implementation candidate

This document describes local implementation, not production activation. Base is master b11c7d439ab79467f1e2c843723f4548d0a3e29f. The owner approved the in-chat behavior and requested full implementation/test on 2026-10-19.

## User behavior

- Connections adds an owned Zalo or Telegram bot using server token validation and existing encrypted activation/connect-code flow. Adding does not replace the current account/session.
- Local disconnect disables Calenote ingress/egress and keeps history, reminders, identity and encrypted credential. It does not delete the platform bot, unregister its webhook, revoke its token or claim to recall a send already started. In-flight or UNCERTAIN login/reminder work blocks disconnect; unresolved durable sends, including typing feedback after dispatch, require operator reconciliation. Reservations never expire automatically; timeout cannot prove whether the provider accepted a send. Normal webhook retry/code rotation cannot reactivate an intentional disconnect.
- Preserve a usable login channel: select another active bound bot as primary before disconnecting the primary. A new explicit primary selector avoids ambiguous multi-bot login. Existing singleton selection is retained when another bot is added; ambiguous preexisting accounts must select explicitly.
- Web manual reminders require an explicit owned active bot when multiple bots are bound. Chat-created reminders retain their originating chat. The selected web target is bound into durable intent identity; recovery cannot move a reminder to a different bot.
- Account setting `reminderConfirmation` defaults to `auto`. An explicit complete, validated chat CREATE commits atomically and replies with confirmation. Missing/ambiguous/invalid details still clarify. Setting `preview` restores the separate confirmation step. Greetings and untrusted content are not write authority. Successor activation and paid inference policy are unchanged.
- Admin `/app/admin` is read-only and requires an authenticated stable user ID in server-only `CALENOTE_ADMIN_USER_IDS`. Missing/invalid configuration denies everyone. No actual identity is selected or granted by this candidate. Navigation is shown only after a server capability check, not from email/display name.
- Admin shows total accounts, distinct recorded daily/monthly actors in Vietnam time, and reservation/finalization totals by the canonical UTC ledger. Recorded activity is partial, not full retention analytics. Finalized budgets may include ceilings; provider actual cost and Cloudflare invoice are UNKNOWN, never zero or fabricated settlements.

## Persistence and release boundaries

New migrations0011 (local disconnect egress reservations),0012 (account confirmation policy),0013 (primary login channel) are local append-only source. Existing0009/0010 status must be freshly inventoried before any authorized production release; local tests do not apply remote migrations.

No configuration, provider/AI authority, production migration, identity grant, credential or deployed Worker change is included. Exact source SHA approval, scoped migration approval and persistent admin-grant confirmation remain separate release gates. Do not reuse old6d/admin73/UI469 packets or release journals.

A rollback must preserve intentional-disconnect fences and support selected primary login channels; the historical Worker is not automatically certified merely because additive migrations parse. D1 changes are forward-only. Require a tested compatible rollback version, or explicitly review the lost-feature/recovery behavior before promotion. Do not replay elapsed pending reminders or unresolved sends on reconnect.

## Verification

Evidence is recorded in the implementation plan ledger and final handoff. All UI fixtures use synthetic users, costs and bots; no production provider acceptance is claimed. Unknown provider/billing values stay UNKNOWN. Automated tests must cover actual Worker/session/D1 paths, ownership, transaction rollback, duplicate requests, multiple bots, retry/reload and desktop/mobile accessibility.
