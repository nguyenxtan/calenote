import { expect, it } from "vitest";
import { supportsEventRelation, type EventRelation } from "./event-relation-evidence";
import { turn } from "./context-test-fixtures";
import type { SourceEvidence } from "./state";

function support(text: string, value: EventRelation, quote = text) {
  const start = [...text.slice(0,text.indexOf(quote))].length;
  const evidence: SourceEvidence = {kind:"USER_QUOTE",sourceTurnId:"old",sourceMapTurnId:"old",quote,occurrence:1,sourceSpan:{start,end:start+[...quote].length},viewSpan:{start,end:start+[...quote].length},normalizationVersion:"nfc-codepoint-v1"};
  return supportsEventRelation(value,[evidence],[turn(text)]);
}
it.each([
  ["2 ngày liên tiếp", "BEFORE_EVENT", false],
  ["Nhắc hai ngày liên tiếp trước hôm thi.", "BEFORE_EVENT", true],
  ["Nhắc trước 2 ngày.", "BEFORE_EVENT", true],
  ["Nhắc trước 8 giờ.", "BEFORE_EVENT", false],
  ["Nhắc trước ngày mai.", "BEFORE_EVENT", false],
  ["Tính cả ngày thi.", "INCLUDING_EVENT", true],
  ["Nhắc hôm đó.", "INCLUDING_EVENT", true],
  ["Bắt đầu từ ngày 08/10.", "STARTING_ON", true],
  ["Không nhắc trước ngày thi.", "BEFORE_EVENT", false],
  ["Không phải tính cả ngày thi, nhắc trước ngày thi.", "BEFORE_EVENT", true],
  ["Không cần đổi giờ; nhắc trước ngày thi.", "BEFORE_EVENT", true],
  ["Ví dụ nhắc trước ngày thi.", "BEFORE_EVENT", false],
  ["'nhắc trước ngày thi'", "BEFORE_EVENT", false],
  ["Nhắc trước ngày thi và tính cả ngày thi.", "BEFORE_EVENT", false],
  ["Nhắc trước ngày thi thì không cần.", "BEFORE_EVENT", false],
  ["Cụm từ trước ngày thi.", "BEFORE_EVENT", false],
  ["Hai ngày trước tôi đổi giờ; nhắc 2 ngày liên tiếp.", "BEFORE_EVENT", false],
  ["Tôi đổi giờ trước 2 ngày; nhắc 2 ngày liên tiếp.", "BEFORE_EVENT", false],
] as const)("%s supports %s only when grounded (%s)",(text,value,want)=>expect(support(text,value)).toBe(want));
it("citing count alone cannot borrow a relation outside the exact quote",()=>expect(support("Nhắc trước ngày thi 2 ngày liên tiếp.","BEFORE_EVENT","2 ngày liên tiếp")).toBe(false));
it("negation outside the selected quote remains visible",()=>expect(support("Đừng nhắc trước ngày thi.","BEFORE_EVENT","nhắc trước ngày thi")).toBe(false));
it("retained event context cannot turn historical narrative into a bare answer",()=>{
  for(const text of ["Trước hai ngày tôi đổi giờ.","Hai ngày trước tôi đổi giờ."]) {
    const n=[...text].length,evidence:SourceEvidence={kind:"USER_QUOTE",sourceTurnId:"old",sourceMapTurnId:"old",quote:text,occurrence:1,sourceSpan:{start:0,end:n},viewSpan:{start:0,end:n},normalizationVersion:"nfc-codepoint-v1"};
    expect(supportsEventRelation("BEFORE_EVENT",[evidence],[turn(text)],true)).toBe(false);
  }
});
