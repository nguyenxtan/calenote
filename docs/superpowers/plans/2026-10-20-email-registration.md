# Email-first registration implementation plan

> Execute with superpowers:subagent-driven-development for bounded independent components.

Goal: register via verified email first, connect a bot afterward.
Architecture: D1 durable OTP challenge + atomic verified account graph; same-origin cookie-bound routes; explicit mail binding; new registration UI.
Spec: ../specs/2026-10-20-email-registration.md
Tech stack: existing TypeScript/React/Next/D1/Cloudflare email binding and Vitest.

- [x] OTP core, migration0017 and actual-database abuse/replay/concurrency/rollback tests.
- [x] Private cookie-bound request/verify handlers and strict API contracts.
- [x] Email-first UI, resend/expiry/errors and existing login handoff.
- [x] Retire unsigned bot-first creation; integrate optional mail binding fail-closed.
- [x] Verify authenticated first bot belongs to verified email account; independent security review.
- [ ] Finish full candidate validation and CI.
- [ ] Qualify sender/domain and real designated recipient, then exact-SHA release/migrations/live checks.

Ruling: retain legacy bot login and refuse unverified legacy-email signup claims; new verified-email accounts may log in by email before adding a bot. Missing mail binding blocks registration rather than falling back to an unverified account or bot-first creation.
