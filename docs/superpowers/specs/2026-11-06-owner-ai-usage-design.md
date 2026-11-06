# Owner-visible AI usage and cost

Area3 of the user-authorized all-five scope. Show the signed-in owner's current UTC day/month ledger totals and mean of known reported costs, with unknown charges and undispatched holds separate. No provider request, management key, invoice claim or mutation is needed.

## Contract
Authenticated GET `/api/ai-usage`, no owner/date selection from the caller. `ai-usage-1` snapshot: asOf ISO instant, timezone UTC, currency USD; runtime READY/OFF/UNAVAILABLE; nullable configured limits {dailyCalls,monthlyCostMicrounits}; day and month records.
Each record: key; dispatchedCalls; knownCalls/knownCostMicrounits; unknownCalls/unknownMaximumMicrounits; pendingCalls/pendingMaximumMicrounits; budgetedCalls/budgetedCostMicrounits. All counts/costs are nonnegative safe integers. Mean is knownCost/knownCalls only; unknowns never become a mean or zero-cost claim.

## Accounting and privacy
- Reservation is the grain, not three overlapping budget windows. FINALIZED with dispatch usage_known=1 is known reported cost. Dispatched RESERVED/FINALIZED with usage_known=0 shows its reserved maximum separately. Historical FINALIZED rows without a dispatch record also remain unknown, with the original reservation maximum; they never become zero-cost known calls. Undispatched RESERVED is a pending hold; RELEASED/EXPIRED are excluded.
- Day/month follow existing UTC daily_window_key/monthly_window_key and ignore future-created rows. Budgeted counters read the exact owner/day or owner/month window (reserved+finalized); these measure application quota, not provider invoicing.
- One aggregate SQL statement returns two bounded rows, guarded by an unexpired/unrevoked session whose user matches the principal. Revocation between route authentication and read fails closed. No foreign owner IDs, chat data, titles, credentials or individual reservation identifiers enter the response.
- AI OFF/unavailable still shows past usage, with unavailable configured limits rather than invented active limits. No global/account-wide provider spend is exposed.
- Forward-only migration0023 adds owner/month/created_at index; no existing migration changes or remote migration now.

## UI
New Settings section “Mức sử dụng AI” with day/month known costs, known-call mean, unknown-charge maximum and pending capacity, plus configured day/month quota. Explain UTC periods and that unknown maxima are reserved capacity, not a bill. Show asOf, loading, retry and unavailable states. A 401/403 or owner change clears old values; late old-owner responses cannot render. Use accessible table, headings and labeled refresh button. Mount by current owner key, passed as a panel slot into the otherwise pure Settings layout.

## Evidence
SQLite tests for known/unknown/pending/released/mixed-owner cases, month/day boundary, multiple budget windows counted once and revoked/foreign sessions. Route tests for auth/no-store/no leaked raw fields. UI tests for known-vs-unknown/mean, no known-cost result, auth/owner late response clearing and retry. Typecheck/scopedlint; final whole-application gate remains after allfive.
