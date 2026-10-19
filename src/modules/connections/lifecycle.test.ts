// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { SqliteD1Database } from "@/testing/sqlite-d1.test-support";
import { D1ConnectionLifecycleStore } from "./lifecycle";
const databases: SqliteD1Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function setup() {
  const db = new SqliteD1Database(); databases.push(db);
  db.sqlite.exec(`INSERT INTO users VALUES ('u','u@example.com','User','Asia/Ho_Chi_Minh',1,1),('other','other@example.com','Other','Asia/Ho_Chi_Minh',1,1);
    INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES
    ('c','u','telegram','public','bot','Bot',x'0102',x'03','fp',1,'ACTIVE_BOUND',1,1),
    ('alternate','u','zalo','alternate','bot2','Other bot',x'0102',x'03','fp2',1,'ACTIVE_BOUND',1,1);
    INSERT INTO chat_identities(id,connection_id,provider_user_id,private_chat_id,linked_at) VALUES ('chat','c','pu','pc',1),('chat2','alternate','pu2','pc2',1);`);
  // D1 serializes transactions; the in-process SQLite adapter must do so too.
  const batch=db.batch.bind(db); let pending:Promise<unknown>=Promise.resolve();
  db.batch=async <T,>(statements:D1PreparedStatement[]):Promise<D1Result<T>[]> => {const result=pending.then(()=>batch<T>(statements));pending=result.catch(()=>{});return result;};
  return {db, store:new D1ConnectionLifecycleStore(db as unknown as D1Database)};
}
it('disconnects locally without deleting credentials, identity or existing reminders', async () => {
  const {db,store}=setup();
  expect(await store.disconnect('u','public',100,'marker')).toBe(true);
  expect(db.sqlite.prepare('SELECT state,transition_marker,hex(encrypted_token) AS credential FROM bot_connections WHERE id=\'c\'').get()).toEqual({state:'SUSPENDED',transition_marker:'disconnected:marker',credential:'0102'});
  expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM chat_identities').get()).toEqual({n:2});
  expect(await store.disconnect('u','public',101,'again')).toBe(false);
});
it('rejects another owner and the last usable login channel', async () => {
  const {db,store}=setup();
  expect(await store.disconnect('other','public',100,'wrong')).toBe(false);
  db.sqlite.exec("UPDATE bot_connections SET state='SUSPENDED' WHERE id='alternate'");
  expect(await store.disconnect('u','public',100,'last')).toBe(false);
  expect(db.sqlite.prepare("SELECT state FROM bot_connections WHERE id='c'").get()).toEqual({state:'ACTIVE_BOUND'});
});
it('serializes two last-channel disconnects so exactly one succeeds', async () => {
  const {store}=setup();
  expect(await Promise.all([store.disconnect('u','public',100,'one'),store.disconnect('u','alternate',100,'two')])).toEqual([true,false]);
});
it('fences provider egress and refuses a disconnect while a reserved send is unresolved', async () => {
  const {store}=setup();
  expect(await store.reserveEgress('c','send',100)).toBe(true);
  expect(await store.disconnect('u','public',100,'one')).toBe(false);
  await store.finishEgress('send');
  expect(await store.disconnect('u','public',101,'two')).toBe(true);
  expect(await store.reserveEgress('c','late',102)).toBe(false);
});
it('rolls back disconnect when audit persistence fails', async () => {
  const {db,store}=setup();
  db.sqlite.exec("CREATE TRIGGER deny_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  await expect(store.disconnect('u','public',100,'marker')).rejects.toThrow('audit unavailable');
  expect(db.sqlite.prepare("SELECT transition_marker FROM bot_connections WHERE id='c'").get()).toEqual({transition_marker:null});
});
it('requires selecting the alternate primary before disconnecting the current primary',async()=>{
 const {db,store}=setup();db.sqlite.exec("INSERT INTO primary_login_channels VALUES ('u','c','first',1)");
 expect(await store.disconnect('u','public',100,'blocked')).toBe(false);
 db.sqlite.exec("UPDATE primary_login_channels SET connection_id='alternate',transition_marker='explicit-alternate' WHERE user_id='u'");
 expect(await store.disconnect('u','public',101,'allowed')).toBe(true);
});
