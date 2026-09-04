import { d1Changes } from "@/modules/platform/types";
import type { UserPreferences, UserPreferencesStore } from "@/modules/preferences/service";

interface PreferencesRow {
  user_id: string;
  address_style: UserPreferences["addressStyle"];
  custom_display_name: string | null;
  tone: UserPreferences["tone"];
  updated_at: number;
}

function fromRow(row: PreferencesRow): UserPreferences {
  return {
    userId: row.user_id,
    addressStyle: row.address_style,
    customDisplayName: row.custom_display_name,
    tone: row.tone,
    updatedAt: row.updated_at,
  };
}

export class D1UserPreferencesStore implements UserPreferencesStore {
  constructor(private readonly database: D1Database) {}

  async get(userId: string): Promise<UserPreferences | null> {
    const row = await this.database
      .prepare(
        `SELECT preferences.user_id, preferences.address_style,
                preferences.custom_display_name, preferences.tone, preferences.updated_at
         FROM user_preferences preferences
         JOIN users user ON user.id = preferences.user_id
         WHERE preferences.user_id = ?
         LIMIT 1`,
      )
      .bind(userId)
      .first<PreferencesRow>();
    return row ? fromRow(row) : null;
  }

  async save(preferences: UserPreferences): Promise<UserPreferences> {
    const result = await this.database
      .prepare(
        `INSERT INTO user_preferences (user_id, address_style, custom_display_name, tone, updated_at)
         SELECT ?, ?, ?, ?, ? FROM users WHERE users.id = ?
         ON CONFLICT (user_id) DO UPDATE SET
           address_style = excluded.address_style,
           custom_display_name = excluded.custom_display_name,
           tone = excluded.tone,
           updated_at = excluded.updated_at`,
      )
      .bind(
        preferences.userId,
        preferences.addressStyle,
        preferences.customDisplayName,
        preferences.tone,
        preferences.updatedAt,
        preferences.userId,
      )
      .run();
    if (d1Changes(result) !== 1) throw new Error("User preferences save did not commit");
    return preferences;
  }
}

export function createD1UserPreferencesStore(database: D1Database): D1UserPreferencesStore {
  return new D1UserPreferencesStore(database);
}
