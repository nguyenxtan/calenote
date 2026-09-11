# Calenote V2 Public Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved V2 Landing, first-time onboarding route, returning-user login routing, and dashboard compatibility path.

**Architecture:** Static Landing V2 remains separate from authenticated data. Existing `OnboardingWizard` and `LoginPanel` preserve their security-sensitive API ownership while their routes and completion destinations become canonical V2 paths. `/dashboard` redirects without instantiating the legacy dashboard shell.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Testing Library, axe-core, existing Node/CDP fixture harness.

**Spec:** `docs/superpowers/specs/2026-09-11-calenote-v2-public-entry-design.md`

## Global Constraints

- Preserve `POST /api/onboarding`, OTP/session authority, same-origin/body/rate protections, token encryption, and one-time connect-command semantics.
- Use only Telegram and Zalo; do not add OAuth, migration, backend refactor, AI policy work, deployment, or screenshot-artifact commits.
- Canonical routes are `/`, `/onboarding`, `/login`, `/app/today`, with `/dashboard` redirecting to `/app/today`.
- Use locked V2 tokens, `CalenoteMark`, accessible semantic landmarks, and no unsupported product claims.

---

### Task 1: Establish public routing and Landing V2

**Files:**
- Create: `src/features/public-entry/PublicEntryExperience.tsx`
- Create: `src/features/public-entry/PublicEntryExperience.module.css`
- Create: `src/features/public-entry/PublicEntryExperience.test.tsx`
- Modify: `src/app/page.tsx`
- Create: `src/app/onboarding/page.tsx`
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Produces `PublicEntryExperience`, a static component with links to `/onboarding` and `/login`.
- `/onboarding` renders the existing `OnboardingWizard`; `/dashboard` uses Next `redirect("/app/today")`.

- [ ] **Step 1: Write failing route/component tests**

```tsx
expect(screen.getByRole("link", { name: "Bắt đầu" })).toHaveAttribute("href", "/onboarding");
expect(screen.getByRole("link", { name: "Đăng nhập" })).toHaveAttribute("href", "/login");
expect(screen.queryByText(/Google Calendar|Gmail|WhatsApp/)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the new public-entry test and verify RED**

Run: `pnpm exec vitest run src/features/public-entry/PublicEntryExperience.test.tsx`

- [ ] **Step 3: Implement static Landing and canonical routes**

```tsx
export default function DashboardPage() {
  redirect("/app/today");
}
```

- [ ] **Step 4: Run public-entry tests and build verification**

Run: `pnpm exec vitest run src/features/public-entry/PublicEntryExperience.test.tsx && pnpm build`

- [ ] **Step 5: Commit**

```bash
git add src/app src/features/public-entry
git commit -m "feat(public): build Calenote V2 landing"
```

### Task 2: Reconcile passwordless login with V2 entry routing

**Files:**
- Modify: `src/components/auth/LoginPanel.tsx`
- Modify: `src/components/auth/LoginPanel.module.css`
- Modify: `src/components/auth/LoginPanel.test.tsx`

**Interfaces:**
- Consumes existing `apiRequest`, `ApiResponseError`, `AmbiguousMutationError`, and `useRouter`.
- Produces login navigation to `/app/today` after session bootstrap and successful OTP verification.

- [ ] **Step 1: Add failing redirect expectations**

```tsx
await waitFor(() => expect(replace).toHaveBeenCalledWith("/app/today"));
```

- [ ] **Step 2: Run the LoginPanel test and verify RED**

Run: `pnpm exec vitest run src/components/auth/LoginPanel.test.tsx`

- [ ] **Step 3: Replace only legacy redirect destinations and reconcile token-based styles**

```tsx
replace("/app/today");
```

- [ ] **Step 4: Run LoginPanel regression and axe tests**

Run: `pnpm exec vitest run src/components/auth/LoginPanel.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/components/auth
git commit -m "feat(auth): reconcile V2 passwordless login"
```

### Task 3: Move and modernize the first-time journey without changing bootstrap authority

**Files:**
- Modify: `src/components/onboarding/OnboardingWizard.tsx`
- Modify: `src/components/onboarding/OnboardingWizard.module.css`
- Modify: `src/components/onboarding/OnboardingWizard.test.tsx`

**Interfaces:**
- Consumes existing `POST /api/onboarding` response and authenticated connection/preference APIs.
- Produces a completion CTA to `/app/today`; a submitted credential is cleared before the activation result renders.

- [ ] **Step 1: Add failing canonical-completion and secret-clearing tests**

```tsx
expect(screen.queryByDisplayValue("secret-token")).not.toBeInTheDocument();
await user.click(screen.getByRole("link", { name: "Vào Calenote" }));
expect(replace).toHaveBeenCalledWith("/app/today");
```

- [ ] **Step 2: Run onboarding tests and verify RED**

Run: `pnpm exec vitest run src/components/onboarding/OnboardingWizard.test.tsx`

- [ ] **Step 3: Implement only route/copy/style completion updates**

```tsx
<Link href="/app/today" className={styles.textLink}>Vào Calenote</Link>
```

- [ ] **Step 4: Run onboarding security and accessibility regression tests**

Run: `pnpm exec vitest run src/components/onboarding/OnboardingWizard.test.tsx src/worker/router.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/components/onboarding
git commit -m "feat(onboarding): build V2 first-time journey"
```

### Task 4: Add safe public visual fixtures and close acceptance evidence

**Files:**
- Modify: `tools/ui-review/phase4a-fixture-server.mjs`
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/current-state.test.mjs`
- Test: `src/features/public-entry/PublicEntryExperience.test.tsx`

**Interfaces:**
- Fixture scenarios return only public static pages or safe mocked `/api/session`, `/api/auth/*`, `/api/onboarding`, `/api/connections`, and `/api/preferences` data.
- Captures eight named files under untracked `artifacts/ui-review/phase-4d/`.

- [ ] **Step 1: Add failing fixture/test assertions for all canonical public routes**

```ts
expect(routes).toContain("/onboarding");
expect(currentState).toContain("Public V2 experience");
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test docs/architecture/current-state.test.mjs && pnpm exec vitest run src/features/public-entry/PublicEntryExperience.test.tsx`

- [ ] **Step 3: Extend only the existing fixture server and reconcile docs**

```js
const scenarios = new Set(["landing", "login-email", "login-otp", "onboarding-welcome", "onboarding-provider", "onboarding-connection", "onboarding-success"]);
```

- [ ] **Step 4: Capture and inspect eight screenshots**

Capture `landing-desktop.png`, `login-desktop.png`, `login-otp-desktop.png`, `onboarding-desktop.png`, `onboarding-connection-desktop.png`, `landing-mobile.png`, `login-mobile.png`, and `onboarding-mobile.png`; assert mobile `scrollWidth <= clientWidth`.

- [ ] **Step 5: Run canonical verification**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm exec wrangler types --check && pnpm exec wrangler deploy --dry-run && node --test docs/architecture/current-state.test.mjs && git diff --check && pnpm check`

- [ ] **Step 6: Commit**

```bash
git add tools/ui-review docs/architecture src/features/public-entry
git commit -m "docs: record V2 public experience"
```
