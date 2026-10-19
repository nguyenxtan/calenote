// @vitest-environment node
import { afterEach,expect,it } from "vitest";
import { SqliteD1Database } from "@/testing/sqlite-d1.test-support";
import { D1PrimaryLoginStore } from "./primary-login";
const databases:SqliteD1Database[]=[];
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
function setup(){const db=new SqliteD1Database();databases.push(db);db.sqlite.exec(`
 INSERT INTO users VALUES ('u','u@example.com','User','Asia/Ho_Chi_Minh',1,1),('other','other@example.com','Other','Asia/Ho_Chi_Minh',1,1);
 INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES
 ('one','u','telegram','one-public','bot','Bot',x'01',x'02','fp',1,'ACTIVE_BOUND',1,1),
 ('two','u','zalo','two-public','bot2','Other bot',x'01',x'02','fp2',1,'ACTIVE_BOUND',1,1);
 INSERT INTO chat_identities VALUES ('chat','one','pu','pc',NULL,1),('chat2','two','pu2','pc2',NULL,1);`);
 return {db,store:new D1PrimaryLoginStore(db as unknown as D1Database)};}
it('requires explicit selection for an account with multiple bound channels',async()=>{const {store}=setup();expect(await store.get('u')).toEqual({publicId:null});expect(await store.select('u','two-public',100,'marker')).toBe(true);expect(await store.get('u')).toEqual({publicId:'two-public'});});
it('rejects foreign, unbound and disconnected targets without changing primary',async()=>{const {db,store}=setup();await store.select('u','one-public',100,'first');expect(await store.select('other','two-public',101,'wrong')).toBe(false);db.sqlite.exec("UPDATE bot_connections SET state='SUSPENDED' WHERE id='two'");expect(await store.select('u','two-public',102,'disabled')).toBe(false);expect(await store.get('u')).toEqual({publicId:'one-public'});});
it('does not change primary if audit cannot persist',async()=>{const {db,store}=setup();db.sqlite.exec("CREATE TRIGGER deny_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'audit unavailable');END");await expect(store.select('u','two-public',100,'marker')).rejects.toThrow('audit unavailable');expect(await store.get('u')).toEqual({publicId:null});});
