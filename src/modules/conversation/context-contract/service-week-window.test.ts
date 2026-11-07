// @vitest-environment node
import { expect, it } from "vitest";
import { harness, proposal, type Proposal } from "./service-test-support";
import { date, time } from "./resolution-test-support";
import { createKeyedContextContractGateway } from "../../intelligence/infrastructure/openrouter/keyed-context-gateway";
import { encodeKeyedSmallComparison } from "../../intelligence/infrastructure/openrouter/context-provider-keyed-small-wire";
import { ConversationInterpretationV3Schema } from "./contracts";

async function keyed(proposals: Proposal[]) {
 const h=await harness([]);
 h.deps.gateway={contextWire:"KEYED_COMPARISON_137",prepare(tier,input){
  h.inputs.push(structuredClone(input));
  const gateway=createKeyedContextContractGateway(async()=>{
   const script=proposals.shift();if(!script)throw Error("unexpected provider call");
   const canonical=ConversationInterpretationV3Schema.parse(script(input)),wire=encodeKeyedSmallComparison(canonical,input);
   return {status:200,body:JSON.stringify({model:"openai/gpt-5-mini",provider:"Azure",usage:{cost:0,prompt_tokens:1,completion_tokens:1},choices:[{finish_reason:"stop",message:{content:JSON.stringify(wire)}}]})};
  },{status:"OBSERVABLE_CANARY",advertisedContextTokens:400000});
  const prepared=gateway.prepare(tier,input);return prepared.status==="READY"?{...prepared,maximumCostMicrounits:1815}:prepared;
 }};
 return h;
}
const event = { title: "đi thi", eventDate: date(20,10,2026) };
const week = { leadOffsetWeeks: 1, eventRelation: "BEFORE_EVENT", frequency: "DAILY", reminderTime: time(8) };
const details = (h: Awaited<ReturnType<typeof keyed>>) => JSON.stringify({replies:h.replies.map(reply=>reply.text),rejected:h.events.filter(e=>e.event==="POST_CANONICAL_STAGE"&&e.diagnostic.result==="REJECTED")});

// Removing active-keyed week ownership, evidence or finite expansion must break this real roundtrip.
it("reported current week plus continuous 8am becomes seven preceding dates through active keyed gateway", async () => {
 const h=await keyed([proposal(event),proposal(week,"CURRENT")]);
 expect(await h.turn(0,"Ngày20/10/2026 đi thi."),details(h)).toEqual({status:"CLARIFICATION_REQUESTED"});
 expect(await h.turn(1,"Nhắc trước 1 tuần. Liên tục vào 8h sáng."),details(h)).toEqual({status:"DRAFT_CREATED"});
 const state=(await h.read(2))!;
 expect(state.slots.leadOffsetWeeks?.value).toBe(1);
 expect(state.slots.leadOffsetDays.value).toBeNull();
 expect(state.slots.frequency.value).toBe("DAILY");
 expect(state.slots.occurrenceCount.provenance?.kind).toBe("DERIVED_POLICY");
 expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
 expect(await h.turn(2,"Có"),details(h)).toEqual({status:"CONFIRMED"});
 const rows=await h.f.db.prepare("SELECT scheduled_at FROM reminders ORDER BY scheduled_at").all<{scheduled_at:number}>();
 expect(rows.results.map(row=>row.scheduled_at)).toEqual([
  Date.parse("2026-10-13T08:00:00+07:00"),Date.parse("2026-10-14T08:00:00+07:00"),Date.parse("2026-10-15T08:00:00+07:00"),Date.parse("2026-10-16T08:00:00+07:00"),
  Date.parse("2026-10-17T08:00:00+07:00"),Date.parse("2026-10-18T08:00:00+07:00"),Date.parse("2026-10-19T08:00:00+07:00"),
 ]);
});
it("explicit once one week before remains one notification and preserves the authored week", async () => {
 const h=await keyed([proposal({...event,leadOffsetWeeks:1,eventRelation:"BEFORE_EVENT",frequency:"ONCE",reminderTime:time(8)})]);
 expect(await h.turn(0,"Ngày20/10/2026 đi thi, nhắc một lần trước 1 tuần lúc8h sáng."),details(h)).toEqual({status:"DRAFT_CREATED"});
 const state=(await h.read(1))!;expect(state.slots.leadOffsetWeeks?.value).toBe(1);
 expect(await h.turn(1,"Có")).toEqual({status:"CONFIRMED"});
 expect(await h.f.db.prepare("SELECT scheduled_at FROM reminders").first("scheduled_at")).toBe(Date.parse("2026-10-13T08:00:00+07:00"));
 expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
});
it("unbounded continuous at 8am asks for a finite count and creates no preview", async () => {
 const h=await keyed([proposal(event),proposal({frequency:"DAILY",reminderTime:time(8)},"CURRENT")]);
 await h.turn(0,"Ngày20/10/2026 đi thi.");
 expect(await h.turn(1,"Liên tục vào 8h sáng."),details(h)).toEqual({status:"CLARIFICATION_REQUESTED"});
 const state=(await h.read(2))!;
 expect(state.slots.frequency.value).toBe("DAILY");expect(state.pendingReminderQuestion?.field).toBe("occurrenceCount");
 expect(h.replies.some(reply=>reply.kind==="PREVIEW")).toBe(false);
 expect(await h.f.db.prepare("SELECT count(*) n FROM command_drafts").first("n")).toBe(0);
});
it("fresh multi-sentence week plus continuous clock confirms seven reminders through the active gateway", async () => {
 const h=await keyed([proposal({...event,eventDate:date(20,12,2026),...week})]);
 expect(await h.turn(0,"Ngày 20/12/2026 đi thi. Nhắc trước 1 tuần. Liên tục vào 8h sáng."),details(h)).toEqual({status:"DRAFT_CREATED"});
 const state=(await h.read(1))!;
 expect(state.slots.frequency.value).toBe("DAILY");expect(state.slots.occurrenceCount.value).toBe(7);
 expect(state.slots.occurrenceCount.provenance?.kind).toBe("DERIVED_POLICY");
 expect(state.slots.leadOffsetWeeks?.value).toBe(1);expect(state.slots.leadOffsetDays.value).toBeNull();
 expect(await h.turn(1,"Có"),details(h)).toEqual({status:"CONFIRMED"});
 const rows=await h.f.db.prepare("SELECT scheduled_at FROM reminders ORDER BY scheduled_at").all<{scheduled_at:number}>();
 expect(rows.results.map(row=>row.scheduled_at)).toEqual([
  Date.parse("2026-12-13T08:00:00+07:00"),Date.parse("2026-12-14T08:00:00+07:00"),Date.parse("2026-12-15T08:00:00+07:00"),Date.parse("2026-12-16T08:00:00+07:00"),
  Date.parse("2026-12-17T08:00:00+07:00"),Date.parse("2026-12-18T08:00:00+07:00"),Date.parse("2026-12-19T08:00:00+07:00"),
 ]);
});
it("fresh multi-sentence continuous omission cannot issue a single preview through the active gateway", async () => {
 const {frequency:omitted,...withoutFrequency}=week;void omitted;
 const h=await keyed([proposal({...event,eventDate:date(20,12,2026),...withoutFrequency})]);
 expect(await h.turn(0,"Ngày 20/12/2026 đi thi. Nhắc trước 1 tuần. Liên tục vào 8h sáng."),details(h)).toEqual({status:"REJECTED"});
 expect(h.replies.some(reply=>reply.kind==="PREVIEW")).toBe(false);
 expect(await h.f.db.prepare("SELECT count(*) n FROM command_drafts").first("n")).toBe(0);
});
it("a fresh bare continuous clock clause on a named task asks for finite bounds", async () => {
 const h=await keyed([proposal({...event,eventDate:date(20,12,2026),frequency:"DAILY",reminderTime:time(8)})]);
 expect(await h.turn(0,"Ngày 20/12/2026 đi thi. Liên tục vào 8h sáng."),details(h)).toEqual({status:"CLARIFICATION_REQUESTED"});
 const state=(await h.read(1))!;expect(state.slots.frequency.value).toBe("DAILY");
 expect(state.pendingReminderQuestion?.field).toBe("occurrenceCount");
 expect(h.replies.some(reply=>reply.kind==="PREVIEW")).toBe(false);
});
it("a deferred NEW burst retains week and clock sources and expands the same seven-day window", async () => {
 const texts=["Ngày 20/12/2026 đi thi.","Nhắc trước 1 tuần.","Liên tục vào 8h sáng."];
 const h=await keyed([input=>{
  const ref=(turn:number)=>[{kind:"USER_QUOTE",turn,quote:texts[turn],occurrence:1}];
  return {schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:ref(0)},
   changes:[...Object.entries({...event,eventDate:date(20,12,2026)}).map(([field,value])=>({field,value,operation:"SET",evidence:ref(0)})),
    ...Object.entries({leadOffsetWeeks:1,eventRelation:"BEFORE_EVENT"}).map(([field,value])=>({field,value,operation:"SET",evidence:ref(1)})),
    ...Object.entries({frequency:"DAILY",reminderTime:time(8)}).map(([field,value])=>({field,value,operation:"SET",evidence:ref(input.currentTurn)}))],
   query:null,uncertainties:[],conversationDirective:null,replyProposal:null};
 }]);
 for(const index of [1,2]){
  const id=h.f.scope(index).sourceInboundId,encrypted=await h.f.keyring.encryptSensitive("inbound-message",id,1,texts[index]);
  await h.f.db.prepare("UPDATE inbound_updates SET state='PENDING',transition_marker=NULL,message_ciphertext=?,message_iv=? WHERE id=?").bind(encrypted.ciphertext,encrypted.iv,id).run();
 }
 expect(await h.turn(0,texts[0])).toEqual({status:"DEFERRED"});
 await h.f.db.prepare("UPDATE inbound_updates SET state='PROCESSING',transition_marker='claim' WHERE id='in-1'").run();
 expect(await h.turn(1,texts[1])).toEqual({status:"DEFERRED"});
 await h.f.db.prepare("UPDATE inbound_updates SET state='PROCESSING',transition_marker='claim' WHERE id='in-2'").run();
 expect(await h.turn(2,texts[2]),details(h)).toEqual({status:"DRAFT_CREATED"});
 expect(h.inputs).toHaveLength(1);expect(h.inputs[0].currentBurstTurns).toEqual([0,1,2]);
 expect(h.inputs[0].turns.map(turn=>turn.text)).toEqual(texts);
 const state=(await h.read(3))!;
 expect(state.slots.leadOffsetWeeks?.evidence[0].sourceTurnId).toBe(h.f.scope(1).sourceInboundId);
 expect(state.slots.reminderTime.evidence[0].sourceTurnId).toBe(h.f.scope(2).sourceInboundId);
 expect(await h.turn(3,"Có"),details(h)).toEqual({status:"CONFIRMED"});
 const rows=await h.f.db.prepare("SELECT scheduled_at FROM reminders ORDER BY scheduled_at").all<{scheduled_at:number}>();
 expect(rows.results).toHaveLength(7);
 expect(rows.results[0].scheduled_at).toBe(Date.parse("2026-12-13T08:00:00+07:00"));
 expect(rows.results[6].scheduled_at).toBe(Date.parse("2026-12-19T08:00:00+07:00"));
});
