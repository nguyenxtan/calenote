-- Additive lineage only. Legacy reminders and delivery states remain canonical.
CREATE TABLE IF NOT EXISTS reminder_series_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  chat_identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE RESTRICT,
  context_id TEXT REFERENCES conversation_contexts(id) ON DELETE RESTRICT,
  context_revision INTEGER,
  revision INTEGER NOT NULL CHECK (revision > 0),
  source_inbound_id TEXT NOT NULL REFERENCES inbound_updates(id) ON DELETE RESTRICT,
  resolution_inbound_id TEXT REFERENCES inbound_updates(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('CREATE','CANCEL')),
  target_series_id TEXT,
  target_revision INTEGER,
  status TEXT NOT NULL CHECK (status IN ('PENDING','CONFIRMED','CANCELLED','EXPIRED','INVALID')),
  transaction_marker TEXT,
  payload_ciphertext BLOB NOT NULL CHECK (length(payload_ciphertext) BETWEEN 16 AND 32784),
  payload_iv BLOB NOT NULL CHECK (length(payload_iv) = 12),
  key_version INTEGER NOT NULL CHECK (key_version = 1),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at AND expires_at <= created_at + 600000),
  CHECK ((action = 'CREATE' AND context_id IS NOT NULL AND context_revision IS NOT NULL AND context_revision > 0 AND target_series_id IS NULL AND target_revision IS NULL)
    OR (action = 'CANCEL' AND context_id IS NULL AND context_revision IS NULL AND target_series_id IS NOT NULL AND target_revision IS NOT NULL AND target_revision > 0)),
  UNIQUE (context_id, context_revision, action),
  UNIQUE (source_inbound_id, action)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_series_one_pending ON reminder_series_proposals(chat_identity_id) WHERE status = 'PENDING';
CREATE TABLE IF NOT EXISTS reminder_series (
  id TEXT PRIMARY KEY NOT NULL,
  public_id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  chat_identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE RESTRICT,
  proposal_id TEXT NOT NULL UNIQUE REFERENCES reminder_series_proposals(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CANCELLED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS reminder_series_occurrences (
  series_id TEXT NOT NULL REFERENCES reminder_series(id) ON DELETE RESTRICT,
  occurrence_index INTEGER NOT NULL CHECK (occurrence_index >= 0 AND occurrence_index < 30),
  reminder_id TEXT NOT NULL UNIQUE REFERENCES reminders(id) ON DELETE RESTRICT,
  PRIMARY KEY (series_id, occurrence_index)
) STRICT;
CREATE TABLE IF NOT EXISTS reminder_calendar_facts (
  reminder_id TEXT PRIMARY KEY NOT NULL REFERENCES reminders(id) ON DELETE RESTRICT,
  encryption_entity_id TEXT NOT NULL,
  payload_ciphertext BLOB NOT NULL CHECK (length(payload_ciphertext) BETWEEN 16 AND 4096),
  payload_iv BLOB NOT NULL CHECK (length(payload_iv) = 12),
  key_version INTEGER NOT NULL CHECK (key_version = 1)
) STRICT;
CREATE TABLE IF NOT EXISTS command_draft_calendar_facts (
  draft_id TEXT PRIMARY KEY NOT NULL REFERENCES command_drafts(id) ON DELETE RESTRICT,
  payload_ciphertext BLOB NOT NULL CHECK (length(payload_ciphertext) BETWEEN 16 AND 4096),
  payload_iv BLOB NOT NULL CHECK (length(payload_iv) = 12),
  key_version INTEGER NOT NULL CHECK (key_version = 1)
) STRICT;
-- The old Worker also copies provenance when it confirms a new lunar one-off.
-- Trigger failure aborts the SAME canonical reminder insertion transaction.
CREATE TRIGGER IF NOT EXISTS copy_draft_calendar_facts AFTER INSERT ON reminders
WHEN NEW.source_draft_id IS NOT NULL
BEGIN
  INSERT INTO reminder_calendar_facts (reminder_id,encryption_entity_id,payload_ciphertext,payload_iv,key_version)
  SELECT NEW.id,draft_id,payload_ciphertext,payload_iv,key_version FROM command_draft_calendar_facts
  WHERE draft_id = NEW.source_draft_id;
END;
-- A V2 request transferred into the legacy one-off draft retains the same
-- source inbound. Resolution by either Worker version terminalizes that context.
CREATE TRIGGER IF NOT EXISTS finish_transferred_conversation AFTER UPDATE OF status ON command_drafts
WHEN OLD.status = 'PENDING' AND NEW.status IN ('CONFIRMED','CANCELLED','EXPIRED') AND NEW.resolution_inbound_id IS NOT NULL
BEGIN
  INSERT INTO conversation_context_outcomes (context_id,revision,source_inbound_id,operation,created_at)
  SELECT id,revision + 1,NEW.resolution_inbound_id,'FINISH',NEW.updated_at FROM conversation_contexts
  WHERE chat_identity_id = NEW.chat_identity_id AND last_inbound_id = NEW.source_inbound_id AND status = 'DRAFT_READY';
  UPDATE conversation_contexts SET status = CASE WHEN NEW.status = 'CONFIRMED' THEN 'COMPLETED' ELSE NEW.status END,
    revision = revision + 1, updated_at = NEW.updated_at, last_inbound_id = NEW.resolution_inbound_id,
    payload_ciphertext = NULL, payload_iv = NULL, key_version = NULL
  WHERE chat_identity_id = NEW.chat_identity_id AND last_inbound_id = NEW.source_inbound_id AND status = 'DRAFT_READY';
END;
