import { expect, it } from "vitest";
import { supportsCadenceOperand } from "./cadence-count-evidence";
import { supportsEventRelation } from "./event-relation-evidence";
import { resolveRequest } from "./resolve";
import { lunarCalendar } from "../lunar-calendar";
import { turn } from "./context-test-fixtures";
import { date, now, request, time } from "./resolution-test-support";
import type { SourceEvidence } from "./state";

function source(text: string, quote = text) {
 const t=turn(text),start=[...text.slice(0,text.indexOf(quote))].length;
 const s:SourceEvidence={kind:"USER_QUOTE",sourceTurnId:t.id,sourceMapTurnId:t.id,quote,occurrence:1,sourceSpan:{start,end:start+[...quote].length},viewSpan:{start,end:start+[...quote].length},normalizationVersion:"nfc-codepoint-v1"};
 return {turn:t,evidence:s};
}
it.each([
 ["Nhắc mỗi tuần 2 lần lúc9h từ09/11.",2], ["Nhắc 2 lần mỗi tuần lúc9h từ09/11.",2],
 ["Nhắc 2 lần/tuần lúc9h.",2],["Nhắc mỗi tháng 3 lượt lúc9h.",3],["Nhắc mỗi ngày 2 lần lúc9h.",2],
 ["Nhắc mỗi tuần 1 lần trong4tuần.",1],
] as const)("times-per-period cannot authorize total occurrence count: %s",(text,value)=>{const s=source(text);expect(supportsCadenceOperand("occurrenceCount",value,[s.evidence],[s.turn])).toBe(false);});
it.each([
 ["Nhắc kiểm tra mỗi tuần trong 4 tuần.",4,"WEEKLY"],
 ["Nhắc kiểm tra hàng tháng trong 3 tháng.",3,"MONTHLY"],
 ["Nhắc kiểm tra hàng tuần, trong 4 tuần.",4,"WEEKLY"],
] as const)("duration only grounds the matching finite cadence: %s",(text,value,frequency)=>{
 const s=source(text);expect(supportsCadenceOperand("occurrenceCount",value,[s.evidence],[s.turn],undefined,undefined,frequency)).toBe(true);
 expect(supportsCadenceOperand("occurrenceCount",value,[s.evidence],[s.turn],undefined,undefined,frequency==="WEEKLY"?"MONTHLY":"WEEKLY")).toBe(false);
});
it.each([
 "Nhắc mỗi tuần; đi công tác trong4tuần.","Không nhắc mỗi tuần trong4tuần.","Nếu nhắc mỗi tuần trong4tuần.","Nhắc mỗi tháng trong4tuần.",
])("foreign/negated/hypothetical/wrong-unit duration is not total count: %s",text=>{const s=source(text);expect(supportsCadenceOperand("occurrenceCount",4,[s.evidence],[s.turn],undefined,undefined,"WEEKLY")).toBe(false);});
it.each([
 ["Nhắc kiểm tra mỗi tuần lúc9h từ ngày09/11/2026.","WEEKLY"],
 ["Nhắc kiểm tra hàng tháng lúc9h từ ngày09/11/2026.","MONTHLY"],
 ["Nhắc kiểm tra mỗi thứ hai lúc9h từ ngày09/11/2026.","WEEKLY"],
] as const)("STARTING_ON requires a source cue matching proposed cadence: %s",(text,frequency)=>{
 const s=source(text);expect(supportsEventRelation("STARTING_ON",[s.evidence],[s.turn],false,frequency)).toBe(true);
 expect(supportsEventRelation("STARTING_ON",[s.evidence],[s.turn],false,frequency==="WEEKLY"?"MONTHLY":"WEEKLY")).toBe(false);
});
function resolvedSource(text:string,day=9,frequency="WEEKLY",quote=text){
 const s=source(text,quote);const state=request({eventDate:null,reminderDate:date(day,11,2026),reminderTime:time(9),frequency,occurrenceCount:4,eventRelation:"STARTING_ON"});
 state.transcript=[s.turn];for(const slot of Object.values(state.slots))if(slot.value!==null)slot.evidence=[s.evidence];return state;
}
it("named weekday cannot silently become the start-date weekday",()=>{
 const r=resolveRequest(resolvedSource("Nhắc mỗi thứ hai từ ngày05/11/2026 trong4lần.",5),now,lunarCalendar);
 expect(r).toMatchObject({status:"CLARIFY",fields:["reminderDate"],reasons:["WEEKDAY_START_CONFLICT"]});
 expect(resolveRequest(resolvedSource("Nhắc mỗi thứ hai từ ngày09/11/2026 trong4lần."),now,lunarCalendar).status).toBe("READY");
});
it.each(["Nhắc mỗi thứ hai và thứ tư từ ngày09/11/2026 trong4lần.","Nhắc mỗi thứ hai, chủ nhật từ ngày09/11/2026 trong4lần."])("a partial source quote cannot conceal multiple weekdays: %s",text=>{
 expect(resolveRequest(resolvedSource(text,9,"WEEKLY","mỗi thứ hai"),now,lunarCalendar)).toMatchObject({status:"UNSUPPORTED",capability:"MULTIPLE_WEEKDAYS"});
});
it("times-per-period remains unsupported even when a model omits total count and supplies an end",()=>{
 const state=resolvedSource("Nhắc mỗi tuần 2 lần từ ngày09/11/2026 đến30/11/2026.");
 state.slots.occurrenceCount={...state.slots.occurrenceCount,state:"MISSING",value:null,fact:null,provenance:null,resolution:null,evidence:[]};
 expect(resolveRequest(state,now,lunarCalendar)).toMatchObject({status:"UNSUPPORTED",capability:"MULTIPLE_PER_PERIOD"});
});
