# Existing product completion implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task by task. Preserve paid HOLD, historical UNKNOWN and exact-SHA release gates.

**Goal:** Complete the reproducible remaining offline work without regressing the deployed V2 product or pretending that unqualified AI has passed acceptance.

**Architecture:** Build on deployed `dde4968e0f02e5680880bc5a635e181b4d8e32dc`. Durable manual-create intents are scoped to authenticated owners and bound to canonical request payloads; D1 arbitrates creation and explicit ambiguity resolution atomically. Context Contract is reconciled on a separate feature branch with the production fallback preserved and the unqualified runtime opt-in.

**Tech Stack:** Next16.3/React19, TypeScript, Cloudflare Worker/D1, SQLite/Miniflare, Vitest/Testing Library.

**Spec:** Existing Context Contract specification/review checkpoint plus the concrete completion boundaries recorded below. The user's instruction to finish the enumerated remaining work authorizes these routine implementation choices.

## 1. Durable manual creation

Files: reminders API service/D1 API store, authenticated reminder routes/operations/contracts, Today capture/client intent helper, immutable migration0010 and regression suites.

- [ ] Reproduce commit-plus-lost-response followed by reload/retry.
- [ ] Bind an opaque client intent to authenticated owner and canonical payload using a keyed digest; never persist plaintext titles in browser state.
- [ ] Commit reminder, audit and receipt atomically; replay must return the same result even after scheduled time passes.
- [ ] Add explicit ambiguity resolution: return an existing result or atomically tombstone the intent so a delayed original write cannot create afterward.
- [ ] Test concurrent creates, payload mismatch, owner isolation, resolution races, lost resolution responses and reload recovery through BE–FE boundaries.
- [ ] Align manual title validation with the public response contract; keep response-size and list traversal bounds.

## 2. Context Contract reconciliation and real UI routing

Files: isolated merge of PR11 into production source; CoreScreenExperience, router/routes, context API composition, calendar presentation, local read-only/failure observation regression suites.

- [ ] Resolve conflicts by preserving production local query handling, telemetry, keyset pagination, lunar/series controls and mutation/read ordering fences.
- [ ] Correct web cancellation to the canonical DELETE route and test the FE click through the actual Worker router/handler.
- [ ] Keep default production screens working on schema0001–0008; successor API/UI must not require an unapplied0009 while the feature is dormant.
- [ ] Preserve Context Contract explicit opt-in and source-SHA requirements. No provider, model, prompt, oracle or budget changes are justified by integration alone.
- [ ] Reconcile source/progress documentation with exact test and qualification evidence.

## 3. UI closure evidence

- [x] Confirm UI24d06a8 is an ancestor of production via PR5 merge f5f5d8e; no missing UI branch port exists.
- [x] Run focused current UI suites:74 tests in8 suites passed before changes.
- [ ] Validate the integrated screens and recovery controls with synthetic data, keyboard and accessibility checks.

## 4. Final integration and review

- [ ] Integrate the independently tested commits, resolve shared API/client/migration boundaries and inspect the final diff.
- [ ] Run meaningful offline conversation create/clarify/confirm/list/cancel/delivery checks with injected transports. These are not live provider acceptance.
- [ ] Run the complete pinned engineering gate once the candidate is frozen, then independent review and exact-head CI.
- [ ] Publish the reviewable feature PR and exact candidate SHA, recording unapplied migrations and release authority separately.

## Qualification and release boundaries

Wire104/Formal Pilot remains unqualified. Paid HOLD and the historical UNKNOWN settlements remain unchanged; broad completion instructions do not change model/provider/oracle/budget or authorize a paid campaign. Prepare the exact bounded qualification proposal from the current protocol/ledger; do not infer remaining budget from an old PR description. Old missing failure detail cannot be reconstructed by polling newer telemetry.

New source/migrations require exact-SHA deployment authorization. No remote D1 application, production mutation, live CREATE/replay, provider call, master push or deploy is part of this implementation plan.
