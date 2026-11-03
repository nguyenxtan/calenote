-- Explicitly edited personal data is encrypted as one owner-bound document.
CREATE TABLE personal_assistant_documents (
 owner_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 document_ciphertext BLOB NOT NULL,
 document_iv BLOB NOT NULL CHECK(length(document_iv) = 12),
 document_key_version INTEGER NOT NULL CHECK(document_key_version > 0),
 schedule_fingerprint TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0),
 updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE personal_assistant_dispatch_cursor (
 id INTEGER PRIMARY KEY CHECK(id = 1), user_id TEXT NOT NULL
) STRICT;
CREATE TABLE personal_assistant_generated (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 occurrence_key TEXT NOT NULL,
 reminder_id TEXT NOT NULL UNIQUE REFERENCES reminders(id),
 kind TEXT NOT NULL CHECK(kind IN ('EVENT','MORNING','EVENING')),
 PRIMARY KEY(user_id, occurrence_key)
) STRICT;
