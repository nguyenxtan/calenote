import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {expect,it,vi} from "vitest";
import {DeliveryTarget,useDeliveryTargets} from "./DeliveryTarget";
const a="YWFhYWFhYWFhYWFhYWFhYQ",b="YmJiYmJiYmJiYmJiYmJiYg",p="cHBwcHBwcHBwcHBwcHBwcA";
const json=(data:unknown,status=200)=>Response.json(status===200?{data}:{error:{code:"UNAUTHENTICATED",message:"private error"}},{status});
const meta=(id:string,paused=false)=>({lifecycle:{publicId:id,state:"ACTIVE_BOUND",paused,cas:{authRevision:1,primary:{revision:1,generation:"a".repeat(32)}},heldReminders:0,heldInbound:0,inFlight:{reminders:0,login:0,inbound:0}}});
const noop=()=>{};
function Harness({owner="owner",unauthorized=noop}:{owner?:string;unauthorized?:()=>void}){const targets=useDeliveryTargets(owner,unauthorized);return <><DeliveryTarget id="target" targets={targets}/><button disabled={!targets.ready} onClick={()=>fetch("/mutation",{method:"POST",body:JSON.stringify({connectionPublicId:targets.selectedId})})}>Submit</button></>;}
it("requires explicit choice, excludes paused bots and sends only that public id",async()=>{
 const fetcher=vi.fn(async(path:unknown)=>path==="/api/connections"?json({connections:[a,b,p].map((id,i)=>({publicId:id,provider:"telegram",displayName:["Bot A","Bot B","Paused"][i],handle:null,state:"ACTIVE_BOUND"}))}):path==="/mutation"?json({}):json(meta(String(path).split("/")[3],String(path).includes(p))));vi.stubGlobal("fetch",fetcher);
 const user=userEvent.setup();render(<Harness/>);await screen.findByRole("option",{name:"Bot B · Telegram"});expect(screen.getByRole("button",{name:"Submit"})).toBeDisabled();expect(screen.queryByRole("option",{name:/Paused/})).not.toBeInTheDocument();
 await user.selectOptions(screen.getByLabelText("Bot nhận lời nhắc"),b);await user.click(screen.getByRole("button",{name:"Submit"}));expect(fetcher).toHaveBeenCalledWith("/mutation",{method:"POST",body:JSON.stringify({connectionPublicId:b})});
 await user.click(screen.getByRole("button",{name:"Tải lại danh sách bot"}));await waitFor(()=>expect(screen.getByRole("button",{name:"Submit"})).toBeDisabled());
});
it("fails closed when lifecycle metadata cannot be verified",async()=>{
 vi.stubGlobal("fetch",vi.fn(async(path:unknown)=>path==="/api/connections"?json({connections:[{publicId:a,provider:"telegram",displayName:"A",handle:null,state:"ACTIVE_BOUND"}]}):Response.json({error:{code:"INTERNAL_ERROR",message:"private error"}},{status:500})));
 render(<Harness/>);await screen.findByRole("alert");expect(screen.getByRole("button",{name:"Submit"})).toBeDisabled();expect(screen.queryByText("private error")).not.toBeInTheDocument();
});
it("does not apply an old account response or unauthorized callback to a new owner",async()=>{
 let release!:(response:Response)=>void;let calls=0;const unauthorized=vi.fn();
 vi.stubGlobal("fetch",vi.fn(async()=>{calls++;return calls===1?new Promise<Response>(resolve=>{release=resolve;}):json({connections:[]});}));
 const view=render(<Harness unauthorized={unauthorized}/>);await waitFor(()=>expect(calls).toBe(1));view.rerender(<Harness owner="new-owner" unauthorized={unauthorized}/>);await screen.findByText(/Chưa có bot/);release(json({},401));await waitFor(()=>expect(unauthorized).not.toHaveBeenCalled());expect(screen.getByRole("button",{name:"Submit"})).toBeDisabled();
});
