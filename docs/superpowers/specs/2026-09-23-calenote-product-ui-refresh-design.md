# Calenote Product UI Refresh

**Status:** Proposed for review
**Scope:** authenticated web UI and passwordless entry UX only; no Worker, D1,
provider, Semantic V1, or production-configuration change.

## 1. Outcome

Bring the authenticated product experience in line with the supplied Calenote
visual direction: a warm, calm, assistant-first application with a coherent
desktop rail, compact mobile navigation, clear account controls, and real
screens for the capabilities the Worker already exposes.

The refresh must improve presentation and discoverability without inventing
calendar, inbox, notification, account, or AI capabilities that are not backed
by the current same-origin API contracts.

## 2. Product boundaries

### In scope

- A single responsive `AppShell` used by all authenticated routes, with the
  Calenote brand, primary navigation, profile affordance, and an accessible
  account menu.
- A visible logout action in that account menu which reuses the existing
  `POST /api/auth/logout` contract and clears client state before navigating to
  `/login`.
- A visual refresh of the existing Today, Calendar, Inbox, Reminders,
  Connections, Activity, and Settings routes using only their current data and
  empty/loading/error states.
- A passwordless Login UI refresh retaining the existing request-code and
  verify-code API flow, generic account-protecting response copy, abort
  handling, and redirect to `/app/today`.
- A Settings screen organized around real account identity (read-only),
  address style, tone, privacy/Semantic V1 status copy, and the account menu
  logout action.  It must state the actual production policy: privacy mode,
  confirmation before reminder mutation, and no model-controlled scheduling.
- Accessible keyboard behavior, focus management, sufficient contrast, and
  responsive layouts without horizontal overflow.

### Out of scope

- New API endpoints, D1 migrations, session-management capability, profile
  editing, notification preferences, subscriptions, recurring/lunar reminders,
  calendar-provider integrations, or mobile-native apps.
- A fake chat composer, fabricated calendar events, fabricated inbox records,
  or UI controls whose action is not supported by the current product.
- Changes to Semantic V1 routing, model/provider policy, budget enforcement,
  Zalo behavior, credentials, deployment, or Cloudflare configuration.

## 3. Information architecture

The authenticated rail exposes existing routes only:

```
Today · Calendar · Inbox · Reminders
Connections · Activity · Settings
                         └─ account menu: profile summary, Settings, Log out
```

Desktop uses the persistent rail and top action area.  Mobile retains the
existing five-item bottom navigation and moves secondary/account actions into a
keyboard-accessible overflow menu.  The active route is explicit in both
layouts.

`/app/today` is the default authenticated destination. `/dashboard` continues
to redirect there. `/login` remains the only passwordless-entry route; an
already authenticated visitor is redirected to Today.

## 4. Screen behavior

### Shared shell and account controls

- Render the authenticated user initial, display name, and timezone in the
  rail on desktop. Activating it opens a menu with Settings and Log out.
- Log out disables only its own control while the request is pending, uses the
  existing authenticated API request helper, and replaces the route with
  `/login` on success or an unauthorized response. A recoverable failure is
  announced without clearing the visible account.
- The menu closes on Escape, outside interaction, route navigation, and after
  an action. Focus returns to its trigger after dismissal.

### Today, Calendar, Inbox, and Reminders

- These surfaces receive the supplied warm visual hierarchy, but remain honest
  about the current data model: Today and Reminders show real reminder data;
  Calendar and Inbox only expose actions and state that current APIs support.
- Existing mutation controls retain their confirmation/idempotency contracts.
  No UI change may turn a semantic draft into a reminder before deterministic
  confirmation.

### Settings

- Account identity stays read-only because the current API has no profile
  mutation contract.
- Address style and tone persist through the existing preferences PATCH API.
- Semantic/privacy information is explanatory, never editable in the browser:
  `AI_MODE=privacy`, approved processing is proposal-only, and user
  confirmation remains authoritative for reminder mutation.
- Connection controls remain on Connections; settings does not duplicate
  credential or webhook management.

### Login

- Preserve the two steps: email then six-digit one-time code delivered to the
  already-bound private bot chat.
- Do not reveal whether an account exists; preserve existing generic acceptance
  copy and no automatic retry after ambiguous mutation results.
- The page visually aligns with the product but continues to support keyboard,
  autofill, error focus, and direct links to onboarding/docs.

## 5. Component design

- Extend `src/ui/shell/AppShell` rather than creating a second authenticated
  shell. Account-menu state and logout behavior are a focused reusable unit.
- Keep each route's data loading and API usage in its existing feature
  component. Shared visual primitives/tokens may be added only when reused by
  two or more screens.
- Refresh `LoginPanel` in place. Its security-sensitive state machine and API
  calls remain unchanged except for testable presentation/accessibility wiring.
- Refactor `FinalScreenExperience` only enough to use the shared shell and
  correct Settings copy; do not add backend assumptions.

## 6. Failure and safety behavior

- Unauthenticated responses always route to Login and must not retain prior
  user, reminders, or connection state.
- Load and mutation errors remain visible via accessible status/alert regions.
- Logout must not be duplicated by repeated clicks and must not treat an
  ambiguous request outcome as successful.
- No raw credentials, semantic input, bot token, or private reminder title is
  introduced into UI diagnostics or browser storage.

## 7. Verification

- Start each UI behavior change with a focused failing component test.
- Cover account-menu keyboard/outside-dismiss behavior, logout success/error/
  pending states, active navigation, Settings preference persistence and
  truthful privacy copy, Login's two-step and session redirects, and route
  responsive behavior.
- Run focused Vitest/axe coverage, `pnpm typecheck`, `pnpm check`, and
  `git diff --check`.
- Capture desktop and mobile visual-review fixtures for the Login, Today,
  Settings, Calendar, Inbox, and account-menu states. Ensure no horizontal
  overflow at the supported mobile viewport.
- This work requires its own review/PR and explicit deployment authorization;
  it does not piggyback on the Semantic V1 production release.
