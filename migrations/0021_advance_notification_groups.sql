-- Only default advance notifications share settlement. Ordinary daily series
-- remain independent tasks with their existing semantics.
CREATE TABLE advance_notification_groups (
 series_id TEXT PRIMARY KEY REFERENCES reminder_series(id),
 owner_user_id TEXT NOT NULL REFERENCES users(id),
 chat_identity_id TEXT NOT NULL REFERENCES chat_identities(id)
) STRICT;
