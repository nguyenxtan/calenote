import type { BotProvider } from "@/modules/connections/contracts";
import type { ConnectionState } from "@/modules/onboarding/service";
import type { PublicActivity } from "@/contracts/api/activity";

export interface PublicSessionUser {
  displayName: string;
  email: string;
  timezone: "Asia/Ho_Chi_Minh";
}

export interface PublicConnection {
  publicId: string;
  provider: BotProvider;
  displayName: string;
  handle: string | null;
  state: ConnectionState;
}

interface UserRow {
  display_name: string;
  email: string;
  timezone: "Asia/Ho_Chi_Minh";
}

interface ConnectionRow {
  public_id: string;
  provider: BotProvider;
  display_name: string;
  handle: string | null;
  state: ConnectionState;
}

export class D1DashboardStore {
  constructor(private readonly database: D1Database) {}

  async getSessionUser(userId: string): Promise<PublicSessionUser | null> {
    const row = await this.database
      .prepare(
        "SELECT display_name, email, timezone FROM users WHERE id = ? LIMIT 1",
      )
      .bind(userId)
      .first<UserRow>();
    return row
      ? { displayName: row.display_name, email: row.email, timezone: row.timezone }
      : null;
  }

  async listConnections(userId: string): Promise<PublicConnection[]> {
    const rows = await this.database
      .prepare(
        `SELECT public_id, provider, display_name, handle, state
         FROM bot_connections
         WHERE user_id = ?
         ORDER BY provider ASC, public_id ASC`,
      )
      .bind(userId)
      .all<ConnectionRow>();
    return rows.results.map((row) => ({
      publicId: row.public_id,
      provider: row.provider,
      displayName: row.display_name,
      handle: row.handle,
      state: row.state,
    }));
  }

  async listActivity(userId: string): Promise<PublicActivity[]> {
    const rows = await this.database.prepare(`SELECT action, created_at FROM audit_events WHERE actor_user_id = ? AND action IN ('REMINDER_CREATED','REMINDER_CANCELLED','CONNECT_CODE_ROTATED','CHAT_BOUND') ORDER BY created_at DESC LIMIT 50`).bind(userId).all<{action:PublicActivity["action"];created_at:number}>();
    return rows.results.map((row) => ({ action: row.action, createdAt: row.created_at }));
  }
}
