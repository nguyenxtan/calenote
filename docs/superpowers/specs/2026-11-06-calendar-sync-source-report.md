# Google Calendar source report — 2026-11-06

Status: `SOURCE_COMPLETE_NOT_ACTIVATED`. All HTTP transport in this lane's validation was mocked. No secrets, Google account actions, resources, deployment, remote migrations or provider writes were performed.

Owned files: migration `0025_calendar_sync.sql`; `src/modules/calendar-sync/{contracts,google-provider,store,service}.ts` and focused tests including actual Workerd/D1 smoke; `src/worker/routes/calendar-sync.ts` and tests; `src/worker/optional-calendar-env.d.ts`; `src/components/calendar/CalendarSyncPanel*`; calendar-sync spec/plan/report.

The parent integrates shared files. Exact contract:

- Add SensitiveContentPurpose `calendar-oauth-tokens` to existing Keyring. Encryption AAD binds purpose + `connectionId:generation` + key version 1. Existing keyed `digestCode` is domain-separated for nonce, rate-limit owner, event id and payload. No plain title hashes.
- Call `calendarSyncCapability(env)`; instantiate provider only when its result is available. Required conjunction: `CALENDAR_SYNC_ENABLED==='true'`, nonempty `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`. Do not add these optional secrets to mandatory production secret gates or enable the flag in committed configuration.
- `new D1CalendarSyncStore(env.DB)`; `new GoogleCalendarProvider({clientId,clientSecret,appOrigin}, injectedHTTP)`; `new CalendarSyncService({enabled,clientId,store,keyring,provider|null,projection,now?})`.
- Projection port is `read(ownerId,now):Promise<{events:SyncEvent[],truncated:boolean}>`. Root calls export store's explicitly authorized internal `readForSyncAuthorizedOwner` only from the service under a real calendar-connection lease. Map `{uid,title,start,status}`; set `truncated = projection.truncated || projection.skipped>0`. Never expose an owner selector publicly. Public export retains live-session fences.
- Register GET `/api/calendar/sync` and POST `/api/calendar/sync/{begin,code,disconnect}` in router and API allowlist. Exported handlers: `handleCalendarSyncStatus(request,create)`, `handleCalendarSyncBegin(request,origin,create)`, `handleCalendarSyncCode(request,origin,create)`, `handleCalendarSyncDisconnect(request,origin,create)`. All require canonical session cookie; mutations require exact Origin; code additionally requires `X-Requested-With: XmlHttpRequest` and strict body `{nonce,code}`. No GET OAuth callback or secret-bearing app URL.
- `CalendarSyncOperations`: `requireUser(credentials)->SessionPrincipal`, `getCalendarSyncStatus(userId)`, `beginCalendarSync(principal)`, `completeCalendarSync(principal,{nonce,code})->{connectionId,state:'PENDING'}`, `disconnectCalendarSync(userId)`. Map `CalendarSyncError.code/status/message` through content-free router errors. Rate limit error is `CALENDAR_RATE_LIMITED`/429.
- After successful complete, enqueue `{type:'SYNC_CALENDAR',connectionId}` with the internal opaque id. Queue consumers call `service.sync(id)` and acknowledge returned statuses. Cron calls `selectDue(5)`, queues only those ids. Per-connection immutable lease/egress marker, `next_sync_at`, attempt count and mapping CAS provide ownership/backoff. Duplicate queue delivery before due time is skipped. Failed enqueue is recoverable by cron.
- Mount named `CalendarSyncPanel` on the calendar/settings screen. It loads GIS only after explicit connect and an available capability. Preparing and then continuing are separate clicks to preserve popup user activation. Keep remote-calendar copy is explicit, including new calendar on reconnect. Callback only posts code in the JSON body; tokens are never returned to the browser.

Validation on 2026-11-06:

- `pnpm exec vitest run src/modules/calendar-sync src/worker/routes/calendar-sync.test.ts src/components/calendar/CalendarSyncPanel.test.tsx` → 35/35 passed.
- Actual Workerd/D1 smoke applies every forward migration including 0025, proves exactly one concurrent claim/nonce/disconnect winner, expired unresolved egress hold, stale-marker rejection and audit-trigger rollback preserving tokens. Uses the existing local semanticRuntime helper with no provider transport.
- Targeted ESLint over those owned TS/TSX files → no warnings/errors.
- `pnpm exec tsc --noEmit --pretty false --incremental false` → no diagnostics after root's concurrent fixes.
- RED→GREEN checks covered missing provider/store/routes/UI, successful-update retry accounting, duplicate queue backoff, content-free audits/rate limits, persisted calendar state after an uncertain event create. Tests also prove live-session/owner/nonce/replay fences, encrypted token storage, response privacy, no ambient fetch, stable deterministic IDs, explicit cancellation only, write/projection bounds, unresolved egress fencing and disconnect/revoke races.

Operational limits:

- Not qualified against a real Google account. Activation needs human-owned Cloud project/API/client/origin/consent setup, privacy review, environment-scoped secrets, reviewed migration/deploy and an explicitly authorized live smoke. Google OAuth revocation affects all grants in that Cloud project; use an isolated project/client arrangement for the feature.
- Sync is one-way from a bounded 300-event projection; twenty changed events per sweep and fifty HTTP requests maximum. Timed reminders use a one-minute slot, date-only reminders one day. Five-minute normal cadence; one-minute continuation for unfinished sweep; exponential retry bounded to one hour and six attempts.
- Only explicit CANCELLED projected events remove managed remote events. Missing, out-of-window, corrupt/skipped or truncated rows never delete remote events. External edits are not imported; unchanged remote events are not routinely polled.
- Unknown secondary-calendar insertion pauses as SETUP_UNCERTAIN without another automatic create. It requires user inspection and explicit disconnect before reconnect. Old remote calendars/events stay; reauthorization creates a fresh dedicated calendar rather than assuming the same Google account.
- A lost provider-request settlement leaves a durable unresolved egress marker. Neither lease expiry nor disconnect bypasses it. An operator must verify settlement before clearing that marker; no unsafe automatic repair endpoint is included. Revocation failure still drops local secrets and reports manual Google permission removal.
- Remote-delete-on-disconnect is deliberately absent; keeping remote events is the sole supported choice. No full-suite/build/deploy claims are made by this isolated lane; the parent owns integrated verification and fresh review.
