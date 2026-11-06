# Final review corrections — 2026-11-06

Claude reviewed source `2f36b381a689f25e9366a03da1acc86f42afc1e6` read-only and reported two P1 and six P2 findings. The source changes below address them; this document does not claim a green final gate or production acceptance.

| Finding | Correction and evidence |
| --- | --- |
| P1-1 persisted key dictionary shifted | Reproduced old production463b0dc envelopes failing both state decoders. `deliveredAt` is appended after the60 historical entries. Three independently captured golden envelopes pin unchanged encoding, first/last historical keys and the new appended key. Compatibility/state/confirmation tests pass. |
| P1-2 Workerd rejects redirect error mode | Actual bundled Workerd probe reproduced the failure before local mock egress. Google now uses manual redirects and treats3xx as UNKNOWN. The same pre-existing Telegram bug was confirmed and corrected, keeping redirected sends UNCERTAIN and never forwarding credentials. |
| P2-1 compound loses its hours | `N tiếng M phút trước` verifies both already-proposed units; omitting hours fails coverage. New tests failed before the correction. No scanner operand is returned or manufactured. |
| P2-2 before-hour phrase ambiguous | A possible clock-hour `trước N giờ` asks the user to restate with `tiếng`, an explicit `N giờ trước`/compound duration, or a chosen clock. This static guidance runs before any paid attempt, including earlier members of a burst. Unambiguous durations stay supported. |
| P2-3 retry after series cancellation | Real D1 tests reproduced tracked and pre0014 untracked retry paths. A retry-only atomic guard settles them CANCELLED. An already acquired send may still settle successfully; cancellation does not invent proof that in-flight egress stopped. |
| P2-4 deleted Google event pauses everything | Deterministic-ID lookup and ownership probes recover404/410 per event. Sparse deleted tombstones require a previously confirmed mapping; a foreign marker never authorizes deletion. Failed individual items do not stop unrelated events. |
| P2-5 unknown403 forces reconnect | Only explicit authorization errors request reauthorization. Other403s retain calendar identity and use bounded retry. Definite rejected calendar creation is distinguished from an unknown creation result. |
| P2-6 invisible/corrupt canonical series | Ten-row active-first keyset pages expose `hasMore`, `nextCursor` and per-page skipped counts. A corrupt owned row does not hide the rest. API/client/panel preserve owner/session, stale-response and narrow path guards. |

Calendar mapping lookup is batched instead of up to300 separate reads. Google remains disabled and has no real account E2E proof. Reconnect retains old events and creates a new calendar; unresolved egress and unknown calendar creation still pause for verified operator/user action. The UI states the bounded300-item,30-day-past/400-day-future scope.

Verification recorded before the final combined freeze: root102 focused and149 regression tests, then75 final source/compatibility/burst tests; calendar/transport105 tests with actual Workerd; series118 tests including actual D1, pagination and retry races. These overlap and must not be summed as unique full-suite coverage. Typecheck and scoped lint passed. The first frozen full run was already red on historical benchmark fixtures and was intentionally stopped with exit143 after the P1 findings; it is not PASS evidence.

The benchmark repair separately pins the reviewed current successor schema/prompts, preserves immutable old wire goldens, and versions the one approved H10 weekly oracle change. A current finite-weekly request without a clock now asks for its reminder clock; the old unsupported-weekly `pendingField:null` expectation is historical. Financial, source, tamper and dispatch authority fences remain required.

Before production: every final check must pass, the exact immutable SHA must be authorized, and production smoke must prove the actual V3 selected route (not merely the legacy-named capability flag), serving version/tag, dotted `.ics` API routing and owned reminder/series acceptance. Source1/2 live acceptance and a fresh full live32-scenario Pilot have not been claimed. Four grouped interpretation cases passed real EU/ZDR provider qualification; they do not substitute for those gates.

Rollback constraint: appending the dictionary preserves old envelopes. Once new operands, advance metadata or `deliveredAt` are populated, an older strict decoder is still not compatible. Do not roll back to a pre-feature binary after such writes; retain a reviewed compatible forward build. D1 migrations remain forward-only.
