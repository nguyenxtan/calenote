-- Owner/month aggregates keep their read cost scoped to one account and month.
CREATE INDEX IF NOT EXISTS idx_semantic_budget_owner_month_created
  ON semantic_budget_reservations(owner_id,monthly_window_key,created_at);
