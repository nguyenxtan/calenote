# Direct typed context wire105

Approved scope: replace JSON structural strings on the provider boundary with typed objects/arrays; choose the schema entirely from canonical input before dispatch. Preserve Google Gemini 2.5 Flash Lite, google-vertex/eu, canonical V3, oracle, storage fence2, paid HOLD and UNKNOWN. No paid inference, credential lookup, retry, merge or deployment.

Implementation:
1. Freeze wire104 serializer/prompt/codec and historical specimen assertions. Introduce separately versioned typed105 schema/prompt/decoder.
2. Keep changes, dates, query operands, uncertainty alternatives and additional evidence structurally typed. Keep request-scoped evidence source codes and existing capability/rank/ownership predicates. Refuse structural strings without coercion.
3. Pair serializer and decoder at gateway selection. The dormant runtime uses typed105; historical benchmark APIs remain explicit104 references and cannot qualify105. Persisted canonical V3 state is unchanged. Bind service attempts to the selected prompt/wire identity.
4. Add codec, gateway and real D1 service regressions, including the R02 year-null date failure, malformed nested strings, query dates, alternative/evidence typing and cross-version refusal.
5. Run offline tests, typecheck, lint, build, configuration dry-run and independent review. Record resulting commit. Provider schema admission and semantic qualification remain unverified until a separately approved newly frozen pilot package.

## Validation and review

- 13 new typed regressions pass: direct structures and string refusal, input year-null specialization, source/rank/field/numeric ownership, query dates/alternatives, guidance quarantine, LIST staging, observable/offline gateway pairing and actual D1 service behavior.
- Full repository run covered 217 files / 10,032 tests. It passed 10,003 tests, skipped 2 existing optional tests, and exposed 27 fixture failures: the launcher still bound source to b11 and the composition test spied on the historical factory. Only those test fixtures changed afterward. All 5 affected/typed suites then passed 55/55 tests; aggregate coverage is 10,030 passing tests plus 2 optional skips. The original `pnpm check` exit was failure; it is not represented as a single green full run.
- Architecture check, typecheck, full lint, production build, Worker type check and Wrangler dry-run all passed after fixture fixes. Commands ran with outbound network denied (localhost fixture traffic allowed) and `/usr/bin/security` denied. No credentials or real provider calls were used.
- Independent reviewer found no blockers in the final wire, schema compaction or fixture changes. Historical wire104 request/specimen digests and canonical oracle files were not changed. The launcher now uses the existing immutable test-only candidate snapshot helper; real source validation and grant fences remain intact.
- Representative R02 schema is 17,469 bytes (initial typed draft 61,021); full request is 47,181 bytes. These byte measurements do not establish provider token counts or schema admission.
- Current paid launcher/package remains wire104. A newly frozen typed105 qualification package is required before any future separately authorized paid Pilot; old approvals and old Pilot results do not qualify this candidate. Paid HOLD, UNKNOWN and successor dormancy remain unchanged. No merge or deployment.
