PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  timezone TEXT NOT NULL CHECK (timezone = 'Asia/Ho_Chi_Minh'),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind = 'PERSONAL'),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (owner_user_id, kind)
) STRICT;

CREATE TABLE memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role = 'OWNER'),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  digest TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE bot_connections (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('zalo', 'telegram')),
  public_id TEXT NOT NULL UNIQUE,
  provider_bot_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  handle TEXT,
  account_type TEXT,
  can_join_groups INTEGER CHECK (can_join_groups IN (0, 1) OR can_join_groups IS NULL),
  encrypted_token BLOB NOT NULL,
  encrypted_token_iv BLOB NOT NULL,
  token_fingerprint TEXT NOT NULL UNIQUE,
  credential_version INTEGER NOT NULL CHECK (credential_version > 0),
  state TEXT NOT NULL CHECK (state IN ('VALIDATING', 'ACTIVE_UNBOUND', 'ACTIVE_BOUND', 'WEBHOOK_FAILED', 'SUSPENDED')),
  webhook_registered_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (provider, provider_bot_id)
) STRICT;

CREATE TABLE connect_codes (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES bot_connections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  digest TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE chat_identities (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES bot_connections(id) ON DELETE CASCADE,
  provider_user_id TEXT NOT NULL,
  private_chat_id TEXT NOT NULL,
  display_name TEXT,
  linked_at INTEGER NOT NULL,
  UNIQUE (connection_id),
  UNIQUE (connection_id, provider_user_id),
  UNIQUE (connection_id, private_chat_id)
) STRICT;

CREATE TABLE login_codes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  digest TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE inbound_updates (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES bot_connections(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('zalo', 'telegram')),
  provider_message_id TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  private_chat_id TEXT NOT NULL,
  display_name TEXT,
  message_ciphertext BLOB NOT NULL,
  message_iv BLOB NOT NULL CHECK (length(message_iv) = 12),
  message_key_version INTEGER NOT NULL CHECK (message_key_version > 0),
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'PROCESSING', 'PROCESSED', 'REJECTED', 'FAILED')),
  received_at INTEGER NOT NULL,
  processing_started_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 4),
  processed_at INTEGER,
  transition_marker TEXT,
  dispatch_started_at INTEGER,
  dispatch_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
    dispatch_attempt_count >= 0 AND dispatch_attempt_count <= 4
  ),
  dispatch_marker TEXT,
  safe_error_code TEXT,
  UNIQUE (provider, connection_id, private_chat_id, provider_message_id)
) STRICT;

CREATE TABLE command_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  chat_identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE CASCADE,
  source_inbound_id TEXT NOT NULL UNIQUE REFERENCES inbound_updates(id) ON DELETE RESTRICT,
  resolution_inbound_id TEXT UNIQUE REFERENCES inbound_updates(id) ON DELETE RESTRICT,
  title_ciphertext BLOB NOT NULL,
  title_iv BLOB NOT NULL CHECK (length(title_iv) = 12),
  title_key_version INTEGER NOT NULL CHECK (title_key_version > 0),
  scheduled_at INTEGER NOT NULL,
  timezone TEXT NOT NULL CHECK (timezone = 'Asia/Ho_Chi_Minh'),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE reminders (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chat_identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE RESTRICT,
  source_draft_id TEXT REFERENCES command_drafts(id) ON DELETE RESTRICT,
  title_ciphertext BLOB NOT NULL,
  title_iv BLOB NOT NULL CHECK (length(title_iv) = 12),
  title_key_version INTEGER NOT NULL CHECK (title_key_version > 0),
  scheduled_at INTEGER NOT NULL,
  timezone TEXT NOT NULL CHECK (timezone = 'Asia/Ho_Chi_Minh'),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CLAIMED', 'SENT', 'CANCELLED', 'FAILED', 'RETRYABLE', 'UNCERTAIN')),
  claimed_at INTEGER,
  cancelled_at INTEGER,
  transition_marker TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE reminder_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  reminder_id TEXT NOT NULL UNIQUE REFERENCES reminders(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'RETRYABLE', 'FAILED', 'UNCERTAIN', 'CANCELLED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 4),
  provider_receipt TEXT,
  safe_error_code TEXT,
  sent_at INTEGER,
  send_started_at INTEGER,
  retry_not_before INTEGER,
  transition_marker TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (status <> 'SENDING' OR (send_started_at IS NOT NULL AND transition_marker IS NOT NULL)),
  CHECK (status <> 'RETRYABLE' OR retry_not_before IS NOT NULL)
) STRICT;

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_connection_id TEXT REFERENCES bot_connections(id) ON DELETE SET NULL,
  target_reminder_id TEXT REFERENCES reminders(id) ON DELETE SET NULL,
  result TEXT NOT NULL CHECK (result IN ('SUCCESS', 'FAILURE')),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE rate_limits (
  subject_digest TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (subject_digest, bucket)
) STRICT;

CREATE INDEX idx_sessions_digest ON sessions(digest);
CREATE INDEX idx_connect_codes_active_digest ON connect_codes(digest) WHERE consumed_at IS NULL;
CREATE INDEX idx_login_codes_active_user_digest ON login_codes(user_id, digest, created_at DESC) WHERE consumed_at IS NULL;
CREATE INDEX idx_login_codes_active_user_created ON login_codes(user_id, created_at DESC) WHERE consumed_at IS NULL;
CREATE INDEX idx_inbound_pending_dispatch
  ON inbound_updates(dispatch_started_at, received_at, id) WHERE state = 'PENDING';
CREATE INDEX idx_inbound_processing_dispatch
  ON inbound_updates(processing_started_at, dispatch_started_at, received_at, id)
  WHERE state = 'PROCESSING';
CREATE UNIQUE INDEX idx_command_drafts_one_pending
  ON command_drafts(chat_identity_id) WHERE status = 'PENDING';
CREATE INDEX idx_command_drafts_chat_created
  ON command_drafts(chat_identity_id, created_at DESC);
CREATE INDEX idx_reminders_due_pending
  ON reminders(scheduled_at, id) WHERE status = 'PENDING';
CREATE INDEX idx_reminders_stale_claimed
  ON reminders(claimed_at, scheduled_at, id) WHERE status = 'CLAIMED';
CREATE INDEX idx_deliveries_due_retryable
  ON reminder_deliveries(retry_not_before, reminder_id) WHERE status = 'RETRYABLE';
CREATE INDEX idx_deliveries_stale_sending
  ON reminder_deliveries(send_started_at, reminder_id) WHERE status = 'SENDING';
CREATE UNIQUE INDEX idx_reminders_source_draft
  ON reminders(source_draft_id) WHERE source_draft_id IS NOT NULL;
