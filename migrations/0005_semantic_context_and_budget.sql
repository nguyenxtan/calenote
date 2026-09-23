-- Additive and replay-safe. Future remediation uses a new forward migration.
-- No existing encrypted data, rate limits, drafts, or reminders are rewritten.
CREATE TABLE IF NOT EXISTS semantic_contexts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  chat_identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE CASCADE,
  source_inbound_id TEXT NOT NULL UNIQUE REFERENCES inbound_updates(id) ON DELETE RESTRICT,
  resolution_inbound_id TEXT UNIQUE REFERENCES inbound_updates(id) ON DELETE RESTRICT,
  target_intent TEXT NOT NULL CHECK (target_intent IN ('CREATE_REMINDER', 'LIST_REMINDERS')),
  context_ciphertext BLOB NOT NULL CHECK (length(context_ciphertext) BETWEEN 16 AND 16384),
  context_iv BLOB NOT NULL CHECK (length(context_iv) = 12),
  context_key_version INTEGER NOT NULL CHECK (context_key_version > 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RESOLVED', 'CANCELLED', 'EXPIRED')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (expires_at > created_at AND expires_at - created_at <= 1800000),
  CHECK ((status IN ('PENDING', 'EXPIRED') AND resolution_inbound_id IS NULL)
    OR (status IN ('RESOLVED', 'CANCELLED') AND resolution_inbound_id IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_context_one_pending
  ON semantic_contexts(chat_identity_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_semantic_context_expiry
  ON semantic_contexts(expires_at, id) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS semantic_budget_windows (
  kind TEXT NOT NULL CHECK (kind IN ('USER_DAILY', 'USER_MONTHLY', 'GLOBAL_DAILY')),
  scope_id TEXT NOT NULL,
  window_key TEXT NOT NULL,
  reserved_calls INTEGER NOT NULL DEFAULT 0 CHECK (reserved_calls >= 0),
  finalized_calls INTEGER NOT NULL DEFAULT 0 CHECK (finalized_calls >= 0),
  reserved_microunits INTEGER NOT NULL DEFAULT 0 CHECK (reserved_microunits >= 0),
  finalized_microunits INTEGER NOT NULL DEFAULT 0 CHECK (finalized_microunits >= 0),
  PRIMARY KEY (kind, scope_id, window_key),
  CHECK ((kind = 'GLOBAL_DAILY' AND scope_id = 'global') OR kind <> 'GLOBAL_DAILY'),
  CHECK ((kind = 'USER_MONTHLY' AND length(window_key) = 7)
    OR (kind <> 'USER_MONTHLY' AND length(window_key) = 10))
) STRICT;

CREATE TABLE IF NOT EXISTS semantic_budget_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_inbound_id TEXT NOT NULL UNIQUE REFERENCES inbound_updates(id) ON DELETE RESTRICT,
  daily_window_key TEXT NOT NULL CHECK (length(daily_window_key) = 10),
  monthly_window_key TEXT NOT NULL CHECK (length(monthly_window_key) = 7),
  reserved_maximum_microunits INTEGER NOT NULL CHECK (reserved_maximum_microunits > 0),
  finalized_microunits INTEGER CHECK (finalized_microunits >= 0 AND finalized_microunits <= reserved_maximum_microunits),
  state TEXT NOT NULL CHECK (state IN ('RESERVED', 'FINALIZED', 'RELEASED', 'EXPIRED')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (expires_at > created_at AND expires_at - created_at <= 900000),
  CHECK ((state = 'FINALIZED' AND finalized_microunits IS NOT NULL)
    OR (state <> 'FINALIZED' AND finalized_microunits IS NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_semantic_budget_reservation_expiry
  ON semantic_budget_reservations(expires_at, id) WHERE state = 'RESERVED';
