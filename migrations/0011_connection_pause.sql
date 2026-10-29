-- Local candidate only. Runtime integration must precede any remote application.
-- statement-breakpoint
ALTER TABLE bot_connections ADD COLUMN processing_paused INTEGER NOT NULL DEFAULT 0 CHECK(processing_paused IN (0,1));
-- statement-breakpoint
ALTER TABLE reminders ADD COLUMN lifecycle_hold INTEGER NOT NULL DEFAULT 0 CHECK(lifecycle_hold IN (0,1));
-- statement-breakpoint
ALTER TABLE inbound_updates ADD COLUMN lifecycle_hold INTEGER NOT NULL DEFAULT 0 CHECK(lifecycle_hold IN (0,1));
-- statement-breakpoint
CREATE TRIGGER pause_auth_revision AFTER UPDATE OF processing_paused ON bot_connections
WHEN OLD.processing_paused IS NOT NEW.processing_paused
BEGIN
  UPDATE bot_connections SET auth_revision=auth_revision+1 WHERE id=NEW.id;
END;
-- statement-breakpoint
CREATE TABLE inbound_egress (
  inbound_id TEXT NOT NULL REFERENCES inbound_updates(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('REPLY','TYPING','SEMANTIC_FREE','SEMANTIC_PAID')),
  action_index INTEGER NOT NULL CHECK(action_index >= 0),
  connection_id TEXT NOT NULL REFERENCES bot_connections(id) ON DELETE RESTRICT,
  auth_revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('SENDING','SENT','FAILED','UNCERTAIN')),
  acquired_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY(inbound_id,kind,action_index)
) STRICT;
