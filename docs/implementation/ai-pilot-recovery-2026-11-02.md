# AI Pilot recovery checkpoint — 2026-11-02

**Current work, 2026-11-03:** see
[keyed comparison design](ai-keyed-comparison-2026-11-03.md).
The sections below are earlier dated evidence, not the current completion
status. On Nov3,prompt139/wire136 passed the fresh full synthetic comparison:
32/32 scripts,84/84 turns,2043/2043 detail checks,5/5 actions,0 safety failures.
See the linked design and [durable result](ai-pilot-live-result-2026-11-03.json).
This is not historical Formal Pilot succession or production qualification.
The owner-approved total lifetime test-key cap isUSD2; observed usage after
completionUSD1.490799129,remainingUSD0.509200871. Production is unchanged.

Working baseline: `455816a` (`origin/codex/wire105-numeric-control-union`).
This branch is a SMALL_106 candidate despite its historical wire105 name.
The independent Claude review identified a parallel code-only backup at
`e9ceee3`; it has not been merged or qualified here.

## Proven problems

- Earlier typed105 requests were rejected with Google's schema state limit.
- SMALL_106 generation grammar admits owner/order combinations that strict
  decoding correctly refuses. For three fields there are 320 combinations of
  owner subsets and reference vectors of length zero through three: only 16
  are valid permutations; 304 must refuse. This is a bounded exhaustive audit,
  not proof that all other grammar constraints have been enumerated.
- Those owner/order failures were reported as GENERATION_SHAPE_INVALID.
  The fix preserves whole-patch refusal and reports CHANGE_ORDER_INVALID only
  after owner schema validation. No values or field names enter that diagnostic.
- Production composition selects TYPED_105; historical recent Pilot work uses
  SMALL_106 and a different provider/privacy policy. A Pilot pass cannot be
  promoted to production qualification across that difference.

## Current provider observations

OpenRouter key authentication returned HTTP 200. One synthetic SMALL_106
request was attempted on the existing `google-vertex/eu`, ZDR-required route,
with no retries and a conservative USD 0.11 exposure ceiling. The gateway
returned PROVIDER_FAILURE with unknown cost. This does not prove schema
admission, model quality, zero billing, or a Formal Pilot result. Keep that
unknown separate from historical accounting; no historical ledgers were edited.

The authenticated endpoint catalogue for `google/gemini-2.5-flash-lite` returned
only `google-ai-studio`, `google-ai-studio/flex`, and
`google-ai-studio/priority` at this inspection. It did not list the pinned EU
Vertex route. A subsequent ZDR catalogue query found no matching model entry.
These metadata observations do not identify the HTTP status/error of the
previous completion attempt, which the local diagnostic did not retain.

Production routing and privacy settings remain unchanged. The owner approved
both evaluated route options, including synthetic-only AI Studio within USD 1.
The supplied key was subsequently identified by `/api/v1/key` as a management
key (`is_provisioning_key: true`). Its completion requests return HTTP 401
`User not found`; authentication metadata returning 200 did not prove inference
access. A separate inference key was created with a USD 0.75 lifetime limit,
no reset, BYOK usage included, and expiry on 2026-11-03. It lives only in the
ignored `.env.pilot.local`; the management key remains in `.env.local`.

## Fresh synthetic live evidence

These are diagnostics, not an authorized historical Formal Pilot successor
or production qualification. No historical accounting namespace was modified.

- AI Studio R01/0–1 and R02/0–2 passed the unchanged complete turn oracle.
- The following R03/0 request returned upstream shared-pool HTTP 429. The
  diagnostic stopped. Known key usage was USD 0.00292595.
- After a 15-minute cooldown, a separate R03-only diagnostic passed R03/0,
  then stopped on R03/1 HTTP 400 INVALID_ARGUMENT: the provider reported too
  many schema states. No R03/1 model output exists to diagnose semantically.
- Current key-reported total usage is USD 0.00407105. Error responses without
  numeric billing evidence remain unknown; this total is not a fabricated
  per-request settlement or a reconciliation of historical exposure.

Compact request-schema measurements (UTF-8, compact JSON):

| Case | Bytes | Arrays | maxItems constraints | Enums |
| --- | ---: | ---: | ---: | ---: |
| R02/2, accepted | 20663 | 158 | 56 | 70 |
| R03/0, accepted | 16901 | 133 | 48 | 57 |
| R03/1, HTTP 400 | 21785 | 164 | 62 | 75 |

R03/1 schema SHA256:
`099e333d70e7c0c632fd8914ae4608502222e0c62d146f935bc45fcc8aa15cf4`.
Size/count differences alone do not establish which schema construct caused
Google's compiler failure. A narrow, read-only Claude review is in progress.
Private synthetic diagnostic artifacts are under
`/tmp/calenote-live-synthetic-1793629909886` and
`/tmp/calenote-live-synthetic-1793630886649`; they contain no authorization
headers. Temporary files are not durable acceptance artifacts.

## Verification and remaining work

- The original owner tests passed (10 tests).
- Both added public diagnostic regression cases failed with the old generic
  classification before the fix and passed afterward.
- Four focused files passed: 80 tests, including the offline full fixture
  campaign (80 scripts, 158 turns, 144 healthy responses, 3,941 detail checks).
- The subsequent owner suite passed all 13 tests, including the 320-case
  owner/order audit and an observer-failure check.
- Dependency installation completed with the original frozen pnpm lockfile;
  the downloaded Next archive was verified against its lockfile SHA512.
- Initial whole-suite execution during setup/source changes failed. After
  completing setup and freezing source, the standard `pnpm test` passed:
  252 files, 10,424 tests passed, 2 skipped (649.10 seconds).
- Build, repository-wide lint, typecheck, architecture documentation tests,
  Worker types check, and Wrangler deployment dry-run passed. Dry-run was
  not deployment. `git diff --check` passed.
- No production changes, deployments, migrations, model switches, oracle
  relaxations, or historical accounting changes were made.

Next: use the retained R03/1 request to investigate compiler complexity
offline, add a failing regression before changing schema generation, and
verify any candidate with a tightly bounded fresh diagnostic. Keep the
canonical contract and frozen oracle unchanged. Full live qualification and
production integration remain incomplete.

## Generation-order-42 candidate

Claude's narrow schema review identified owner/CLEAR combinations in subtree
`c` as a plausible complexity source; it did not prove Google's internal cause.
Two independent admission-only experiments used the retained synthetic R03/1
request and the same provider/model:

1. Requiring every existing WRITE cell to be nonempty still returned HTTP 400.
   That reduced-permission diagnostic was never integrated into application code.
2. Removing only `c.o.maxItems` from the generation schema returned HTTP 200
   and a model response, with reported cost USD 0.0012505. This was schema
   admission evidence, not a scored application or Formal Pilot pass.

The implementation follows the smaller experimentally supported change:
`smallContextGenerationSchemaV3` clones the strict schema and removes only that
provider-side bound. The strict codec retains maxItems 13, owner cardinalities,
typed values, evidence bounds and exact owner/order permutation validation.
Overlong, duplicate, missing and inactive references still refuse the whole
patch without repair. This intentionally broadens the generation grammar; it
does not eliminate the existing generation/strict gap. Model compliance must
be measured live.

The new protocol includes `generation-order-42`, and its prompt digest is
`be4b993dbca5952722efccd96ad8efbf459fcda06a219792e45fc944bd15b141`.
Only current runner pins were updated; historical evidence remains unchanged.
The original owner40 protocol is refused rather than silently relabeled.

Verification so far:

- The new generation-bound regression failed against the original schema.
- Four focused files pass all 84 tests. For every one of 144 healthy inputs,
  the generated schema equals the strict schema with exactly `c.o.maxItems`
  removed, and the valid canonical fixture remains admitted.
- Synthetic R02/2 and R03/1 inputs are retained as regression fixtures; they
  contain no credentials or provider authorization headers.
- Repository-wide lint, typecheck and architecture documentation tests passed.
- A fresh application-path R03 diagnostic on the new profile passed R03/0;
  R03/1 then received HTTP 429 from the provider shared pool. That does not
  establish either semantic failure or application acceptance for R03/1.
- Full regression/build/Worker checks are rerunning for this new source. The
  earlier 10,424-test pass belongs to the prior diagnostics-only source.
- A separate R03-only check is scheduled after the latest 15-minute cooldown,
  with 45 seconds between successful turns and at most two physical requests.
