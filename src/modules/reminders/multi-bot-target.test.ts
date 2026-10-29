// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { SqliteD1Database, deterministicRandomBytes } from "@/testing/sqlite-d1.test-support";
import { createKeyring } from "@/modules/security/keyring";
import { D1ReminderApiStore } from "./infrastructure/d1/api-store";
import { createManualReminder } from "./api-service";
import { D1SourceActionStore } from "@/modules/source-actions/infrastructure/d1/store";
import { approveActionCandidate, createReminderActionCandidate } from "@/modules/source-actions/service";
const now=1_800_000_000_000;
const databases:SqliteD1Database[]=[];
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
const publicId=(id:string)=>Buffer.from(id.padEnd(16,"!").slice(0,16)).toString("base64url");
async function setup(count=2){
  const db=new SqliteD1Database();databases.push(db);const keyring=await createKeyring("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  db.sqlite.exec("INSERT INTO users VALUES ('owner','owner@example.invalid','Owner','Asia/Ho_Chi_Minh',1,1),('foreign','foreign@example.invalid','Foreign','Asia/Ho_Chi_Minh',1,1);INSERT INTO workspaces VALUES ('workspace','owner','PERSONAL',1,1);INSERT INTO memberships VALUES ('workspace','owner','OWNER',1)");
  for(const id of ["a",...(count===2?["b"]:[]),"foreign"]){
    const token=await keyring.encryptCredential(id,"telegram",1,"12345678:synthetic-multi-bot-target");
    db.sqlite.prepare(`INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at)
      VALUES (?,?,'telegram',?,?,?, ?,?,?,1,'ACTIVE_BOUND',1,1)`).run(id,id==="foreign"?"foreign":"owner",publicId(id),id,id,new Uint8Array(token.ciphertext),new Uint8Array(token.iv),id);
    db.sqlite.prepare("INSERT INTO chat_identities VALUES (?,?,?,?,NULL,1)").run(`identity-${id}`,id,`user-${id}`,`chat-${id}`);
  }
  db.sqlite.exec("INSERT INTO source_connections VALUES ('source','workspace','fixture','account','Source','ACTIVE',1,1);INSERT INTO source_items VALUES ('item','source','workspace','external','EVENT',1,1)");
  const common={keyring,now:()=>now,randomBytes:deterministicRandomBytes()};
  const manualDeps={...common,store:new D1ReminderApiStore(db as unknown as D1Database),rateLimitStore:{consume:async()=>({allowed:true,resetAt:now+60_000})}};
  const actionDeps={...common,store:new D1SourceActionStore(db as unknown as D1Database)};
  const candidate=await createReminderActionCandidate({sourceItemId:"item",workspaceId:"workspace",title:"Synthetic",scheduledAt:now+60_000,timezone:"Asia/Ho_Chi_Minh"},actionDeps);
  const manual=(target?:string)=>createManualReminder({userId:"owner",title:"Synthetic",scheduledAt:now+60_000,timezone:"Asia/Ho_Chi_Minh",...(target===undefined?{}:{connectionPublicId:publicId(target)})},manualDeps);
  const approve=(target?:string)=>approveActionCandidate({userId:"owner",candidateId:candidate.id,...(target===undefined?{}:{connectionPublicId:publicId(target)})},actionDeps);
  return {db,manual,approve};
}
describe("explicit owned delivery target for multi-bot accounts",()=>{
  it.each(["manual","approve"] as const)("%s selects the explicit second Telegram bot without changing login primary",async method=>{
    const h=await setup();expect(await h[method]("b")).toEqual(method==="manual"?expect.objectContaining({status:"PENDING"}):expect.objectContaining({status:"APPROVED"}));
    expect(h.db.sqlite.prepare("SELECT chat_identity_id FROM reminders").get()).toEqual({chat_identity_id:"identity-b"});
    expect(h.db.sqlite.prepare("SELECT connection_id FROM primary_login_channels WHERE user_id='owner'").get()).toEqual({connection_id:"a"});
  });
  it.each(["manual","approve"] as const)("%s preserves the single-bot omitted-target contract",async method=>{
    const h=await setup(1);await h[method]();expect(h.db.sqlite.prepare("SELECT chat_identity_id FROM reminders").get()).toEqual({chat_identity_id:"identity-a"});
  });
  it.each(["missing","foreign","paused","unbound","no-identity","ambiguous"])("rejects %s without a reminder or decision",async kind=>{
    const h=await setup();let target:string|undefined="b";
    if(kind==="missing"||kind==="foreign") target=kind;
    if(kind==="paused") h.db.sqlite.exec("UPDATE bot_connections SET processing_paused=1 WHERE id='b'");
    if(kind==="unbound") h.db.sqlite.exec("UPDATE bot_connections SET state='ACTIVE_UNBOUND' WHERE id='b'");
    if(kind==="no-identity") h.db.sqlite.exec("DELETE FROM chat_identities WHERE connection_id='b'");
    if(kind==="ambiguous") target=undefined;
    await expect(h.manual(target)).rejects.toMatchObject({code:"REMINDER_CHANNEL_UNAVAILABLE"});
    expect(await h.approve(target)).toEqual({status:"CHANNEL_UNAVAILABLE"});
    expect(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM reminders").get()).toEqual({n:0});expect(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM action_decisions").get()).toEqual({n:0});
  });
});
