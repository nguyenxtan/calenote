# Calenote Conversational Core V1 Implementation Plan

> **Status: SUPERSEDED — do not execute.** Replaced by
> [AI Semantic Conversation V1 Implementation Plan](2026-09-16-ai-semantic-conversation-v1.md).
> Preserve only its proven platform-boundary references; do not resume this
> plan's broad deterministic Vietnamese NLP, old routing modes, UI-sync, or
> bind-hardening work as part of Semantic Conversation V1.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a provider-agnostic Vietnamese conversational reminder core with deterministic-first interpretation, an optional privacy-mode semantic fallback, persistent clarification continuation, idempotent binding, and automatic connection-state UI feedback.

**Architecture:** The inbound processor remains the provider boundary and delegates bound text to a small conversational application layer. That layer routes deterministic intents, uses canonical D1 repositories for encrypted clarification state and read-only reminder queries, and invokes the optional intelligence port at most once only for plausible unresolved semantics. Database transactions remain the authority for drafts, confirmation, and `/connect` binding.

**Tech Stack:** TypeScript 6, Zod 4, Cloudflare Workers/D1/Queues, Vitest 4, React 19, Next.js 16, OpenRouter structured JSON Schema.

**Spec:** `docs/superpowers/specs/2026-09-15-calenote-conversational-core-v1-design.md`

## Global Constraints

- Preserve proven Zalo ingress, dual webhook authentication, encrypted credentials/inbound text, D1 BLOB normalization, queue dispatch, and provider transport behavior.
- Use `interpretationReferenceTime = inbound.receivedAt`; use `mutationValidityTime = processingNow` before every mutable draft/clarification action.
- `AI_MODE=privacy` is intended; `off` is zero-network fail-safe; `free` remains unavailable by policy.
- The LLM returns only a strict structured interpretation; it never writes D1, schedules work, authorizes a request, or bypasses user confirmation.
- AI is called at most once per inbound and never for sensitive input, a confident deterministic result, or a known/local parser failure.
- D1 migration is allowed only for encrypted persistent clarification state or a proven idempotency requirement; migrations are additive and forward-only.
- Do not expose bot tokens, webhook secrets/paths, connect codes, private identifiers, raw payloads, inbound text, encrypted values, or AI input/output in logs, metrics, tests, or docs.
- Before changing Next.js UI code, read the version-specific guide under `node_modules/next/dist/docs/` required by `AGENTS.md`.
- Run `pnpm.cmd check` and `git diff --check` before every implementation checkpoint. Production deploy, secrets, live AI, and provider side effects require separate explicit authorization.

---

## File and boundary map

| Path | Responsibility |
| --- | --- |
| `src/modules/conversation/contracts.ts` | Provider-neutral intents, deterministic outcomes, clarification record/query types, and safe reply result types. |
| `src/modules/conversation/intent-router.ts` | Pure deterministic classification of confirmation, cancellation, list/help, plausible create, and unknown text. |
| `src/modules/conversation/deterministic.ts` | Parser-failure mapping, time authorities, Vietnamese grammar adaptation, and deterministic create/query outcomes. |
| `src/modules/conversation/service.ts` | Orchestrates deterministic outcome, one optional intelligence call, post-model validation, and read-only/draft/clarification commands. |
| `src/modules/conversation/infrastructure/d1/store.ts` | D1 clarification lifecycle and bounded owner-scoped query reads; all encrypted persisted values use `persistedD1Blob`. |
| `src/modules/reminders/parse-vietnamese.ts` | Compact Vietnamese date/time/title grammar only. |
| `src/modules/reminders/command-service.ts` | Existing draft/confirmation mutations, refactored to apply conversational-core outcomes rather than own intent/NLP routing. |
| `src/modules/intelligence/*` | Strict conversational interpretation Zod schema, OpenRouter request schema, safe metrics, null gateway, and post-model validation. |
| `src/modules/inbound/processor.ts` | Claim/decrypt/provider reply and atomic idempotent `/connect` outcome application; no conversation grammar. |
| `src/features/final-screens/FinalScreenExperience.tsx` | Canonical connection-code watch state and user feedback. |
| `migrations/0005_conversation_clarifications.sql` | Additive encrypted clarification state only if the D1 store cannot safely persist it otherwise. |

## Task A: Deterministic conversational core and Vietnamese grammar

**Files:**
- Create: `src/modules/conversation/contracts.ts`
- Create: `src/modules/conversation/intent-router.ts`
- Create: `src/modules/conversation/deterministic.ts`
- Create: `src/modules/conversation/intent-router.test.ts`
- Create: `src/modules/conversation/deterministic.test.ts`
- Modify: `src/modules/reminders/parse-vietnamese.ts`
- Modify: `src/modules/reminders/parse-vietnamese.test.ts`

**Interfaces:**
- Consumes: normalized bound inbound `text`, `receivedAt`, timezone, and parser result.
- Produces: `ConversationIntent`, `DeterministicConversationResult`, `ClarificationRequirement`, and parsed reminder candidate without provider or D1 dependencies.

- [ ] **Step 1: Write failing intent-router tests**

```ts
expect(routeConversationIntent("lịch hôm nay")).toEqual({ intent: "LIST_REMINDERS", range: "TODAY" });
expect(routeConversationIntent("có")).toEqual({ intent: "CONFIRM_PENDING" });
expect(routeConversationIntent("mai 8h gọi mẹ")).toEqual({ intent: "CREATE_REMINDER" });
expect(routeConversationIntent("thứ sáu tuần sau lúc bốn giờ gửi báo cáo")).toEqual({ intent: "UNKNOWN", plausible: true });
```

- [ ] **Step 2: Run the intent tests to verify failure**

Run: `pnpm.cmd exec vitest run src/modules/conversation/intent-router.test.ts`

Expected: FAIL because the router does not exist.

- [ ] **Step 3: Write failing parser and deterministic-result tests**

```ts
expect(parseVietnameseReminder("12h trưa mai đăng ký chữ ký số", now, tz)).toMatchObject({ ok: true, candidate: { scheduledAt: tomorrowNoon } });
expect(parseVietnameseReminder("mai 8h tối gọi mẹ", now, tz)).toMatchObject({ ok: true, candidate: { scheduledAt: tomorrow20h } });
expect(resolveDeterministicConversation("chiều mai gọi mẹ", receivedAt, processingNow, tz))
  .toEqual({ kind: "CLARIFY", missingFields: ["time"], title: "gọi mẹ", localDate: "2026-09-16" });
expect(resolveDeterministicConversation("hôm nay 12h nhắc tôi đăng ký eTax", beforeNoon, afterNoon, tz))
  .toMatchObject({ kind: "REJECT", code: "PAST_TIME" });
```

- [ ] **Step 4: Run parser/core tests to verify failure**

Run: `pnpm.cmd exec vitest run src/modules/reminders/parse-vietnamese.test.ts src/modules/conversation/deterministic.test.ts`

Expected: FAIL for optional marker, explicit dayparts, clarification, and split time authority.

- [ ] **Step 5: Implement focused types and router**

```ts
export type ConversationIntent = "CREATE_REMINDER" | "LIST_REMINDERS" | "CONFIRM_PENDING" | "CANCEL_PENDING" | "HELP" | "UNKNOWN";
export type DeterministicConversationResult =
  | { kind: "CREATE"; candidate: ParsedReminderCandidate }
  | { kind: "QUERY"; range: "TODAY" | "TOMORROW" | "DATE" | "UPCOMING"; localDate?: string }
  | { kind: "CLARIFY"; targetIntent: "CREATE_REMINDER" | "LIST_REMINDERS"; missingFields: Array<"date" | "time" | "title" | "range">; context: ClarificationSeed; reply: string }
  | { kind: "REJECT"; code: ReminderParseFailureCode; reply: string }
  | { kind: "AI_ELIGIBLE" }
  | { kind: "HELP" };
```

Keep `PAST_TIME`, invalid values, over-horizon values, and genuinely absent
date/time/title local. Mark unsupported but semantically plausible phrasing as
`AI_ELIGIBLE`; do not mislabel it as missing.

- [ ] **Step 6: Extend only explicit grammar tokens**

Add marker-optional extraction after date/time identification, safe filler-span
removal, and explicit daypart normalization (`trưa=12`, `sáng` only with hour,
`chiều` adds 12 for 1–11, `tối` adds 12 for 1–11). Reject bare `chiều`/`tối`
without a clock as missing time. Preserve max title and future/horizon checks.

- [ ] **Step 7: Run focused deterministic tests**

Run: `pnpm.cmd exec vitest run src/modules/reminders/parse-vietnamese.test.ts src/modules/conversation/intent-router.test.ts src/modules/conversation/deterministic.test.ts`

Expected: PASS, including examples from the spec, known failure replies, and
received-time versus processing-time regression.

- [ ] **Step 8: Commit Task A**

```bash
git add src/modules/conversation src/modules/reminders/parse-vietnamese.ts src/modules/reminders/parse-vietnamese.test.ts
git commit -m "feat(conversation): add deterministic Vietnamese intent routing"
```

## Task B: Persistent clarification state and canonical reminder queries

**Files:**
- Create: `migrations/0005_conversation_clarifications.sql`
- Create: `src/modules/conversation/infrastructure/d1/store.ts`
- Create: `src/modules/conversation/infrastructure/d1/store.test.ts`
- Create: `src/modules/conversation/query-service.ts`
- Create: `src/modules/conversation/query-service.test.ts`
- Modify: `src/modules/reminders/infrastructure/d1/command-store.ts`
- Modify: `src/modules/reminders/infrastructure/d1/api-store.ts`

**Interfaces:**
- Consumes: `BoundChatContext`, claimed inbound ownership marker, encrypted title keyring port, and a backend-owned range kind/local date.
- Produces: an encrypted active clarification, idempotent terminal resolution, and `ListedReminder[]` filtered to active schedule statuses.

- [ ] **Step 1: Write failing D1 lifecycle tests**

```ts
await store.createClarification(seed);
await store.resolveClarification({ ...turn, hour: 16, processingNow });
expect(await store.findActiveClarification(turn)).toBeNull();
expect(await store.countActiveClarifications(turn.chatIdentityId)).toBe(0);
```

Cover expiry, cancellation, second queue invocation, duplicate resolution, and
encrypted title BLOB read as `number[]`. Assert no sensitive plaintext appears
in a returned public result.

- [ ] **Step 2: Write failing query tests**

```ts
expect(await listConversationReminders({ userId, range: todayRange }, deps))
  .toEqual([{ scheduledAt: futureToday, title: "Gọi mẹ" }]);
expect(sqlBoundStatuses).toEqual(["PENDING", "CLAIMED", "RETRYABLE", "UNCERTAIN"]);
```

Assert `CANCELLED`, `FAILED`, and `SENT` are excluded from active schedule
results; assert owner scope, range bounds, limit, and Vietnam local-day
construction for `TODAY`, `TOMORROW`, `DATE`, and `UPCOMING`.

- [ ] **Step 3: Run Task B tests to verify failure**

Run: `pnpm.cmd exec vitest run src/modules/conversation/infrastructure/d1/store.test.ts src/modules/conversation/query-service.test.ts`

Expected: FAIL because persistent clarification/query services do not exist.

- [ ] **Step 4: Add the additive migration and repository contract**

Create `conversation_clarifications` with an opaque primary key, canonical
`chat_identity_id`, unique source/resolution inbound IDs, encrypted title BLOB
and IV/key-version fields, optional local date, state (`PENDING`, `RESOLVED`,
`CANCELLED`, `EXPIRED`), `expires_at`, and timestamps. Add a partial unique
index for one `PENDING` clarification per chat. Do not store raw user text,
tokens, IDs from the provider, or an LLM response.

Expose methods with ownership marker conditions:

```ts
createClarification(input: CreateClarificationMutation): Promise<"COMMITTED" | "SUPERSEDED">;
findActiveClarification(message: BoundChatMessage, chatIdentityId: string): Promise<ActiveClarification | null>;
resolveClarification(input: ResolveClarificationMutation): Promise<"COMMITTED" | "ALREADY_RESOLVED" | "EXPIRED" | "SUPERSEDED">;
cancelClarification(input: ResolveClarificationMutation): Promise<"COMMITTED" | "SUPERSEDED">;
listActiveScheduled(input: OwnedRangeQuery): Promise<OwnedReminderRow[]>;
```

- [ ] **Step 5: Implement backend-owned query range construction**

```ts
export function canonicalQueryRange(kind: QueryRangeKind, referenceTime: number, localDate?: LocalDate): { from: number; to: number } {
  // Construct only Asia/Ho_Chi_Minh day/window boundaries; never accept model timestamps.
}
```

Decrypt titles through the existing keyring only after D1 ownership/status/range
filtering. Keep `MAX_LISTED_REMINDERS` or a narrower explicit conversational
limit.

- [ ] **Step 6: Run focused Task B tests and local migration integration**

Run: `pnpm.cmd exec vitest run src/modules/conversation/infrastructure/d1/store.test.ts src/modules/conversation/query-service.test.ts src/modules/reminders/infrastructure/d1/command-store.test.ts src/modules/reminders/infrastructure/d1/api-store.test.ts`

Expected: PASS, including local D1 migration application in existing harnesses.

- [ ] **Step 7: Commit Task B**

```bash
git add migrations/0005_conversation_clarifications.sql src/modules/conversation src/modules/reminders/infrastructure/d1
git commit -m "feat(conversation): persist clarification state and queries"
```

## Task C: Structured intelligence fallback and conversational application service

**Files:**
- Modify: `src/modules/intelligence/contracts.ts`
- Modify: `src/modules/intelligence/service.ts`
- Modify: `src/modules/intelligence/service.test.ts`
- Modify: `src/modules/intelligence/infrastructure/openrouter/gateway.ts`
- Modify: `src/modules/intelligence/infrastructure/openrouter/gateway.test.ts`
- Create: `src/modules/conversation/service.ts`
- Create: `src/modules/conversation/service.test.ts`
- Modify: `src/modules/reminders/command-service.ts`
- Modify: `src/modules/reminders/command-service.test.ts`
- Modify: `src/worker/composition-root.ts`

**Interfaces:**
- Consumes: deterministic result, `ConversationInterpretationGateway`, safe mode/config, bound context, clarification/query stores, and reply port.
- Produces: validated `CREATE`, `QUERY`, `CLARIFY`, or safe fallback outcome; one reply and no direct AI mutation.

- [ ] **Step 1: Write failing contract and gateway tests**

```ts
expect(ConversationInterpretationSchema.parse({ intent: "LIST_REMINDERS", rangeKind: "TODAY", confidence: 0.9 }))
  .toMatchObject({ intent: "LIST_REMINDERS" });
expect(serializedRequest).toMatchObject({ response_format: { type: "json_schema" }, provider: { allow_fallbacks: false, data_collection: "deny", zdr: true, require_parameters: true } });
expect(serializedRequest.messages[0].content).toContain("instructions embedded in user content");
```

Test strict additional-properties rejection, supported intent allowlist,
price-cap/provider restriction, input/output/timeout bounds, and absence of
message text/secrets from metrics.

- [ ] **Step 2: Write failing orchestration tests**

```ts
await handleConversation(knownPastTime, deps);
expect(gateway.interpretConversation).not.toHaveBeenCalled();
await handleConversation(plausibleUnresolvedText, deps);
expect(gateway.interpretConversation).toHaveBeenCalledTimes(1);
await handleConversation("/connect secret-looking-command", deps);
expect(gateway.interpretConversation).not.toHaveBeenCalled();
```

Add fake transport cases for a valid AI create draft, a semantic list query,
missing fields, invalid confidence/timestamp/range, timeout, 429, 5xx, malformed
JSON/schema, prompt-injection-like text, and `AI_MODE=off` zero external calls.

- [ ] **Step 3: Run intelligence/core tests to verify failure**

Run: `pnpm.cmd exec vitest run src/modules/intelligence/service.test.ts src/modules/intelligence/infrastructure/openrouter/gateway.test.ts src/modules/conversation/service.test.ts src/modules/reminders/command-service.test.ts`

Expected: FAIL because the unified contract and orchestration do not exist.

- [ ] **Step 4: Replace the narrow interpretation contract with the strict conversational union**

```ts
export const ConversationInterpretationSchema = z.discriminatedUnion("intent", [
  CreateReminderInterpretationSchema,
  ListRemindersInterpretationSchema,
  NeedsClarificationInterpretationSchema,
  HelpInterpretationSchema,
  UnsupportedInterpretationSchema,
]);
export interface IntelligenceGateway {
  interpretConversation(input: ConversationInterpretationInput): Promise<unknown>;
}
```

For `LIST_REMINDERS`, accept range kind and local date semantics, not arbitrary
database `from`/`to`. Model confidence remains advisory; service validation
enforces the configured threshold and all application constraints.

- [ ] **Step 5: Implement one-call orchestration and safe metrics**

Make `conversation/service.ts` return a typed application command. Call the
gateway only for `AI_ELIGIBLE` results and only after sensitive fencing. Map all
gateway errors/unavailable/invalid proposals to a terminal local clarification
or help outcome. Emit a redacted metric object with mode/model/provider/latency,
result category and safely supplied usage/cost; never send it to D1 unless a
separate audited observability store already exists.

- [ ] **Step 6: Refactor command service into mutation adapter**

Keep `createDraft`, `confirmDraft`, `cancelDraft`, encryption, and terminal
ownership handling in `command-service`. Replace direct parser/AI branching
with a call to the conversational service. Apply a validated create outcome to
the existing draft transaction; apply query/clarification outcomes through the
new stores; retain confirmation and cancellation locally.

- [ ] **Step 7: Run focused Task C tests**

Run: `pnpm.cmd exec vitest run src/modules/intelligence src/modules/conversation/service.test.ts src/modules/reminders/command-service.test.ts src/worker/composition-root.test.ts`

Expected: PASS. Verify no model test uses live credentials or network.

- [ ] **Step 8: Commit Task C**

```bash
git add src/modules/intelligence src/modules/conversation src/modules/reminders/command-service.ts src/modules/reminders/command-service.test.ts src/worker/composition-root.ts
git commit -m "feat(conversation): add validated intelligence fallback"
```

## Task D: Idempotent `/connect` terminal outcomes

**Files:**
- Modify: `src/modules/inbound/processor.ts`
- Modify: `src/modules/inbound/processor.test.ts`
- Modify: `src/modules/onboarding/service.ts` only if an existing bind store contract must expose a discriminated result
- Modify: `src/modules/db/onboarding-store.ts` only if its transaction boundary is the canonical one
- Create: `migrations/0006_connect_bind_idempotency.sql` only if a proven existing unique invariant is missing

**Interfaces:**
- Consumes: claimed inbound row, exact `/connect CODE` syntax, code digest, connection/chat identity, and claim marker.
- Produces: `"BOUND" | "ALREADY_BOUND_SAME_CHAT" | "REJECTED_DIFFERENT_CHAT" | "INVALID_CODE" | "SUPERSEDED"` with terminal inbound state.

- [ ] **Step 1: Write failing idempotency tests**

```ts
await process(firstInbound, deps);
await process(secondSameChatSameCodeInbound, deps);
expect(await counts()).toMatchObject({ identities: 1, chatBoundAudits: 1, state: "ACTIVE_BOUND" });
await Promise.all([process(concurrentA, deps), process(concurrentB, deps)]);
expect(await counts()).toMatchObject({ identities: 1, chatBoundAudits: 1 });
```

Add exact provider-message redelivery, malformed `/connect CODE.`, malformed
then correct, already-bound same-chat retry, and consumed-code/different-chat
rejection. Assert no failed inbound merely because a same-chat concurrent winner
completed first.

- [ ] **Step 2: Run inbound tests to verify failure**

Run: `pnpm.cmd exec vitest run src/modules/inbound/processor.test.ts`

Expected: FAIL because the current boolean bind result maps every non-winner to
rejection.

- [ ] **Step 3: Implement a discriminated transactional bind result**

```ts
export type BindPrivateChatResult =
  | { status: "BOUND" }
  | { status: "ALREADY_BOUND_SAME_CHAT" }
  | { status: "REJECTED_DIFFERENT_CHAT" }
  | { status: "INVALID_CODE" }
  | { status: "SUPERSEDED" };
```

Within D1, first prove the claimed inbound ownership. The first successful
transaction updates `ACTIVE_UNBOUND`, inserts one identity, consumes one code,
terminalizes inbound `PROCESSED`, and inserts one audit. On a later attempt,
read the canonical bound identity inside the same ownership-fenced operation:
same provider user/chat returns `ALREADY_BOUND_SAME_CHAT` and terminalizes that
inbound `PROCESSED`; a differing identity returns `REJECTED_DIFFERENT_CHAT` and
terminalizes `REJECTED`. Never use an in-memory lock as authority.

If the existing unique constraints and transaction predicates cannot prove the
single-audit invariant, add only the additive `0006` migration with the exact
unique/index constraint needed. Never edit the already-applied `0005` migration.

- [ ] **Step 4: Implement malformed-command guidance**

Detect a `/connect`-prefixed message that fails the exact code regex before
digesting. Terminalize it as rejected, send `CONNECT_HELP_REPLY` best-effort,
and do not consume a code or change connection state.

- [ ] **Step 5: Run focused Task D tests**

Run: `pnpm.cmd exec vitest run src/modules/inbound/processor.test.ts src/modules/inbound/webhook.test.ts src/modules/onboarding/service.test.ts`

Expected: PASS with atomic counts and terminal states asserted for every
duplicate/malformed case.

- [ ] **Step 6: Commit Task D**

```bash
git add src/modules/inbound/processor.ts src/modules/inbound/processor.test.ts src/modules/onboarding/service.ts src/modules/db/onboarding-store.ts migrations
git commit -m "fix(inbound): make connect binding idempotent"
```

## Task E: Connections UI state watch

**Files:**
- Modify: `src/features/final-screens/FinalScreenExperience.tsx`
- Modify: `src/features/final-screens/FinalScreenExperience.module.css`
- Modify: `src/features/final-screens/FinalScreenExperience.test.tsx`
- Modify: `src/app/app/connections/ConnectionsDiagnosticExperience.tsx` only to remove the temporary diagnostic query behavior in Task F

**Interfaces:**
- Consumes: returned `connectCommand`/`expiresAt`, canonical `GET /api/connections`, authenticated `apiRequest`, and the existing `PublicConnection` contract.
- Produces: bounded polling state, success/expiry/timeout/auth-loss feedback, and no second connection truth source.

- [ ] **Step 1: Read Next.js 16 local documentation and write failing UI tests**

Run: `Get-ChildItem node_modules/next/dist/docs -Recurse -File | Select-String -Pattern "useEffect|Client Component" -List`

Then test fake-timer lifecycle:

```tsx
await user.click(screen.getByRole("button", { name: "Tạo mã kết nối" }));
await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/connections", expect.anything()));
respondConnections([activeBound]);
expect(screen.getByText("Đã kết nối thành công")).toBeVisible();
expect(screen.queryByLabelText("Mã kết nối")).not.toBeInTheDocument();
```

Add expiry, bounded timeout, manual re-check, unmount cleanup, and unauthorized
redirect tests. Assert polling begins only when the code is active.

- [ ] **Step 2: Run UI tests to verify failure**

Run: `pnpm.cmd exec vitest run src/features/final-screens/FinalScreenExperience.test.tsx`

Expected: FAIL because code generation does not start a canonical state watch.

- [ ] **Step 3: Implement cancellable canonical watch**

Use a client `useEffect` keyed by active code metadata. Refresh only via the
existing authenticated `apiRequest("/api/connections")`; stop on success,
expiry, timeout, unmount, or unauthorized callback. Clear the code and show
the locked success copy on `ACTIVE_BOUND`. Keep pending mutation buttons
disabled and do not create a new API or WebSocket.

- [ ] **Step 4: Implement accessible state copy and responsive CSS**

Use `role="status"` for waiting/success, an actionable error/timeout region,
and existing design tokens. Keep controls usable at 390px and ensure action
names are exactly `Kiểm tra lại` and `Tạo mã mới` where applicable.

- [ ] **Step 5: Run focused UI and accessibility tests**

Run: `pnpm.cmd exec vitest run src/features/final-screens/FinalScreenExperience.test.tsx src/features/final-screens/FinalScreenExperience.responsive.test.ts`

Expected: PASS. If the responsive test file does not exist, add it with
scroll-width and bottom-navigation assertions using the existing UI test style.

- [ ] **Step 6: Commit Task E**

```bash
git add src/features/final-screens src/app/app/connections
git commit -m "feat(connections): watch bind confirmation"
```

## Task F: Remove temporary diagnostics, reconcile documentation, and validate

**Files:**
- Modify: `src/worker/routes/connections.ts`
- Delete: `src/worker/routes/connections-poll-diagnostic.test.ts`
- Modify: `src/worker/composition-root.ts`
- Delete: `src/modules/onboarding/zalo-poll-diagnostic.ts`
- Delete: `src/modules/onboarding/zalo-poll-diagnostic.test.ts`
- Modify: `src/modules/inbound/processor.ts`
- Modify: `src/modules/inbound/processor.test.ts`
- Modify: `src/features/final-screens/FinalScreenExperience.tsx`
- Modify: `src/features/final-screens/FinalScreenExperience.test.tsx`
- Modify: `src/app/app/connections/page.tsx`
- Delete: `src/app/app/connections/ConnectionsDiagnosticExperience.tsx`
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/current-state.test.mjs`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/runbooks/zalo-production-acceptance.md`

**Interfaces:**
- Consumes: verified production evidence and all completed tests from Tasks A–E.
- Produces: no temporary public polling endpoint/UI, preserved secret-safe normal observability, and canonical documents that distinguish implemented/tested/proven/live-AI states.

- [ ] **Step 1: Write failing removal/regression tests**

```ts
expect(routerResponseFor("POST", "/api/connections/id/zalo-poll-diagnostic").status).toBe(404);
render(<FinalScreenExperience screen="connections" />);
expect(screen.queryByText(/Kiểm tra nhận tin Zalo/i)).not.toBeInTheDocument();
```

Retain tests for normal same-origin mutation protection, webhook authentication,
safe non-secret provider diagnostics, and all ordinary connection recovery
actions.

- [ ] **Step 2: Run diagnostic-removal tests to verify failure**

Run: `pnpm.cmd exec vitest run src/worker/routes/connections-poll-diagnostic.test.ts src/modules/onboarding/zalo-poll-diagnostic.test.ts src/features/final-screens/FinalScreenExperience.test.tsx`

Expected: FAIL because temporary diagnostic endpoint/UI remain.

- [ ] **Step 3: Remove only investigation-only surfaces**

Remove the owner-facing poll diagnostic route, composition wiring, query-param
client control, and tests. Change the connections page to render the normal
`FinalScreenExperience` directly before deleting `ConnectionsDiagnosticExperience`.
Remove parser/early/bind console diagnostic code only
after retaining a reviewed, secret-safe operational event required by the
deployment runbook. Do not remove webhook authentication, parser normalization,
D1 BLOB normalization, connection recovery, or normal provider transport.

- [ ] **Step 4: Reconcile canonical documentation**

Update current state, system overview, roadmap, and runbook with the actual
production Zalo acceptance boundary and the new conversational architecture.
Label `AI_FALLBACK_IMPLEMENTED`, `AI_FALLBACK_CONFIGURED`, and
`AI_FALLBACK_PROVEN_LIVE` separately. Preserve the deployment guardrail in
`zalo-production-acceptance.md`; do not claim live AI or Telegram proof without
fresh authorized evidence.

- [ ] **Step 5: Run focused docs and full canonical validation**

Run:

```bash
node --test docs/architecture/current-state.test.mjs
pnpm.cmd test
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
pnpm.cmd exec wrangler types --check
pnpm.cmd exec wrangler deploy --dry-run
git diff --check
pnpm.cmd check
```

Expected: every command exits `0`; preserve exact aggregate output for the
final report.

- [ ] **Step 6: Commit Task F**

```bash
git add src/worker src/modules/onboarding src/modules/inbound src/features docs
git commit -m "chore: close conversational core v1 diagnostics"
```

## Final acceptance evidence

- [ ] Verify Tasks A–F against every requirement in the spec before any push.
- [ ] Confirm only approved, non-sensitive production actions are proposed; do
  not deploy or configure `AI_MODE=privacy` unless model/provider/cost/privacy
  approval and secret authority are separately explicit.
- [ ] If a deployment is separately authorized, use the immutable Worker
  lifecycle and the Zalo production acceptance runbook; record only safe
  metadata.
