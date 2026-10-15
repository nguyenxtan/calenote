# Non-AI UI scope and lunar/guide candidate

Authority: product UI refresh design/plan dated 2026-09-23, task guidance in `b87c5fa`, and owner request for dual-calendar display and short bot setup instructions. This inventory covers the non-AI UI owned by this branch; semantic/provider execution is owned separately.

Production baseline: `b87c5fa8b6abbd7e4a1b6f4cbfed927a3db548e6`, version `35d396f4-c1aa-495d-8d35-1f6df699d9ff` reported deployed by coordinator. “Deployed” below means source included in that exact release; it does not assert a fresh authenticated owner acceptance test.

| Requirement | Route / implementation / commit | Status and remaining verification |
|---|---|---|
| Shared authenticated shell, desktop active route, account summary | `/app/*`, `AppShell`, source in b87 | Deployed; local shell tests available. Fresh owner keyboard/visual acceptance separate. |
| Full mobile menu, secondary routes, Escape and focus restoration | `/app/*`, `AppShell`, b87 | Deployed; local tests and synthetic mobile evidence in initial release. No new session actions here. |
| Logout using existing authenticated contract, lock/error handling | `AppShell`, b87 ancestry | Deployed source; no real session logout performed in this candidate. |
| Today real data, loading/empty/partial failure and pending decisions | `/app/today`, `TodayExperience`, ed05d60 in b87 | Deployed; only existing data/API flow. No live reminder/provider test in current work. |
| Manual reminder creation, deterministic time and uncertain-outcome handling | `/app/today`, b87 ancestry | Deployed; synthetic tests. Real mutation deliberately not used for smoke. |
| Calendar Gregorian grid, selected agenda, reminder detail | `/app/calendar`, `CoreScreenExperience`, b87 ancestry | Deployed; current candidate preserves existing reminder API. |
| Calendar Vietnamese lunar labels and timezone-safe month navigation | `/app/calendar`, `calendar-presentation`, new delta adapted from a3fd106 | Local tested; not integrated/deployed yet. Uses existing adapter b61658e in b87. No flag/API/migration required. Standalone candidate validation required. |
| Inbox approval/rejection uses existing contracts | `/app/inbox`, `CoreScreenExperience`, b87 ancestry | Deployed source; current delta does not modify this behavior. |
| Reminders filters/status/cancel | `/app/reminders`, `CoreScreenExperience`, b87 ancestry | Deployed source; targeted tests cover existing controls. |
| Connection state, private-chat binding and webhook recovery | `/app/connections`, `FinalScreenExperience`, b87 ancestry | Deployed source; real bot delivery/credentials not tested by this candidate. |
| Additional bot within existing account | `AddBotPanel`, 783f26a; backend bc269c4 or successor owner candidate | Local tested, not integrated into this release. Default feature hidden. Backend ownership/identity/release gates remain separate. |
| Primary login channel selection | `PrimaryLoginPanel`, 1fbb264; backend fe7aa6d plus migration prerequisites | Local tested, not integrated into this release; hidden by default. Separate backend/migration release and owner acceptance needed. |
| Activity using real audit records | `/app/activity`, `FinalScreenExperience`, b87 ancestry | Deployed source; no fabricated production activity. |
| Read-only account identity, persisted address style/tone, local density preference | `/app/settings`, `SettingsPanel`, b87 | Deployed source; synthetic persistence tests. Profile mutation and notification preferences not implemented (out of original scope). |
| Passwordless email/code UI, generic acceptance, abort/uncertain outcomes and redirect | `/login`, `LoginPanel`, b87 ancestry | Deployed source; existing tests. No live code request/OTP/provider run in this candidate. |
| Onboarding account/provider/token and truthful activation/private-chat states | `/onboarding`, `OnboardingWizard`, b87 ancestry | Deployed source. New creation-guide presentation is local only; API/activation logic unchanged. |
| Task guide, actual route links and synthetic screenshot labels | `/docs`, `PipelineGuide`, b87 | Deployed. New platform selection and one-action guide replace dense setup copy in local candidate. |
| Zalo Bot Platform / Telegram creation sources | `/docs`, `/onboarding`, `BotCreationGuide`, new delta | Local tested. Sources supplied and verified by coordinator: Zalo create_bot; Telegram official features/tutorial and BotFather. No real bot creation, secrets or copied screenshots. |
| Responsive keyboard/focus/accessibility/contrast | Shared components and affected routes | Baseline synthetic evidence exists; current targeted axe/keyboard tests and standalone desktop/mobile review required. This is not a claim of every route/device/assistive-technology acceptance. |
| Landing route and current capability claims | `/`, b87 | Deployed source; unchanged by this candidate. Full product acceptance remains separate. |
| New APIs, D1 migration, calendar-provider sync, annual/monthly lunar recurrence, profile editing, subscriptions | None in this delta | Not implemented here / original UI scope excluded. Lunar display does not add lunar scheduling controls or recurrence. |

## Release isolation

The current development branch also contains 783f26a and 1fbb264. Do not deploy its full HEAD for the lunar/guide release. Prepare a separate local candidate with parent b87 plus only this lunar/guide delta. Keep the existing b87 archive/snapshot unchanged. No backend/contracts, credentials, Cloudflare config, workflows or migrations change.

Independent delta review: Critical 0, Important 0. Targeted tests include lunar reference vectors, every artifact month boundary, leap month, coverage limits, foreign browser timezones, Tet year transition, selected-day retention, guide platform reset and existing onboarding safety. Exact standalone test/build and visual receipts are recorded separately; counts alone do not establish complete product scope or production acceptance.
