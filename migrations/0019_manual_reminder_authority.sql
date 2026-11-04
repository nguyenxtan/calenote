-- A manual web create is separate from a chat SAVE confirmation. Its exact
-- reminder/owner/channel capability exists only inside the atomic create batch.
CREATE TABLE manual_reminder_write_permits (
 reminder_id TEXT PRIMARY KEY,
 owner_user_id TEXT NOT NULL REFERENCES users(id),
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 chat_identity_id TEXT NOT NULL REFERENCES chat_identities(id),
 marker TEXT NOT NULL UNIQUE
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
 AND NOT EXISTS(SELECT 1 FROM manual_reminder_write_permits p
 JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=p.owner_user_id AND w.kind='PERSONAL'
 JOIN memberships m ON m.workspace_id=w.id AND m.user_id=p.owner_user_id AND m.role='OWNER'
 JOIN chat_identities ci ON ci.id=p.chat_identity_id
 JOIN bot_connections c ON c.id=ci.connection_id AND c.user_id=p.owner_user_id AND c.state='ACTIVE_BOUND'
 WHERE p.reminder_id=NEW.id AND p.marker=NEW.context_write_marker AND NEW.workspace_id=p.workspace_id AND NEW.chat_identity_id=p.chat_identity_id AND NEW.source_draft_id IS NULL AND NEW.status='PENDING')
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;
