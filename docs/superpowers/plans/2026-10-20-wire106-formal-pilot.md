# Wire106 Formal Pilot Implementation Plan

**Goal:** Qualify SMALL_106 through the existing bounded Formal Pilot without changing canonical/oracle/model/provider.

**Architecture:** Add explicit version-3 authority records for SMALL_106 to the Formal launcher and private debug bridge. Preserve old authorities and all source, owner, proposal, budget and one-shot fences.

**Constraints:** Cumulative $10 cap, conservative UNKNOWN, no Full/deploy. Existing diagnostic grant is consumed; new user instruction authorizes progressing toward Pilot, never replaying that grant.

- [x] Add failing end-to-end synthetic Formal76 and first-error/protocol/bypass tests for SMALL_106.
- [x] Implement explicit authority-3 and coherent debug protocol selection; retain private bridge.
- [ ] Run regression, typecheck, lint and corpus; independent review; freeze source and prepare exact proposal.
- [ ] Verify fresh CI/key/quota and authority before any paid Formal Pilot. Stop on error/budget; report actual oracle outcome.

Validation: 232 synthetic regression tests passed (including all three 76-request protocols), typecheck and scoped lint passed. Independent reviewer found no must-fix. Next: exact-source CI and frozen authority/proposal review before paid dispatch.
