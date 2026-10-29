import {fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,expect,it,vi} from "vitest";
import {SqliteD1Database} from "@/testing/sqlite-d1.test-support";
import {createKeyring} from "@/modules/security/keyring";
import {prepareSession} from "@/modules/auth/session";
import {createRouter} from "@/worker/router";
import {createReminderActionCandidate} from "@/modules/source-actions/service";
import {D1SourceActionStore} from "@/modules/source-actions/infrastructure/d1/store";
import {TodayExperience} from "@/features/today/TodayExperience";
import {CoreScreenExperience} from "@/features/core-screens/CoreScreenExperience";
import {ConnectionLifecyclePanel} from "./ConnectionLifecyclePanel";
const replace=vi.fn();vi.mock("next/navigation",()=>({useRouter:()=>({replace})}));
const databases:SqliteD1Database[]=[];afterEach(()=>databases.splice(0).forEach(db=>db.close()));
const publicId=(id:string)=>Buffer.from(id.repeat(16)).toString("base64url");
async function setup(){
 const db=new SqliteD1Database({conversationV2:true});databases.push(db);const now=Date.now(),master="A".repeat(43),origin="https://calenote.iconiclogs.com";const keyring=await createKeyring(master);
 db.sqlite.prepare("INSERT INTO users VALUES ('owner','owner@example.invalid','Owner','Asia/Ho_Chi_Minh',?,?)").run(now,now);
 db.sqlite.prepare("INSERT INTO workspaces VALUES ('workspace','owner','PERSONAL',?,?)").run(now,now);db.sqlite.prepare("INSERT INTO memberships VALUES ('workspace','owner','OWNER',?)").run(now);
 for(const id of ["a","b","p"]){
  const token=await keyring.encryptCredential(id,"telegram",1,"12345678:synthetic-ui-integration");
  db.sqlite.prepare("INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES (?,'owner','telegram',?,?,?, ?,?,?,1,'ACTIVE_BOUND',?,?)")
   .run(id,publicId(id),id,"Bot "+id.toUpperCase(),new Uint8Array(token.ciphertext),new Uint8Array(token.iv),id,now,now);
  db.sqlite.prepare("INSERT INTO chat_identities VALUES (?,?,?,?,NULL,?)").run("identity-"+id,id,"user-"+id,"chat-"+id,now);
 }
 db.sqlite.exec("UPDATE bot_connections SET processing_paused=1 WHERE id='p'");
 const session=await prepareSession("owner",{keyring,now:()=>now});db.sqlite.prepare("INSERT INTO sessions VALUES (?,?,?,?,NULL,?)").run(session.record.id,"owner",session.record.digest,session.record.expiresAt,now);
 db.sqlite.exec("INSERT INTO source_connections VALUES ('source','workspace','fixture','account','Source','ACTIVE',1,1);INSERT INTO source_items VALUES ('item','source','workspace','external','EVENT',1,1)");
 const candidate=await createReminderActionCandidate({sourceItemId:"item",workspaceId:"workspace",title:"Duyệt đúng bot",scheduledAt:now+3_600_000,timezone:"Asia/Ho_Chi_Minh"},{store:new D1SourceActionStore(db as unknown as D1Database),keyring,now:()=>now});
 const env={APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:"production",CALENOTE_MASTER_KEY:master,AI_MODE:"off",DB:db,JOBS:{send:vi.fn()},ASSETS:{fetch:vi.fn()}} as unknown as Env;
 const router=createRouter();let lostAck=false,ackStatus=0,blockReadback=false;const mutations:{path:string;body:unknown}[]=[];
 vi.stubGlobal("fetch",vi.fn(async(input:unknown,init?:RequestInit)=>{
  if(typeof input!=="string"||!input.startsWith("/api/"))throw new Error("External transport forbidden");
  if(init?.method==="POST")mutations.push({path:input,body:JSON.parse(String(init.body))});
  if(blockReadback&&(input==="/api/reminders"||input==="/api/actions")&&init?.method!=="POST")return Response.json({error:{code:"READ_FAILED",message:"Synthetic read failure"}},{status:503});
  const response=await router(new Request(origin+input,{...init,headers:{origin,"content-type":"application/json",cookie:session.cookie.split(";")[0]}}),env,{} as ExecutionContext);
  if(lostAck&&(input==="/api/reminders"||input.endsWith("/approve"))&&init?.method==="POST"){lostAck=false;if(ackStatus)return Response.json({error:{code:"INTERNAL_ERROR",message:"Synthetic uncertain response"}},{status:ackStatus});throw new Error("Synthetic acknowledgement lost");}
  return response;
 }));
 return {db,now,candidate,mutations,loseNextAck:(status=0,block=false)=>{lostAck=true;ackStatus=status;blockReadback=block;},allowReadback:()=>{blockReadback=false;}};
}
async function choose(label:string){const select=await screen.findByRole("combobox",{name:label});await within(select).findByRole("option",{name:"Bot B · Telegram"});await userEvent.selectOptions(select,publicId("b"));}
async function fillManual(now:number){
 const user=userEvent.setup();await user.type(screen.getByLabelText("Nội dung nhắc hẹn"),"Nhắc đúng bot B");await user.click(screen.getByRole("button",{name:"Chọn thời gian"}));
 fireEvent.change(screen.getByLabelText("Thời điểm nhắc"),{target:{value:new Date(now+8*3_600_000).toISOString().slice(0,16)}});
}
it("uses Today selectors and confirmed proposal approval through canonical routes, then pauses/resumes without retargeting",async()=>{
 const h=await setup();const view=render(<TodayExperience allowDeliverySelection/>);await screen.findByRole("heading",{name:/Chào/});
 await choose("Bot nhận lời nhắc");await fillManual(h.now);await userEvent.dblClick(screen.getByRole("button",{name:"Tạo lời nhắc"}));await screen.findByText("Nhắc hẹn đã được lưu.");
 expect(h.mutations.filter(value=>value.path==="/api/reminders")).toEqual([{path:"/api/reminders",body:expect.objectContaining({connectionPublicId:publicId("b")})}]);
 await userEvent.selectOptions(screen.getByRole("combobox",{name:"Bot nhận khi duyệt đề xuất"}),publicId("b"));await userEvent.click(screen.getByRole("button",{name:"Đồng ý Duyệt đúng bot"}));
 expect(screen.getByRole("dialog")).toHaveTextContent("Bot B · Telegram");expect(h.mutations.filter(value=>value.path.includes("/approve"))).toHaveLength(0);
 await userEvent.dblClick(screen.getByRole("button",{name:"Xác nhận bot nhận"}));await waitFor(()=>expect(h.mutations.filter(value=>value.path.includes("/approve"))).toHaveLength(1));
 await waitFor(()=>expect(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM reminders").get()).toEqual({n:2}));
 expect(h.db.sqlite.prepare("SELECT chat_identity_id FROM reminders").all()).toEqual([{chat_identity_id:"identity-b"},{chat_identity_id:"identity-b"}]);
 expect(h.db.sqlite.prepare("SELECT connection_id FROM primary_login_channels").get()).toEqual({connection_id:"a"});view.unmount();
 render(<ConnectionLifecyclePanel connection={{publicId:publicId("b"),provider:"telegram",displayName:"Bot B",handle:null,state:"ACTIVE_BOUND"}}/>);
 await waitFor(()=>expect(screen.getByRole("button",{name:"Tạm dừng Bot B"})).toBeEnabled());await userEvent.click(screen.getByRole("button",{name:"Tạm dừng Bot B"}));await userEvent.click(screen.getByRole("button",{name:"Xác nhận tạm dừng"}));await screen.findByText("Đã xác minh: bot đang tạm dừng.");
 expect(h.db.sqlite.prepare("SELECT lifecycle_hold FROM reminders").all()).toEqual([{lifecycle_hold:1},{lifecycle_hold:1}]);
 await userEvent.click(screen.getByRole("button",{name:"Tiếp tục Bot B"}));await userEvent.click(screen.getByRole("button",{name:"Xác nhận tiếp tục"}));await screen.findByText(/Đã xác minh: bot đã bỏ tạm dừng/);
 expect(h.db.sqlite.prepare("SELECT chat_identity_id,lifecycle_hold FROM reminders").all()).toEqual([{chat_identity_id:"identity-b",lifecycle_hold:0},{chat_identity_id:"identity-b",lifecycle_hold:0}]);
},10_000);
it("requires an Inbox destination and confirmation while reject remains channel-independent",async()=>{
 const h=await setup();render(<CoreScreenExperience screen="inbox" allowDeliverySelection/>);const approve=await screen.findByRole("button",{name:"Đồng ý Duyệt đúng bot"});expect(approve).toBeDisabled();
 await choose("Bot nhận khi duyệt đề xuất");await userEvent.click(approve);await userEvent.keyboard("{Escape}");expect(h.mutations).toHaveLength(0);
 await userEvent.click(approve);await userEvent.click(screen.getByRole("button",{name:"Xác nhận bot nhận"}));await waitFor(()=>expect(h.db.sqlite.prepare("SELECT chat_identity_id FROM reminders").get()).toEqual({chat_identity_id:"identity-b"}));
 expect(h.mutations).toEqual([{path:"/api/actions/"+h.candidate.id+"/approve",body:{connectionPublicId:publicId("b")}}]);
});
it("does not blindly replay a manual create after the server commits but its acknowledgement is lost",async()=>{
 const h=await setup();render(<TodayExperience allowDeliverySelection/>);await screen.findByRole("heading",{name:/Chào/});await choose("Bot nhận lời nhắc");await fillManual(h.now);h.loseNextAck();await userEvent.click(screen.getByRole("button",{name:"Tạo lời nhắc"}));
 await screen.findByRole("button",{name:"Đã kiểm tra danh sách"});expect(screen.getByRole("button",{name:"Tạo lời nhắc"})).toBeDisabled();expect(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM reminders").get()).toEqual({n:1});expect(h.mutations.filter(value=>value.path==="/api/reminders")).toHaveLength(1);
});

it.each([0,500])("keeps uncertain create locked until successful list read-back (response %s)",async(status)=>{
 const h=await setup();render(<TodayExperience allowDeliverySelection/>);await screen.findByRole("heading",{name:/Chào/});await choose("Bot nhận lời nhắc");await fillManual(h.now);h.loseNextAck(status,true);await userEvent.click(screen.getByRole("button",{name:"Tạo lời nhắc"}));
 const acknowledge=await screen.findByRole("button",{name:"Đã kiểm tra danh sách"});await screen.findByRole("button",{name:"Tải lại để kiểm tra"});expect(acknowledge).toBeDisabled();await userEvent.click(acknowledge);expect(screen.getByRole("button",{name:"Tạo lời nhắc"})).toBeDisabled();
 h.allowReadback();await userEvent.click(screen.getByRole("button",{name:"Tải lại để kiểm tra"}));await waitFor(()=>expect(acknowledge).toBeEnabled());expect(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM reminders").get()).toEqual({n:1});expect(h.mutations.filter(value=>value.path==="/api/reminders")).toHaveLength(1);
});
it("rejects an Inbox proposal without choosing a delivery bot",async()=>{
 const h=await setup();render(<CoreScreenExperience screen="inbox" allowDeliverySelection/>);await userEvent.click(await screen.findByRole("button",{name:"Bỏ qua Duyệt đúng bot"}));await waitFor(()=>expect(h.mutations).toEqual([{path:"/api/actions/"+h.candidate.id+"/reject",body:{}}]));expect(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM reminders").get()).toEqual({n:0});
});

it("keeps an uncertain Inbox approval blocked until fresh actions resolve it",async()=>{
 const h=await setup();render(<CoreScreenExperience screen="inbox" allowDeliverySelection/>);await choose("Bot nhận khi duyệt đề xuất");await userEvent.click(screen.getByRole("button",{name:"Đồng ý Duyệt đúng bot"}));h.loseNextAck(500,true);await userEvent.click(screen.getByRole("button",{name:"Xác nhận bot nhận"}));const acknowledge=await screen.findByRole("button",{name:"Đã kiểm tra danh sách"});expect(acknowledge).toBeDisabled();expect(screen.queryByRole("button",{name:"Đồng ý Duyệt đúng bot"})).not.toBeInTheDocument();h.allowReadback();await userEvent.click(screen.getByRole("button",{name:"Tải lại để kiểm tra"}));await waitFor(()=>expect(acknowledge).toBeEnabled());expect(screen.queryByRole("button",{name:"Đồng ý Duyệt đúng bot"})).not.toBeInTheDocument();expect(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM reminders").get()).toEqual({n:1});expect(h.mutations.filter(value=>value.path.endsWith("/approve"))).toHaveLength(1);
});
