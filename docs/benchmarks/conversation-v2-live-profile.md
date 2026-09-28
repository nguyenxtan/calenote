# Conversation V2 bounded live evaluation

Authorization: user-approved aggregate ceiling USD 0.50 on 2026-09-27.
This is a synthetic evaluation, not production acceptance or deployment authority.

## Repair authorization amendment — 2026-09-27

User explicitly approved correction, safe schema diagnosis and new evaluation,
then raised the aggregate ceiling to USD 2.00, inclusive of the original run.
The legacy $0.50 slot/ledger is immutable and remains reserved in full.
Three additional fixed slots (`diagnostic`, `repair`, `verification`) each
allow at most 40 requests / $0.50, one exclusive ledger per slot in the shared
Git directory. Thus all four allocations together cannot exceed $2.00, even
with concurrent worktrees or missing usage after a crash. No automatic retries.
Unused allocations are not permission to model-shop or change provider.

Append a slot name to the live CLI command to use a new allocation. Never delete
or reuse a consumed slot. Diagnostics store only canonical field names, Zod error
codes and bounded invariant labels; never values, error messages or unknown keys.
The transport forwards the original response unchanged into the real gateway.
Corpus/scoring gates remain unchanged. A diagnostic pass alone cannot repair
the previously observed intermittent contract defect.

## Frozen profile

### Semantic repair continuation authorization — 2026-09-27

After reviewing the residual failure plan, the user authorized completing the
repairs and a bounded new evaluation ("làm hết đi"), retaining the USD 2 total.
Two new exclusive slots are `semantic-diagnostic` and `semantic-verification`,
USD 0.50 / 40 requests each, zero retries. Before either LIVE run the runner
requires the exact SHA-256 of all four closed historical ledgers and their final
COMPLETE records; all dispatched reservations sum to 71665 microunits. Missing,
changed or incomplete evidence fails closed before HTTP or creating a new ledger.
Thus the worst-case aggregate is 71665 + 2 * 500000 = 1071665 microunits, below
USD 2. This does not reuse any old slot or discount ambiguous dispatched usage.

New safe diagnostics include only validated semantic enum labels, canonical
mismatch field names and a case-only title-difference boolean, never titles,
dates, user text, identifiers or raw provider output. They do not change scoring.

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

### 2026-09-28 boundary-repair verification authorization

The user's continuation request authorizes one new `boundary-verification`
slot for the repaired context-transition and semantic-wire contract, retaining
the original model, corpus, scoring gates and aggregate USD 2 ceiling.
Admission requires all six preceding ledgers to be closed, digest-matched and
unchanged. Their dispatched reservations total 125088 microunits; adding the
new slot's maximum 500000 yields 625088, below 2000000. Provider-reported spend
is not used to release uncertain reservations. No historical ledger is reused.
The new slot remains exclusive across linked worktrees and run IDs. It permits
at most 40 inference requests, zero retries, no alternate model or fallback.
It does not authorize deployment; exact-master-SHA approval remains required.

```sh
node --import ./tools/benchmark/register-conversation-loader.mjs tools/benchmark/run-conversation-v2-live.mjs --live RUN_ID boundary-verification
```

From repository root, using installed Node and TypeScript:

```sh
node --import ./tools/benchmark/register-conversation-loader.mjs tools/benchmark/run-conversation-v2-live.mjs --preflight
node --import ./tools/benchmark/register-conversation-loader.mjs tools/benchmark/run-conversation-v2-live.mjs --live RUN_ID
```

Only the second command reads `OPENROUTER_API_KEY` from the approved local
environment. Never pass it as an argument or print its value. A failed quality
gate blocks UAT activation; no alternate model is implicitly authorized.
