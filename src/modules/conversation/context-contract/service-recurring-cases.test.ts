// @vitest-environment node
import { expect,it } from "vitest";
import {harness,proposal,type Proposal} from "./service-test-support";
import {date,time} from "./resolution-test-support";
it.each([
 {text:"Nhắc kiểm tra QA mỗi ngày lúc 8h, bắt đầu ngày mai, trong 3 ngày liên tiếp.",values:{title:"kiểm tra QA",reminderDate:{kind:"RELATIVE_DAY",offsetDays:1},reminderTime:time(),frequency:"DAILY",occurrenceCount:3,eventRelation:"STARTING_ON"},dates:["2026-09-29T08:00:00+07:00","2026-09-30T08:00:00+07:00","2026-10-01T08:00:00+07:00"]},
 {text:"Nhắc kiểm tra QA mỗi ngày lúc 9h từ ngày 06/11/2026 đến hết ngày 08/11/2026.",values:{title:"kiểm tra QA",reminderDate:date(6,11,2026),endDate:date(8,11,2026),reminderTime:time(9),frequency:"DAILY",eventRelation:"STARTING_ON"},dates:["2026-11-06T09:00:00+07:00","2026-11-07T09:00:00+07:00","2026-11-08T09:00:00+07:00"]},
 {text:"Ngày 10/11/2026 lúc 9h có buổi kiểm tra QA. Nhắc lúc 8h mỗi ngày trong 2 ngày liên tiếp trước buổi đó.",values:{title:"kiểm tra QA",eventDate:date(10,11,2026),eventTime:time(9),reminderTime:time(),frequency:"DAILY",occurrenceCount:2,eventRelation:"BEFORE_EVENT"},dates:["2026-11-08T08:00:00+07:00","2026-11-09T08:00:00+07:00"]},
])("complete recurring source reaches a confirmable exact preview: $text",async({text,values,dates})=>{
 const h=await harness([proposal(values)]);expect(await h.turn(0,text),JSON.stringify({replies:h.replies,events:h.events})).toEqual({status:"DRAFT_CREATED"});
 expect(await h.turn(1,"Có.")).toEqual({status:"CONFIRMED"});
 expect((await h.f.db.prepare("SELECT scheduled_at FROM reminders ORDER BY scheduled_at").all<{scheduled_at:number}>()).results.map(r=>r.scheduled_at)).toEqual(dates.map(x=>Date.parse(x)));
});
it("a grounded unsupported cadence asks no misleading once-or-daily question and creates nothing",async()=>{
 const p:Proposal=input=>({...proposal({title:"kiểm tra QA"})(input) as object,uncertainties:[{field:"frequency",reason:"UNSUPPORTED_COMBINATION",alternatives:[]}]});
 const h=await harness([p]);await h.turn(0,"Cứ 30 phút nhắc kiểm tra QA, bắt đầu ngày mai lúc8h.");
 expect(h.replies.at(-1)?.kind,JSON.stringify(h.events)).toBe("NOTICE");expect(h.replies.at(-1)?.text).toContain("chưa được hỗ trợ");
 expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
