CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address_style TEXT NOT NULL DEFAULT 'ban' CHECK (address_style IN ('ban', 'anh_chi', 'ong_tui', 'minh', 'sep', 'custom')),
  custom_display_name TEXT,
  tone TEXT NOT NULL DEFAULT 'friendly' CHECK (tone IN ('concise', 'friendly', 'professional', 'playful')),
  updated_at INTEGER NOT NULL,
  CHECK (address_style <> 'custom' OR (custom_display_name IS NOT NULL AND length(trim(custom_display_name)) > 0)),
  CHECK (address_style = 'custom' OR custom_display_name IS NULL)
) STRICT;
