-- Add a durable, one-shot dispatch fence without rewriting migration 0005.
CREATE TABLE IF NOT EXISTS semantic_budget_dispatches (
  reservation_id TEXT PRIMARY KEY NOT NULL REFERENCES semantic_budget_reservations(id) ON DELETE RESTRICT,
  dispatched_at INTEGER NOT NULL CHECK (dispatched_at >= 0),
  usage_known INTEGER NOT NULL DEFAULT 0 CHECK (usage_known IN (0, 1))
) STRICT;

-- A pre-existing RESERVED row has no reliable dispatch evidence. Treat it as
-- potentially billed. Replaying this migration remains conservative and never
-- creates another dispatch authorization or refunds a possibly billed call.
INSERT INTO semantic_budget_dispatches (reservation_id, dispatched_at, usage_known)
SELECT id, created_at, 0 FROM semantic_budget_reservations WHERE state = 'RESERVED'
ON CONFLICT (reservation_id) DO NOTHING;
