// @vitest-environment node
import { expect, it } from "vitest";
import { typedHarness, proposal } from "./service-test-support";
import { date } from "./resolution-test-support";

it("typed105 carries R02 yearless eventDate through actual service without a date JSON string", async () => {
  let observed: Record<string, unknown> | undefined;
  const h = await typedHarness([proposal({title: "đi thi", eventDate: date(11, 10, null), location: "Quang Trung", frequency: "DAILY", occurrenceCount: 2})], wire => {
    observed = structuredClone(wire) as Record<string, unknown>;
    return wire;
  });
  await h.turn(0, "Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.");
  const carrier = observed!.eventDateChange as {change:{value:unknown;evidence:Record<string,unknown>}};
  expect(carrier.change.value).toEqual({kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null});
  expect(carrier.change.evidence.additionalEvidence).toEqual([]);
  expect(carrier.change.evidence).not.toHaveProperty("additionalEvidenceJson");
  expect(h.events.some(e => e.event === "REQUEST_DISPATCHED" && e.promptVersion === "calenote-context-typed-objects-105")).toBe(true);
  expect((await h.read(1))?.slots.eventDate.value).toEqual(carrier.change.value);
  expect(await h.f.db.prepare("SELECT count(*) as n FROM reminders").first("n")).toBe(0);
});

it("typed105 refuses reintroduced nested change JSON before any draft or reminder mutation", async () => {
  const h = await typedHarness([proposal({title:"đi thi", eventDate:date(11,10,null),location:"Quang Trung"})], wire => {
    const value = structuredClone(wire) as {eventDateChange:{change:unknown}};
    value.eventDateChange.change = JSON.stringify(value.eventDateChange.change);
    return value;
  });
  await h.turn(0,"Ngày 11/10 đi thi ở Quang Trung.");
  expect((await h.read(1))?.slots.title.value ?? null).toBeNull();
  expect(await h.f.db.prepare("SELECT count(*) as n FROM reminders").first("n")).toBe(0);
  expect(h.events.some(e=>e.event === "RESPONSE_RECEIVED" && e.outcome === "FAILURE" && e.reason === "SCHEMA_INVALID")).toBe(true);
});

it("typed105 enforces local title bounds before mutation even when generation permits a string",async()=>{
 const h=await typedHarness([proposal({title:"đi thi",eventDate:date(11,10,null),location:"Quang Trung"})],wire=>{
  const value=structuredClone(wire) as {titleChange:{change:{value:unknown}}};value.titleChange.change.value="x".repeat(2001);return value;
 });
 await h.turn(0,"Ngày 11/10 đi thi ở Quang Trung.");
 expect((await h.read(1))?.slots.title.value??null).toBeNull();
 expect(await h.f.db.prepare("SELECT count(*) as n FROM reminders").first("n")).toBe(0);
 expect(h.events.some(e=>e.event==="RESPONSE_RECEIVED"&&e.outcome==="FAILURE"&&e.reason==="SCHEMA_INVALID")).toBe(true);
});

it("typed105 rejects factored generation field/value mismatches before any mutation",async()=>{
 const base=proposal({title:"đi thi",eventDate:date(11,10,null),location:"Quang Trung"});
 const h=await typedHarness([input=>{
  const value=base(input) as {requestTarget:{evidence:unknown}};
  return {...value,uncertainties:[{field:"leadOffsetDays",reason:"AMBIGUOUS",alternatives:[{value:2,evidence:value.requestTarget.evidence}]}]};
 }],wire=>{
  const value=structuredClone(wire) as {uncertainties:Array<{alternatives:Array<{value:unknown}>}>};value.uncertainties[0].alternatives[0].value="invalid-number";return value;
 });
 await h.turn(0,"Ngày 11/10 đi thi ở Quang Trung.");
 expect((await h.read(1))?.slots.title.value??null).toBeNull();
 expect(await h.f.db.prepare("SELECT count(*) as n FROM reminders").first("n")).toBe(0);
 expect(h.events.some(e=>e.event==="RESPONSE_RECEIVED"&&e.outcome==="FAILURE"&&e.reason==="SCHEMA_INVALID")).toBe(true);
});
