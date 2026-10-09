import type { ContextInput, FieldChangeV3, SemanticPatchProposalV3 } from "./contracts";
import type { ValidatedFieldEvidence } from "./evidence";
import type { TranscriptEntry } from "./state";
import { extractTemporalEvidence } from "../../semantic/temporal-evidence";

/** Finite complete first-person assertion only; no parsed operand is returned. */
export function isFirstPersonExamClockAssertion(text:string):boolean {
  if(!/^\s*(?:Tôi|tôi|Em|em)\s+thi\s+ngày\s+\d{1,2}[/-]\d{1,2}(?:[/-]\d{4})?\s+lúc\s+\d{1,2}(?:h(?:\d{1,2})?|:\d{2})(?:\s+(?:sáng|trưa|chiều|tối))?\s*[.!]?\s*$/u.test(text))return false;
  const time=extractTemporalEvidence({text,referenceNow:Date.parse("2026-01-01T00:00:00Z")}).time;
  return time.state==="RESOLVED"&&time.source==="EXACT_TIME";
}

type CoverageInput = {
  intent: SemanticPatchProposalV3["intent"];
  target: SemanticPatchProposalV3["requestTarget"];
  currentTurn: TranscriptEntry;
  changes: readonly FieldChangeV3[];
  changeEvidence: readonly ValidatedFieldEvidence[];
  uncertainties: SemanticPatchProposalV3["uncertainties"];
  alternativeEvidence: readonly ValidatedFieldEvidence[];
  retainedLocation: string | null;
};

/** Sufficient initial whole-clause exclusion only; unknown context never counts as empty. */
export function isInitialIsolatedExamNotesFree(input:ContextInput):boolean {
  return !!input && Array.isArray(input.turns) && input.turns.length===1 && input.currentTurn===0 && input.turns[0]?.role==="USER" && typeof input.turns[0].text==="string"
    && input.activeRequest===null && Array.isArray(input.facts) && input.facts.length===0 && input.pendingQuestion===null && Array.isArray(input.ambiguities) && input.ambiguities.length===0
    && examTitleCoverage(input.turns[0].text)!==null;
}
export function notesCoverageComplete(input:ContextInput,proposal:SemanticPatchProposalV3):boolean {
  return proposal.intent!=="CREATE_REMINDER" || !isInitialIsolatedExamNotesFree(input)
    || !proposal.changes.some(change=>change.field==="notes") && !proposal.uncertainties.some(issue=>issue.field==="notes"&&issue.alternatives.length>0);
}

/** Presence/coverage only for the initial literal complete exam task. Unknown
 * subjects and ambiguous discourse never create a generation obligation. */
export function examTitleCoverage(text: string, value?: unknown): boolean | null {
  if(isFirstPersonExamClockAssertion(text))return value==="đi thi";
  if (/["'“”‘’`?]/u.test(text) || text.includes("[CONTROL]")
    || /(?:^|[^\p{L}])(?:không|ko|chẳng|đừng|chưa|nếu|ví dụ|giả sử|hay là|lịch|xem|liệt kê|giải thích|tiếp tục|bản nháp|giữ|đổi|thay|sửa|bỏ|xóa|cụm từ|từ ngữ|tên|chữ|trích dẫn|đâu|nào|gì)(?:[^\p{L}]|$)/iu.test(text)) return null;
  const matches=[...text.matchAll(/(?:^|[^\p{L}])(đi thi)(?=$|[,;.!\n]|\s+(?:ở|tại|nhắc|nhé|nha|ngày|lúc|vào)(?:[^\p{L}]|$))/giu)];
  if(matches.length!==1) return null;
  const subjectStart=matches[0].index!+matches[0][0].length-matches[0][1].length;
  // Only finite assertion introductions are admitted. An unknown question,
  // metalinguistic instruction or discourse prefix is not reminder authority.
  if(!/^(?:\s*(?:ngày\s+\d{1,2}[/-]\d{1,2}(?:[/-]\d{4})?|mai|hôm nay|tôi|nhắc(?:\s+(?:tôi|mình|tui))?)\s+)?$/iu.test(text.slice(0,subjectStart)))return null;
  // Positively admit only finite venue/scheduling continuations. Merely seeing
  // a comma, locative or reminder verb cannot admit arbitrary trailing tasks.
  const count="(?:\\d+|một|hai|ba)",clock="\\d{1,2}(?:h(?:\\d{1,2})?|:\\d{2})(?:\\s+(?:sáng|chiều|tối))?";
  const schedule=`(?:lúc\\s+${clock}|ngày\\s+\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{4})?|nhắc\\s+(?:(?:tôi|mình|tui)\\s+)?(?:trước\\s+${count}\\s+ngày|${count}\\s+ngày\\s+liên tiếp|lúc\\s+${clock})|giúp tôi|nhé|nha)`;
  const venue="(?:\\s+(?:ở|tại)\\s+\\p{Lu}[\\p{L}\\p{M}\\p{N}-]*(?:\\s+\\p{Lu}[\\p{L}\\p{M}\\p{N}-]*)*)?";
  const tail=text.slice(subjectStart+matches[0][1].length);
  if(!new RegExp(`^${venue}(?:[\\s,;]+${schedule})*[\\s.!]*$`,"u").test(tail))return null;
  if(typeof value!=="string"||!value.length)return false;
  const valueStart=text.indexOf(value);
  return valueStart>=0 && valueStart<=subjectStart && valueStart+value.length>=subjectStart+matches[0][1].length;
}

export function titleCoverageComplete(input: Omit<CoverageInput,"retainedLocation"> & {retainedTitle:string|null}): boolean {
  if(input.target?.kind==="CURRENT"&&isFirstPersonExamClockAssertion(input.currentTurn.semanticView))return true;
  if(input.intent!=="CREATE_REMINDER" || input.currentTurn.role!=="USER" || examTitleCoverage(input.currentTurn.semanticView)===null) return true;
  const text=input.currentTurn.semanticView;
  const covered=(value:unknown,bound:ValidatedFieldEvidence|undefined)=>examTitleCoverage(text,value)===true && bound?.current===true
    && bound.sources.some(source=>source.sourceTurnId===input.currentTurn.id && examTitleCoverage([...text].slice(source.viewSpan.start,source.viewSpan.end).join(""),value)===true);
  const titles=input.changes.map((change,index)=>({change,bound:input.changeEvidence[index]})).filter(p=>p.change.field==="title");
  if(titles.some(p=>p.change.operation!=="CLEAR" && covered(p.change.value,p.bound))) return true;
  let index=0, alternativeCovered=false;
  for(const uncertainty of input.uncertainties) for(const alternative of uncertainty.alternatives){
    const bound=input.alternativeEvidence[index++];
    if(uncertainty.field==="title" && covered(alternative.value,bound)) alternativeCovered=true;
  }
  if(titles.length===0 && alternativeCovered) return true;
  return titles.length===0 && input.target?.kind==="CURRENT" && examTitleCoverage(text,input.retainedTitle)===true;
}

const continuationBoundary = /^(?:$|[,;.!\n]|\s+(?:[Nn]gày\s+(?:\d{1,2}[/-]\d{1,2}|mai|kia)|[Ll]úc\s+\d{1,2}(?:h|:)|[Vv]ào\s+(?:ngày\s+)?\d{1,2}[/-]\d{1,2}|nhớ\s+(?:mang|đem|gọi|chuẩn bị)|nhắc\s+(?:\d+|tôi|mình|tui|lúc)|nhé|nha|rồi\s+(?:về|đi|ăn)|và\s+(?:ăn|về|đi|nhắc))(?:[^\p{L}]|$))/u;

/** Bounded omission check only. Never returns, fills or persists an operand.
 * Unknown linguistic forms remain outside this narrow coverage obligation. */
export function locationCoverageComplete(input: CoverageInput): boolean {
  if (input.intent !== "CREATE_REMINDER" || input.currentTurn.role !== "USER") return true;
  const text = input.currentTurn.semanticView;
  // Do not treat quoted, hypothetical, removed-control or question language as
  // an asserted venue. No normalization changes the immutable source.
  if (/["'“”‘’`?]/u.test(text) || text.includes("[CONTROL]")
    || /(?:^|[^\p{L}])(?:nếu|ví dụ|giả sử|hay là)(?:[^\p{L}]|$)/iu.test(text)) return true;
  const pattern = /(?:^|[^\p{L}])(?:đi thi|thi|họp|khám|gặp|đi làm)\s+(?:ở|tại)\s+([\p{L}\p{N}][\p{L}\p{N}\s-]{0,299}?)(?=\s+(?:nhớ|nhắc|nhé|nha|rồi|và|ngày\s+(?:\d{1,2}[/-]\d{1,2}|mai|kia)|lúc\s+\d{1,2}(?:h|:)|vào\s+(?:ngày\s+)?\d{1,2}[/-]\d{1,2})(?:[^\p{L}]|$)|[,;.!\n]|$)/giu;
  for (const match of text.matchAll(pattern)) {
    const prefix = text.slice(0, match.index).split(/[,;.!\n]/u).at(-1) ?? "";
    if (/(?:^|[^\p{L}])(?:không|ko|chẳng|đừng|chưa|cụm từ|từ ngữ|tên|chữ|trích dẫn)(?:[^\p{L}]|$)/iu.test(prefix)
      || /(?:^|[^\p{L}])(?:không|ko|chẳng|chưa|đâu|nào|hay|hoặc)(?:[^\p{L}]|$)/iu.test(match[1])) continue;
    const place = match[1].trimEnd();
    const end = [...text.slice(0, match.index! + match[0].length)].length - [...match[1]].length + [...place].length;
    const start = end - [...place].length;
    const discoveredTail = [...text].slice(end).join("");
    // An unrecognized lower-case discourse continuation is ambiguous, not a
    // proven venue boundary. Discovery and coverage share the same eligibility.
    if (/^\s+(?:nhớ|nhắc|rồi|và)(?:[^\p{L}]|$)/u.test(discoveredTail) && !continuationBoundary.test(discoveredTail)) continue;
    // Validate the model's own literal at the locative start before considering
    // a finite continuation marker. A marker inside a proper venue name must
    // not truncate a grounded proposed value (e.g. Công ty Ngày Mới).
    const literalSpan = (value: unknown): {end:number} | null => {
      if (typeof value !== "string" || value.length === 0) return null;
      const suffix = [...text].slice(start).join("");
      if (!suffix.startsWith(value)) return null;
      const tail = suffix.slice(value.length);
      // Scheduling markers require an actual date/clock continuation, not a
      // bare word occurring in a venue. Discourse markers are case-sensitive;
      // an uppercase proper-name word cannot authorize a truncated prefix.
      if (!continuationBoundary.test(tail)) return null;
      return {end:start+[...value].length};
    };
    const covered = (value: unknown, bound: ValidatedFieldEvidence | undefined) => {
      const span = literalSpan(value);
      return span !== null && bound?.current === true && bound.sources.some(source => source.sourceTurnId === input.currentTurn.id
        && source.viewSpan.start <= start && source.viewSpan.end >= span.end);
    };
    const locations = input.changes.map((change,index) => ({change,bound:input.changeEvidence[index]})).filter(p => p.change.field === "location");
    if (locations.some(p => p.change.operation !== "CLEAR" && covered(p.change.value,p.bound))) continue;
    let index = 0;
    let uncertainCoverage = false;
    for (const uncertainty of input.uncertainties) for (const alternative of uncertainty.alternatives) {
      const bound = input.alternativeEvidence[index++];
      if (uncertainty.field === "location" && covered(alternative.value,bound)) uncertainCoverage = true;
    }
    if (uncertainCoverage && locations.length === 0) continue;
    if (input.target?.kind === "CURRENT" && locations.length === 0 && literalSpan(input.retainedLocation)) continue;
    return false;
  }
  return true;
}
