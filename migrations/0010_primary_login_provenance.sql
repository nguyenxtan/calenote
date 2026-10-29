-- Local candidate only: durable bot auth epochs and sticky primary login selection.
-- statement-breakpoint
ALTER TABLE bot_connections ADD COLUMN auth_revision INTEGER NOT NULL DEFAULT 0 CHECK(auth_revision >= 0);
-- statement-breakpoint
CREATE TABLE primary_login_channels (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES bot_connections(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0),
  generation TEXT NOT NULL,
  marker TEXT NOT NULL,
  selected_at INTEGER NOT NULL
) STRICT;
-- statement-breakpoint
ALTER TABLE login_codes ADD COLUMN proof_auth_revision INTEGER;
-- statement-breakpoint
ALTER TABLE login_codes ADD COLUMN proof_primary_revision INTEGER;
-- statement-breakpoint
ALTER TABLE login_codes ADD COLUMN proof_primary_generation TEXT;
-- statement-breakpoint
ALTER TABLE login_codes ADD COLUMN proof_identity_id TEXT;
-- statement-breakpoint
INSERT INTO primary_login_channels(user_id,connection_id,revision,generation,marker,selected_at)
SELECT c.user_id,MIN(c.id),1,lower(hex(randomblob(16))),lower(hex(randomblob(16))),MAX(c.updated_at)
FROM bot_connections c JOIN chat_identities ci ON ci.connection_id=c.id
WHERE c.state='ACTIVE_BOUND' AND length(ci.private_chat_id)>0 AND length(ci.provider_user_id)>0
GROUP BY c.user_id HAVING COUNT(*)=1;
-- statement-breakpoint
CREATE TRIGGER bot_auth_revision_changed AFTER UPDATE OF user_id,provider,provider_bot_id,encrypted_token,encrypted_token_iv,credential_version,state,transition_marker ON bot_connections
WHEN OLD.user_id IS NOT NEW.user_id OR OLD.provider IS NOT NEW.provider OR OLD.provider_bot_id IS NOT NEW.provider_bot_id
 OR OLD.encrypted_token IS NOT NEW.encrypted_token OR OLD.encrypted_token_iv IS NOT NEW.encrypted_token_iv
 OR OLD.credential_version IS NOT NEW.credential_version OR OLD.state IS NOT NEW.state OR OLD.transition_marker IS NOT NEW.transition_marker
BEGIN
  UPDATE bot_connections SET auth_revision=auth_revision+1 WHERE id=NEW.id;
END;
-- statement-breakpoint
CREATE TRIGGER chat_auth_revision_inserted AFTER INSERT ON chat_identities
BEGIN
  UPDATE bot_connections SET auth_revision=auth_revision+1 WHERE id=NEW.connection_id;
  INSERT OR IGNORE INTO primary_login_channels(user_id,connection_id,revision,generation,marker,selected_at)
  SELECT c.user_id,c.id,1,lower(hex(randomblob(16))),lower(hex(randomblob(16))),NEW.linked_at
  FROM bot_connections c WHERE c.id=NEW.connection_id AND c.state='ACTIVE_BOUND'
    AND length(NEW.private_chat_id)>0 AND length(NEW.provider_user_id)>0
    AND (SELECT COUNT(*) FROM bot_connections eligible JOIN chat_identities identity ON identity.connection_id=eligible.id
      WHERE eligible.user_id=c.user_id AND eligible.state='ACTIVE_BOUND'
        AND length(identity.private_chat_id)>0 AND length(identity.provider_user_id)>0)=1;
END;
-- statement-breakpoint
CREATE TRIGGER chat_auth_revision_deleted AFTER DELETE ON chat_identities
BEGIN
  UPDATE bot_connections SET auth_revision=auth_revision+1 WHERE id=OLD.connection_id;
END;
-- statement-breakpoint
CREATE TRIGGER chat_auth_revision_changed AFTER UPDATE OF id,connection_id,provider_user_id,private_chat_id,linked_at ON chat_identities
WHEN OLD.id IS NOT NEW.id OR OLD.connection_id IS NOT NEW.connection_id OR OLD.provider_user_id IS NOT NEW.provider_user_id
 OR OLD.private_chat_id IS NOT NEW.private_chat_id OR OLD.linked_at IS NOT NEW.linked_at
BEGIN
  UPDATE bot_connections SET auth_revision=auth_revision+1 WHERE id=OLD.connection_id OR id=NEW.connection_id;
END;
-- statement-breakpoint
CREATE TRIGGER bound_primary_initialized AFTER UPDATE OF state ON bot_connections
WHEN NEW.state='ACTIVE_BOUND' AND OLD.state IS NOT NEW.state
BEGIN
  INSERT OR IGNORE INTO primary_login_channels(user_id,connection_id,revision,generation,marker,selected_at)
  SELECT NEW.user_id,NEW.id,1,lower(hex(randomblob(16))),lower(hex(randomblob(16))),NEW.updated_at
  FROM chat_identities ci WHERE ci.connection_id=NEW.id AND length(ci.private_chat_id)>0 AND length(ci.provider_user_id)>0
    AND (SELECT COUNT(*) FROM bot_connections eligible JOIN chat_identities identity ON identity.connection_id=eligible.id
      WHERE eligible.user_id=NEW.user_id AND eligible.state='ACTIVE_BOUND'
        AND length(identity.private_chat_id)>0 AND length(identity.provider_user_id)>0)=1;
END;
