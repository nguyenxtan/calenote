# Semantic Conversation Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a Vietnamese reminder clarification keeps its encrypted context, explains unsupported recurrence truthfully, and never degrades a safe semantic failure into misleading generic parser help.

**Architecture:** The command boundary will map typed semantic outcomes to local, context-aware replies without exposing provider details. Deterministic temporal evidence remains authoritative; recurrence remains explicitly unsupported and therefore cannot create a one-off draft. Safe telemetry will report only outcome categories and route metadata, never user text, identifiers, encrypted values, or secrets.

**Tech Stack:** TypeScript, Vitest, Cloudflare Worker, D1 encrypted semantic context, Zod.

**Spec:** `docs/superpowers/specs/2026-09-16-ai-semantic-conversation-v1-design.md`

## Global Constraints

- No provider fallback, live model test, secret logging, raw message telemetry, migration, or production configuration change.
- Model has no temporal, authorization, persistence, confirmation, or mutation authority.
- CREATE remains draft-only until deterministic confirmation; LIST is read-only.
- Recurrence is not a V1 capability: fail closed with a local explanation rather than silently producing a one-off reminder.
- Preserve encryption, owner/chat scoping, dedupe, and inbound terminalization.

## Review Focus

- A pending time clarification followed by a recurrence phrase must not create a single reminder.
- A complete date/time request missing only its title must ask only for the title.
- A complete one-off request must make one draft, not a reminder mutation.
- An unavailable provider must preserve pending context and emit a truthful retry response without provider details.
- Telemetry serialization must not include inbound text, context title, tokens, identifiers, or secret-like material.

### Task 1: Context-aware safe outcomes and recurrence refusal

**Files:**
- Modify: `src/modules/reminders/command-service.ts`
- Test: `src/modules/reminders/command-service.test.ts`

**Interfaces:**
- Consumes: `SemanticServiceResult`, encrypted `SemanticContextStore`, deterministic `TemporalEvidence` through `SemanticService`.
- Produces: terminal local replies that retain pending context on safe failure and never create drafts for unsupported recurrence.

- [ ] Write failing tests for the screenshot continuation, missing-title clarification, complete single reminder draft, provider-unavailable retry copy, and recurrence refusal.
- [ ] Run the exact focused test selectors and confirm each fails for the missing behavior.
- [ ] Add a narrow local reply mapper plus deterministic recurrence detection at the command boundary; do not change model contract or storage.
- [ ] Re-run focused tests and command-service suite.

### Task 2: Privacy-safe semantic outcome observability

**Files:**
- Modify: `src/modules/semantic/service.ts`
- Modify: `src/modules/inbound/processor.ts`
- Test: `src/modules/semantic/service.test.ts`
- Test: `src/modules/inbound/processor.test.ts`

**Interfaces:**
- Consumes: existing `SemanticObservation` and `recordDiagnostic` ports.
- Produces: safe outcome observation containing only bounded route/category/timing/cost fields.

- [ ] Write failing tests proving safe failures are observed and serialized diagnostics exclude message, context, credentials, identifiers, and provider response body.
- [ ] Run tests and confirm failure is due to missing bridge from semantic service to processor diagnostics.
- [ ] Thread a typed, best-effort observation callback through composition without changing business outcome.
- [ ] Re-run focused observability tests.

### Task 3: Verification, review, release

- [ ] Run focused command, semantic, inbound, and composition tests.
- [ ] Run `pnpm typecheck`, `pnpm check`, and `git diff --check`.
- [ ] Perform static sensitive-data scan and review the final diff against this plan.
- [ ] Commit, push, open a feature-to-master PR, wait for CI, merge normally after CI passes, then deploy only the exact merged master SHA using immutable Worker version upload/promotion.
- [ ] Run provider-free post-deploy health/binding/queue/cron/version checks. Do not send Zalo messages; request human acceptance only after server-side checks pass.
