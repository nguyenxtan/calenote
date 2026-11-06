-- Optional feature. Tables alone never enable external synchronization.
CREATE TABLE calendar_connections (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL DEFAULT 'google' CHECK (provider='google'),
 state TEXT NOT NULL CHECK (state IN ('AUTHORIZING','PENDING','CREATING_CALENDAR','ACTIVE','SETUP_UNCERTAIN','REAUTH_REQUIRED','DISCONNECTING','DISCONNECTED')),
 generation INTEGER NOT NULL DEFAULT 1 CHECK (generation>0),
 token_ciphertext BLOB,
 token_iv BLOB,
 token_key_version INTEGER NOT NULL DEFAULT 1 CHECK (token_key_version>0),
 remote_calendar_id TEXT,
 lease_marker TEXT,
 lease_until INTEGER,
 -- Never expires automatically: a lost settlement is not proof that egress ended.
 egress_marker TEXT,
 last_synced_at INTEGER,
 next_sync_at INTEGER,
 attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
 last_error TEXT CHECK (last_error IS NULL OR last_error IN ('REAUTH_REQUIRED','PROVIDER_UNAVAILABLE','SETUP_UNCERTAIN','OWNERSHIP_CONFLICT','RETRY_EXHAUSTED','PROJECTION_INVALID','EGRESS_UNRESOLVED')),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(user_id,provider),
 CHECK ((token_ciphertext IS NULL)=(token_iv IS NULL)),
 CHECK ((lease_marker IS NULL)=(lease_until IS NULL)),
 CHECK (egress_marker IS NULL OR lease_marker IS NOT NULL),
 CHECK (state<>'DISCONNECTED' OR (token_ciphertext IS NULL AND egress_marker IS NULL))
) STRICT;
CREATE INDEX calendar_connections_due ON calendar_connections(next_sync_at) WHERE state IN ('PENDING','ACTIVE','CREATING_CALENDAR');
CREATE TABLE calendar_oauth_states (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 nonce_digest TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER,
 created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE calendar_event_mappings (
 connection_id TEXT NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
 logical_uid TEXT NOT NULL,
 remote_event_id TEXT NOT NULL,
 payload_digest TEXT,
 target_digest TEXT NOT NULL,
 state TEXT NOT NULL CHECK (state IN ('WRITING','UNCERTAIN','SYNCED','REMOVED')),
 operation TEXT NOT NULL CHECK (operation IN ('UPSERT','REMOVE')),
 write_marker TEXT NOT NULL,
 attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(connection_id,logical_uid),
 UNIQUE(connection_id,remote_event_id)
) STRICT;
