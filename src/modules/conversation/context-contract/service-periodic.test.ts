// @vitest-environment node
import { expect,it } from "vitest";
import { harness,proposal } from "./service-test-support";
import { date,now,time } from "./resolution-test-support";
import { D1SeriesStore } from "@/modules/reminders/infrastructure/d1/series-store";

it.each([
 {frequency:"WEEKLY",day:9,month:11,year:2026,count:4,text:"Nhắc kiểm tra QA mỗi tuần lúc9h từ ngày09/11/2026 trong 4 tuần.",dates:["2026-11-09","2026-11-16","2026-11-23","2026-11-30"]},
 {frequency:"MONTHLY",day:15,month:11,year:2026,count:3,text:"Nhắc kiểm tra QA mỗi tháng lúc9h từ ngày15/11/2026 trong 3 tháng.",dates:["2026-11-15","2026-12-15","2027-01-15"]},
])("addressed $frequency preview confirms once without exposing successor rows to the legacy reader",async c=>{
 const h=await harness([proposal({title:"kiểm tra QA",frequency:c.frequency,reminderDate:date(c.day,c.month,c.year),reminderTime:time(9),occurrenceCount:c.count,eventRelation:"STARTING_ON"})]);
 h.deps.getReplyPreferences=async()=>({addressStyle:"sep",customDisplayName:null});
 expect(await h.turn(0,c.text),JSON.stringify({replies:h.replies,events:h.events})).toEqual({status:"DRAFT_CREATED"});
 const state=(await h.read(1))!;expect(h.replies[0].text).toMatch(/^Sếp,/u);
 const token=state.pendingDecision!.tokenHandle;
 expect(await h.turn(1,`xác nhận ${token}`)).toEqual({status:"CONFIRMED"});
 const rows=await h.f.db.prepare('SELECT scheduled_at FROM reminders ORDER BY scheduled_at').all<{scheduled_at:number}>();
 expect(rows.results.map(r=>r.scheduled_at)).toEqual(c.dates.map(d=>Date.parse(`${d}T09:00:00+07:00`)));
 expect(await h.f.db.prepare('SELECT count(*) n FROM advance_notification_groups').first('n')).toBe(0);
 await h.turn(2,`xác nhận ${token}`);expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(c.count);
 expect(h.events.filter(e=>e.event==="REQUEST_DISPATCHED")).toHaveLength(1);
 const series=new D1SeriesStore(h.f.db,h.f.keyring);const principal={userId:"owner",sessionId:"session",expiresAt:now+1000000};
 expect(await series.listWeb(principal,now+3)).toEqual([]); // Canonical series controls require their own reader; preserve the fence.

});
it("missing monthly day gives a specific clarification and writes nothing",async()=>{
 const h=await harness([proposal({title:"kiểm tra QA",frequency:"MONTHLY",reminderDate:date(31,1,2027),reminderTime:time(9),occurrenceCount:3,eventRelation:"STARTING_ON"})]);
 expect(await h.turn(0,"Nhắc kiểm tra QA mỗi tháng lúc9h từ ngày31/01/2027 trong 3 tháng."),JSON.stringify(h.events)).toEqual({status:"CLARIFICATION_REQUESTED"});
 expect(h.replies.at(-1)?.text).toContain("2027-02");expect(h.replies.at(-1)?.text).toContain("28");
 expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(0);
});
it("a weekly first occurrence passing inside preview TTL invalidates confirmation",async()=>{
 const h=await harness([proposal({title:"kiểm tra QA",frequency:"WEEKLY",reminderDate:date(28,9,2026),reminderTime:{hour:10,minute:1,qualifier:"H24"},occurrenceCount:4,eventRelation:"STARTING_ON"})]);
 expect(await h.turn(0,"Nhắc kiểm tra QA mỗi tuần lúc10:01 từ ngày28/09/2026 trong 4 tuần."),JSON.stringify(h.events)).toEqual({status:"DRAFT_CREATED"});
 const state=(await h.read(1))!;h.deps.now=()=>now+60000;
 expect(await h.turn(1,`xác nhận ${state.pendingDecision!.tokenHandle}`)).not.toEqual({status:"CONFIRMED"});
 expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(0);
});

it("a named-weekday conflict asks for the start date and never saves a Thursday series",async()=>{
 const h=await harness([proposal({title:"kiểm tra QA",frequency:"WEEKLY",reminderDate:date(5,11,2026),reminderTime:time(9),occurrenceCount:4,eventRelation:"STARTING_ON"})]);
 expect(await h.turn(0,"Nhắc kiểm tra QA mỗi thứ hai lúc9h từ ngày05/11/2026 trong 4 lần."),JSON.stringify(h.events)).toEqual({status:"CLARIFICATION_REQUESTED"});
 expect(h.replies.at(-1)?.text).toContain("không khớp ngày bắt đầu");expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(0);
});
it("a missing weekly count can be answered with its actual period unit",async()=>{
 const h=await harness([proposal({title:"kiểm tra QA",frequency:"WEEKLY",reminderDate:date(9,11,2026),reminderTime:time(9),eventRelation:"STARTING_ON"}),proposal({occurrenceCount:4},"CURRENT")]);
 expect(await h.turn(0,"Nhắc kiểm tra QA mỗi tuần lúc9h từ ngày09/11/2026."),JSON.stringify(h.events)).toEqual({status:"CLARIFICATION_REQUESTED"});
 expect(h.replies.at(-1)?.text).toContain("bao nhiêu lần");
 expect(await h.turn(1,"4 tuần"),JSON.stringify({replies:h.replies,events:h.events})).toEqual({status:"DRAFT_CREATED"});
});
it("a current weekly duration cannot become a retained monthly total when the frequency write is omitted",async()=>{
 const h=await harness([proposal({title:"kiểm tra QA",frequency:"MONTHLY",reminderDate:date(9,11,2026),reminderTime:time(9),eventRelation:"STARTING_ON"}),proposal({occurrenceCount:4},"CURRENT")]);
 expect(await h.turn(0,"Nhắc kiểm tra QA mỗi tháng lúc9h từ ngày09/11/2026.")).toEqual({status:"CLARIFICATION_REQUESTED"});
 await h.turn(1,"Nhắc mỗi tuần trong 4 tuần.");
 expect(h.replies.some(r=>r.kind==="PREVIEW")).toBe(false);
 expect((await h.read(2))?.slots.occurrenceCount.value).toBeNull();
});
