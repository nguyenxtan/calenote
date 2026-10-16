-- Atomic manual CREATE receipts. No plaintext payload is persisted.
CREATE TABLE manual_reminder_intents (
  user_id TEXT NOT NULL REFERENCES users(id),
  intent_id TEXT NOT NULL,
  payload_digest TEXT,
  reminder_id TEXT REFERENCES reminders(id),
  state TEXT NOT NULL CHECK (state IN ('CREATED', 'ABANDONED')),
  PRIMARY KEY (user_id, intent_id)
);
