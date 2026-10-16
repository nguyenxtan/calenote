-- Successor storage is dormant until a separately authorized activation.
-- Existing ciphertext, canonical identities and unique lineage indexes remain.
ALTER TABLE conversation_contexts ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 1 CHECK(contract_version IN (1,2));
ALTER TABLE command_drafts ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 1 CHECK(contract_version IN (1,2));
ALTER TABLE reminder_series_proposals ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 1 CHECK(contract_version IN (1,2));
ALTER TABLE conversation_contexts ADD COLUMN write_marker TEXT;
ALTER TABLE command_drafts ADD COLUMN write_marker TEXT;
ALTER TABLE reminders ADD COLUMN context_write_marker TEXT;
ALTER TABLE conversation_context_outcomes ADD COLUMN operation_key TEXT;
ALTER TABLE conversation_context_outcomes ADD COLUMN proof_hash TEXT;
ALTER TABLE conversation_context_outcomes ADD COLUMN result_json TEXT;
ALTER TABLE conversation_context_outcomes ADD COLUMN web_session_id TEXT REFERENCES sessions(id);
CREATE UNIQUE INDEX idx_context_operation_key ON conversation_context_outcomes(operation_key) WHERE operation_key IS NOT NULL;
CREATE TABLE conversation_contract_ownership (
 chat_identity_id TEXT PRIMARY KEY REFERENCES chat_identities(id) ON DELETE RESTRICT,
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 context_id TEXT NOT NULL UNIQUE REFERENCES conversation_contexts(id) ON DELETE RESTRICT,
 contract_version INTEGER NOT NULL CHECK(contract_version=2)
) STRICT;
-- A permit is inserted and deleted in the SAME batch. A pre-existing permit
-- never authorizes a new operation; the store requires a fresh random marker.
CREATE TABLE conversation_contract_write_permits (
 chat_identity_id TEXT PRIMARY KEY REFERENCES chat_identities(id) ON DELETE RESTRICT,
 context_id TEXT NOT NULL,
 marker TEXT NOT NULL UNIQUE,
 operation TEXT NOT NULL CHECK(operation IN ('APPLY','CONFIRM','DELIVERY','PURGE')),
 source_inbound_id TEXT REFERENCES inbound_updates(id) ON DELETE RESTRICT,
 web_session_id TEXT REFERENCES sessions(id) ON DELETE RESTRICT,
 CHECK(NOT(source_inbound_id IS NOT NULL AND web_session_id IS NOT NULL))
) STRICT;

CREATE TABLE command_draft_context_details (
 draft_id TEXT PRIMARY KEY REFERENCES command_drafts(id) ON DELETE RESTRICT,
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 chat_identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE RESTRICT,
 encryption_entity_id TEXT NOT NULL,
 payload_version TEXT NOT NULL CHECK(payload_version='calenote-reminder-details-1'),
 payload_ciphertext BLOB NOT NULL CHECK(length(payload_ciphertext) BETWEEN 16 AND 24592),
 payload_iv BLOB NOT NULL CHECK(length(payload_iv)=12),
 key_version INTEGER NOT NULL CHECK(key_version=1)
) STRICT;

CREATE TABLE reminder_context_details (
 reminder_id TEXT PRIMARY KEY REFERENCES reminders(id) ON DELETE RESTRICT,
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 chat_identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE RESTRICT,
 encryption_entity_id TEXT NOT NULL,
 payload_version TEXT NOT NULL CHECK(payload_version='calenote-reminder-details-1'),
 payload_ciphertext BLOB NOT NULL CHECK(length(payload_ciphertext) BETWEEN 16 AND 24592),
 payload_iv BLOB NOT NULL CHECK(length(payload_iv)=12),
 key_version INTEGER NOT NULL CHECK(key_version=1)
) STRICT;

CREATE TABLE reminder_series_context_details (
 series_id TEXT PRIMARY KEY REFERENCES reminder_series(id) ON DELETE RESTRICT,
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 chat_identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE RESTRICT,
 encryption_entity_id TEXT NOT NULL,
 payload_version TEXT NOT NULL CHECK(payload_version='calenote-reminder-details-1'),
 payload_ciphertext BLOB NOT NULL CHECK(length(payload_ciphertext) BETWEEN 16 AND 24592),
 payload_iv BLOB NOT NULL CHECK(length(payload_iv)=12),
 key_version INTEGER NOT NULL CHECK(key_version=1)
) STRICT;

CREATE TRIGGER fence_conversation_contexts_insert BEFORE INSERT ON conversation_contexts
WHEN (NEW.contract_version=2 OR EXISTS(SELECT 1 FROM conversation_contract_ownership o WHERE o.chat_identity_id=NEW.chat_identity_id))
 AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p WHERE p.chat_identity_id=NEW.chat_identity_id AND p.marker=NEW.write_marker
   AND (p.context_id=NEW.id))
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER fence_conversation_contexts_update BEFORE UPDATE ON conversation_contexts
WHEN (NEW.contract_version=2 OR EXISTS(SELECT 1 FROM conversation_contract_ownership o WHERE o.chat_identity_id=NEW.chat_identity_id))
 AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p WHERE p.chat_identity_id=NEW.chat_identity_id AND (p.marker=NEW.write_marker OR (NEW.write_marker IS NULL AND OLD.write_marker=p.marker))
   AND (p.context_id=NEW.id))
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER fence_command_drafts_insert BEFORE INSERT ON command_drafts
WHEN (NEW.contract_version=2 OR EXISTS(SELECT 1 FROM conversation_contract_ownership o WHERE o.chat_identity_id=NEW.chat_identity_id))
 AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p WHERE p.chat_identity_id=NEW.chat_identity_id AND p.marker=NEW.write_marker
   AND (EXISTS(SELECT 1 FROM conversation_contract_ownership o WHERE o.chat_identity_id=p.chat_identity_id AND o.context_id=p.context_id)))
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER fence_command_drafts_update BEFORE UPDATE ON command_drafts
WHEN (NEW.contract_version=2 OR EXISTS(SELECT 1 FROM conversation_contract_ownership o WHERE o.chat_identity_id=NEW.chat_identity_id))
 AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p WHERE p.chat_identity_id=NEW.chat_identity_id AND (p.marker=NEW.write_marker OR (NEW.write_marker IS NULL AND OLD.write_marker=p.marker))
   AND ((NEW.write_marker IS NULL AND OLD.write_marker=p.marker) OR EXISTS(SELECT 1 FROM conversation_contract_ownership o WHERE o.chat_identity_id=p.chat_identity_id AND o.context_id=p.context_id)))
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER fence_reminder_series_proposals_insert BEFORE INSERT ON reminder_series_proposals
WHEN (NEW.contract_version=2 OR EXISTS(SELECT 1 FROM conversation_contract_ownership o WHERE o.chat_identity_id=NEW.chat_identity_id))
 AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p WHERE p.chat_identity_id=NEW.chat_identity_id AND p.marker=NEW.transaction_marker
   AND (EXISTS(SELECT 1 FROM conversation_contract_ownership o WHERE o.chat_identity_id=p.chat_identity_id AND o.context_id=p.context_id)))
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER fence_reminder_series_proposals_update BEFORE UPDATE ON reminder_series_proposals
WHEN (NEW.contract_version=2 OR EXISTS(SELECT 1 FROM conversation_contract_ownership o WHERE o.chat_identity_id=NEW.chat_identity_id))
 AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p WHERE p.chat_identity_id=NEW.chat_identity_id AND (p.marker=NEW.transaction_marker OR (NEW.transaction_marker IS NULL AND OLD.transaction_marker=p.marker))
   AND ((NEW.transaction_marker IS NULL AND OLD.transaction_marker=p.marker) OR EXISTS(SELECT 1 FROM conversation_contract_ownership o WHERE o.chat_identity_id=p.chat_identity_id AND o.context_id=p.context_id)))
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER fence_semantic_contexts_insert BEFORE INSERT ON semantic_contexts
WHEN (EXISTS(SELECT 1 FROM conversation_contract_ownership o WHERE o.chat_identity_id=NEW.chat_identity_id))

BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER fence_semantic_contexts_update BEFORE UPDATE ON semantic_contexts
WHEN (EXISTS(SELECT 1 FROM conversation_contract_ownership o WHERE o.chat_identity_id=NEW.chat_identity_id))

BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER fence_reminder_insert BEFORE INSERT ON reminders
WHEN EXISTS(SELECT 1 FROM conversation_contract_ownership o WHERE o.chat_identity_id=NEW.chat_identity_id)
 AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p JOIN conversation_contract_ownership o ON o.chat_identity_id=p.chat_identity_id AND o.context_id=p.context_id
 WHERE p.chat_identity_id=NEW.chat_identity_id AND p.operation='CONFIRM' AND p.marker=NEW.context_write_marker)
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER fence_ownership_delete BEFORE DELETE ON conversation_contract_ownership
WHEN NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p JOIN conversation_contexts c ON c.id=p.context_id
 WHERE p.chat_identity_id=OLD.chat_identity_id AND p.context_id=OLD.context_id
 AND c.status IN ('COMPLETED','CANCELLED','EXPIRED','INVALID') AND c.write_marker=p.marker)
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

-- Replace only the trigger definition, never the historical migration. Legacy
-- transfer semantics are unchanged; successor terminalization belongs to T4.
DROP TRIGGER finish_transferred_conversation;
CREATE TRIGGER finish_transferred_conversation AFTER UPDATE OF status ON command_drafts
WHEN OLD.status='PENDING' AND NEW.status IN ('CONFIRMED','CANCELLED','EXPIRED')
 AND NEW.resolution_inbound_id IS NOT NULL AND OLD.contract_version=1
BEGIN
 INSERT INTO conversation_context_outcomes(context_id,revision,source_inbound_id,operation,created_at)
 SELECT id,revision+1,NEW.resolution_inbound_id,'FINISH',NEW.updated_at FROM conversation_contexts
 WHERE chat_identity_id=NEW.chat_identity_id AND last_inbound_id=NEW.source_inbound_id
 AND status='DRAFT_READY' AND contract_version=1;
 UPDATE conversation_contexts SET status=CASE WHEN NEW.status='CONFIRMED' THEN 'COMPLETED' ELSE NEW.status END,
 revision=revision+1,updated_at=NEW.updated_at,last_inbound_id=NEW.resolution_inbound_id,
 payload_ciphertext=NULL,payload_iv=NULL,key_version=NULL
 WHERE chat_identity_id=NEW.chat_identity_id AND last_inbound_id=NEW.source_inbound_id
 AND status='DRAFT_READY' AND contract_version=1;
END;

-- Durable shared ordering survives release of active contract ownership.

CREATE TRIGGER ordered_conversation_contexts_insert BEFORE INSERT ON conversation_contexts
WHEN NEW.status IN ('CLARIFYING','DRAFT_READY') AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p WHERE p.chat_identity_id=NEW.chat_identity_id)
 AND EXISTS(SELECT 1 FROM inbound_updates current WHERE current.id=NEW.last_inbound_id
 AND (EXISTS(SELECT 1 FROM conversation_context_outcomes o JOIN inbound_updates later ON later.id=o.source_inbound_id
 WHERE later.connection_id=current.connection_id AND later.provider_user_id=current.provider_user_id AND later.private_chat_id=current.private_chat_id
 AND (later.received_at>current.received_at OR (later.received_at=current.received_at AND later.rowid>current.rowid)))
 OR EXISTS(SELECT 1 FROM conversation_contexts wc WHERE wc.chat_identity_id=NEW.chat_identity_id AND wc.claim_marker LIKE 'web:%' AND wc.updated_at>=current.received_at)))
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER ordered_conversation_contexts_update BEFORE UPDATE ON conversation_contexts
WHEN NEW.status IN ('CLARIFYING','DRAFT_READY') AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p WHERE p.chat_identity_id=NEW.chat_identity_id)
 AND EXISTS(SELECT 1 FROM inbound_updates current WHERE current.id=NEW.last_inbound_id
 AND (EXISTS(SELECT 1 FROM conversation_context_outcomes o JOIN inbound_updates later ON later.id=o.source_inbound_id
 WHERE later.connection_id=current.connection_id AND later.provider_user_id=current.provider_user_id AND later.private_chat_id=current.private_chat_id
 AND (later.received_at>current.received_at OR (later.received_at=current.received_at AND later.rowid>current.rowid)))
 OR EXISTS(SELECT 1 FROM conversation_contexts wc WHERE wc.chat_identity_id=NEW.chat_identity_id AND wc.claim_marker LIKE 'web:%' AND wc.updated_at>=current.received_at)))
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER ordered_command_drafts_insert BEFORE INSERT ON command_drafts
WHEN NEW.status IN ('PENDING','CONFIRMED') AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p WHERE p.chat_identity_id=NEW.chat_identity_id)
 AND EXISTS(SELECT 1 FROM inbound_updates current WHERE current.id=coalesce(NEW.resolution_inbound_id,NEW.source_inbound_id)
 AND (EXISTS(SELECT 1 FROM conversation_context_outcomes o JOIN inbound_updates later ON later.id=o.source_inbound_id
 WHERE later.connection_id=current.connection_id AND later.provider_user_id=current.provider_user_id AND later.private_chat_id=current.private_chat_id
 AND (later.received_at>current.received_at OR (later.received_at=current.received_at AND later.rowid>current.rowid)))
 OR EXISTS(SELECT 1 FROM conversation_contexts wc WHERE wc.chat_identity_id=NEW.chat_identity_id AND wc.claim_marker LIKE 'web:%' AND wc.updated_at>=current.received_at)))
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER ordered_command_drafts_update BEFORE UPDATE ON command_drafts
WHEN NEW.status IN ('PENDING','CONFIRMED') AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p WHERE p.chat_identity_id=NEW.chat_identity_id)
 AND EXISTS(SELECT 1 FROM inbound_updates current WHERE current.id=coalesce(NEW.resolution_inbound_id,NEW.source_inbound_id)
 AND (EXISTS(SELECT 1 FROM conversation_context_outcomes o JOIN inbound_updates later ON later.id=o.source_inbound_id
 WHERE later.connection_id=current.connection_id AND later.provider_user_id=current.provider_user_id AND later.private_chat_id=current.private_chat_id
 AND (later.received_at>current.received_at OR (later.received_at=current.received_at AND later.rowid>current.rowid)))
 OR EXISTS(SELECT 1 FROM conversation_contexts wc WHERE wc.chat_identity_id=NEW.chat_identity_id AND wc.claim_marker LIKE 'web:%' AND wc.updated_at>=current.received_at)))
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER ordered_reminder_series_proposals_insert BEFORE INSERT ON reminder_series_proposals
WHEN NEW.status IN ('PENDING','CONFIRMED') AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p WHERE p.chat_identity_id=NEW.chat_identity_id)
 AND EXISTS(SELECT 1 FROM inbound_updates current WHERE current.id=coalesce(NEW.resolution_inbound_id,NEW.source_inbound_id)
 AND (EXISTS(SELECT 1 FROM conversation_context_outcomes o JOIN inbound_updates later ON later.id=o.source_inbound_id
 WHERE later.connection_id=current.connection_id AND later.provider_user_id=current.provider_user_id AND later.private_chat_id=current.private_chat_id
 AND (later.received_at>current.received_at OR (later.received_at=current.received_at AND later.rowid>current.rowid)))
 OR EXISTS(SELECT 1 FROM conversation_contexts wc WHERE wc.chat_identity_id=NEW.chat_identity_id AND wc.claim_marker LIKE 'web:%' AND wc.updated_at>=current.received_at)))
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER ordered_reminder_series_proposals_update BEFORE UPDATE ON reminder_series_proposals
WHEN NEW.status IN ('PENDING','CONFIRMED') AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p WHERE p.chat_identity_id=NEW.chat_identity_id)
 AND EXISTS(SELECT 1 FROM inbound_updates current WHERE current.id=coalesce(NEW.resolution_inbound_id,NEW.source_inbound_id)
 AND (EXISTS(SELECT 1 FROM conversation_context_outcomes o JOIN inbound_updates later ON later.id=o.source_inbound_id
 WHERE later.connection_id=current.connection_id AND later.provider_user_id=current.provider_user_id AND later.private_chat_id=current.private_chat_id
 AND (later.received_at>current.received_at OR (later.received_at=current.received_at AND later.rowid>current.rowid)))
 OR EXISTS(SELECT 1 FROM conversation_contexts wc WHERE wc.chat_identity_id=NEW.chat_identity_id AND wc.claim_marker LIKE 'web:%' AND wc.updated_at>=current.received_at)))
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER ordered_semantic_contexts_insert BEFORE INSERT ON semantic_contexts
WHEN NEW.status IN ('PENDING','CONFIRMED') AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p WHERE p.chat_identity_id=NEW.chat_identity_id)
 AND EXISTS(SELECT 1 FROM inbound_updates current WHERE current.id=coalesce(NEW.resolution_inbound_id,NEW.source_inbound_id)
 AND (EXISTS(SELECT 1 FROM conversation_context_outcomes o JOIN inbound_updates later ON later.id=o.source_inbound_id
 WHERE later.connection_id=current.connection_id AND later.provider_user_id=current.provider_user_id AND later.private_chat_id=current.private_chat_id
 AND (later.received_at>current.received_at OR (later.received_at=current.received_at AND later.rowid>current.rowid)))
 OR EXISTS(SELECT 1 FROM conversation_contexts wc WHERE wc.chat_identity_id=NEW.chat_identity_id AND wc.claim_marker LIKE 'web:%' AND wc.updated_at>=current.received_at)))
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

CREATE TRIGGER ordered_semantic_contexts_update BEFORE UPDATE ON semantic_contexts
WHEN NEW.status IN ('PENDING','CONFIRMED') AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits p WHERE p.chat_identity_id=NEW.chat_identity_id)
 AND EXISTS(SELECT 1 FROM inbound_updates current WHERE current.id=coalesce(NEW.resolution_inbound_id,NEW.source_inbound_id)
 AND (EXISTS(SELECT 1 FROM conversation_context_outcomes o JOIN inbound_updates later ON later.id=o.source_inbound_id
 WHERE later.connection_id=current.connection_id AND later.provider_user_id=current.provider_user_id AND later.private_chat_id=current.private_chat_id
 AND (later.received_at>current.received_at OR (later.received_at=current.received_at AND later.rowid>current.rowid)))
 OR EXISTS(SELECT 1 FROM conversation_contexts wc WHERE wc.chat_identity_id=NEW.chat_identity_id AND wc.claim_marker LIKE 'web:%' AND wc.updated_at>=current.received_at)))
BEGIN SELECT RAISE(ABORT,'CONTEXT_CONTRACT_FENCE'); END;

-- Clear the row's transient capability while its permit still exists. No
-- committed row can lend a former marker to an orphan permit/legacy update.
CREATE TRIGGER clear_context_contract_markers BEFORE DELETE ON conversation_contract_write_permits
BEGIN
 UPDATE conversation_contexts SET write_marker=NULL WHERE write_marker=OLD.marker;
 UPDATE command_drafts SET write_marker=NULL WHERE write_marker=OLD.marker;
 UPDATE reminder_series_proposals SET transaction_marker=NULL WHERE contract_version=2 AND transaction_marker=OLD.marker;
 UPDATE reminders SET context_write_marker=NULL WHERE context_write_marker=OLD.marker;
END;
