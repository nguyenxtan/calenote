# Calenote Product UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a coherent, accessible Calenote web UI matching the approved assistant-first direction while preserving all current API and Semantic V1 safety contracts.

**Architecture:** `AppShell` becomes the sole authenticated navigation and account-control shell. Each route keeps its current data loading and API calls; the refresh changes component hierarchy, CSS, and accessibility only. Login retains its existing passwordless OTP state machine.

**Tech Stack:** Next.js 16 App Router static export, React 19, TypeScript, CSS Modules, Lucide, Vitest, Testing Library, axe-core.

**Spec:** `docs/superpowers/specs/2026-09-23-calenote-product-ui-refresh-design.md`

## Global Constraints

- Use only existing same-origin API contracts; no endpoint, D1, provider, Semantic V1, or Cloudflare changes.
- Do not fabricate records or expose controls for unsupported product actions.
- Preserve request aborts, session redirects, idempotency, generic login responses, and ambiguous mutation safety.
- `AI_MODE=privacy` is explanatory Settings copy only; the browser never manages models, providers, budgets, or secrets.
- A semantic proposal remains draft-only until its existing deterministic confirmation action succeeds.
- Keep keyboard interaction, focus restoration, visible focus, reduced-motion support, and zero horizontal mobile overflow.
- This plan does not authorize deployment.

## Review Focus

- Logout must not report success after an ambiguous or failed request; Task 1 covers its lock/error boundary.
- Account-menu dismissal by Escape, outside interaction, and navigation must be keyboard safe; Task 1 covers it.
- A refreshed route receiving 401 must clear private state and redirect to Login; Tasks 2–4 retain this behavior.
- Settings must not promise free routing or editable AI configuration; Task 2 asserts truthful privacy/confirmation copy.
- Desktop/mobile screens must remain usable without horizontal overflow; Task 5 captures and tests the affected routes.

---

### Task 1: Shared shell, account menu, and logout

**Files:**
- Modify: `src/ui/shell/AppShell.tsx`
- Modify: `src/ui/shell/AppShell.module.css`
- Create: `src/ui/shell/AppShell.test.tsx`
- Modify: `src/components/accessibility.test.tsx`

**Interfaces:**
- Consumes `SessionUser`, `apiRequest`, `ApiResponseError`, and `useRouter`.
- Produces the existing `AppShell({ user, children, activePath })` plus a reusable accessible account menu.

- [ ] **Step 1: Write the failing account-menu tests**

```tsx
render(<AppShell user={user}><main>Today</main></AppShell>);
await userEvent.click(screen.getByRole("button", { name: /tài khoản/i }));
expect(screen.getByRole("menuitem", { name: /đăng xuất/i })).toBeVisible();
await userEvent.click(screen.getByRole("menuitem", { name: /đăng xuất/i }));
expect(fetcher).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST", authenticated: true }));
expect(replace).toHaveBeenCalledWith("/login");
```

Add cases for pending disablement, failed/ambiguous request alert, Escape/outside dismissal, focus restoration, and mobile overflow navigation.

- [ ] **Step 2: Run the new test and confirm RED**

Run: `pnpm exec vitest run src/ui/shell/AppShell.test.tsx`

Expected: FAIL because the current shell has no account-menu trigger or logout behavior.

- [ ] **Step 3: Implement the minimal account-menu behavior**

```tsx
async function logout() {
  if (loggingOut) return;
  setLoggingOut(true);
  try {
    await apiRequest("/api/auth/logout", { method: "POST", body: {}, authenticated: true });
    replace("/login");
  } catch (error) {
    setAccountError(safeLogoutMessage(error));
  } finally {
    setLoggingOut(false);
  }
}
```

Use a button trigger, `role="menu"` and menuitems, Settings link, desktop profile trigger, mobile overflow action, outside/Escape close handlers, and trigger focus restoration. Do not duplicate API ownership in route components.

- [ ] **Step 4: Apply responsive warm shell styling**

Refine the rail, top action area, active navigation, account menu, and mobile bottom navigation in `AppShell.module.css`. Include `:focus-visible` and `prefers-reduced-motion`; do not add fake counters or data.

- [ ] **Step 5: Verify and commit**

Run: `pnpm exec vitest run src/ui/shell/AppShell.test.tsx src/components/accessibility.test.tsx`

Expected: PASS.

```bash
git add src/ui/shell/AppShell.tsx src/ui/shell/AppShell.module.css src/ui/shell/AppShell.test.tsx src/components/accessibility.test.tsx
git commit -m "feat(ui): add unified account shell and logout"
```

### Task 2: Truthful Settings and passwordless Login refresh

**Files:**
- Modify: `src/features/final-screens/FinalScreenExperience.tsx`
- Modify: `src/features/final-screens/FinalScreenExperience.module.css`
- Modify: `src/features/final-screens/FinalScreenExperience.test.tsx`
- Modify: `src/components/auth/LoginPanel.tsx`
- Modify: `src/components/auth/LoginPanel.module.css`
- Modify: `src/components/auth/LoginPanel.test.tsx`

**Interfaces:**
- Consumes existing session/preferences/Login API contracts and Task 1's `AppShell`.
- Produces Settings and Login presentation with no browser configuration authority.

- [ ] **Step 1: Write failing Settings/Login UI-contract tests**

```tsx
render(<FinalScreenExperience screen="settings" />);
expect(await screen.findByText(/AI_MODE=privacy/i)).toBeVisible();
expect(screen.getByText(/xác nhận.*tạo lời nhắc/i)).toBeVisible();
expect(screen.queryByRole("combobox", { name: /model|provider/i })).not.toBeInTheDocument();
```

Retain Login tests for generic request-code copy, OTP verification, error focus, and session redirect.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm exec vitest run src/features/final-screens/FinalScreenExperience.test.tsx src/components/auth/LoginPanel.test.tsx`

Expected: FAIL because Settings currently claims free/economy-style AI behavior.

- [ ] **Step 3: Implement minimal truthful content and visual hierarchy**

Replace obsolete Settings assistance copy with privacy/proposal/confirmation copy. Keep identity read-only and `save(patch)` unchanged. Refresh Login markup and CSS hierarchy only; preserve locks, abort controllers, routes, generic response strings, labels, status and alert roles.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run src/features/final-screens/FinalScreenExperience.test.tsx src/components/auth/LoginPanel.test.tsx src/components/accessibility.test.tsx`

Expected: PASS.

```bash
git add src/features/final-screens src/components/auth
git commit -m "feat(ui): refresh settings and passwordless login"
```

### Task 3: Assistant-first Today

**Files:**
- Modify: `src/features/today/TodayExperience.tsx`
- Modify: `src/features/today/TodayExperience.module.css`
- Modify: `src/features/today/TodayExperience.test.tsx`
- Modify: `src/features/today/TodayExperience.responsive.test.ts`

**Interfaces:**
- Consumes existing session, reminder, and pending-action state/functions.
- Produces a Today visual hierarchy while preserving existing create and decision flows.

- [ ] **Step 1: Write failing proposal-state and responsive tests**

```tsx
render(<TodayExperience />);
expect(await screen.findByRole("form", { name: /tạo lời nhắc nhanh/i })).toBeVisible();
expect(screen.getByText(/chưa tạo lời nhắc/i)).toBeVisible();
expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
```

Assert a pending action stays proposal-only until the existing approval call succeeds.

- [ ] **Step 2: Run focused test and confirm RED**

Run: `pnpm exec vitest run src/features/today/TodayExperience.test.tsx src/features/today/TodayExperience.responsive.test.ts`

Expected: FAIL on new layout assertions.

- [ ] **Step 3: Recompose with existing state only**

Build the warm hero/capture surface, real upcoming timeline, and explicit proposal/confirmation panel from existing `reminders`, `actions`, `createReminder`, and `decide`. Do not add LLM calls, fabricated calendar records, or a mutation bypass.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run src/features/today/TodayExperience.test.tsx src/features/today/TodayExperience.responsive.test.ts src/components/accessibility.test.tsx`

Expected: PASS.

```bash
git add src/features/today
git commit -m "feat(ui): refresh assistant-first today"
```

### Task 4: Calendar, Inbox, Reminders, Connections, and Activity

**Files:**
- Modify: `src/features/core-screens/CoreScreenExperience.tsx`
- Modify: `src/features/core-screens/CoreScreenExperience.module.css`
- Modify: `src/features/core-screens/CoreScreenExperience.test.tsx`
- Modify: `src/features/final-screens/FinalScreenExperience.tsx`
- Modify: `src/features/final-screens/FinalScreenExperience.module.css`
- Modify: `src/features/final-screens/FinalScreenExperience.test.tsx`

**Interfaces:**
- Consumes existing reminder/action/connection/activity schemas and API calls.
- Produces visual hierarchy with the same data/mutation contracts.

- [ ] **Step 1: Write failing route-state tests**

```tsx
render(<CoreScreenExperience screen="calendar" />);
expect(await screen.findByRole("heading", { name: "Lịch" })).toBeVisible();
expect(screen.getByRole("button", { name: /tháng trước/i })).toBeVisible();

render(<CoreScreenExperience screen="inbox" />);
expect(await screen.findByText(/chưa tạo lời nhắc/i)).toBeVisible();
```

Add cases that Calendar displays only real reminders, Inbox uses its existing decision path, Reminder cancellation preserves its busy scope, Connections keeps retry/connect-code protections, and Activity remains read-only.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm exec vitest run src/features/core-screens/CoreScreenExperience.test.tsx src/features/final-screens/FinalScreenExperience.test.tsx`

Expected: FAIL on new visual-state assertions.

- [ ] **Step 3: Implement visual hierarchy from current records**

Refresh Calendar selected-day agenda, Inbox proposal cards, Reminder list/filter, Connections statuses, and read-only Activity. Preserve `loadReminders`, `loadActions`, `decide`, `cancel`, connect-code expiry, copy failures, retry behavior, and ownership/session handling.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run src/features/core-screens/CoreScreenExperience.test.tsx src/features/final-screens/FinalScreenExperience.test.tsx src/components/accessibility.test.tsx`

Expected: PASS.

```bash
git add src/features/core-screens src/features/final-screens
git commit -m "feat(ui): refresh authenticated product screens"
```

### Task 5: Visual review and full branch validation

**Files:**
- Modify/Create only under existing `tools/ui-review/` conventions when fixture coverage is missing.
- Modify UI tests only when visual review finds a reproducible issue.

**Interfaces:**
- Consumes Tasks 1–4 and existing fixture tooling.
- Produces reviewable desktop/mobile evidence, not a deployment artifact.

- [ ] **Step 1: Add missing fixture assertions**

Cover Login email/OTP, Today, Calendar, Inbox, Settings, and mobile account menu. Assert active navigation, focusable controls, and no horizontal overflow.

- [ ] **Step 2: Capture and inspect visual fixtures**

Run the repository's existing Phase 4 UI fixture server/capture workflow. Preserve its output as untracked review artifacts. Inspect hierarchy, contrast, Settings truthfulness, active nav, mobile layout, and OTP state.

- [ ] **Step 3: Fix only reproducible visual/accessibility issues**

Do not add dependencies, functionality, fake data, or runtime changes.

- [ ] **Step 4: Run final verification**

```bash
pnpm check
git diff --check
```

Expected: PASS, including static export, Worker types, dry-run, tests, lint, and typecheck.

- [ ] **Step 5: Commit and request whole-branch review**

```bash
git status --short
git add src/ui/shell/AppShell.tsx src/ui/shell/AppShell.module.css src/ui/shell/AppShell.test.tsx \
  src/components/accessibility.test.tsx src/components/auth/LoginPanel.tsx \
  src/components/auth/LoginPanel.module.css src/components/auth/LoginPanel.test.tsx \
  src/features/today src/features/core-screens src/features/final-screens \
  tools/ui-review/phase4a-fixture-server.test.ts
git commit -m "test(ui): verify responsive product refresh"
```

Request independent review focused on auth/logout safety, truthful UI claims, Semantic confirmation boundaries, responsive accessibility, and absence of runtime/deployment changes. Resolve all critical and important findings before PR creation.
