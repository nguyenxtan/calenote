import { expect, it } from "vitest";
import { resolveRequest } from "./resolve";
import { lunarCalendar } from "../lunar-calendar";
import { date, now, request, time } from "./resolution-test-support";
import type { ContextSnapshotV2 } from "./state";

const periodic = (values: Record<string, unknown> = {}) => request({ eventDate: null, location: null, reminderDate: date(9, 11, 2026), reminderTime: time(9), frequency: "WEEKLY", occurrenceCount: 4, eventRelation: "STARTING_ON", ...values });
it("weekly preserves exact civil weekday across month/year and includes the end date", () => {
  const r = resolveRequest(periodic({ occurrenceCount: null, endDate: date(30, 11, 2026) }), now, lunarCalendar);
  expect(r).toMatchObject({ status: "READY", occurrences: [9, 16, 23, 30].map(d => ({ localDate: `2026-11-${d.toString().padStart(2,"0")}`, scheduledAt: Date.parse(`2026-11-${d.toString().padStart(2,"0")}T09:00:00+07:00`) })), resolvedSlots: { occurrenceCount: { value: 4, provenance: { kind: "DERIVED_POLICY" } } } });
  const year = resolveRequest(periodic({ reminderDate: date(28, 12, 2026), occurrenceCount: 3 }), now, lunarCalendar);
  expect(year.status).toBe("READY"); if (year.status === "READY") expect(year.occurrences.map(o=>o.localDate)).toEqual(["2026-12-28","2027-01-04","2027-01-11"]);
});
it("weekly end need not be an occurrence; an explicit incompatible count is rejected", () => {
  expect(resolveRequest(periodic({ occurrenceCount: null, endDate: date(2,12,2026) }), now,lunarCalendar)).toMatchObject({status:"READY",resolvedSlots:{occurrenceCount:{value:4}}});
  expect(resolveRequest(periodic({ occurrenceCount: 5, endDate: date(30,11,2026) }), now,lunarCalendar)).toMatchObject({status:"CLARIFY",fields:["occurrenceCount"],reasons:["COUNT_RANGE_CONFLICT"]});
});
it("monthly always uses the original anchor date and excludes an anchor after the inclusive end", () => {
  const r=resolveRequest(periodic({ frequency:"MONTHLY",reminderDate:date(31,12,2026),occurrenceCount:null,endDate:date(15,2,2027) }),now,lunarCalendar);
  expect(r).toMatchObject({status:"READY",occurrences:[{localDate:"2026-12-31"},{localDate:"2027-01-31"}],resolvedSlots:{occurrenceCount:{value:2}}});
});
it.each([
  [31,1,2027,3,"2027-02"], [30,1,2027,3,"2027-02"], [29,1,2027,3,"2027-02"], [31,3,2027,2,"2027-04"],
])("monthly missing anchor %s/%s/%s clarifies before any partial save",(d,m,y,count,invalidMonth)=>{
  expect(resolveRequest(periodic({frequency:"MONTHLY",reminderDate:date(d,m,y),occurrenceCount:count}),now,lunarCalendar)).toMatchObject({status:"CLARIFY",fields:["reminderDate"],reasons:["MONTH_DAY_MISSING"],invalidMonth});
});
it("monthly leap-year29 stays29 in following months",()=>{
  const r=resolveRequest(periodic({frequency:"MONTHLY",reminderDate:date(29,1,2028),occurrenceCount:3}),Date.parse("2028-01-01T00:00:00Z"),lunarCalendar);
  expect(r).toMatchObject({status:"READY",occurrences:[{localDate:"2028-01-29"},{localDate:"2028-02-29"},{localDate:"2028-03-29"}]});
});
it.each([
  [{occurrenceCount:null},"occurrenceCount","MISSING"],
  [{occurrenceCount:1},"occurrenceCount","LIMIT"],
  [{occurrenceCount:31},"occurrenceCount","LIMIT"],
  [{endDate:date(8,11,2026),occurrenceCount:null},"endDate","INCOMPATIBLE_RANGE"],
  [{reminderDate:null},"reminderDate","MISSING"],
  [{reminderTime:null},"reminderTime","MISSING"],
  [{reminderDate:date(28,9,2026)},"reminderDate","PAST_OCCURRENCE"],
  [{frequency:"MONTHLY",occurrenceCount:14},"reminderDate","HORIZON_LIMIT"],
] as const)("periodic limits/missing/past %j",(values,field,reason)=>{
  expect(resolveRequest(periodic(values),now,lunarCalendar)).toMatchObject({status:"CLARIFY",fields:expect.arrayContaining([field]),reasons:expect.arrayContaining([reason])});
});
it("weekly permits30 but rejects a first occurrence that passes before confirmation",()=>{
  expect(resolveRequest(periodic({reminderDate:date(1,10,2026),occurrenceCount:30}),now,lunarCalendar)).toMatchObject({status:"READY",occurrences:expect.arrayContaining([{index:29,localDate:"2027-04-22",scheduledAt:Date.parse("2027-04-22T09:00:00+07:00")}])});
  expect(resolveRequest(periodic(),Date.parse("2026-11-09T09:00:00+07:00"),lunarCalendar)).toMatchObject({status:"CLARIFY",reasons:["PAST_OCCURRENCE"]});
});
it.each(["WEEKLY","MONTHLY"])("%s rejects lunar and event-relative recurrence without silently changing it",frequency=>{
  expect(resolveRequest(periodic({frequency,calendar:"LUNAR_VN",reminderDate:{kind:"CIVIL_DATE",calendar:"LUNAR_VN",year:2026,month:10,day:1,leapMonth:false}}),now,lunarCalendar).status).toBe("UNSUPPORTED");
  expect(resolveRequest(periodic({frequency,eventRelation:"BEFORE_EVENT",eventDate:date(30,11,2026),reminderDate:null}),now,lunarCalendar).status).toBe("UNSUPPORTED");
});
it("explicit weekly/monthly cadence never applies optional advance defaults",()=>{
  for(const frequency of ["WEEKLY","MONTHLY"]){
    const r=resolveRequest({...periodic({frequency,reminderDate:date(9,11,2026),occurrenceCount:2}),schemaVersion:"calenote-context-state-2",pendingSemanticCandidate:null,advanceReminders:{days:2,hours:3}} as ContextSnapshotV2,now,lunarCalendar);
    expect(r).toMatchObject({status:"READY",occurrences:[{localDate:"2026-11-09"},{}]});if(r.status==="READY")expect(r.details.advanceReminders).toBeUndefined();
  }
});
