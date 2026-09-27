# Conversation V2 bounded live evaluation

Authorization: user-approved aggregate ceiling USD 0.50 on 2026-09-27.
This is a synthetic evaluation, not production acceptance or deployment authority.

## Frozen profile

- Existing immutable V2 corpus: 22 cases / 37 turns, digest
  `5e514ba2c1f53a4a8c06482597530a9eab361f828dc61f3fef5c1d7f6d055382`.
- Real local ephemeral D1, encrypted context, command/service and gateway path.
  No remote D1, Zalo messages, production credentials or deployment.
- Model `google/gemini-2.5-flash-lite`, provider `google-vertex/eu` only.
  ZDR, data collection deny, required parameters, strict schema, no fallback.
  Flash Lite intentionally omits reasoning. Input bound 12000, output 256 tokens.
- Maximum 40 inference HTTP requests, 500000 microunits total, zero retries.
  Reserve 1303 microunits durably before each dispatch; never reclaim ambiguous
  usage. Conservative 37-call bound: 48211 microunits. Actual usage is reported
  separately when supplied by provider, not substituted for the safety reserve.
- One exclusive authorization ledger in
  `<shared-git-dir>/calenote-benchmark-authorizations/conversation-v2-live-20260927/`.
  Linked worktrees share this fence; changing checkout or run ID cannot reset it.
  No resume/restart/new-run-ID escape. A crash requires operator inspection,
  not deletion of the ledger. Evidence contains only IDs, categories and cost.
- Immediately revalidate public endpoint and ZDR metadata before inference.
  Refuse unavailable routes, missing structured output or prices above caps.

## Acceptance and scoring

Require all 37 turns accounted for, at least 36 correct final outcomes,
100% schema validity for attempted model calls, 100% temporal evidence,
and zero safety failures. A deterministic greeting need not call the model.
Provider/schema failure stops inference and leaves remaining turns failed/not run.
Compare actual persisted encrypted request context, pending single drafts
(title, timestamp, timezone, calendar facts and count), and series proposal dates,
epochs, order and count, not only a recomputed pure reconciliation result.
Canonical reminders must remain zero throughout these pre-confirmation turns.
Confirmation/idempotency are covered by separate local integration suites;
this corpus alone does not prove full release or production acceptance.

Frozen differences from historical pure-reconciler expectations:

1. Past series must be rejected by the real service, leaving no context.
2. The 2023 lunar leap completion is past at the corpus reference clock;
   service rejection preserves its pending clarification, not a draft.
3. The exam title accepts `thi hết môn ở Quang Trung`, `thi hết môn`, or the
   historical `ôn thi`. Date, time, series dates and other fields remain exact.

These policies are bound by the runner digest before any live calls. Do not
change them after observing model output to manufacture a pass.

## Commands

From repository root, using installed Node and TypeScript:

```sh
node --import ./tools/benchmark/register-conversation-loader.mjs tools/benchmark/run-conversation-v2-live.mjs --preflight
node --import ./tools/benchmark/register-conversation-loader.mjs tools/benchmark/run-conversation-v2-live.mjs --live RUN_ID
```

Only the second command reads `OPENROUTER_API_KEY` from the approved local
environment. Never pass it as an argument or print its value. A failed quality
gate blocks UAT activation; no alternate model is implicitly authorized.
