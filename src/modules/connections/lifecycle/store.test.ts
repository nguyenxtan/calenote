// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { SqliteD1Database } from "@/testing/sqlite-d1.test-support";
import { D1ConnectionLifecycleStore } from "./store";
import { D1InboundEgressStore } from "./egress-store";
import { D1PrimaryLoginStore } from "@/modules/auth/primary-login";
import { D1InboundDispatchStore } from "@/modules/reminders/scheduler";
import { D1ReminderSchedulerStore } from "@/modules/reminders/infrastructure/d1/scheduler-store";
import { D1ReminderDeliveryStore } from "@/modules/reminders/infrastructure/d1/delivery-store";
import { D1InboundWebhookStore, acceptWebhookMessage } from "@/modules/inbound/webhook";
import type { ClaimedInboundMessage } from "@/modules/inbound/processor";

const databases: SqliteD1Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function setup() {
  const db = new SqliteD1Database(); databases.push(db);
  db.sqlite.exec(`INSERT INTO users VALUES ('owner','owner@example.invalid','Owner','Asia/Ho_Chi_Minh',1,1),('other','other@example.invalid','Other','Asia/Ho_Chi_Minh',1,1);
    INSERT INTO workspaces VALUES ('workspace','owner','PERSONAL',1,1);
    INSERT INTO memberships VALUES ('workspace','owner','OWNER',1);`);
  for (const [id,owner] of [["a","owner"],["b","owner"],["foreign","other"]]) {
    db.sqlite.prepare(`INSERT INTO bot_connections (id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at)
      VALUES (?,?,'telegram',?,?,?,x'0102',zeroblob(12),?,1,'ACTIVE_BOUND',1,1)`).run(id,owner,id,id,id,id);
    db.sqlite.prepare("INSERT INTO chat_identities VALUES (?,?,?,?,NULL,1)").run(`chat-${id}`,id,`user-${id}`,`private-${id}`);
  }
  const store = new D1ConnectionLifecycleStore(db as unknown as D1Database);
  async function change(id: string, paused: boolean, marker = `${id}-${paused}`) {
    const snapshot = (await store.get("owner", id))!;
    return store.change({ userId:"owner", publicId:id, paused, expected:snapshot.cas, marker, now:100 });
  }
  function reminder(id: string, scheduled: number, connection = "b", status = "PENDING") {
    db.sqlite.prepare(`INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at)
      VALUES (?,?,'workspace',?,x'01',zeroblob(12),1,?,'Asia/Ho_Chi_Minh',?,1,1)`).run(id,id,`chat-${connection}`,scheduled,status);
  }
  function inbound(id: string, connection = "b") {
    db.sqlite.prepare(`INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at)
      VALUES (?,?,'telegram',?,?,?,x'01',zeroblob(12),1,'PENDING',1)`).run(id,connection,id,`user-${connection}`,`private-${connection}`);
  }
  return { db, store, change, reminder, inbound };
}

function egressMessage(h:ReturnType<typeof setup>):ClaimedInboundMessage {
  return {id:"old",connectionId:"b",connectionUserId:"owner",connectionState:"ACTIVE_BOUND",provider:"telegram",providerMessageId:"old",providerUserId:"user-b",privateChatId:"private-b",displayName:null,text:"synthetic",receivedAt:1,processingStartedAt:1,attemptCount:1,claimMarker:"claim",encryptedToken:new Uint8Array([1,2]).buffer,encryptedTokenIv:new Uint8Array(12).buffer,credentialVersion:1,authRevision:h.db.sqlite.prepare("SELECT auth_revision FROM bot_connections WHERE id='b'").get()!.auth_revision as number};
}

describe("pause dispatch and egress boundaries",()=>{
  it("rejects paused primary selection before transaction mutation",async()=>{
    const h=setup();expect(await h.change("b",true)).toBe(true);
    const primary=new D1PrimaryLoginStore(h.db as unknown as D1Database);
    expect((await primary.candidate("owner","b"))!.hasIdentity).toBe(false);
    expect(await primary.select("owner",(await primary.candidate("owner","b"))!,await primary.snapshot("owner"),"selection",101)).toBe(false);
  });
  it("serializes primary selection against stale pause",async()=>{
    const h=setup();const snapshot=(await h.store.get("owner","b"))!;
    const primary=new D1PrimaryLoginStore(h.db as unknown as D1Database);
    expect(await primary.select("owner",(await primary.candidate("owner","b"))!,await primary.snapshot("owner"),"selection",99)).toBe(true);
    expect(await h.store.change({userId:"owner",publicId:"b",paused:true,expected:snapshot.cas,marker:"pause",now:100})).toBe(false);
  });
  it("never dispatches held inbound after resume",async()=>{
    const h=setup();h.inbound("old");const dispatch=new D1InboundDispatchStore(h.db as unknown as D1Database);
    expect(await h.change("b",true)).toBe(true);expect(await h.change("b",false)).toBe(true);
    expect(await dispatch.selectOrphans(200,10)).toEqual([]);expect(await dispatch.reserve("old",200,"dispatch")).toEqual({status:"TERMINAL"});
  });
  it("fences stale reminder claim and acquisition and keeps overdue work held",async()=>{
    const h=setup();h.reminder("due",50);const scheduler=new D1ReminderSchedulerStore(h.db as unknown as D1Database);
    const [candidate]=await scheduler.selectCandidates(100,10);
    expect(await h.change("b",true)).toBe(true);expect(await scheduler.claim(candidate,100,"claim")).toBeNull();
    const delivery=new D1ReminderDeliveryStore(h.db as unknown as D1Database);
    h.db.sqlite.exec("UPDATE reminders SET status='CLAIMED' WHERE id='due'");
    expect(await delivery.acquire("due","d","send",100)).toEqual({status:"NOOP"});
    expect(await h.change("b",false)).toBe(true);expect(await scheduler.selectCandidates(200,10)).toEqual([]);
  });
  it("admission racing pause persists no message and sends no queue job",async()=>{
    const h=setup();const webhook=new D1InboundWebhookStore(h.db as unknown as D1Database);const connection=(await webhook.findConnection("telegram","b"))!;
    expect(await h.change("b",true)).toBe(true);let queued=0;
    const result=await acceptWebhookMessage({provider:"telegram",providerMessageId:"new",providerUserId:"user-b",privateChatId:"private-b",displayName:null,text:"synthetic content",receivedAt:100},connection,{
      store:webhook,dispatchStore:new D1InboundDispatchStore(h.db as unknown as D1Database),enqueue:async()=>{queued++;},
      keyring:{encryptSensitive:async()=>({ciphertext:new Uint8Array([1]).buffer,iv:new Uint8Array(12).buffer})},now:()=>100,
    });
    expect(result).toEqual({status:204});expect(queued).toBe(0);expect(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM inbound_updates").get()).toEqual({n:0});
  });
  it.each(["REPLY","TYPING","SEMANTIC_FREE","SEMANTIC_PAID"] as const)("pause immediately before %s acquire blocks it, including after resume",async kind=>{
    const h=setup();h.inbound("old");h.db.sqlite.exec("UPDATE inbound_updates SET state='PROCESSING',transition_marker='claim' WHERE id='old'");const message=egressMessage(h);const egress=new D1InboundEgressStore(h.db as unknown as D1Database);
    expect(await h.change("b",true)).toBe(true);expect(await egress.acquire(message,kind,0,100)).toBe(false);
    expect(await h.change("b",false)).toBe(true);expect(await egress.acquire(message,kind,0,101)).toBe(false);
  });
  it("acquire before pause is in-flight, keeps its real outcome and cannot replay",async()=>{
    const h=setup();h.inbound("old");h.db.sqlite.exec("UPDATE inbound_updates SET state='PROCESSING',transition_marker='claim' WHERE id='old'");const message=egressMessage(h);const egress=new D1InboundEgressStore(h.db as unknown as D1Database);
    expect(await egress.acquire(message,"REPLY",0,99)).toBe(true);expect(await h.change("b",true)).toBe(true);
    expect((await h.store.get("owner","b"))!.inFlight.inbound).toBe(1);
    await egress.finalize("old","REPLY",0,"SENT",101);expect(await h.change("b",false)).toBe(true);
    expect(await egress.acquire(message,"REPLY",0,102)).toBe(false);expect(h.db.sqlite.prepare("SELECT status FROM inbound_egress").get()).toEqual({status:"SENT"});
  });
  it("permits distinct stable reply indexes but never repeats the same action",async()=>{
    const h=setup();h.inbound("old");h.db.sqlite.exec("UPDATE inbound_updates SET transition_marker='claim' WHERE id='old'");const message=egressMessage(h);const egress=new D1InboundEgressStore(h.db as unknown as D1Database);
    expect(await egress.acquire(message,"REPLY",0,99)).toBe(true);expect(await egress.acquire(message,"REPLY",0,99)).toBe(false);expect(await egress.acquire(message,"REPLY",1,99)).toBe(true);
    await egress.reconcile(500,100);expect(h.db.sqlite.prepare("SELECT status FROM inbound_egress").all()).toEqual([{status:"UNCERTAIN"},{status:"UNCERTAIN"}]);expect(await egress.acquire(message,"REPLY",1,501)).toBe(false);
  });
  it("rejects connection epoch ABA even with identical restored credential/chat",async()=>{
    const h=setup();h.inbound("old");h.db.sqlite.exec("UPDATE inbound_updates SET transition_marker='claim' WHERE id='old'");const message=egressMessage(h);
    h.db.sqlite.exec("UPDATE bot_connections SET encrypted_token=x'03' WHERE id='b';UPDATE bot_connections SET encrypted_token=x'0102' WHERE id='b'");
    expect(await new D1InboundEgressStore(h.db as unknown as D1Database).acquire(message,"REPLY",0,100)).toBe(false);
  });
});

describe("connection pause transaction contract", () => {
  it("does not disclose foreign or missing connection snapshots", async () => {
    const h=setup(); expect(await h.store.get("owner","foreign")).toBeNull(); expect(await h.store.get("owner","missing")).toBeNull();
  });
  it("refuses losing the selected primary even when another bot exists", async () => {
    const h=setup(); expect(await h.change("a",true)).toBe(false);
    expect(h.db.sqlite.prepare("SELECT processing_paused FROM bot_connections WHERE id='a'").get()).toEqual({processing_paused:0});
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events").get()).toEqual({n:0});
  });
  it("refuses an unresolved or invalid alternate primary", async () => {
    const h=setup(); h.db.sqlite.exec("DELETE FROM primary_login_channels WHERE user_id='owner'"); expect(await h.change("b",true)).toBe(false);
  });
  it("retains credentials, history and schedules while holding only this bot", async () => {
    const h=setup(); h.reminder("future",200); h.reminder("elapsed",50); h.reminder("other",50,"a"); h.inbound("old");
    const before=h.db.sqlite.prepare("SELECT encrypted_token,encrypted_token_iv FROM bot_connections WHERE id='b'").get();
    expect(await h.change("b",true)).toBe(true);
    expect(h.db.sqlite.prepare("SELECT encrypted_token,encrypted_token_iv FROM bot_connections WHERE id='b'").get()).toEqual(before);
    expect(h.db.sqlite.prepare("SELECT id,scheduled_at,status,lifecycle_hold FROM reminders ORDER BY id").all()).toEqual([
      {id:"elapsed",scheduled_at:50,status:"PENDING",lifecycle_hold:1},{id:"future",scheduled_at:200,status:"PENDING",lifecycle_hold:1},{id:"other",scheduled_at:50,status:"PENDING",lifecycle_hold:0},
    ]);
    expect(h.db.sqlite.prepare("SELECT lifecycle_hold FROM inbound_updates WHERE id='old'").get()).toEqual({lifecycle_hold:1});
  });
  it("resume opens future unsent work and never historical inbound or overdue work", async () => {
    const h=setup(); h.reminder("future",200); h.reminder("elapsed",100); h.inbound("old");
    expect(await h.change("b",true)).toBe(true); expect(await h.change("b",false)).toBe(true);
    expect(h.db.sqlite.prepare("SELECT id,lifecycle_hold FROM reminders ORDER BY id").all()).toEqual([{id:"elapsed",lifecycle_hold:1},{id:"future",lifecycle_hold:0}]);
    expect(h.db.sqlite.prepare("SELECT lifecycle_hold FROM inbound_updates").get()).toEqual({lifecycle_hold:1});
  });
  it("never rewrites sending, uncertain or terminal delivery outcomes", async () => {
    const h=setup(); h.reminder("sending",200,"b","CLAIMED"); h.reminder("uncertain",200,"b","UNCERTAIN");
    h.db.sqlite.exec("INSERT INTO reminder_deliveries(id,reminder_id,status,attempt_count,send_started_at,transition_marker,created_at,updated_at) VALUES ('d','sending','SENDING',1,1,'send',1,1)");
    expect(await h.change("b",true)).toBe(true); expect(await h.change("b",false)).toBe(true);
    expect(h.db.sqlite.prepare("SELECT status FROM reminder_deliveries").get()).toEqual({status:"SENDING"});
    expect(h.db.sqlite.prepare("SELECT id,status FROM reminders ORDER BY id").all()).toEqual([{id:"sending",status:"CLAIMED"},{id:"uncertain",status:"UNCERTAIN"}]);
  });
  it("holds a send acquired before pause even when it later becomes retryable",async()=>{
    const h=setup();h.reminder("sending",50,"b","CLAIMED");
    h.db.sqlite.exec("INSERT INTO reminder_deliveries(id,reminder_id,status,attempt_count,send_started_at,transition_marker,created_at,updated_at) VALUES ('d','sending','SENDING',1,1,'send',1,1)");
    expect(await h.change("b",true)).toBe(true);
    h.db.sqlite.exec("UPDATE reminder_deliveries SET status='RETRYABLE',retry_not_before=101 WHERE id='d';UPDATE reminders SET status='RETRYABLE' WHERE id='sending'");
    expect(await h.change("b",false)).toBe(true);
    expect(await new D1ReminderSchedulerStore(h.db as unknown as D1Database).selectCandidates(200,10)).toEqual([]);
    expect(h.db.sqlite.prepare("SELECT status,lifecycle_hold FROM reminders").get()).toEqual({status:"RETRYABLE",lifecycle_hold:1});
  });
  it("unpauses a connection suspended by an in-flight rejection without activation or job release",async()=>{
    const h=setup();h.reminder("future",200);expect(await h.change("b",true)).toBe(true);
    h.db.sqlite.exec("UPDATE bot_connections SET state='SUSPENDED' WHERE id='b'");
    expect(await h.change("b",false)).toBe(true);
    expect(h.db.sqlite.prepare("SELECT state,processing_paused FROM bot_connections WHERE id='b'").get()).toEqual({state:"SUSPENDED",processing_paused:0});
    expect(h.db.sqlite.prepare("SELECT lifecycle_hold FROM reminders").get()).toEqual({lifecycle_hold:1});
  });
  it.each(["connection","primary","generation"])("rejects stale %s CAS with no partial holds/audit", async field => {
    const h=setup(); h.reminder("future",200); const snapshot=(await h.store.get("owner","b"))!;
    if(field==="connection") h.db.sqlite.exec("UPDATE bot_connections SET transition_marker='changed' WHERE id='b'");
    if(field==="primary") h.db.sqlite.exec("UPDATE primary_login_channels SET revision=revision+1 WHERE user_id='owner'");
    if(field==="generation") h.db.sqlite.exec("UPDATE primary_login_channels SET generation='new' WHERE user_id='owner'");
    expect(await h.store.change({userId:"owner",publicId:"b",paused:true,expected:snapshot.cas,marker:"stale",now:100})).toBe(false);
    expect(h.db.sqlite.prepare("SELECT lifecycle_hold FROM reminders").get()).toEqual({lifecycle_hold:0});
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events").get()).toEqual({n:0});
  });
  it("audit failure rolls back pause and job holds", async () => {
    const h=setup(); h.reminder("future",200);
    h.db.sqlite.exec("CREATE TRIGGER deny_pause_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
    await expect(h.change("b",true)).rejects.toThrow("synthetic audit failure");
    expect(h.db.sqlite.prepare("SELECT processing_paused FROM bot_connections WHERE id='b'").get()).toEqual({processing_paused:0});
    expect(h.db.sqlite.prepare("SELECT lifecycle_hold FROM reminders").get()).toEqual({lifecycle_hold:0});
  });
});
