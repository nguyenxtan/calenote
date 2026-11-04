// @vitest-environment node
import { readFileSync, existsSync } from "node:fs";
import { expect, it } from "vitest";
import { harness, proposal } from "./service-test-support";
import { date, time } from "./resolution-test-support";
import { D1FollowThroughService } from "@/modules/follow-through/service";
it.each(["DONE","STOP"] as const)("%s settles the whole advance group without leaving the second notification pending",async action=>{
 const h=await harness([proposal({title:"họp QA",eventDate:date(2,10,2026),eventTime:time(15)})]);
 for(const file of ["0014_reminder_follow_through.sql","0015_personal_assistant.sql","0016_personal_assistant_dispatch.sql","0022_advance_group_settlement.sql"]){if(existsSync(`migrations/${file}`))h.f.sqlite!.sqlite.exec(readFileSync(`migrations/${file}`,"utf8"));}
 h.deps.getReplyPreferences=async()=>({addressStyle:"sep",customDisplayName:null,advanceReminderDays:2,advanceReminderHours:3});
 expect(await h.turn(0,"Ngày 02/10/2026 lúc 15h có cuộc họp QA, nhắc giúp tôi.")).toEqual({status:"DRAFT_CREATED"});
 const s=(await h.read(1))!;expect(await h.turn(1,`xác nhận ${s.pendingDecision!.tokenHandle}`)).toEqual({status:"CONFIRMED"});
 const service=new D1FollowThroughService(h.f.db,h.f.keyring,{now:()=>h.f.scope(2).now});const scope={userId:"owner"};
 const tasks=(await service.list(scope)).items;expect(tasks).toHaveLength(2);
 await service.act(scope,{action,publicId:tasks[0].publicId,expectedRevision:tasks[0].revision,idempotencyKey:"qa-finish-advance"});
 expect((await service.list(scope)).items.map(t=>t.progress)).toEqual(action==="DONE"?["DONE","DONE"]:["STOPPED","STOPPED"]);
 expect(await h.f.db.prepare("SELECT count(*) n FROM reminders WHERE status IN ('PENDING','RETRYABLE')").first("n")).toBe(0);
});
