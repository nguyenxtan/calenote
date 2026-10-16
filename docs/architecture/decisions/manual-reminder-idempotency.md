# Durable manual reminder CREATE

Manual Today requests persist one opaque intent per account namespace before sending. Browser storage contains neither titles nor payload fingerprints. Storage failure prevents sending. Account hashes isolate state across logout/account changes; pending opaque IDs survive returning to the same account.

The server binds each owner and intent to a keyed payload digest and reminder in the same D1 batch as the reminder and audit. A unique owner/intent primary key rolls back competing batches completely. Retries return the current reminder status, including after its scheduled time passes; changed payloads fail closed. Legacy callers may omit an intent for backwards compatibility; Today always supplies one. Manual titles are bounded to the public contract's 500 UTF-16 code units. List pages fit beneath the client's response-byte limit.

When a persisted intent already exists, submitting first resolves the prior request instead of sending a new CREATE. Same-origin authenticated resolution inserts an ABANDONED tombstone if no CREATE receipt exists. CREATE and resolution serialize on the same unique key. If CREATE won, resolution returns its public ID; if resolution won, a delayed CREATE cannot commit. Resolution retries are safe, including after a lost response. Only a definitive response clears browser state; the user can then create a new request. A refresh or missing list row alone never proves the old request failed.

Migration 0010 is local implementation only and must be applied through a separately authorized release. Receipts/tombstones must be retained while old requests can be replayed. No provider authority or deterministic chat CREATE path changes.
