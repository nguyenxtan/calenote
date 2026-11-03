// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { SqliteD1Database } from "@/testing/sqlite-d1.test-support";
import { D1EmailDiscoveryStore, continueWithEmail } from "./email-discovery";
import { createKeyring } from "@/modules/security/keyring";
import { D1RateLimitStore } from "@/modules/db/rate-limit-store";
const dbs: SqliteD1Database[] = [];
afterEach(() => dbs.splice(0).forEach(db => db.close()));
function setup() { const db = new SqliteD1Database(); dbs.push(db); return { db, store: new D1EmailDiscoveryStore(db as unknown as D1Database) }; }
it("classifies unknown email as SETUP and existing unusable account as RECOVERY without writes", async () => {
  const {db,store} = setup();
  expect(await store.classify("new@example.com")).toBe("SETUP");
  db.sqlite.exec("INSERT INTO users VALUES ('u','old@example.com','Owner','Asia/Ho_Chi_Minh',1,1)");
  expect(await store.classify("OLD@example.com")).toBe("RECOVERY");
  expect(db.sqlite.prepare("SELECT count(*) AS n FROM sessions").get()).toMatchObject({n:0});
});
it("requires the primary owned ACTIVE_BOUND bot and its private binding", async () => {
  const {db,store} = setup();
  db.sqlite.exec(`INSERT INTO users VALUES ('u','old@example.com','Owner','Asia/Ho_Chi_Minh',1,1);
  INSERT INTO bot_connections (id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES ('c','u','telegram','public','bot','Bot',X'00',X'00','fingerprint',1,'ACTIVE_BOUND',1,1);
  INSERT INTO primary_login_channels VALUES ('u','c','marker',1);
  INSERT INTO chat_identities VALUES ('ci','c','provider-user','private-chat','Owner',1);`);
  expect(await store.classify("old@example.com")).toBe("LOGIN");
  db.sqlite.exec("UPDATE bot_connections SET state='SUSPENDED'");
  expect(await store.classify("old@example.com")).toBe("RECOVERY");
  db.sqlite.exec("UPDATE bot_connections SET state='ACTIVE_BOUND'; DELETE FROM chat_identities");
  expect(await store.classify("old@example.com")).toBe("RECOVERY");
  db.sqlite.exec("DELETE FROM primary_login_channels");
  expect(await store.classify("old@example.com")).toBe("RECOVERY");
});
it("uses only an unambiguous singleton fallback when no primary has been selected", async () => {
  const {db,store} = setup();
  db.sqlite.exec(`INSERT INTO users VALUES ('u','new-owner@example.com','Owner','Asia/Ho_Chi_Minh',1,1);
    INSERT INTO bot_connections (id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at)
    VALUES ('c','u','telegram','public','bot','Bot',X'00',X'00','fingerprint',1,'ACTIVE_BOUND',1,1);
    INSERT INTO chat_identities VALUES ('ci','c','provider-user','private-chat','Owner',1);`);
  expect(await store.classify("new-owner@example.com")).toBe("LOGIN");
  db.sqlite.exec(`INSERT INTO bot_connections (id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at)
    VALUES ('c2','u','telegram','public2','bot2','Bot 2',X'00',X'00','fingerprint2',1,'ACTIVE_BOUND',1,1);
    INSERT INTO chat_identities VALUES ('ci2','c2','provider-user-2','private-chat-2','Owner',1);`);
  expect(await store.classify("new-owner@example.com")).toBe("RECOVERY");
  db.sqlite.exec("INSERT INTO primary_login_channels VALUES ('u','c','marker',1)");
  expect(await store.classify("new-owner@example.com")).toBe("LOGIN");
  db.sqlite.exec("UPDATE bot_connections SET state='SUSPENDED' WHERE id='c'");
  expect(await store.classify("new-owner@example.com")).toBe("RECOVERY");
  db.sqlite.exec("UPDATE bot_connections SET state='ACTIVE_BOUND' WHERE id='c'; UPDATE chat_identities SET private_chat_id='' WHERE connection_id='c'");
  expect(await store.classify("new-owner@example.com")).toBe("RECOVERY");
});

it("rate limits both IP and normalized email before discovery", async () => {
  const {db,store} = setup();
  const dependencies = {store, keyring: await createKeyring("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), rateLimitStore:new D1RateLimitStore(db as unknown as D1Database), now:()=>1800000000000};
  for(let n=0;n<3;n++) expect(await continueWithEmail({email:" NEW@example.com ",clientIp:"192.0.2.1"},dependencies)).toEqual({next:"SETUP"});
  await expect(continueWithEmail({email:"new@example.com",clientIp:"192.0.2.2"},dependencies)).rejects.toMatchObject({status:429});
  for(let n=0;n<7;n++) await continueWithEmail({email:`new${n}@example.com`,clientIp:"192.0.2.1"},dependencies);
  await expect(continueWithEmail({email:"another@example.com",clientIp:"192.0.2.1"},dependencies)).rejects.toMatchObject({status:429});
});
