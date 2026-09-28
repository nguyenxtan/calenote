-- Additive only. V1 tables and ciphertext remain unchanged.
CREATE TABLE IF NOT EXISTS conversation_contexts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  chat_identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE RESTRICT,
  source_inbound_id TEXT NOT NULL UNIQUE REFERENCES inbound_updates(id) ON DELETE RESTRICT,
  last_inbound_id TEXT NOT NULL REFERENCES inbound_updates(id) ON DELETE RESTRICT,
  claim_marker TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('CLARIFYING','DRAFT_READY','COMPLETED','CANCELLED','EXPIRED','INVALID')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  payload_ciphertext BLOB,
  payload_iv BLOB,
  key_version INTEGER,
  CHECK (updated_at >= created_at),
  CHECK (expires_at > created_at AND expires_at <= created_at + 7200000),
  CHECK ((status IN ('CLARIFYING','DRAFT_READY')
    AND payload_ciphertext IS NOT NULL AND length(payload_ciphertext) BETWEEN 16 AND 16400
    AND payload_iv IS NOT NULL AND length(payload_iv) = 12 AND key_version IS NOT NULL AND key_version = 1)
    OR (status IN ('COMPLETED','CANCELLED','EXPIRED','INVALID')
      AND payload_ciphertext IS NULL AND payload_iv IS NULL AND key_version IS NULL))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_one_active
  ON conversation_contexts(chat_identity_id) WHERE status IN ('CLARIFYING','DRAFT_READY');
CREATE INDEX IF NOT EXISTS idx_conversation_expiry
  ON conversation_contexts(expires_at,id) WHERE status IN ('CLARIFYING','DRAFT_READY');

-- Content-free durable ordering/idempotency history. Payload removal does not
-- remove evidence that a newer inbound already made a conversation decision.
CREATE TABLE IF NOT EXISTS conversation_context_outcomes (
  context_id TEXT NOT NULL REFERENCES conversation_contexts(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  source_inbound_id TEXT NOT NULL REFERENCES inbound_updates(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('SAVE','FINISH')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (context_id, revision),
  UNIQUE (source_inbound_id, operation)
) STRICT;
