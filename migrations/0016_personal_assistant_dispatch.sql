ALTER TABLE personal_assistant_documents ADD COLUMN last_dispatch_at INTEGER;
-- Durable exact-occurrence capability. Contains identifiers/timestamps only.
CREATE TABLE personal_assistant_occurrences (
 owner_user_id TEXT NOT NULL REFERENCES users(id), occurrence_key TEXT NOT NULL,
 reminder_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('EVENT','MORNING','EVENING')),
 document_revision INTEGER NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 chat_identity_id TEXT NOT NULL REFERENCES chat_identities(id), connection_id TEXT NOT NULL REFERENCES bot_connections(id),
 scheduled_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(owner_user_id,occurrence_key)
) STRICT;
CREATE INDEX personal_assistant_occurrences_due ON personal_assistant_occurrences(owner_user_id,scheduled_at);
CREATE TABLE personal_assistant_spawn_permits (
 reminder_id TEXT PRIMARY KEY, marker TEXT NOT NULL UNIQUE
) STRICT;
DROP TRIGGER fence_reminder_insert;
CREATE TRIGGER fence_reminder_insert BEFORE INSERT ON reminders
WHEN EXISTS(SELECT 1 FROM conversation_contract_ownership o WHERE o.chat_identity_id=NEW.chat_identity_id)
 AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p JOIN conversation_contract_ownership o ON o.chat_identity_id=p.chat_identity_id AND o.context_id=p.context_id WHERE p.chat_identity_id=NEW.chat_identity_id AND p.operation='CONFIRM' AND p.marker=NEW.context_write_marker)
 AND NOT EXISTS(SELECT 1 FROM follow_through_spawn_permits p JOIN follow_through_items i ON i.id=p.item_id WHERE p.reminder_id=NEW.id AND p.marker=NEW.context_write_marker AND i.progress='OPEN' AND i.chat_identity_id=NEW.chat_identity_id AND i.workspace_id=NEW.workspace_id AND NEW.source_draft_id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM personal_assistant_spawn_permits p
 JOIN personal_assistant_occurrences a ON a.reminder_id=p.reminder_id
 JOIN personal_assistant_documents d ON d.owner_user_id=a.owner_user_id AND d.revision=a.document_revision
 JOIN workspaces w ON w.id=a.workspace_id AND w.owner_user_id=a.owner_user_id AND w.kind='PERSONAL'
 JOIN memberships m ON m.workspace_id=w.id AND m.user_id=a.owner_user_id AND m.role='OWNER'
 JOIN bot_connections c ON c.id=a.connection_id AND c.user_id=a.owner_user_id AND c.state='ACTIVE_BOUND'
 JOIN primary_login_channels primary_channel ON primary_channel.user_id=a.owner_user_id AND primary_channel.connection_id=c.id
 JOIN chat_identities ci ON ci.id=a.chat_identity_id AND ci.connection_id=c.id
 WHERE p.reminder_id=NEW.id AND p.marker=NEW.context_write_marker AND NEW.workspace_id=a.workspace_id AND NEW.chat_identity_id=a.chat_identity_id AND NEW.scheduled_at=a.scheduled_at AND NEW.source_draft_id IS NULL)
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;
-- Briefs are delivery messages, not tasks to complete. Annual reminders are tracked normally.
DROP TRIGGER track_new_reminder;
CREATE TRIGGER track_new_reminder AFTER INSERT ON reminders
WHEN NOT EXISTS(SELECT 1 FROM follow_through_spawn_permits WHERE reminder_id=NEW.id)
 AND NOT EXISTS(SELECT 1 FROM personal_assistant_occurrences WHERE reminder_id=NEW.id AND kind IN ('MORNING','EVENING'))
BEGIN
 INSERT INTO follow_through_items(id,public_id,root_reminder_id,owner_user_id,workspace_id,chat_identity_id,connection_id,current_reminder_id,created_at,updated_at)
 SELECT NEW.id,NEW.public_id,NEW.id,w.owner_user_id,w.id,NEW.chat_identity_id,ci.connection_id,NEW.id,NEW.created_at,NEW.updated_at
 FROM workspaces w JOIN memberships m ON m.workspace_id=w.id AND m.user_id=w.owner_user_id AND m.role='OWNER'
 JOIN chat_identities ci ON ci.id=NEW.chat_identity_id JOIN bot_connections c ON c.id=ci.connection_id AND c.user_id=w.owner_user_id WHERE w.id=NEW.workspace_id AND w.kind='PERSONAL';
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM follow_through_items WHERE root_reminder_id=NEW.id) THEN RAISE(ABORT,'FOLLOW_THROUGH_OWNER_FENCE') END;
 INSERT INTO follow_through_runs(item_id,reminder_id,kind,ordinal,lineage_key) SELECT id,NEW.id,'ORIGINAL',0,NEW.id FROM follow_through_items WHERE root_reminder_id=NEW.id;
END;
-- A document edit revokes queued output from its previous revision, without changing acquired sends.
CREATE TRIGGER revoke_personal_assistant_pending AFTER UPDATE ON personal_assistant_documents
WHEN OLD.schedule_fingerprint IS NOT NEW.schedule_fingerprint
BEGIN
 UPDATE reminders SET status='CANCELLED',cancelled_at=NEW.updated_at,updated_at=NEW.updated_at
 WHERE status IN ('PENDING','RETRYABLE') AND (id IN (SELECT reminder_id FROM personal_assistant_occurrences WHERE owner_user_id=NEW.owner_user_id AND document_revision<NEW.revision)
 OR id IN (SELECT i.current_reminder_id FROM follow_through_items i JOIN personal_assistant_occurrences a ON a.reminder_id=i.root_reminder_id WHERE a.owner_user_id=NEW.owner_user_id AND a.document_revision<NEW.revision));
 UPDATE follow_through_items SET progress='STOPPED',revision=revision+1,follow_up_enabled=0,next_follow_up_at=NULL,updated_at=NEW.updated_at
 WHERE progress='OPEN' AND root_reminder_id IN (SELECT reminder_id FROM personal_assistant_occurrences WHERE owner_user_id=NEW.owner_user_id AND document_revision<NEW.revision) AND current_reminder_id IN (SELECT id FROM reminders WHERE status='CANCELLED');
END;
