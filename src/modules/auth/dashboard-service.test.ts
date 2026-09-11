import { afterEach, describe, expect, it } from "vitest";
import { SqliteD1Database } from "@/testing/sqlite-d1.test-support";
import { D1DashboardStore } from "./dashboard-service";

const databases: SqliteD1Database[] = [];
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function setup(): { db: SqliteD1Database; store: D1DashboardStore } {
  const db = new SqliteD1Database();
  databases.push(db);
  db.sqlite.exec(`
    INSERT INTO users VALUES ('user-1','one@example.com','One','Asia/Ho_Chi_Minh',1,1);
    INSERT INTO users VALUES ('user-2','two@example.com','Two','Asia/Ho_Chi_Minh',1,1);
    INSERT INTO bot_connections (
      id,user_id,provider,public_id,provider_bot_id,display_name,handle,
      encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,
      state,created_at,updated_at,transition_marker
    ) VALUES
      ('connection-z','user-1','zalo','AAAAAAAAAAAAAAAAAAAAAA','bot-z','Zalo bot',NULL,
       X'01',zeroblob(12),'fingerprint-z',1,'ACTIVE_UNBOUND',1,1,'marker-z'),
      ('connection-t','user-1','telegram','BBBBBBBBBBBBBBBBBBBBBA','bot-t','Telegram bot','@bot',
       X'02',zeroblob(12),'fingerprint-t',1,'ACTIVE_BOUND',1,1,'marker-t'),
      ('connection-other','user-2','telegram','CCCCCCCCCCCCCCCCCCCCCA','bot-o','Private','@private',
       X'03',zeroblob(12),'fingerprint-o',1,'SUSPENDED',1,1,'marker-o');
  `);
  return { db, store: new D1DashboardStore(db as unknown as D1Database) };
}

describe("authenticated dashboard reads on migrated D1", () => {
  it("projects only allowlisted actor-owned activity newest first and bounds it to fifty", async () => {
    const { db, store } = setup();
    const inserts: string[] = [];
    for (let index = 0; index < 55; index += 1) inserts.push(`('secret-token-${index}','user-1','REMINDER_CREATED',NULL,NULL,NULL,'SUCCESS',${index})`);
    inserts.push("('foreign-secret','user-2','REMINDER_CANCELLED',NULL,NULL,NULL,'SUCCESS',999)", "('internal-secret','user-1','LOGIN_CODE_DELIVERY_UNCERTAIN',NULL,NULL,NULL,'SUCCESS',1000)");
    db.sqlite.exec(`INSERT INTO audit_events (id,actor_user_id,action,target_user_id,target_connection_id,target_reminder_id,result,created_at) VALUES ${inserts.join(",")}`);
    const activity = await store.listActivity("user-1");
    expect(activity).toHaveLength(50);
    expect(activity[0]).toEqual({ action: "REMINDER_CREATED", createdAt: 54 });
    expect(activity.at(-1)).toEqual({ action: "REMINDER_CREATED", createdAt: 5 });
    expect(JSON.stringify(activity)).not.toContain("secret-token");
    expect(JSON.stringify(activity)).not.toContain("foreign-secret");
    expect(JSON.stringify(activity)).not.toContain("LOGIN_CODE");
    expect(await store.listActivity("user-2")).toEqual([{ action: "REMINDER_CANCELLED", createdAt: 999 }]);
  });
  it("returns only the session user's safe account and sorted connection fields", async () => {
    const { store } = setup();

    await expect(store.getSessionUser("user-1")).resolves.toEqual({
      displayName: "One",
      email: "one@example.com",
      timezone: "Asia/Ho_Chi_Minh",
    });
    await expect(store.listConnections("user-1")).resolves.toEqual([
      {
        publicId: "BBBBBBBBBBBBBBBBBBBBBA",
        provider: "telegram",
        displayName: "Telegram bot",
        handle: "@bot",
        state: "ACTIVE_BOUND",
      },
      {
        publicId: "AAAAAAAAAAAAAAAAAAAAAA",
        provider: "zalo",
        displayName: "Zalo bot",
        handle: null,
        state: "ACTIVE_UNBOUND",
      },
    ]);
    expect(JSON.stringify(await store.listConnections("user-1"))).not.toContain("connection-");
    await expect(store.listConnections("missing-user")).resolves.toEqual([]);
  });
});
