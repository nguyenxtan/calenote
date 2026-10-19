ALTER TABLE user_preferences ADD COLUMN reminder_confirmation TEXT NOT NULL DEFAULT 'auto' CHECK (reminder_confirmation IN ('auto', 'preview'));
