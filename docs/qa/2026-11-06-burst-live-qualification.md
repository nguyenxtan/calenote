# Synthetic burst qualification — 2026-11-06

Existing keyed production gateway, `openai/gpt-5-mini` / `azure/swedencentral`, EU/ZDR. Four grouped inputs with manual expected operands and exact source receipt times; no production database, chat message, reminder mutation or Google API operation. The previously approved cumulative USD4 test ceiling applies.

The first four calls found an event date duplicated into a reminder date and exterior punctuation in a venue. These were fixed in the conditional burst prompt; a narrow boolean ownership guard rejects relative event-date duplication. The second four calls passed every manually authored field, no extra operands, valid evidence/merge, and the original source timestamp for each field.

| Case | Result | Request SHA-256 | Known cost (USD) |
| --- | --- | --- | --- |
| BURST01_TASK_THEN_CLOCK | PASS | `db783e675a43a717a14b2b0e7b03aff2f6c0ec5e6f32ae1a881674ab67f7eac4` | 0.002619 |
| BURST02_VENUE_BEFORE_TAIL | PASS | `380f3b8fa499e1bdf7c22e28c3c55df856500e16eaab970017f6cd12f7b51c3d` | 0.002547 |
| BURST03_DURATION_AND_NOTES | PASS | `34247b4991f2e8c3f3dfbeb46d081576f8585374bdc4c53b82e0e55acfd0816a` | 0.003434 |
| BURST04_SOURCE_MIDNIGHT | PASS | `6268f4536889dd32531485449b4efd73ee212c126e7050cea2144c4527b0badc` | 0.002020 |

Eight calls total known ceiling-rounded cost: USD0.027167. Unknown calls:0. Conservative campaign floor afterward: USD2.445445808, including previous campaign spending. Provider usage metadata lags, so no smaller metadata delta is used to erase known costs.

The four historical request146 anchors remain byte-identical for single-message inputs. Offline grouped source/wire qualification and typed106 legacy correlations also pass. This small qualification establishes the grouped path; it does not claim a fresh full32-scenario Pilot pass or real Google connection. Full combined source gates and final cross-review are recorded separately.

Local diagnostic artifacts remain under `artifacts/diagnostics/product-next-20261104/`: grouped input/expected/request captures, wire/historical proofs, both live records and the explicit synthetic runner. They contain no authorization headers or credentials.
