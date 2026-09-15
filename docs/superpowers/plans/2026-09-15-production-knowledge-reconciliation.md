# Production Knowledge Reconciliation Implementation Plan

> **For agentic workers:** Execute this documentation-only plan inline; no runtime, Cloudflare, D1, provider, or diagnostic changes are permitted.

**Goal:** Make Calenote's canonical documentation reflect the deployed Worker, D1, Queue, and Zalo evidence without representing the open inbound incident as resolved.

**Architecture:** Replace obsolete prototype claims with repository- and production-evidenced boundaries. Classify each operational statement as `IMPLEMENTED`, `PROVEN_IN_PRODUCTION`, `OPEN_INCIDENT`, or `PLANNED`; provider payload statements are constrained by official Zalo documentation.

**Tech Stack:** Markdown, Node documentation regression test, pnpm.

**Spec:** User request “CALENOTE — PRODUCTION KNOWLEDGE RECONCILIATION”.

## Global Constraints

- Docs and docs-test files only.
- Do not change runtime code, Cloudflare, D1, provider behavior, or remove temporary diagnostics.
- Do not expose credentials, webhook paths/secrets, connect codes, private identifiers, or message content.
- Do not claim the Zalo real-message incident is resolved.

### Task 1: Reconcile canonical architecture documents

**Files:**
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/architecture/current-state.test.mjs`

- [ ] Replace the prototype/PostgreSQL-only narrative with the actual Worker + D1 + Queue + cron architecture.
- [ ] Preserve evidence boundaries: webhook registration and restoration are proven, but real Zalo message receipt and chat E2E are open.
- [ ] Update the regression test to assert the current classified evidence and prevent a return to obsolete claims.

### Task 2: Reconcile Zalo operational documentation

**Files:**
- Modify: `docs/integrations/zalo-bot-platform.md`
- Create: `docs/runbooks/zalo-production-acceptance.md`
- Modify: `docs/runbooks/cloudflare-incidents.md`

- [ ] Document implemented Zalo operations and the object-shaped provider payload contract.
- [ ] Add the deterministic production acceptance sequence and the current open-incident evidence.
- [ ] Record the narrowly scoped Browser Integrity Check exception and diagnostic decision tree.

### Task 3: Preserve future scope and validate documentation

**Files:**
- Create: `docs/architecture/external-source-boundary.md`
- Modify: `docs/roadmap.md`

- [ ] Define the non-implemented ICONIC external-source boundary without assigning ICONIC business state to Calenote.
- [ ] Add bot ownership/claim and Telegram diagnosis backlog items.
- [ ] Run the documentation regression test, `pnpm.cmd check`, and `git diff --check`; commit and push only documentation changes.
