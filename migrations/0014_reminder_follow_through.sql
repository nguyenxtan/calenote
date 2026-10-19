-- Existing reminders deliberately remain untracked. New insert tracking is atomic.
CREATE TABLE follow_through_items (
 id TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE,
 root_reminder_id TEXT NOT NULL UNIQUE REFERENCES reminders(id),
 owner_user_id TEXT NOT NULL REFERENCES users(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 chat_identity_id TEXT NOT NULL REFERENCES chat_identities(id), connection_id TEXT NOT NULL REFERENCES bot_connections(id),
 progress TEXT NOT NULL DEFAULT 'OPEN' CHECK(progress IN ('OPEN','DONE','STOPPED')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), current_reminder_id TEXT NOT NULL REFERENCES reminders(id),
 completed_at INTEGER, follow_up_enabled INTEGER NOT NULL DEFAULT 0 CHECK(follow_up_enabled IN (0,1)),
 interval_minutes INTEGER NOT NULL DEFAULT 120 CHECK(interval_minutes IN (30,120,1440)),
 follow_up_count INTEGER NOT NULL DEFAULT 0 CHECK(follow_up_count BETWEEN 0 AND 3),
 next_follow_up_at INTEGER, mutation_marker TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE follow_through_runs (
 item_id TEXT NOT NULL REFERENCES follow_through_items(id), reminder_id TEXT PRIMARY KEY REFERENCES reminders(id),
 kind TEXT NOT NULL CHECK(kind IN ('ORIGINAL','SNOOZE','RESCHEDULE','FOLLOW_UP')),ordinal INTEGER NOT NULL,
 lineage_key TEXT NOT NULL UNIQUE, UNIQUE(item_id,ordinal)
) STRICT;
CREATE TABLE follow_through_action_receipts (
 scope TEXT NOT NULL,idempotency_key TEXT NOT NULL,payload_digest TEXT NOT NULL,item_id TEXT NOT NULL REFERENCES follow_through_items(id),
 expected_revision INTEGER NOT NULL,resulting_revision INTEGER NOT NULL,result_json TEXT NOT NULL,
 PRIMARY KEY(scope,idempotency_key)
) STRICT;
CREATE TABLE follow_through_spawn_permits (reminder_id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES follow_through_items(id),marker TEXT NOT NULL UNIQUE) STRICT;
CREATE TRIGGER track_new_reminder AFTER INSERT ON reminders
WHEN NOT EXISTS(SELECT 1 FROM follow_through_spawn_permits WHERE reminder_id=NEW.id)
BEGIN
 INSERT INTO follow_through_items(id,public_id,root_reminder_id,owner_user_id,workspace_id,chat_identity_id,connection_id,current_reminder_id,created_at,updated_at)
 SELECT NEW.id,NEW.public_id,NEW.id,w.owner_user_id,w.id,NEW.chat_identity_id,ci.connection_id,NEW.id,NEW.created_at,NEW.updated_at
 FROM workspaces w JOIN memberships m ON m.workspace_id=w.id AND m.user_id=w.owner_user_id AND m.role='OWNER'
 JOIN chat_identities ci ON ci.id=NEW.chat_identity_id JOIN bot_connections c ON c.id=ci.connection_id AND c.user_id=w.owner_user_id WHERE w.id=NEW.workspace_id AND w.kind='PERSONAL';
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM follow_through_items WHERE root_reminder_id=NEW.id) THEN RAISE(ABORT,'FOLLOW_THROUGH_OWNER_FENCE') END;
 INSERT INTO follow_through_runs(item_id,reminder_id,kind,ordinal,lineage_key) SELECT id,NEW.id,'ORIGINAL',0,NEW.id FROM follow_through_items WHERE root_reminder_id=NEW.id;
END;
-- A child capability authorizes only its exact tracked source and original channel;
-- it cannot confer conversation successor or draft-confirmation authority.
DROP TRIGGER fence_reminder_insert;
CREATE TRIGGER fence_reminder_insert BEFORE INSERT ON reminders
WHEN EXISTS(SELECT 1 FROM conversation_contract_ownership o WHERE o.chat_identity_id=NEW.chat_identity_id)
 AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p JOIN conversation_contract_ownership o ON o.chat_identity_id=p.chat_identity_id AND o.context_id=p.context_id WHERE p.chat_identity_id=NEW.chat_identity_id AND p.operation='CONFIRM' AND p.marker=NEW.context_write_marker)
 AND NOT EXISTS(SELECT 1 FROM follow_through_spawn_permits p JOIN follow_through_items i ON i.id=p.item_id WHERE p.reminder_id=NEW.id AND p.marker=NEW.context_write_marker AND i.progress='OPEN' AND i.chat_identity_id=NEW.chat_identity_id AND i.workspace_id=NEW.workspace_id AND NEW.source_draft_id IS NULL)
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;
