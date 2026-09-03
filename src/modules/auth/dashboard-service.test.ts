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
