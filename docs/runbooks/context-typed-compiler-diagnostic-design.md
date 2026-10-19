# Typed105 one-request compiler diagnostic

Status: LOCAL IMPLEMENTATION; no paid authority or live execution follows.

The existing single-target runner already executes a frozen turn through the
actual local D1/service/gateway/oracle. Extend it only through a private bridge
from a separate branded compiler launcher. Public typed single-target/replay
entrypoints remain rejected; the Formal76 manifest/launcher remain untouched.

The reviewed authority must pin immutable app/harness proofs, R01/turn0 manifest,
exact payload/schema, owner/proposal hashes, full account inventory/lifecycle,
actual prior UNKNOWN/retained/remaining, validity window and fixed route. Cap is
10,000,000microunits, one request bound105,472, retry0, fallbacknone, maxoutput1536.
Load/inspect are read-only and neither read credentials nor call a provider.

Under account lock recheck all pins, freshness, prior headroom and unused owner
and proposal across historical consumed markers. Write/fsync one-use markers
and execution evidence. The existing runner then durably writes BEGIN with
CONFIRMED_COST_V1 and requestExposureBound105472, RESERVE0 and DISPATCH before
the credential callback. Conservative account inspection charges that pending
claim the full105472. Recheck historical inventory excluding only the own leaf,
total retained<=cap (no second headroom requirement), immutable/loaded source,
payload/route, freshness and active bridge before one physical transport call.
The approved orchestration supplies a fenced Keychain callback; no env fallback
or credential literal belongs in this module. Callback errors are sanitized.
Abort/timeout prevents a late callback from starting a request.

Expected failures terminalize inside the lock so an owned completed operation
releases it. Uncertain storage failure deliberately retains the lock for review;
never remove an unowned or uncertain lock. Runner settlement retains the full
bound for unknown usage, even if acquisition fails after durable reservation.
No historical UNKNOWN is rewritten. Conservative policy is account inspection;
BEGIN keeps the existing validated ledger policy, not a new accounting enum.

Result is always terminal/HOLD, score null, pilotCreditfalse, full/deployfalse.
HTTP200 observation, strict service/oracle acceptance and charged/unknown usage
are separate evidence. No COMPLETE or Formal/Pilot advancement can be emitted.

Implementation checklist:
- [x] RED: absent/forged authority, drift/used/insufficient/freshness checks,
  reservation-before-credential and one-call successful/failed/unknown outcomes.
- [x] Separate strict branded launcher and runner-private bridge; fixed transport.
- [x] GREEN: concurrency, callback/transport timeout, source/payload/inventory
  drift, old owner grant replay, exact-bound boundary and immutable history.
- [x] Targeted existing scope/launcher/ledger regression, typecheck/lint, review.
After the immutable commit, freeze a separately reviewed preparation packet with
app/harness/payload/schema/account pins. This document is not an execution grant.

Validation:170targetedtests in5files passed, including30new launcher cases,
existing typed105 public-scope refusals/Formal76 synthetic qualification,
Formal launcher authority fences and ledger/cost regressions. Typecheck and
scoped ESLint passed. Independent review found two durability gaps; marker and
ledger post-write/fsync fault injection reproduced them, and both were fixed.
Runner records any ledger mutation exception even if the service catches it,
and both runner/launcher refuse unresolved RESERVE before normal lock release.
Unexpected exceptions after mutation retain the lock for explicit recovery.
No full-suite rerun locally and no real account/credential/provider/CF/deploy
mutation occurred during implementation. Previous4115application tests remain
source6e evidence; this change touches tools only.
