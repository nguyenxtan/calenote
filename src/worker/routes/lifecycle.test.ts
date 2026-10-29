// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteD1Database } from "@/testing/sqlite-d1.test-support";
import { createKeyring } from "@/modules/security/keyring";
import { prepareSession } from "@/modules/auth/session";
import { D1ConnectionLifecycleStore } from "@/modules/connections/lifecycle/store";
import { createRouter } from "@/worker/router";
const origin="https://calenote.iconiclogs.com";
const master="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ids={a:Buffer.from("a".repeat(16)).toString("base64url"),b:Buffer.from("b".repeat(16)).toString("base64url"),foreign:Buffer.from("f".repeat(16)).toString("base64url"),missing:Buffer.from("m".repeat(16)).toString("base64url")};
const databases:SqliteD1Database[]=[];
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
async function setup(){
  const db=new SqliteD1Database();databases.push(db);const keyring=await createKeyring(master);const now=Date.now();
  for(const user of ["owner","other"]) db.sqlite.prepare("INSERT INTO users VALUES (?,?,?,'Asia/Ho_Chi_Minh',?,?)").run(user,`${user}@example.invalid`,user,now,now);
  for(const id of ["a","b","foreign"] as const){
    db.sqlite.prepare(`INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at)
      VALUES (?,?,'telegram',?,?,?,x'01',zeroblob(12),?,1,'ACTIVE_BOUND',?,?)`).run(id,id==="foreign"?"other":"owner",ids[id],id,id,id,now,now);
    db.sqlite.prepare("INSERT INTO chat_identities VALUES (?,?,?,?,NULL,?)").run(`identity-${id}`,id,`user-${id}`,`chat-${id}`,now);
  }
  const session=await prepareSession("owner",{keyring,now:()=>now});
  db.sqlite.prepare("INSERT INTO sessions VALUES (?,?,?,?,NULL,?)").run(session.record.id,"owner",session.record.digest,session.record.expiresAt,now);
  const cookie=session.cookie.split(";")[0];const router=createRouter();
  const env={APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:"production",CALENOTE_MASTER_KEY:master,DB:db,JOBS:{send:vi.fn()},ASSETS:{fetch:vi.fn()}} as unknown as Env;
  const store=new D1ConnectionLifecycleStore(db as unknown as D1Database);
  const run=async(target:keyof typeof ids,action="lifecycle",body?:unknown,authenticated=true,requestOrigin=origin)=>router(new Request(`${origin}/api/connections/${ids[target]}/${action}`,{
    method:action==="lifecycle"?"GET":"POST",headers:{origin:requestOrigin,"content-type":"application/json",...(authenticated?{cookie}:{})},...(action!=="lifecycle"?{body:JSON.stringify(body)}:{}),
  }),env,{} as ExecutionContext);
  return {db,store,run,env};
}
describe("authenticated lifecycle route contract",()=>{
  it("returns only owner-scoped lifecycle metadata",async()=>{
    const h=await setup();const result=await h.run("b");expect(result.status).toBe(200);
    const body=await result.json() as {data:{lifecycle:unknown}};expect(body.data.lifecycle).toEqual(expect.objectContaining({publicId:ids.b,paused:false,state:"ACTIVE_BOUND",cas:{authRevision:1,primary:{revision:1,generation:expect.stringMatching(/^[a-f0-9]{32}$/u)}}}));
    expect(JSON.stringify(body)).not.toMatch(/encrypted|token|credential|email|private_chat/u);
    expect(result.headers.get("vary")).toBe("Cookie");
  });
  it.each(["lifecycle","pause","resume"])("requires canonical session for %s",async action=>{
    const h=await setup();expect((await h.run("b",action,{},false)).status).toBe(401);
  });
  it("returns identical missing/foreign safe errors",async()=>{
    const h=await setup();const missing=await h.run("missing");const foreign=await h.run("foreign");expect(missing.status).toBe(404);expect(foreign.status).toBe(404);expect(await missing.json()).toEqual(await foreign.json());
  });
  it("requires same origin and exact client CAS body",async()=>{
    const h=await setup();const cas=(await h.store.get("owner",ids.b))!.cas;
    expect((await h.run("b","pause",cas,true,"https://foreign.invalid")).status).toBe(403);
    expect((await h.run("b","pause",{})).status).toBe(400);expect((await h.run("b","pause",{...cas,token:"synthetic"})).status).toBe(400);
    expect((await h.run("b","pause",{...cas,primary:{revision:1,generation:"invalid"}})).status).toBe(400);
  });
  it("blocks selected primary, pauses alternate, rejects stale resume, and resumes fresh CAS",async()=>{
    const h=await setup();const a=(await h.store.get("owner",ids.a))!.cas;const b=(await h.store.get("owner",ids.b))!.cas;
    expect((await h.run("a","pause",a)).status).toBe(409);expect((await h.run("b","pause",b)).status).toBe(200);
    expect((await h.run("b","resume",b)).status).toBe(409);
    const fresh=(await h.store.get("owner",ids.b))!;expect(fresh.paused).toBe(true);
    expect((await h.run("b","resume",fresh.cas)).status).toBe(200);
    expect((await h.store.get("owner",ids.b))!.paused).toBe(false);expect(h.env.JOBS.send).not.toHaveBeenCalled();
  });
});
