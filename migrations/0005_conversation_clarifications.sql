CREATE TABLE conversation_clarifications (
  id TEXT PRIMARY KEY NOT NULL,
  chat_identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE CASCADE,
  source_inbound_id TEXT NOT NULL UNIQUE REFERENCES inbound_updates(id) ON DELETE RESTRICT,
  resolution_inbound_id TEXT UNIQUE REFERENCES inbound_updates(id) ON DELETE RESTRICT,
  title_ciphertext BLOB NOT NULL,
  title_iv BLOB NOT NULL CHECK (length(title_iv) = 12),
  title_key_version INTEGER NOT NULL CHECK (title_key_version > 0),
  local_date TEXT,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'RESOLVED', 'CANCELLED', 'EXPIRED')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_conversation_clarifications_one_pending
  ON conversation_clarifications(chat_identity_id) WHERE state = 'PENDING';
CREATE INDEX idx_conversation_clarifications_active
  ON conversation_clarifications(chat_identity_id, expires_at, id) WHERE state = 'PENDING';
