import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {expect,it,vi} from "vitest";
import {ConnectionLifecyclePanel} from "./ConnectionLifecyclePanel";
const replace=vi.fn();vi.mock("next/navigation",()=>({useRouter:()=>({replace})}));
const bot={publicId:"YWFhYWFhYWFhYWFhYWFhYQ",provider:"telegram" as const,displayName:"Bot A",handle:null,state:"ACTIVE_BOUND" as const};
const cas={authRevision:1,primary:{revision:1,generation:"a".repeat(32)}};
const state=(paused=false)=>({publicId:bot.publicId,state:"ACTIVE_BOUND",paused,cas,heldReminders:paused?2:0,heldInbound:paused?1:0,inFlight:{reminders:0,login:0,inbound:0}});
const response=(value:unknown)=>Response.json({data:{lifecycle:value}});
it("confirms retained credentials, posts exact CAS once and verifies pause read-back",async()=>{
 let paused=false;const fetcher=vi.fn(async(_path:unknown,init?:RequestInit)=>{if(init?.method==="POST")paused=true;return response(state(paused));});vi.stubGlobal("fetch",fetcher);
 const user=userEvent.setup();render(<ConnectionLifecyclePanel connection={bot}/>);
 await user.click(await screen.findByRole("button",{name:"Tạm dừng Bot A"}));expect(screen.getByRole("dialog")).toHaveTextContent(/giữ token mã hoá/);
 await user.dblClick(screen.getByRole("button",{name:"Xác nhận tạm dừng"}));await screen.findByText("Đã xác minh: bot đang tạm dừng.");
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);expect(fetcher).toHaveBeenCalledWith("/api/connections/"+bot.publicId+"/pause",expect.objectContaining({body:JSON.stringify(cas)}));
 expect(await screen.findByRole("button",{name:"Tiếp tục Bot A"})).toBeVisible();
});
it("handles a primary/CAS conflict without claiming pause success or blind retry",async()=>{
 const fetcher=vi.fn(async(_path:unknown,init?:RequestInit)=>init?.method==="POST"?Response.json({error:{code:"CONNECTION_STATE_INVALID",message:"private"}},{status:409}):response(state()));vi.stubGlobal("fetch",fetcher);
 const user=userEvent.setup();render(<ConnectionLifecyclePanel connection={bot}/>);await user.click(await screen.findByRole("button",{name:"Tạm dừng Bot A"}));await user.click(screen.getByRole("button",{name:"Xác nhận tạm dừng"}));
 expect(await screen.findByRole("alert")).toHaveTextContent(/bot đăng nhập khác/);expect(screen.queryByText("private")).not.toBeInTheDocument();expect(screen.getByRole("button",{name:"Tạm dừng Bot A"})).toBeDisabled();expect(fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
});
it("unpauses SUSPENDED without claiming activation or held-job release",async()=>{
 let paused=true;vi.stubGlobal("fetch",vi.fn(async(_path:unknown,init?:RequestInit)=>{if(init?.method==="POST")paused=false;return response({...state(paused),state:"SUSPENDED",heldReminders:2});}));
 const user=userEvent.setup();render(<ConnectionLifecyclePanel connection={{...bot,state:"SUSPENDED"}}/>);await user.click(await screen.findByRole("button",{name:"Tiếp tục Bot A"}));await user.click(screen.getByRole("button",{name:"Xác nhận tiếp tục"}));expect(await screen.findByRole("status")).toHaveTextContent(/vẫn cần kiểm tra/);expect(screen.getByText(/2 lời nhắc đang giữ/)).toBeVisible();
});
