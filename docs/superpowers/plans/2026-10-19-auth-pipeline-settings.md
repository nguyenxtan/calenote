# Auth pipeline and flexible Settings implementation plan

> For agentic workers: use superpowers:subagent-driven-development and verification-before-completion. User explicitly approved the in-chat pipeline and Settings scope and asked to execute/test now.

Goal: route new emails to bot setup, require proof for existing accounts, make Settings functional and coherent.
Architecture: bounded changes to current login/onboarding, account APIs and browser presentation. Existing bot-based OTP is identity proof; email discovery alone grants nothing. Account personalization/profile/sessions use server-owned userId. Device appearance has a typed allowlisted local preference store and no backend effects.
Spec: approved user messages in this chat, including latest explicit execution request2026-10-19.

## Constraints
- No production deployment/migrations/provider/AI calls/admin grant. New exact-SHA authorization needed for release.
- Existing account email lookup may reveal existence per owner's explicit product decision; same-origin, bounded input, rate limiting. Never reveal IDs/bot names or mint sessions merely from email.
- Preserve exact-proof onboarding recovery; never attach arbitrary new bot to old email or show private data before verification.
- Profile name update is not privileged identity/admin eligibility; email remains verified-flow-only and unchanged.
- Appearance is device-local, clearly labeled, whitelist default page, robust malformed/blocked storage fallback. No arbitrary redirect URL.
- Sessions never expose digest/cookie/secret. Revoke only same owner's other sessions, preserve current.
- Deferred: quiet hours/snooze/export/delete, dark theme, timezone expansion; Vietnam scheduling unchanged.

## Tasks and ownership
- [x] Auth implementer: TDD email classification API and Login/Onboarding transitions, proof/recovery/races/limits. Own auth/onboarding/contracts/routes-specific files; root integrates shared router/composition.
- [x] Account Settings implementer: TDD display name update and session listing/revoke-other API; SettingsPanel profile/session/channel controls and FinalScreen data wiring. Own these files only. Root supplies separate AppearanceSettings component.
- [x] Root: typed device appearance (density,text size,weekstart,lunar visibility,default page), global CSS/startup, calendar integration; default redirect helper for auth implementer.
- [ ] Integrate routes/composition; tests real SQLite/Worker/auth boundaries; full suite on frozen clean SHA, docs/type/lint/build/types/dryrun; synthetic desktop/mobile/keyboard/privacy UX; independent review and draft PR/evidence.

## Review focus
- Unknown email is NEW; known but unusable bot is RECOVERY, not bogus OTP success.
- No unauthorized email-to-account login, takeover via arbitrary token, missing primary, user switching and stale requests.
- Profile validation, real session/menu updates, other owner isolation, revoke retains current.
- Storage stale/corrupt/denied, cross-page behavior, Sunday offset and lunar accessible labels match display.
- Density genuinely changes row/card/page spacing and text scale without shrinking touch targets or horizontal overflow.

Ledger: independent auth review found post-onboarding singleton without primary incorrectly classified RECOVERY. RED/GREEN real SQLite coverage and eligibility fix now preserve authoritative primary or exact singleton fallback. Re-reviewC0/I0. Account/appearance independent reviewC0/I0 with14 focused tests rerun. Rootreal-router/session/keyring/SQLite integration covers discovery noqueue/no-session, profile readback and owned session revoke. Full frozen-suite and browserQA next.
