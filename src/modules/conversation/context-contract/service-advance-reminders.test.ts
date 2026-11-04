// @vitest-environment node
import { expect, it } from "vitest";
import { harness, proposal } from "./service-test-support";
import { date, time } from "./resolution-test-support";
const meeting = { title:"họp QA",eventDate:date(2,10,2026),eventTime:time(15) };
const text = "Ngày 02/10/2026 lúc 15h có cuộc họp QA, nhắc giúp tôi.";
const preferences = { addressStyle:"sep" as const,customDisplayName:null,advanceReminderDays:2,advanceReminderHours:3 };
it("previews and saves exactly two independent advance timestamps, fixed through preference changes",async()=>{
 const h=await harness([proposal(meeting)]);h.deps.getReplyPreferences=async()=>preferences;
 expect(await h.turn(0,text)).toEqual({status:"DRAFT_CREATED"});
 const s=(await h.read(1))!;
 expect(h.replies[0].text).toContain("2026-09-30 15:00");expect(h.replies[0].text).toContain("2026-10-02 12:00");
 h.deps.getReplyPreferences=async()=>({...preferences,advanceReminderDays:7,advanceReminderHours:24});
 expect(await h.turn(1,`xác nhận ${s.pendingDecision!.tokenHandle}`)).toEqual({status:"CONFIRMED"});
 const rows=(await h.f.db.prepare("SELECT scheduled_at FROM reminders ORDER BY scheduled_at").all<{scheduled_at:number}>()).results;
 expect(rows.map(r=>r.scheduled_at)).toEqual([Date.parse("2026-09-30T15:00:00+07:00"),Date.parse("2026-10-02T12:00:00+07:00")]);
 expect(h.events.filter(e=>e.event==="REQUEST_DISPATCHED")).toHaveLength(1);
});
it("explicit reminder date/time override both advance defaults",async()=>{
 const h=await harness([proposal({...meeting,reminderDate:date(1,10,2026),reminderTime:time(10)})]);h.deps.getReplyPreferences=async()=>preferences;
 expect(await h.turn(0,text+" Nhắc vào ngày01/10/2026 lúc10h.")).toEqual({status:"DRAFT_CREATED"});
 const s=(await h.read(1))!;expect(await h.turn(1,`xác nhận ${s.pendingDecision!.tokenHandle}`)).toEqual({status:"CONFIRMED"});
 expect((await h.f.db.prepare("SELECT scheduled_at FROM reminders").all<{scheduled_at:number}>()).results).toEqual([{scheduled_at:Date.parse("2026-10-01T10:00:00+07:00")}]);
});
it("equal1day and24hour defaults create only one notification",async()=>{
 const h=await harness([proposal(meeting)]);h.deps.getReplyPreferences=async()=>({...preferences,advanceReminderDays:1,advanceReminderHours:24});
 expect(await h.turn(0,text)).toEqual({status:"DRAFT_CREATED"});const s=(await h.read(1))!;
 expect(await h.turn(1,`xác nhận ${s.pendingDecision!.tokenHandle}`)).toEqual({status:"CONFIRMED"});
 expect((await h.f.db.prepare("SELECT scheduled_at FROM reminders").all<{scheduled_at:number}>()).results).toEqual([{scheduled_at:Date.parse("2026-10-01T15:00:00+07:00")}]);
});
it("does not silently save a past selected advance or apply defaults to reminder-only input",async()=>{
 const h=await harness([proposal({...meeting,eventDate:date(29,9,2026)}),proposal({title:"họp QA",reminderDate:date(2,10,2026),reminderTime:time(15)},"NEW")]);h.deps.getReplyPreferences=async()=>preferences;
 const past = await h.turn(0,"Ngày 29/09/2026 lúc 15h có cuộc họp QA, nhắc giúp tôi.");
 expect(past,JSON.stringify(h.replies)).toEqual({status:"CLARIFICATION_REQUESTED"});
 expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
 expect(h.replies.at(-1)?.text).toContain("Một mốc nhắc trước đã qua");
 await h.turn(1,"bỏ");
 expect(await h.turn(2,"Ngày 02/10/2026 lúc 15h nhắc họp QA.")).toEqual({status:"DRAFT_CREATED"});
 const current=(await h.read(3))!;
 expect(await h.turn(3,`xác nhận ${current.pendingDecision!.tokenHandle}`)).toEqual({status:"CONFIRMED"});
 expect((await h.f.db.prepare("SELECT scheduled_at FROM reminders").all<{scheduled_at:number}>()).results).toEqual([{scheduled_at:Date.parse("2026-10-02T15:00:00+07:00")}]);
});

it.each([
 {extra:" Nhắc một lần.",values:{frequency:"ONCE"}},
 {extra:" Nhắc hôm đó.",values:{eventRelation:"INCLUDING_EVENT"}},
 {extra:" Nhắc 3 lần.",values:{occurrenceCount:3}},
])("advance defaults cannot override an explicit cadence/relation: $extra",async({extra,values})=>{
 const h=await harness([proposal({...meeting,...values})]);h.deps.getReplyPreferences=async()=>preferences;
 const result=await h.turn(0,text+extra);
 expect(result).toEqual({status:"CLARIFICATION_REQUESTED"});
 expect(h.replies.at(-1)?.kind).not.toBe("PREVIEW");
 expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
