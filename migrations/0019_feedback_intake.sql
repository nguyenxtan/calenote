-- Forward-only. No retention, deletion, notifications or provider work.
CREATE TABLE feedback_tickets (
 id TEXT PRIMARY KEY,
 owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 request_id TEXT NOT NULL,
 payload_digest TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('BUG','FEATURE')),
 status TEXT NOT NULL CHECK(status IN ('NEW','REVIEWING','IN_PROGRESS','CLOSED')),
 content_ciphertext BLOB NOT NULL,
 content_iv BLOB NOT NULL,
 content_key_version INTEGER NOT NULL DEFAULT 1 CHECK(content_key_version > 0),
 revision INTEGER NOT NULL CHECK(revision > 0),
 actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(owner_user_id,request_id)
);
CREATE INDEX feedback_owner_created ON feedback_tickets(owner_user_id,created_at);
CREATE INDEX feedback_queue ON feedback_tickets(status,kind,id);
CREATE TABLE feedback_audit (
 ticket_id TEXT NOT NULL REFERENCES feedback_tickets(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL,
 actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 old_status TEXT,
 new_status TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('CREATE','TRIAGE')),
 occurred_at INTEGER NOT NULL,
 PRIMARY KEY(ticket_id,revision)
);
CREATE TRIGGER feedback_create_audit AFTER INSERT ON feedback_tickets BEGIN
 INSERT INTO feedback_audit VALUES(NEW.id,NEW.revision,NEW.actor_user_id,NULL,NEW.status,'CREATE',NEW.updated_at);
END;
CREATE TRIGGER feedback_triage_audit AFTER UPDATE ON feedback_tickets BEGIN
 INSERT INTO feedback_audit VALUES(NEW.id,NEW.revision,NEW.actor_user_id,OLD.status,NEW.status,'TRIAGE',NEW.updated_at);
END;
