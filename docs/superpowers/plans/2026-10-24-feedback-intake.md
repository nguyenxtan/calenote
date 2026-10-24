# Feedback Intake V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Existing members submit bugs/needs, receive a durable ID, follow their own status; existing admins triage/respond.
**Architecture:** Strict shared contracts, encrypted D1 records and atomic audit triggers; session-owned HTTP routes. RAM-only identity-generation-bound UI with manual pagination/refresh, no external side effects.
**Tech Stack:** Next16 static pages, React19, Zod4, Worker/D1, existing AES-GCM keyring, Vitest/Miniflare.
**Spec:** /Users/bichtuyen/Documents/Codex/2026-10-24/calenote-feedback-intake-proposal/design-v1.md (implementation authorized via coordinator24/10).

## Global Constraints
- Base f11b19d223ddb01abfe9bc1c096d07fc331b8c51; feature branch codex/feedback-intake-v1; do not edit Pilot or unrelated dirty checkout.
- No new dependency, binding, AI/provider/email/bot/attachment, grant or remote operation.
- No retention job, DELETE endpoint or hard-delete. Migration0019 local disposable only; renumber compatibility at combined integration if needed.
- Same-origin mutations, authenticated owner scope, existing admin allowlist, no-store/Vary Cookie.
- Body16KiB; title5–120, description20–4000; create3/10min and20/day per owner; retry same request ID/payload yields same ticket, changed payload409.
- Draft/request ID/list/detail/filter/cursor/receipt cleared on session-generation/identity/auth loss; stale success/error/401/403 cannot affect new session.
- One combined release only after Pilot PASS, validation/review and separate exact-SHA production authority.

## Review Focus
- Concurrent create/retry near limits must not duplicate or spend slots on idempotent replay (store task).
- CAS failure cannot emit audit or overwrite another admin (store task).
- Authentication failures emitted by obsolete requests must not log out new identity (UI task).
- Missing/malformed receipts must preserve draft/id and disclose unknown outcome (UI task).
- Large Unicode/markup/private text must remain encrypted, bounded and escaped (contracts/store/UI tasks).

### Task1: Contracts and transactional encrypted store
Files: src/contracts/api/feedback.ts; src/modules/feedback/{store.ts,store.test.ts}; migrations/0019_feedback_intake.sql; keyring purpose union.
Interfaces: FeedbackCreateSchema/FeedbackPatchSchema/TicketSchema/ListSchema; D1FeedbackStore.create(owner,input,now),list(owner|null,filters),get(owner|null,id),update(actor,id,patch,now).
- [x] Write failing contract/store integration tests for ownership, encryption/audit, concurrent idempotency, changed payload409, rolling limits, pagination and CAS atomicity.
- [x] Run pnpm exec vitest run src/modules/feedback/store.test.ts, verify RED.
- [x] Implement strict contracts and migration with encrypted content, owner/request uniqueness, minimal audit triggers; create limits in single atomic insert; update CAS.
- [x] Run tests GREEN; commit only task files.

### Task2: HTTP and composition
Files: src/worker/routes/{feedback.ts,feedback.test.ts}; src/modules/feedback/composition.ts; src/worker/router.ts.
Interfaces: createFeedbackOperations(env),handleFeedback(request,origin,factory); GET /api/feedback and /:id; POST /api/feedback; GET /api/admin/feedback; PATCH /api/admin/feedback/:id.
- [x] Write RED tests for missing/expired auth, admin denial, foreign404, method/query/origin/body/size,429, receipt and fail-closed errors with privacy headers.
- [x] Implement lazy authenticated composition with existing session/keyring/admin allowlist; wire route before fallthrough.
- [x] Run focused HTTP/store and existing router regressions GREEN; commit.

### Task3: Member/admin UI and entry links
Files: src/features/feedback/{FeedbackWorkspace.tsx,FeedbackPanel.tsx,FeedbackPanel.test.tsx,feedback-client.ts,Feedback.module.css}; src/app/app/{feedback,admin/feedback}/page.tsx; AppShell.tsx; AdminOverview.tsx; PublicEntryExperience.tsx.
Interfaces: FeedbackWorkspace({admin?}), FeedbackPanel({scope,onAuthLost}); feedback client validates receipts/envelopes and exposes identity reader ID from server, guards requests by AbortSignal/generation.
- [x] Write RED tests for submit/receipt/retry, owned list/detail, triage/CAS, account switch, deferred success/error/401/403, draft reset and network preservation.
- [x] Implement RAM state and guarded lifecycle, bounded client, Vietnamese accessible forms/status, manual refresh/filter/pagination, admin close disposition/reply.
- [x] Add existing Help/admin/docs links, responsive shared brand tokens.
- [x] Run UI/router/store regressions, typecheck/lint/build; review desktop/mobile/keyboard. Commit.

### Task4: Qualification and handoff
Files: docs/runbooks/feedback-intake.md, release catalog only if current release gate permits appropriate candidate note; evidence outside repo.
- [ ] Run complete pnpm test and required docs/type/lint/build checks. Do not run Wrangler until guidance read; no runtime binding changes intended.
- [x] Independent whole-branch review; reproduce/fix important findings with RED→GREEN then regressions.
- [ ] Report exact candidate/base, code/local/CI/live separately, migration compatibility and combined-release blocker. No push/deploy/migration remote without applicable authority.

## Ledger
24/10: Clean source baseline verified; existing unrelated cbe5 UI changes untouched. Native execution selected by instruction to build in existing session; no repeat approval. Proposed rate-limit implementation counts committed requests atomically rather than consuming generic counters before create, so retry never spends a new-ticket slot.

24/10 review: P1 cross-tab cookie identity race reproduced RED in workspace, route and unknown-POST retry tests. Fixed focus/visibility obscuring/revalidation plus mandatory expected-reader precondition on mutations. All three regressions GREEN. Final review found no other definite persistence/security findings; no deferred minor findings.
Ruling: admin detail GET added under the same existing server allowlist because queue summaries intentionally exclude full descriptions; without it triage cannot open a ticket. No expansion of identity grants.
