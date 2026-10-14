# UI navigation and guide handoff — 14 October 2026

Branch: `codex/unified-navigation-guide`. Worktree: `/Users/bichtuyen/.codex/worktrees/cbe5/calenote`.

## Scope and baseline

The initial local `master` assumption `de7b4e0c23177ca2ea25143de4879a7199d9da4a` was stale. Owner/coordinator explicitly selected `6329b33264a2916f004953865f6483fafdfd7491`, which matches the production UI observed in Chrome on 14 October. Coordinator supplied a 28 September deployment record for Worker `5bde4cd7-b094-4ae1-8e1e-a102091b7897` at that SHA. This session has **not** obtained a fresh Cloudflare allocation read-back; the record is a candidate rollback target, not proof it is still active or available.

Changes stay on the feature branch. No semantic candidate, Worker code, auth logic, contracts/API, migrations, configuration, provider calls, merge, push or deployment is included. The existing `logout()` implementation is byte-equivalent to baseline. One SettingsPanel sentence now says Menu rather than the removed label Thêm; this is a UI copy change only.

## Inventory and short plan

| Destination | Existing behavior | Change |
| --- | --- | --- |
| `/app/today` | Quick capture, upcoming and attention lists, pending proposals | Shared menu/help entry |
| `/app/calendar` | Calendar and month navigation | Shared menu |
| `/app/inbox` | Review approve/reject proposals | Shared menu |
| `/app/reminders` | Waiting/history filters, cancel | Shared menu |
| `/app/connections` | States, retry webhook, generate/copy connect code | Shared menu; no bot lifecycle changes |
| `/app/activity` | Recorded account activity | Shared menu |
| `/app/settings` | Profile, personalisation, local density, delivery/privacy links | Shared menu; one label correction |
| `/docs` | Previously technical bot pipeline; connection CTA pointed to `/` | Six task sections, real screen links, troubleshooting, real fixture screenshot |
| `/` | Landing with illustrative chat receipt | Product tasks, help/settings links, real fixture screenshot |
| `/login`, `/onboarding`, `/dashboard` | OTP entry, user-owned bot setup, Today redirect | Routes and auth unchanged |

Plan implemented: one grouped menu definition for desktop/mobile, current-page styling, account/help discovery; task-based Vietnamese guidance; truthful landing retaining orange/white tokens; targeted/full checks, independent review and browser fixtures. Public guide stays usable without auth; personal links retain their existing session gates.

## Evidence and limitations

- Before/after images and logs are local-only in ignored `artifacts/ui-navigation/`.
- `public/guide/today-desktop.jpg` and `create-reminder.jpg` are actual Chrome screenshots of the final UI at a 1440×1000 viewport, synthetic fixture data only. The guide/landing captions explicitly label local sample data. The form screenshot shows content and the selected time; no create submission occurred.
- Desktop 1440×1000, mobile 390×844 and short mobile 320×568 were inspected. No horizontal overflow was measured on landing/help/menu at tested mobile widths. At 320×568 the panel has 466px height and 633px scrollable content.
- Mobile panel: focus enters Hôm nay; Tab reaches Lịch; Escape closes and restores Menu focus. Menu links open Settings and Help; Settings is current in the panel and Menu is highlighted for secondary destinations.
- Browser synthetic login/logout: a temporary localhost-only fixture adapter returns canned auth responses and toggles a synthetic session. Logout navigates to `/login`; email→six-digit sample input→verify navigates to Today. This does not prove OTP delivery, cookies/security, D1, provider or production behavior. Adapter source is preserved locally as `artifacts/ui-navigation/auth-fixture-source.txt`, excluded from product output.
- Final targeted UI/login suite: 50/50 passed across seven files. Earlier UI-only run: 40/40 passed. Full suite: 1875/1877 passed; two untouched benchmark tests timed out under the full run (5s and 120s). Isolated rerun of their file passed 18/18 in 49.81s. Do not describe the original full run as green.
- Typecheck, lint, Next static build and `docs/architecture/current-state.test.mjs` passed. Initial lint accidentally scanned a copied baseline export under artifacts; that generated export was moved outside the repository and lint was rerun successfully.
- Independent static reviewer: Critical=0, Important=0; confirmed route/control truthfulness and byte-identical logout. Final read-only follow-up confirmed both image assets, one-line Settings copy, and release handoff; Critical=0, Important=0. Reviewer explicitly withheld production/human acceptance claims.
- Official Zalo setup link verified on 14 October: https://bot.zapps.me/docs/create-bot/ . https://bot.zapps.me/docs/apis/setWebhook/ explicitly says the URL can remain saved when verification fails. The guide avoids claiming webhook registration alone proves connectivity. No shared bot, groups/media, disconnect, price or new policy is advertised.

## Release in separate steps

1. **Review immutable candidate.** Record final feature SHA, exact diff versus baseline, checks and screenshot acceptance. Obtain a clean integration on the then-current reviewed production lineage; rerun checks if conflict resolution changes code. The UI feature does not depend on the unaccepted semantic repair.
2. **Fresh read-only delivery inventory.** Authorized release operator must confirm current `master`/production SHA, active Worker allocation, same-environment rollback version availability, deployed migration state and credentials isolation. This remains pending; no rollback recommendation is unconditional.
3. **Owner action.** Explicitly approve the reviewed exact integration SHA and its target for production. A reviewed `master` SHA does not itself authorize deployment. No new approval question is needed for routine local UI work.
4. **Upload/promote only when authorized.** Use the repository immutable-version process. Upload once, record version ID and SHA, then promote that exact version; record target and timestamp. This writer performs neither step.
5. **Verify delivery.** Read back allocation/version. Inspect landing, help, all menu routes, desktop/mobile, keyboard and account entry. Check console/assets and safe session handling without paid AI, real token screenshots or new user data. Obtain human visual acceptance separately from local checks and deployed status.
6. **Rollback trigger and action.** Broken route/assets, unreachable account/help, severe responsive/keyboard regression or auth/privacy regression stops acceptance. With explicit rollback authority, promote the freshly verified known-good same-Worker version. Worker rollback never reverses D1 migrations. Because this diff adds no migration/contracts/backend changes, its own database compatibility risk is low; compatibility of the actual target version with current D1 must still be checked. If the recorded `5bde4cd7…` is unavailable or incompatible, obtain another verified target before promotion.

Local implementation readiness is separate from release authority. Production acceptance and fresh rollback availability remain unproven in this session.
