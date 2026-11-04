ALTER TABLE user_preferences ADD COLUMN advance_reminder_days INTEGER CHECK(advance_reminder_days IS NULL OR advance_reminder_days BETWEEN 1 AND 7);
ALTER TABLE user_preferences ADD COLUMN advance_reminder_hours INTEGER CHECK(advance_reminder_hours IS NULL OR advance_reminder_hours BETWEEN 1 AND 24);
