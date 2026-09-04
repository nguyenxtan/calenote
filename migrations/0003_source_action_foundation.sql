PRAGMA foreign_keys = ON;

CREATE TABLE source_connections (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'REVOKED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, provider, external_account_id)
) STRICT;

CREATE TABLE source_items (
  id TEXT PRIMARY KEY NOT NULL,
  source_connection_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  external_item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (source_connection_id, workspace_id)
    REFERENCES source_connections(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (id, workspace_id),
  UNIQUE (source_connection_id, external_item_id)
) STRICT;

CREATE TABLE action_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  source_item_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type = 'REMINDER'),
  title_ciphertext BLOB NOT NULL,
  title_iv BLOB NOT NULL CHECK (length(title_iv) = 12),
  title_key_version INTEGER NOT NULL CHECK (title_key_version > 0),
  scheduled_at INTEGER NOT NULL,
  timezone TEXT NOT NULL CHECK (timezone = 'Asia/Ho_Chi_Minh'),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (source_item_id, workspace_id)
    REFERENCES source_items(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (id, workspace_id),
  UNIQUE (source_item_id, action_type)
) STRICT;

CREATE UNIQUE INDEX idx_reminders_id_workspace ON reminders(id, workspace_id);

CREATE TABLE action_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  action_candidate_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  decided_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  created_reminder_id TEXT,
  decided_at INTEGER NOT NULL,
  FOREIGN KEY (action_candidate_id, workspace_id)
    REFERENCES action_candidates(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (created_reminder_id, workspace_id)
    REFERENCES reminders(id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (action_candidate_id),
  CHECK (
    (decision = 'APPROVED' AND created_reminder_id IS NOT NULL)
    OR (decision = 'REJECTED' AND created_reminder_id IS NULL)
  )
) STRICT;

CREATE INDEX idx_source_connections_workspace_status
  ON source_connections(workspace_id, status, id);
CREATE INDEX idx_source_items_workspace_observed
  ON source_items(workspace_id, observed_at DESC, id);
CREATE INDEX idx_action_candidates_workspace_pending
  ON action_candidates(workspace_id, created_at, id) WHERE status = 'PENDING';
CREATE INDEX idx_action_decisions_workspace_decided
  ON action_decisions(workspace_id, decided_at DESC, id);
