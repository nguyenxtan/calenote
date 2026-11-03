-- Preserve the sole current login channel; existing multi-channel accounts need
-- an explicit selection. A new bot never displaces an existing primary.
CREATE TABLE primary_login_channels (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 connection_id TEXT NOT NULL UNIQUE REFERENCES bot_connections(id) ON DELETE RESTRICT,
 transition_marker TEXT NOT NULL,
 updated_at INTEGER NOT NULL
) STRICT;
INSERT INTO primary_login_channels(user_id,connection_id,transition_marker,updated_at)
SELECT c.user_id,MIN(c.id),'migration-0013',MAX(c.updated_at)
FROM bot_connections c JOIN chat_identities ci ON ci.connection_id=c.id
WHERE c.state='ACTIVE_BOUND' AND length(ci.private_chat_id)>0 AND length(ci.provider_user_id)>0
GROUP BY c.user_id HAVING COUNT(*)=1;
