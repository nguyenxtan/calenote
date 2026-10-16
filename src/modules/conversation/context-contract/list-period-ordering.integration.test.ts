// @vitest-environment node
import {expect,it} from "vitest";
import {harness,type Proposal} from "./service-test-support";
const list:Proposal=input=>({schemaVersion:"calenote-context-3",intent:"LIST_REMINDERS",requestTarget:null,changes:[],query:{kind:"LIST",period:{kind:"MONTH",offset:0},statusScope:"DEFAULT",evidence:[{kind:"USER_QUOTE",turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}]},uncertainties:[],conversationDirective:null,replyProposal:null});
const unknown=(wire:unknown)=>{const w=wire as {query:{period:{kind:string}}};w.query.period.kind="DATE";return w;};
it("R01 actual path recovers DATE only from verified current month, with one read and no mutations",async()=>{
 const h=await harness([list,list],unknown),ranges:unknown[]=[];const actual=h.deps.list;h.deps.list=input=>{ranges.push(input.range);return actual(input);};
 expect(await h.turn(0,"Có lịch nào ko?")).toEqual({status:"CLARIFICATION_REQUESTED"});expect(ranges).toEqual([]);
 expect(await h.turn(1,"Tháng này có lịch gì ko?")).toEqual({status:"REMINDERS_LISTED"});
 expect(ranges).toEqual([{start:Date.parse("2026-09-01T00:00:00+07:00"),end:Date.parse("2026-10-01T00:00:00+07:00")}]);
 expect(h.inputs).toHaveLength(2);expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
 const trace=h.events.filter(e=>e.event==="POST_CANONICAL_STAGE").map(e=>e.diagnostic);
 expect(trace).toContainEqual(expect.objectContaining({stage:"PERIOD_RECONCILIATION",modelPeriodAuthority:"NONE",candidateRange:"MONTH"}));
 const last=trace.slice(trace.map(d=>d.stage).lastIndexOf("TRANSPORT"));expect(last.map(d=>d.stage).indexOf("PERIOD_RECONCILIATION")).toBeLessThan(last.map(d=>d.stage).indexOf("CANONICAL"));
});
it("unknown without range never grants a read",async()=>{
 const h=await harness([list],unknown);let reads=0;const actual=h.deps.list;h.deps.list=i=>{reads++;return actual(i);};
 expect(await h.turn(0,"Có lịch nào ko?")).toEqual({status:"CLARIFICATION_REQUESTED"});expect(reads).toBe(0);expect(h.inputs).toHaveLength(1);
});
