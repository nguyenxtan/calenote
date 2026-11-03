-- Local disconnect keeps provider credentials, private-chat identity and reminders.
-- An unresolved outbound reservation deliberately blocks disconnect until settled.
CREATE TABLE connection_egress (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES bot_connections(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_connection_egress_connection ON connection_egress(connection_id);
