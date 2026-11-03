-- OTP and browser proofs are keyed digests; email/name metadata expires and is purged.
-- No user identity exists before successful proof.
CREATE TABLE email_registration_challenges (
  email TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
  id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  code_digest TEXT NOT NULL,
  binding_digest TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  delivery_status TEXT NOT NULL CHECK(delivery_status IN ('PENDING','SENT','FAILED')),
  consumed_at INTEGER,
  verification_marker TEXT
) STRICT;
CREATE TABLE email_verified_accounts (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verified_email_at INTEGER NOT NULL
) STRICT;
CREATE INDEX email_registration_expiry ON email_registration_challenges(expires_at);
