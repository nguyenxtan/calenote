# Existing-product completion checkpoint — 2026-10-16

Baseline: production source `19df5a3bc16a56ee96835d01b1b3d07f4624fdc4`.
This checkpoint is a feature-branch candidate, not a deployment receipt.

## Resulting behavior

- Local, whole-utterance today/tomorrow calendar questions use Vietnam receipt
  dates, exact day ranges and the existing owner/chat/workspace/inbound fences.
  They do not dispatch AI, alter pending proposals or create reminders.
- A lost web CREATE response triggers a real read-back. The mounted form blocks
  resubmitting that normalized title/time even when read-back fails or the user
  edits away and back. This is not durable cross-reload idempotency.
- Cancellation keeps API rejection reasons, reads back ambiguous/conflict results,
  serializes web mutations and fences stale list responses, including a series
  refresh that starts while cancellation is pending.
- Web list reads traverse bounded keyset pages instead of silently stopping at
  100 records. Public IDs provide immutable traversal order. Each page remains
  owner scoped; the UI applies its own presentation order. A failed later page,
  repeated cursor or total traversal limit produces a local error, not a partial
  list presented as complete. Concurrent GETs do not constitute a snapshot.
- Production V2 routing, grouped-series controls, lunar presentation, delivery
  projection and failure telemetry are preserved. The separate UI branch has
  not been merged wholesale.

## Why this work became difficult to close

The inspected branches represent different products/stages: PR #11 is the
Context Contract foundation, while deployed master contains the V2/local-read
path. The separate UI checkout lacks some newer runtime and grouped-series
wiring. Combining their changes indiscriminately would regress existing behavior.
The architecture document also retained an undeployed September checkpoint as
current, so this change adds a clearly dated superseding checkpoint.

The old runtime mapped several failure stages to a generic reply and did not
retain enough correlated detail to identify the two historical CREATE incidents.
New telemetry cannot reconstruct that missing evidence. Repeated empty
telemetry queries cannot establish the cause or prove successful CREATE. This
is an evidence limit, separate from the reproducible web defects fixed here.

## Acceptance boundaries

Independent review identified the web ambiguity/pagination issues; local
regression tests reproduced them.
Regression coverage includes lost responses, failed read-back, concurrent series
refresh, real D1 ownership, delivery status changes between pages, API contracts,
and the real Worker Queue path with pending drafts/cancellations.

Paid AI remains on hold. Historical CREATE root cause remains `UNKNOWN`. No
provider calls, live CREATE replay, production mutation, master promotion, merge,
migration or deployment is part of this checkpoint. Full local checks and exact
commit CI results must be attached to the PR before release consideration.
