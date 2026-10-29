// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createKeyring } from "@/modules/security/keyring";
import { prepareSession } from "@/modules/auth/session";
import { createRouter } from "@/worker/router";
import { createRuntimeOperations } from "@/worker/composition-root";
import { D1InboundWebhookStore, acceptWebhookMessage } from "@/modules/inbound/webhook";
import { D1InboundDispatchStore } from "@/modules/reminders/scheduler";
import { createReminderActionCandidate } from "@/modules/source-actions/service";
import { D1SourceActionStore } from "@/modules/source-actions/infrastructure/d1/store";
import { persistedD1Blob } from "@/modules/db/persisted-blob";

const runtimes:Miniflare[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(runtimes.splice(0).map(runtime=>runtime.dispose()));});
const origin="https://calenote.iconiclogs.com";
const master="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const originalPublicId=Buffer.from("a".repeat(16)).toString("base64url");
const token="12345678:synthetic-independent-telegram-token";

it("runs authenticated two-Telegram add/bind/primary/manual/action/queue flows on real D1 without semantic 0009",async()=>{
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:"export default {fetch(){return new Response('fixture')}}",compatibilityDate:"2026-09-03",d1Databases:{DB:"00000000-0000-0000-0000-000000000015"},port:0}));runtimes.push(runtime);
  const db=await runtime.getD1Database("DB") as unknown as D1Database;
  const migrations=["0001_production_mvp","0002_onboarding_transition_marker","0003_source_action_foundation","0004_user_preferences","0005_semantic_context_and_budget","0006_semantic_budget_dispatch_fence","0007_conversation_context_v2","0008_finite_reminder_series","0010_primary_login_provenance","0011_connection_pause"];
  for(const migration of migrations){
    const sql=readFileSync(`migrations/${migration}.sql`,"utf8");
    for(const statement of sql.split(sql.includes("-- statement-breakpoint")?"-- statement-breakpoint":migration.startsWith("0008")?/;\s*(?=CREATE|--|$)/u:";").map(part=>part.replace(/^--.*$/gm,"").trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  expect(migrations.some(name=>name.startsWith("0009"))).toBe(false);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  const now=Date.now();const keyring=await createKeyring(master);
  const encrypted=await keyring.encryptCredential("original","telegram",1,"12345678:synthetic-original-telegram-token");
  await db.batch([
    db.prepare("INSERT INTO users VALUES ('owner','owner@example.invalid','Owner','Asia/Ho_Chi_Minh',?,?)").bind(now,now),
    db.prepare("INSERT INTO workspaces VALUES ('workspace','owner','PERSONAL',?,?)").bind(now,now),
    db.prepare("INSERT INTO memberships VALUES ('workspace','owner','OWNER',?)").bind(now),
    db.prepare("INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES ('original','owner','telegram',?,'original-bot','Original',?,?,'original-fingerprint',1,'ACTIVE_BOUND',?,?)").bind(originalPublicId,encrypted.ciphertext,encrypted.iv,now,now),
    db.prepare("INSERT INTO chat_identities VALUES ('original-identity','original','original-user','original-chat',NULL,?)").bind(now),
  ]);
  const session=await prepareSession("owner",{keyring,now:()=>now});
  await db.prepare("INSERT INTO sessions VALUES (?,?,?,?,NULL,?)").bind(session.record.id,"owner",session.record.digest,session.record.expiresAt,now).run();
  const operations:string[]=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
    const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
    if(url.hostname!=="api.telegram.org") throw new Error("Unexpected external transport");
    const operation=url.pathname.split("/").at(-1)!;operations.push(operation);
    if(operation==="getMe") return Response.json({ok:true,result:{id:200,is_bot:true,first_name:"Synthetic second bot",username:"synthetic_second_bot"}});
    if(operation==="setWebhook") return Response.json({ok:true,result:true});
    if(operation==="sendMessage") return Response.json({ok:true,result:{message_id:123}});
    throw new Error("Unexpected provider operation");
  });
  const jobs:unknown[]=[];
  const env={APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:"production",CALENOTE_MASTER_KEY:master,AI_MODE:"off",DB:db,JOBS:{send:async(job:unknown)=>{jobs.push(job);}},ASSETS:{fetch:vi.fn()}} as unknown as Env;
  const router=createRouter();const cookie=session.cookie.split(";")[0];
  const request=(path:string,body?:unknown,authenticated=true)=>router(new Request(`${origin}${path}`,{method:body===undefined?"GET":"POST",headers:{origin,"content-type":"application/json","CF-Connecting-IP":"192.0.2.1",...(authenticated?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{} as ExecutionContext);
  expect((await request("/api/connections",{provider:"telegram",token},false)).status).toBe(401);expect(operations).toEqual([]);
  const added=await request("/api/connections",{provider:"telegram",token});expect(added.status).toBe(201);
  const payload=await added.json() as {data:{bot:{publicId:string;state:string};connectCommand:string}};
  const target=payload.data.bot.publicId;expect(payload.data.bot.state).toBe("ACTIVE_UNBOUND");expect(added.headers.get("set-cookie")).toBeNull();
  expect(await db.prepare("SELECT COUNT(*) AS n FROM users").first()).toEqual({n:1});expect(await db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL").first()).toEqual({n:1});
  expect((await request("/api/connections",{provider:"telegram",token})).status).toBe(409);expect(operations.filter(op=>op==="setWebhook")).toHaveLength(1);
  const webhook=new D1InboundWebhookStore(db);const connection=(await webhook.findConnection("telegram",target))!;
  await acceptWebhookMessage({provider:"telegram",providerMessageId:"connect-message",providerUserId:"second-user",privateChatId:"second-chat",displayName:null,text:payload.data.connectCommand,receivedAt:now},connection,{store:webhook,dispatchStore:new D1InboundDispatchStore(db),enqueue:async job=>{jobs.push(job);},keyring,now:()=>now});
  const inbound=await db.prepare("SELECT id FROM inbound_updates WHERE connection_id=?").bind(connection.id).first<{id:string}>();
  const worker=await createRuntimeOperations(env,{conversationV2:true});expect(await worker.processInbound(inbound!.id)).toEqual({status:"BOUND"});
  expect(await worker.processInbound(inbound!.id)).toEqual({status:"TERMINAL"});
  expect(await db.prepare("SELECT connection_id FROM primary_login_channels WHERE user_id='owner'").first()).toEqual({connection_id:"original"});
  expect((await request(`/api/connections/${target}/login-channel`,{})).status).toBe(200);
  expect(await db.prepare("SELECT connection_id FROM primary_login_channels WHERE user_id='owner'").first()).toEqual({connection_id:connection.id});
  expect((await request("/api/auth/request-code",{email:"owner@example.invalid"},false)).status).toBe(202);
  const proof=await db.prepare("SELECT id,code_ciphertext,code_iv,code_key_version FROM login_codes WHERE consumed_at IS NULL").first<{id:string;code_ciphertext:unknown;code_iv:unknown;code_key_version:number}>();
  expect(jobs).toContainEqual({type:"DELIVER_LOGIN_CODE",loginCodeId:proof!.id});
  await worker.deliverLoginCode(proof!.id);
  const code=await keyring.decryptSensitive("login-code",proof!.id,proof!.code_key_version,{ciphertext:persistedD1Blob(proof!.code_ciphertext),iv:persistedD1Blob(proof!.code_iv)});
  expect((await request("/api/auth/verify-code",{email:"owner@example.invalid",code},false)).status).toBe(200);
  const reminderBody={title:"Synthetic manual",scheduledAt:now+60_000,timezone:"Asia/Ho_Chi_Minh"};
  expect((await request("/api/reminders",reminderBody)).status).toBe(409);
  const created=await request("/api/reminders",{...reminderBody,connectionPublicId:target});expect(created.status).toBe(201);
  expect(await db.prepare("SELECT ci.connection_id FROM reminders r JOIN chat_identities ci ON ci.id=r.chat_identity_id").first()).toEqual({connection_id:connection.id});
  await db.batch([db.prepare("INSERT INTO source_connections VALUES ('source','workspace','fixture','source-account','Source','ACTIVE',?,?)").bind(now,now),db.prepare("INSERT INTO source_items VALUES ('item','source','workspace','external','EVENT',?,?)").bind(now,now)]);
  const candidate=await createReminderActionCandidate({sourceItemId:"item",workspaceId:"workspace",title:"Synthetic action",scheduledAt:now+60_000,timezone:"Asia/Ho_Chi_Minh"},{store:new D1SourceActionStore(db),keyring,now:()=>now});
  expect((await request(`/api/actions/${candidate.id}/approve`,{connectionPublicId:target})).status).toBe(200);
  expect((await request(`/api/actions/${candidate.id}/approve`,{connectionPublicId:target})).status).toBe(409);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM reminders").first()).toEqual({n:2});
  expect((await request(`/api/connections/${originalPublicId}/login-channel`,{})).status).toBe(200);
  const lifecycle=await (await request(`/api/connections/${target}/lifecycle`)).json() as {data:{lifecycle:{cas:unknown}}};
  const [paused,racingCreate]=await Promise.all([request(`/api/connections/${target}/pause`,lifecycle.data.lifecycle.cas),request("/api/reminders",{...reminderBody,connectionPublicId:target})]);
  expect(paused.status).toBe(200);expect([201,409]).toContain(racingCreate.status);
  expect((await db.prepare("SELECT r.lifecycle_hold,ci.connection_id FROM reminders r JOIN chat_identities ci ON ci.id=r.chat_identity_id").all()).results.every(row=>row.lifecycle_hold===1&&row.connection_id===connection.id)).toBe(true);
  const resume=await (await request(`/api/connections/${target}/lifecycle`)).json() as {data:{lifecycle:{cas:unknown}}};
  expect((await request(`/api/connections/${target}/resume`,resume.data.lifecycle.cas)).status).toBe(200);
  expect(await worker.processInbound(inbound!.id)).toEqual({status:"TERMINAL"});
  expect(operations.every(op=>["getMe","setWebhook","sendMessage"].includes(op))).toBe(true);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
},30_000);
