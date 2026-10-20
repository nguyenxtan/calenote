// @vitest-environment node
import {readFileSync} from "node:fs";
import {afterEach,expect,it,vi} from "vitest";
import {SqliteD1Database} from "@/testing/sqlite-d1.test-support";
import {parseSessionCredentials,requireSession} from "./session";
import {D1SessionStore} from "@/modules/db/session-store";
import {D1DashboardStore} from "./dashboard-service";
import {D1OnboardingStore} from "@/modules/db/onboarding-store";
import {addConnection} from "@/modules/connections/add-service";
import {createKeyring} from "@/modules/security/keyring";
import {D1RateLimitStore} from "@/modules/db/rate-limit-store";
import {requestEmailRegistration,verifyEmailRegistration,type EmailRegistrationDependencies} from "./email-registration";
const databases:SqliteD1Database[]=[];
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
async function setup() {
 const db=new SqliteD1Database(); databases.push(db);
 db.sqlite.exec(readFileSync("migrations/0017_email_registration.sql","utf8"));
 let now=1800000000000; const sent:{to:string;code:string;expiresAt:number}[]=[];
 const deps:EmailRegistrationDependencies={database:db as unknown as D1Database,keyring:await createKeyring("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),rateLimitStore:new D1RateLimitStore(db as unknown as D1Database),now:()=>now,sender:{send:async m=>{sent.push(m);}}};
 const input={email:" NEW@example.com ",displayName:"New Owner",clientIp:"192.0.2.1",browserBinding:"a".repeat(43)};
 const request=()=>requestEmailRegistration(input,deps);
 const verify=(challengeId:string,code=sent.at(-1)!.code,overrides={})=>verifyEmailRegistration({challengeId,email:input.email,code,clientIp:input.clientIp,browserBinding:input.browserBinding,...overrides},deps);
 const count=(table:string)=>Number((db.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n);
 return {db,deps,sent,input,request,verify,count,advance:(ms:number)=>{now+=ms;}};
}
it("creates no identity until proof, stores only code HMAC, and atomically creates a personal graph",async()=>{
 const s=await setup();const issued=await s.request();
 for(const t of ["users","workspaces","memberships","sessions","email_verified_accounts"]) expect(s.count(t)).toBe(0);
 expect(s.sent[0].to).toBe("new@example.com");expect(s.sent[0].code).toMatch(/^\d{6}$/);
 const row=s.db.sqlite.prepare("SELECT * FROM email_registration_challenges").get()!;
 expect(row.code_digest).not.toBe(s.sent[0].code);expect(Object.keys(row)).not.toContain("code");
 const result=await s.verify(issued.challengeId);
 expect(result.session.cookie).toContain("HttpOnly");
 for(const t of ["users","workspaces","memberships","sessions","email_verified_accounts"]) expect(s.count(t)).toBe(1);
 expect(s.count("bot_connections")).toBe(0);
 expect(s.db.sqlite.prepare("SELECT display_name FROM users").get()).toMatchObject({display_name:"New Owner"});
 await expect(s.verify(issued.challengeId)).rejects.toMatchObject({code:"INVALID_CODE"});
});
it("only one concurrent verifier wins",async()=>{
 const s=await setup();const issued=await s.request();
 const results=await Promise.allSettled([s.verify(issued.challengeId),s.verify(issued.challengeId)]);
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(s.count("sessions")).toBe(1);
});
it("enforces email/browser ownership and durable five attempt limit",async()=>{
 const s=await setup();const issued=await s.request();
 await expect(s.verify(issued.challengeId,undefined,{browserBinding:"b".repeat(43)})).rejects.toMatchObject({code:"INVALID_CODE"});
 await expect(s.verify(issued.challengeId,undefined,{email:"other@example.com"})).rejects.toMatchObject({code:"INVALID_CODE"});
 const wrong=s.sent[0].code==="000000"?"111111":"000000";
 for(let i=0;i<5;i++) await expect(s.verify(issued.challengeId,wrong)).rejects.toMatchObject({code:"INVALID_CODE"});
 expect(s.db.sqlite.prepare("SELECT attempts FROM email_registration_challenges").get()).toMatchObject({attempts:5});
 await expect(s.verify(issued.challengeId)).rejects.toMatchObject({code:"INVALID_CODE"});expect(s.count("users")).toBe(0);
});
it("expires codes and invalidates old challenge on resend after cooldown",async()=>{
 const s=await setup();const first=await s.request();const oldCode=s.sent[0].code;
 await expect(s.request()).rejects.toMatchObject({status:429});
 s.advance(60_000);const second=await s.request();
 await expect(s.verify(first.challengeId,oldCode)).rejects.toMatchObject({code:"INVALID_CODE"});
 s.advance(600_000);await expect(s.verify(second.challengeId)).rejects.toMatchObject({code:"INVALID_CODE"});expect(s.count("users")).toBe(0);
});
it("fails closed for missing sender and uncertain delivery without creating account",async()=>{
 const s=await setup();s.deps.sender=undefined;await expect(s.request()).rejects.toMatchObject({code:"DELIVERY_UNAVAILABLE"});expect(s.count("email_registration_challenges")).toBe(0);
 s.deps.sender={send:async m=>{s.sent.push(m);throw Error("unknown delivery outcome");}};
 await expect(s.request()).rejects.toMatchObject({code:"DELIVERY_UNAVAILABLE"});
 const row=s.db.sqlite.prepare("SELECT id,delivery_status FROM email_registration_challenges").get()!;
 expect(row.delivery_status).toBe("FAILED");await expect(s.verify(String(row.id))).rejects.toMatchObject({code:"INVALID_CODE"});expect(s.count("users")).toBe(0);
});
it("never claims legacy accounts but allows new verified accounts to log in again",async()=>{
 const s=await setup();s.db.sqlite.exec("INSERT INTO users VALUES('legacy','legacy@example.com','Legacy','Asia/Ho_Chi_Minh',1,1)");
 const legacy=await requestEmailRegistration({...s.input,email:"legacy@example.com"},s.deps);
 expect(s.sent).toHaveLength(0);await expect(s.verify(legacy.challengeId,"000000",{email:"legacy@example.com"})).rejects.toMatchObject({code:"INVALID_CODE"});
 const first=await s.request();const account=await s.verify(first.challengeId);s.advance(60_000);
 const login=await s.request();const second=await s.verify(login.challengeId);
 expect(second.userId).toBe(account.userId);expect(second.session.bearer).not.toBe(account.session.bearer);expect(s.count("users")).toBe(2);expect(s.count("sessions")).toBe(2);
});
it("limits normalized email to three sends hourly",async()=>{
 const s=await setup();for(let n=0;n<3;n++){await s.request();s.advance(60_000);}
 await expect(s.request()).rejects.toMatchObject({status:429});expect(s.sent).toHaveLength(3);
});
it("enforces the per-IP hourly ceiling across addresses",async()=>{
 const s=await setup();for(let n=0;n<10;n++) await requestEmailRegistration({...s.input,email:`user${n}@example.com`},s.deps);
 await expect(requestEmailRegistration({...s.input,email:"extra@example.com"},s.deps)).rejects.toMatchObject({status:429});expect(s.sent).toHaveLength(10);
});
it("bounds total delivery across distinct IPs and emails",async()=>{
 const s=await setup();for(let n=0;n<100;n++) await requestEmailRegistration({...s.input,email:`user${n}@example.com`,clientIp:`192.0.2.${n}`},s.deps);
 await expect(requestEmailRegistration({...s.input,email:"extra@example.com",clientIp:"198.51.100.1"},s.deps)).rejects.toMatchObject({status:429});expect(s.sent).toHaveLength(100);
});
it("rolls back proof consumption and all account rows if graph creation fails",async()=>{
 const s=await setup();const issued=await s.request();
 s.db.sqlite.exec("CREATE TRIGGER reject_registration_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'test failure'); END");
 await expect(s.verify(issued.challengeId)).rejects.toThrow("test failure");
 for(const t of ["users","workspaces","memberships","email_verified_accounts","sessions"])expect(s.count(t)).toBe(0);
 expect(s.db.sqlite.prepare("SELECT consumed_at,attempts FROM email_registration_challenges").get()).toMatchObject({consumed_at:null,attempts:0});
 s.db.sqlite.exec("DROP TRIGGER reject_registration_session");await s.verify(issued.challengeId);expect(s.count("users")).toBe(1);
});

it("authenticates the email-created account with its cookie and adds its first bot under the same owner",async()=>{
 const s=await setup();const issued=await s.request();const registration=await s.verify(issued.challengeId);
 const credentials=parseSessionCredentials(registration.session.cookie);
 expect(credentials).not.toBeNull();
 const principal=await requireSession(credentials!,{store:new D1SessionStore(s.deps.database),keyring:s.deps.keyring,now:s.deps.now});
 expect(principal.userId).toBe(registration.userId);
 const dashboard=new D1DashboardStore(s.deps.database);
 expect(await dashboard.getSessionUser(principal.userId)).toEqual({displayName:"New Owner",email:"new@example.com",timezone:"Asia/Ho_Chi_Minh"});
 expect(await dashboard.listConnections(principal.userId)).toEqual([]);
 const verifyToken=vi.fn(async()=>({provider:"telegram" as const,providerBotId:"first-synthetic-bot",displayName:"First bot",handle:null,accountType:null,canJoinGroups:false}));
 const registerWebhook=vi.fn(async()=>{});
 const result=await addConnection(principal.userId,{provider:"telegram",token:"12345678:synthetic-fixture"},{
   store:new D1OnboardingStore(s.deps.database),keyring:await createKeyring("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
   rateLimitStore:s.deps.rateLimitStore,verifyToken,registerWebhook,appOrigin:"https://calenote.example",now:s.deps.now,
 });
 expect(verifyToken).toHaveBeenCalledOnce();expect(registerWebhook).toHaveBeenCalledOnce();
 expect(result.bot.state).toBe("ACTIVE_UNBOUND");expect(result.connectCommand).toMatch(/^\/connect /);
 expect(await dashboard.listConnections(principal.userId)).toEqual([{publicId:result.bot.publicId,provider:"telegram",displayName:"First bot",handle:null,state:"ACTIVE_UNBOUND"}]);
 expect(s.db.sqlite.prepare("SELECT user_id FROM bot_connections").get()).toMatchObject({user_id:principal.userId});
 for(const table of ["users","workspaces","memberships","sessions","email_verified_accounts"])expect(s.count(table)).toBe(1);
 expect((await requireSession(credentials!,{store:new D1SessionStore(s.deps.database),keyring:s.deps.keyring,now:s.deps.now})).userId).toBe(principal.userId);
});
