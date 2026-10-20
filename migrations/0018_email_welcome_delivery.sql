-- At-most-once welcome attempt for newly verified registrations only.
-- ATTEMPTED may include unknown delivery; never automatically retry.
CREATE TABLE email_welcome_deliveries (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('ATTEMPTED','SENT')),
 attempted_at INTEGER NOT NULL
) STRICT;
