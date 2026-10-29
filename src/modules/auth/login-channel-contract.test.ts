import {execFileSync} from "node:child_process";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {readFileSync} from "node:fs";
import { D1PrimaryLoginStore } from "./primary-login";
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteD1Database, deterministicRandomBytes } from "@/testing/sqlite-d1.test-support";
import { prepareSession } from "./session";
import { createKeyring } from "@/modules/security/keyring";
import { createAuthOperations, createConnectionsOperations } from "@/worker/composition-root";
import { createRouter } from "@/worker/router";
import { D1LoginCodeStore, deliverLoginCode, requestLoginCode, verifyLoginCode } from "./login-service";

const origin = "https://calenote.iconiclogs.com";
const master = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const now = 1_800_000_000_000;
const email = "synthetic-owner@example.invalid";
const databases: SqliteD1Database[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.useRealTimers(); });

function publicId(id: string) { return Buffer.from(id.padEnd(16,"!").slice(0,16)).toString("base64url"); }

async function setup(count: number, legacy = false) {
  const db = new SqliteD1Database({loginProvenance:!legacy}); databases.push(db);
  const keyring = await createKeyring(master);
  for (const user of ["owner", "foreign"]) db.sqlite.prepare("INSERT INTO users VALUES (?,?,?,'Asia/Ho_Chi_Minh',?,?)").run(user, user === "owner" ? email : "synthetic-foreign@example.invalid", user, now, now);
  async function bind(id: string, owner = "owner") {
    const encrypted = await keyring.encryptCredential(id, "telegram", 1, `12345678:synthetic-contract-${id}`);
    db.sqlite.prepare(`INSERT INTO bot_connections (id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at,transition_marker)
      VALUES (?,?,'telegram',?,?,?, ?,?,?,1,'ACTIVE_BOUND',?,?,'synthetic-marker')`).run(id, owner, publicId(id), id, id, new Uint8Array(encrypted.ciphertext), new Uint8Array(encrypted.iv), id, now, now);
    db.sqlite.prepare("INSERT INTO chat_identities VALUES (?,?,?,?,NULL,?)").run(`identity-${id}`, id, `provider-user-${id}`, `chat-${id}`, now);
  }
  for (let index = 0; index < count; index++) await bind(`bot-${index}`);
  const store = new D1LoginCodeStore(db as unknown as D1Database);
  const jobs: {type:"DELIVER_LOGIN_CODE";loginCodeId:string}[] = [];
  const randomBytes = deterministicRandomBytes();
  const deps = {store,keyring,now:() => now,randomBytes};
  const issue = (address = email) => requestLoginCode(address,{...deps,enqueue:async job => {jobs.push(job);}});
  const code = async () => {
    const row = db.sqlite.prepare("SELECT id,code_ciphertext,code_iv,code_key_version FROM login_codes ORDER BY rowid DESC LIMIT 1").get()!;
    return keyring.decryptSensitive("login-code",row.id as string,row.code_key_version as number,{ciphertext:Uint8Array.from(row.code_ciphertext as Uint8Array).buffer,iv:Uint8Array.from(row.code_iv as Uint8Array).buffer});
  };
  const enqueue = vi.fn(async () => {});
  const env = {APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:"production",CALENOTE_MASTER_KEY:master,DB:db,JOBS:{send:enqueue},ASSETS:{fetch:vi.fn()}} as unknown as Env;
  const operations = await createAuthOperations(env);
  const router = createRouter({authOperations:async () => operations});
  const request = (path: string, body: unknown) => router(new Request(`${origin}${path}`,{method:"POST",headers:{origin,"content-type":"application/json","CF-Connecting-IP":"192.0.2.1"},body:JSON.stringify(body)}),env,{} as ExecutionContext);
  const connectionRouter=createRouter({connectionsOperations:createConnectionsOperations});
  const channelRequest = async (target: string | null, owner = "owner", suppliedOrigin = origin, authenticated = true) => {
    let cookie="";
    if (authenticated) {
      const session=await prepareSession(owner,deps);
      db.sqlite.prepare("INSERT INTO sessions VALUES (?,?,?,?,?,?)").run(session.record.id,owner,session.record.digest,session.record.expiresAt,null,now);
      cookie=session.cookie.split(";")[0];
    }
    return connectionRouter(new Request(`${origin}/api/connections/${target ? `${publicId(target)}/login-channel` : "login-channel"}`,{
      method:target?"POST":"GET", headers:{origin:suppliedOrigin,"content-type":"application/json",cookie}, ...(target?{body:"{}"}:{}),
    }),env,{} as ExecutionContext);
  };
  return {db,bind,deps,jobs,issue,code,request,enqueue,channelRequest};
}

describe("baseline verified-bot login contract and release blockers", () => {
  it.each([0,1,2])("runs actual issuance with %i bound bots and delivers through the sticky primary", async count => {
    const h = await setup(count);
    expect(await h.issue()).toEqual({accepted:true});
    expect(h.jobs).toHaveLength(1); // Ineligible accounts enqueue the same opaque decoy shape.
    expect(Object.keys(h.jobs[0]).sort()).toEqual(["loginCodeId","type"]);
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM login_codes").get()).toEqual({count:count > 0 ? 1 : 0});
    const sendText = vi.fn(async () => ({providerMessageId:"synthetic-receipt"}));
    await deliverLoginCode(h.jobs[0].loginCodeId,{...h.deps,sendText});
    expect(sendText).toHaveBeenCalledTimes(count > 0 ? 1 : 0);
    if (count > 0) {
      expect(sendText.mock.calls[0]).toEqual(["telegram","12345678:synthetic-contract-bot-0","chat-bot-0",expect.stringContaining(await h.code())]);
      const result = await verifyLoginCode(email,await h.code(),h.deps);
      expect(result.cookie).toContain("HttpOnly"); expect(result.cookie).toContain("Secure"); expect(result.cookie).toContain("SameSite=Lax");
      await expect(verifyLoginCode(email,await h.code(),h.deps)).rejects.toMatchObject({code:"INVALID_LOGIN_CODE"});
    }
  });
  it.each([0,1,2])("does not enumerate accounts or channels through request-code with %i bots", async count => {
    const h = await setup(count);
    const eligible = await h.request("/api/auth/request-code",{email});
    const absent = await h.request("/api/auth/request-code",{email:"absent@example.invalid"});
    expect(eligible.status).toBe(202);expect(absent.status).toBe(202);
    expect(await eligible.json()).toEqual({data:{accepted:true}});expect(await absent.json()).toEqual({data:{accepted:true}});
    expect(eligible.headers.get("set-cookie")).toBeNull();
  });
  it("does not accept pre-auth bot/channel/user selectors", async () => {
    const h = await setup(1);
    for (const field of ["publicId","connectionId","provider","userId"]) {
      expect((await h.request("/api/auth/request-code",{email,[field]:"foreign"})).status).toBe(400);
    }
    expect(h.enqueue).not.toHaveBeenCalled();
  });
  it("does not borrow a foreign owner's bound channel", async () => {
    const h = await setup(0); await h.bind("foreign-bot","foreign"); await h.issue();
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM login_codes").get()).toEqual({count:0});
    const sendText = vi.fn(async () => ({providerMessageId:null}));
    await deliverLoginCode(h.jobs[0].loginCodeId,{...h.deps,sendText});expect(sendText).not.toHaveBeenCalled();
  });
  it("rejects delivery after its connection is reassigned to another owner", async () => {
    const h = await setup(1);await h.issue();
    h.db.sqlite.prepare("UPDATE bot_connections SET user_id='foreign' WHERE id='bot-0'").run();
    const sendText = vi.fn(async () => ({providerMessageId:null}));
    await deliverLoginCode(h.jobs[0].loginCodeId,{...h.deps,sendText});expect(sendText).not.toHaveBeenCalled();
  });
  it("fences a private-chat change after taking the delivery snapshot", async () => {
    const h = await setup(1);await h.issue();
    const result = await h.deps.store.prepareDelivery(h.jobs[0].loginCodeId,now);
    expect(result.status).toBe("READY");
    if (result.status !== "READY") throw new Error("Expected synthetic delivery snapshot");
    h.db.sqlite.prepare("UPDATE chat_identities SET private_chat_id='changed-synthetic-chat' WHERE connection_id='bot-0'").run();
    expect(await h.deps.store.acquireDelivery(result.delivery,"synthetic-send-marker",now)).not.toEqual({status:"OWNED"});
    expect(h.db.sqlite.prepare("SELECT delivery_status FROM login_codes").get()).toEqual({delivery_status:"PENDING"});
  });
  it("duplicate binding fails atomically without adding a second identity", async () => {
    const h = await setup(1);
    expect(() => h.db.sqlite.prepare("INSERT INTO chat_identities VALUES ('duplicate','bot-0','other-provider-user','other-chat',NULL,?)").run(now)).toThrow(/UNIQUE/);
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM chat_identities").get()).toEqual({count:1});
  });
  it.each([0,1,2])("preserves the email request limit across %i bot channels", async count => {
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
    const h = await setup(count);
    for (let attempt=0;attempt<3;attempt++) expect((await h.request("/api/auth/request-code",{email})).status).toBe(202);
    const limited = await h.request("/api/auth/request-code",{email});expect(limited.status).toBe(429);expect(h.enqueue).toHaveBeenCalledTimes(3);
  });
  it("preserves the email verification limit even with multiple bound bots", async () => {
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
    const h = await setup(2);
    for (let attempt=0;attempt<10;attempt++) expect((await h.request("/api/auth/verify-code",{email,code:"000000"})).status).toBe(401);
    expect((await h.request("/api/auth/verify-code",{email,code:"000000"})).status).toBe(429);
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({count:0});
  });
  it.each(["suspended", "reassigned"])("rejects an already delivered proof after its channel is %s", async change => {
    const h = await setup(1);await h.issue();
    await deliverLoginCode(h.jobs[0].loginCodeId,{...h.deps,sendText:async () => ({providerMessageId:"synthetic-delivered"})});
    expect(h.db.sqlite.prepare("SELECT delivery_status FROM login_codes").get()).toEqual({delivery_status:"SENT"});
    const suppliedCode = await h.code();
    if (change === "suspended") h.db.sqlite.prepare("UPDATE bot_connections SET state='SUSPENDED' WHERE id='bot-0'").run();
    else h.db.sqlite.prepare("UPDATE bot_connections SET user_id='foreign' WHERE id='bot-0'").run();
    await expect(verifyLoginCode(email,suppliedCode,h.deps)).rejects.toMatchObject({code:"INVALID_LOGIN_CODE"});
    expect(h.db.sqlite.prepare("SELECT user_id FROM sessions").all()).toEqual([]);
  });
  it.each(["suspended","unbound","reassigned","chat-changed","identity-replaced","credential-changed","marker-changed","provider-user-changed","linked-at-changed","version-changed","iv-changed","provider-changed"])("fences %s between proof lookup and atomic verification commit", async change => {
    const h = await setup(1);await h.issue();
    const suppliedCode = await h.code();
    const decrypt = h.deps.keyring.decryptSensitive.bind(h.deps.keyring);
    let changed = false;
    const keyring = {...h.deps.keyring, decryptSensitive: async (...args: Parameters<typeof decrypt>) => {
      const value = await decrypt(...args);
      if (!changed && args[0] === "login-code") {
        changed = true;
        if (change === "suspended") h.db.sqlite.prepare("UPDATE bot_connections SET state='SUSPENDED' WHERE id='bot-0'").run();
        if (change === "reassigned") h.db.sqlite.prepare("UPDATE bot_connections SET user_id='foreign' WHERE id='bot-0'").run();
        if (change === "chat-changed") h.db.sqlite.prepare("UPDATE chat_identities SET private_chat_id='replacement-chat' WHERE connection_id='bot-0'").run();
        if (change === "identity-replaced") h.db.sqlite.prepare("UPDATE chat_identities SET id='replacement-identity' WHERE connection_id='bot-0'").run();
        if (change === "credential-changed") h.db.sqlite.prepare("UPDATE bot_connections SET encrypted_token=X'01' WHERE id='bot-0'").run();
        if (change === "unbound") h.db.sqlite.prepare("UPDATE bot_connections SET state='ACTIVE_UNBOUND' WHERE id='bot-0'").run();
        if (change === "marker-changed") h.db.sqlite.prepare("UPDATE bot_connections SET transition_marker='replacement-marker' WHERE id='bot-0'").run();
        if (change === "provider-user-changed") h.db.sqlite.prepare("UPDATE chat_identities SET provider_user_id='replacement-provider-user' WHERE connection_id='bot-0'").run();
        if (change === "linked-at-changed") h.db.sqlite.prepare("UPDATE chat_identities SET linked_at=linked_at+1 WHERE connection_id='bot-0'").run();
        if (change === "version-changed") h.db.sqlite.prepare("UPDATE bot_connections SET credential_version=credential_version+1 WHERE id='bot-0'").run();
        if (change === "iv-changed") h.db.sqlite.prepare("UPDATE bot_connections SET encrypted_token_iv=X'000000000000000000000000' WHERE id='bot-0'").run();
        if (change === "provider-changed") h.db.sqlite.prepare("UPDATE bot_connections SET provider='zalo' WHERE id='bot-0'").run();
      }
      return value;
    }};
    await expect(verifyLoginCode(email,suppliedCode,{...h.deps,keyring})).rejects.toMatchObject({code:"INVALID_LOGIN_CODE"});
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({count:0});
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='LOGIN_VERIFIED'").get()).toEqual({count:0});
    expect(h.db.sqlite.prepare("SELECT consumed_at FROM login_codes").get()).toEqual({consumed_at:null});
  });
  it("rejects proof when private binding was removed before lookup", async () => {
    const h = await setup(1);await h.issue();const suppliedCode=await h.code();
    h.db.sqlite.prepare("DELETE FROM chat_identities WHERE connection_id='bot-0'").run();
    await expect(verifyLoginCode(email,suppliedCode,h.deps)).rejects.toMatchObject({code:"INVALID_LOGIN_CODE"});
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({count:0});
  });
  it.each(["null-channel","foreign-session"])("rejects a direct verification commit with %s", async invalid => {
    const h = await setup(1);await h.issue();
    const challenge = await h.deps.store.findVerifiable(email,now);
    if (!challenge) throw new Error("Expected synthetic challenge");
    const session = await prepareSession(invalid === "foreign-session" ? "foreign" : "owner",h.deps);
    const result = await h.deps.store.commitCorrectVerification(invalid === "null-channel" ? {...challenge,channel:null} : challenge,"synthetic-marker",session.record,"synthetic-audit",now);
    expect(result).toBe(false);
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({count:0});
    expect(h.db.sqlite.prepare("SELECT consumed_at FROM login_codes").get()).toEqual({consumed_at:null});
  });
  it.each(["state","owner","chat","credential","identity","marker"])("invalidates proof after post-issuance %s ABA before lookup", async field => {
    const h = await setup(1);await h.issue();const suppliedCode=await h.code();
    if (field === "state") h.db.sqlite.exec("UPDATE bot_connections SET state='SUSPENDED' WHERE id='bot-0'; UPDATE bot_connections SET state='ACTIVE_BOUND' WHERE id='bot-0'");
    if (field === "owner") h.db.sqlite.exec("UPDATE bot_connections SET user_id='foreign' WHERE id='bot-0'; UPDATE bot_connections SET user_id='owner' WHERE id='bot-0'");
    if (field === "chat") h.db.sqlite.exec("UPDATE chat_identities SET private_chat_id='ABA' WHERE connection_id='bot-0'; UPDATE chat_identities SET private_chat_id='chat-bot-0' WHERE connection_id='bot-0'");
    if (field === "identity") h.db.sqlite.exec("UPDATE chat_identities SET id='ABA' WHERE connection_id='bot-0'; UPDATE chat_identities SET id='identity-bot-0' WHERE connection_id='bot-0'");
    if (field === "marker") h.db.sqlite.exec("UPDATE bot_connections SET transition_marker='ABA' WHERE id='bot-0'; UPDATE bot_connections SET transition_marker='synthetic-marker' WHERE id='bot-0'");
    if (field === "credential") {
      const value=h.db.sqlite.prepare("SELECT encrypted_token FROM bot_connections WHERE id='bot-0'").get()!.encrypted_token;
      h.db.sqlite.exec("UPDATE bot_connections SET encrypted_token=X'01' WHERE id='bot-0'");
      h.db.sqlite.prepare("UPDATE bot_connections SET encrypted_token=? WHERE id='bot-0'").run(value as Uint8Array);
    }
    await expect(verifyLoginCode(email,suppliedCode,h.deps)).rejects.toMatchObject({code:"INVALID_LOGIN_CODE"});
    const sendText=vi.fn(async()=>({providerMessageId:null}));await deliverLoginCode(h.jobs[0].loginCodeId,{...h.deps,sendText});expect(sendText).not.toHaveBeenCalled();
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({count:0});
  });
  it("shows why disabling the last login channel needs a product guard", async () => {
    const h = await setup(1);
    h.db.sqlite.prepare("UPDATE bot_connections SET state='SUSPENDED' WHERE id='bot-0'").run();await h.issue();
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM login_codes").get()).toEqual({count:0});
    await h.bind("replacement");await h.issue();
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM login_codes").get()).toEqual({count:0});
    expect((await h.channelRequest("replacement")).status).toBe(200);
    await h.issue();expect(h.db.sqlite.prepare("SELECT connection_id FROM login_codes").get()).toEqual({connection_id:"replacement"});
  });
});


describe("authenticated primary login channel selection", () => {
  it("selects a verified owned alternate without changing pre-auth login payload", async () => {
    const h=await setup(2);await h.issue();const stale=await h.code();
    expect((await h.channelRequest("bot-1")).status).toBe(200);
    await expect(verifyLoginCode(email,stale,h.deps)).rejects.toMatchObject({code:"INVALID_LOGIN_CODE"});
    await h.issue();expect(h.db.sqlite.prepare("SELECT connection_id FROM login_codes WHERE consumed_at IS NULL").get()).toEqual({connection_id:"bot-1"});
    expect((await h.channelRequest(null)).status).toBe(200);
  });
  it("keeps old proof invalid after primary A to B to A", async () => {
    const h=await setup(2);await h.issue();const stale=await h.code();
    expect((await h.channelRequest("bot-1")).status).toBe(200);expect((await h.channelRequest("bot-0")).status).toBe(200);
    await expect(verifyLoginCode(email,stale,h.deps)).rejects.toMatchObject({code:"INVALID_LOGIN_CODE"});
  });
  it("requires a canonical session and same origin", async () => {
    const h=await setup(2);
    expect((await h.channelRequest("bot-1","owner",origin,false)).status).toBe(401);
    expect((await h.channelRequest("bot-1","owner","https://foreign.example")).status).toBe(403);
  });
  it("makes foreign and missing channels indistinguishable", async () => {
    const h=await setup(1);await h.bind("foreign-bot","foreign");
    const foreign=await h.channelRequest("foreign-bot"),missing=await h.channelRequest("missing");
    expect(foreign.status).toBe(404);expect(missing.status).toBe(404);expect(await foreign.json()).toEqual(await missing.json());
  });
  it("rejects disabled or unbound targets without selecting them", async () => {
    const h=await setup(2);
    for (const state of ["SUSPENDED","ACTIVE_UNBOUND"]) {
      h.db.sqlite.prepare("UPDATE bot_connections SET state=? WHERE id='bot-1'").run(state);
      expect((await h.channelRequest("bot-1")).status).toBe(409);
    }
    expect(h.db.sqlite.prepare("SELECT connection_id FROM primary_login_channels WHERE user_id='owner'").get()).toEqual({connection_id:"bot-0"});
  });
  it("limits channel selection per authenticated owner", async () => {
    const h=await setup(2);
    for(const id of ["bot-1","bot-0","bot-1"]) expect((await h.channelRequest(id)).status).toBe(200);
    expect((await h.channelRequest("bot-0")).status).toBe(429);
  });
  it("does not revive old proof when primary row is deleted and recreated", async () => {
    const h=await setup(1);await h.issue();const stale=await h.code();
    h.db.sqlite.exec("DELETE FROM primary_login_channels WHERE user_id='owner'");
    expect((await h.channelRequest("bot-0")).status).toBe(200);
    await expect(verifyLoginCode(email,stale,h.deps)).rejects.toMatchObject({code:"INVALID_LOGIN_CODE"});
  });
});


describe("primary login migration and selection transactions", () => {
  it.each([0,1,2])("backfills only exact-one eligible legacy owner with %i bots", async count => {
    const h=await setup(count,true);h.db.sqlite.exec(readFileSync("migrations/0010_primary_login_provenance.sql","utf8"));h.db.sqlite.exec(readFileSync("migrations/0011_connection_pause.sql","utf8"));
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM primary_login_channels WHERE user_id='owner'").get()).toEqual({count:count===1?1:0});
    if(count===2) {expect((await h.channelRequest("bot-1")).status).toBe(200);await h.issue();expect(h.db.sqlite.prepare("SELECT connection_id FROM login_codes").get()).toEqual({connection_id:"bot-1"});}
  });
  it.each(["third-binding","recovery"])("keeps unresolved legacy multi-bot primary unset after %s", async operation => {
    const h=await setup(2,true);h.db.sqlite.exec(readFileSync("migrations/0010_primary_login_provenance.sql","utf8"));h.db.sqlite.exec(readFileSync("migrations/0011_connection_pause.sql","utf8"));
    if(operation==="third-binding")await h.bind("bot-third");
    else h.db.sqlite.exec("UPDATE bot_connections SET state='SUSPENDED' WHERE id='bot-0'; UPDATE bot_connections SET state='ACTIVE_BOUND' WHERE id='bot-0'");
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM primary_login_channels WHERE user_id='owner'").get()).toEqual({count:0});
  });
  it("rejects migrated legacy proof with NULL issuance provenance before egress", async () => {
    const h=await setup(1,true);const encrypted=await h.deps.keyring.encryptSensitive("login-code","legacy-proof",1,"123456");
    h.db.sqlite.prepare("INSERT INTO login_codes(id,user_id,connection_id,code_ciphertext,code_iv,code_key_version,expires_at,delivery_status,created_at,updated_at) VALUES ('legacy-proof','owner','bot-0',?,?,1,?,'PENDING',?,?)").run(new Uint8Array(encrypted.ciphertext),new Uint8Array(encrypted.iv),now+600000,now,now);
    h.db.sqlite.exec(readFileSync("migrations/0010_primary_login_provenance.sql","utf8"));h.db.sqlite.exec(readFileSync("migrations/0011_connection_pause.sql","utf8"));
    await expect(verifyLoginCode(email,"123456",h.deps)).rejects.toMatchObject({code:"INVALID_LOGIN_CODE"});
    const sendText=vi.fn(async()=>({providerMessageId:null}));await deliverLoginCode("legacy-proof",{...h.deps,sendText});expect(sendText).not.toHaveBeenCalled();
  });
  it("rolls back selection and proof invalidation if audit fails", async () => {
    const h=await setup(2);await h.issue();
    const before=h.db.sqlite.prepare("SELECT * FROM primary_login_channels WHERE user_id='owner'").get();
    h.db.sqlite.exec("CREATE TRIGGER reject_primary_audit BEFORE INSERT ON audit_events WHEN NEW.action='LOGIN_CHANNEL_SELECTED' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
    expect((await h.channelRequest("bot-1")).status).toBe(500);
    expect(h.db.sqlite.prepare("SELECT * FROM primary_login_channels WHERE user_id='owner'").get()).toEqual(before);
    expect(h.db.sqlite.prepare("SELECT consumed_at FROM login_codes").get()).toEqual({consumed_at:null});
  });
  it("rejects a stale selection snapshot instead of last-writer overwrite", async () => {
    const h=await setup(2),store=new D1PrimaryLoginStore(h.db as unknown as D1Database);
    const expected=await store.snapshot("owner"),a=await store.candidate("owner",publicId("bot-0")),b=await store.candidate("owner",publicId("bot-1"));
    if(!a||!b) throw new Error("Missing synthetic candidates");
    expect(await store.select("owner",b,expected,"first-winner",now)).toBe(true);
    expect(await store.select("owner",a,expected,"stale-loser",now)).toBe(false);
    expect(h.db.sqlite.prepare("SELECT connection_id,marker FROM primary_login_channels WHERE user_id='owner'").get()).toEqual({connection_id:"bot-1",marker:"first-winner"});
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='LOGIN_CHANNEL_SELECTED'").get()).toEqual({count:1});
  });
  it("fences ABA after delivery snapshot and before send acquisition", async () => {
    const h=await setup(1);await h.issue();const snapshot=await h.deps.store.prepareDelivery(h.jobs[0].loginCodeId,now);
    if(snapshot.status!=="READY")throw new Error("Missing synthetic delivery");
    h.db.sqlite.exec("UPDATE chat_identities SET private_chat_id='ABA' WHERE connection_id='bot-0'; UPDATE chat_identities SET private_chat_id='chat-bot-0' WHERE connection_id='bot-0'");
    expect(await h.deps.store.acquireDelivery(snapshot.delivery,"stale-send",now)).not.toEqual({status:"OWNED"});
  });
});


describe("actual old auth source compatibility hazards", () => {
  it.each(["6329b33264a2916f004953865f6483fafdfd7491","ed37691bf5ff441453db04dacb2c1c41ac0ded1e"])("shows old %s auth ignores primary and writes proof without provenance", async revision => {
    const directory=mkdtempSync(join(tmpdir(),"calenote-old-auth-"));
    try {
      const source=execFileSync("git",["show",`${revision}:src/modules/auth/login-service.ts`],{encoding:"utf8"});
      const target=join(directory,"login-service.ts");writeFileSync(target,source);
      const legacy=await import(/* @vite-ignore */ target) as typeof import("./login-service");
      const h=await setup(2);
      h.db.sqlite.exec("UPDATE bot_connections SET state='SUSPENDED' WHERE id='bot-0'");
      const oldStore=new legacy.D1LoginCodeStore(h.db as unknown as D1Database);
      await legacy.requestLoginCode(email,{...h.deps,store:oldStore,enqueue:async()=>{}});
      expect(h.db.sqlite.prepare("SELECT connection_id,proof_auth_revision FROM login_codes").get()).toEqual({connection_id:"bot-1",proof_auth_revision:null});
      const suppliedCode=await h.code();
      await expect(verifyLoginCode(email,suppliedCode,h.deps)).rejects.toMatchObject({code:"INVALID_LOGIN_CODE"});
      expect((await legacy.verifyLoginCode(email,suppliedCode,{...h.deps,store:oldStore})).cookie).toContain("__Host-calenote_session=");
    } finally {rmSync(directory,{recursive:true,force:true});}
  });
});
