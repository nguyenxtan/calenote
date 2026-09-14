# Calenote Egress Isolation V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate whether Calenote's outbound-fetch failure is caused by request initialization, its custom-domain/zone path, or an account-wide Worker boundary.

**Architecture:** Extend the existing expired one-time scheduled diagnostic with two fixed `example.com` fetch probes: one with no `RequestInit` and one with only an 8-second abort signal. The probes emit a strict, non-sensitive event schema. Create a separate no-binding workers.dev control only when this matrix remains inconclusive.

**Tech Stack:** TypeScript, Cloudflare Workers, Vitest, Wrangler.

**Spec:** User request, “CALENOTE — CLOUDFLARE EGRESS ROOT-CAUSE ISOLATION V2”.

## Global Constraints

- Do not change Zalo, D1, Queue, cron, secrets, OpenRouter, custom domains, SSL/TLS, or production behavior.
- Do not log a raw error message, URL, request/response body, header, or credential.
- Production diagnostics use fixed tokenless destinations and run once only from the existing scheduled boundary.
- A workers.dev control, if needed, has no bindings, secrets, variables, routes, or custom domain.
- Use immutable Worker versions for any deployment and run `pnpm.cmd check` and `git diff --check` before deployment.

---

### Task 1: Add Calenote plain/signal fetch diagnostic coverage

**Files:**
- Modify: `src/worker/zalo-egress-probe.test.ts`
- Modify: `src/worker/zalo-egress-probe.ts`
- Modify: `src/worker/index.ts`

**Interfaces:**
- Produces `runCalenoteEgressIsolationV2Probes(fetcher, logger)` and an allowlisted event type containing only probe name, response status, safe error metadata, and no raw error data.
- Consumes the scheduled controller time through an additional one-time window.

- [ ] **Step 1: Write failing tests**

```ts
expect(fetcher).toHaveBeenNthCalledWith(1, "https://example.com/");
expect(fetcher).toHaveBeenNthCalledWith(2, "https://example.com/", {
  signal: expect.any(AbortSignal),
});
expect(JSON.stringify(events)).not.toContain("raw-error-marker");
```

- [ ] **Step 2: Run the focused test and verify it fails because the V2 probe is absent.**

Run: `pnpm.cmd exec vitest run src/worker/zalo-egress-probe.test.ts`

- [ ] **Step 3: Implement the smallest fixed-destination V2 probe.**

Use direct `fetch("https://example.com/")` for plain fetch and an otherwise-empty init with `AbortSignal.timeout(8_000)` for signal fetch. Emit only the specified safe fields and preserve scheduled work.

- [ ] **Step 4: Run focused tests and typecheck.**

Run: `pnpm.cmd exec vitest run src/worker/zalo-egress-probe.test.ts src/worker/index.test.ts` and `pnpm.cmd typecheck`.

### Task 2: Validate and execute the one-time production matrix

**Files:**
- No further source files unless Task 1 validation fails.

- [ ] **Step 1: Run canonical checks.**

Run: `pnpm.cmd check` and `git diff --check`.

- [ ] **Step 2: Commit and deploy the immutable diagnostic version.**

Upload once, record its version ID, and deploy that exact version at 100%. Do not mutate resources or settings.

- [ ] **Step 3: Tail only structured V2 probe events, run the two probes once, and stop the tail.**

Record only safe result fields. If the plain probe already demonstrates a custom-domain failure is not distinguishable from account-wide behavior, continue to Task 3.

### Task 3: Create the isolated workers.dev control only if required

**Files:**
- Create: `src/worker/egress-control.ts`
- Create: `wrangler.egress-control.jsonc`
- Create: `src/worker/egress-control.test.ts`

- [ ] **Step 1: Write a failing handler test.**

```ts
expect(await handler.fetch(new Request("https://irrelevant.invalid"))).toMatchObject({ status: 200 });
```

- [ ] **Step 2: Implement a handler that fetches only `https://example.com/` with no init and returns only a status or safe failure classification.**

- [ ] **Step 3: Validate, deploy, invoke once, and report the separate workers.dev URL/version.**

No custom domain, bindings, variables, secret, or production data may be configured.
