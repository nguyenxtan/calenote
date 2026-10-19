// @vitest-environment node
import { afterEach,expect,it,vi } from "vitest";
import { SqliteD1Database } from "@/testing/sqlite-d1.test-support";
import { createRouter } from "../router";
import { D1ConnectionLifecycleStore,ConnectionDisconnectError } from "@/modules/connections/lifecycle";
import type { ConnectionsOperations } from "./operations";
const databases:SqliteD1Database[]=[];
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
const origin='https://calenote.iconiclogs.com',publicId='A'.repeat(22);
function setup(userId='owner') {
 const db=new SqliteD1Database();databases.push(db);
 db.sqlite.exec(`INSERT INTO users VALUES ('owner','owner@example.com','Owner','Asia/Ho_Chi_Minh',1,1),('foreign','foreign@example.com','Foreign','Asia/Ho_Chi_Minh',1,1);
 INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES
 ('target','owner','telegram','${publicId}','bot','Bot',x'01',x'02','fp',1,'ACTIVE_BOUND',1,1),
 ('alternate','owner','zalo','other-public','bot2','Other bot',x'01',x'02','fp2',1,'ACTIVE_BOUND',1,1);
 INSERT INTO chat_identities VALUES ('chat','target','pu','pc',NULL,1),('chat2','alternate','pu2','pc2',NULL,1);`);
 const lifecycle=new D1ConnectionLifecycleStore(db as unknown as D1Database);
 const factory=vi.fn(async()=>({getPrimaryLogin:vi.fn(),selectPrimaryLogin:vi.fn(),addConnection:vi.fn(),listConnections:vi.fn(),retryWebhook:vi.fn(),rotateConnectCode:vi.fn(),requireUser:async()=>({userId}),disconnectConnection:async(input:{userId:string;publicId:string})=>{
  if(!await lifecycle.disconnect(input.userId,input.publicId,100,'mutation'))throw new ConnectionDisconnectError();return {disconnected:true as const};
 }} as ConnectionsOperations));
 const router=createRouter({connectionsOperations:factory});
 const run=(body:unknown={},cookie=true,requestOrigin=origin)=>router(new Request(`${origin}/api/connections/${publicId}/disconnect`,{method:'POST',headers:{origin:requestOrigin,'content-type':'application/json',...(cookie?{cookie:`__Host-calenote_session=${'A'.repeat(43)}`}:{})},body:JSON.stringify(body)}),{APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:'production',ASSETS:{fetch:vi.fn()}} as unknown as Env,{} as ExecutionContext);
 return {db,run,factory};
}
it('disconnects only the authenticated owner and returns no credential or session mutation',async()=>{
 const {db,run}=setup();const response=await run();expect(response.status).toBe(200);expect(await response.json()).toEqual({data:{disconnected:true}});expect(response.headers.get('set-cookie')).toBeNull();expect(db.sqlite.prepare("SELECT state FROM bot_connections WHERE id='target'").get()).toEqual({state:'SUSPENDED'});
});
it('keeps another owner connection untouched',async()=>{
 const {db,run}=setup('foreign');expect((await run()).status).toBe(409);expect(db.sqlite.prepare("SELECT state FROM bot_connections WHERE id='target'").get()).toEqual({state:'ACTIVE_BOUND'});
});
it.each([[{},false,origin,401],[{},true,'https://foreign.example',403],[{userId:'foreign'},true,origin,400]] as const)('rejects invalid authority before constructing operations',async(body,cookie,requestOrigin,status)=>{
 const {run,factory}=setup();expect((await run(body,cookie,requestOrigin)).status).toBe(status);expect(factory).not.toHaveBeenCalled();
});
