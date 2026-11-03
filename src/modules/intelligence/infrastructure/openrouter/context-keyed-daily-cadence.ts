import type {ContextInput} from '../../../conversation/context-contract/contracts';
import type {SourceEvidence} from '../../../conversation/context-contract/state';
import {supportsCadenceOperand} from '../../../conversation/context-contract/cadence-count-evidence';
import {CONTROL_PLACEHOLDER} from '../../../conversation/context-contract/projection';

/** Sufficient whole notification source only. This returns a presence bound,
 * never a proposed cadence/count, evidence, target or persisted operand. */
export function keyedDailyCadenceRequired(input:ContextInput):boolean {
 const active=input.activeRequest,current=input.turns[input.currentTurn];
 if(active?.lifecycle!=='CLARIFYING'||current?.role!=='USER'||input.currentTurn!==input.turns.length-1||input.ambiguities.length||input.pendingQuestion?.scope!=='REMINDER'||input.pendingQuestion.reason!=='MISSING'||Object.values(active.slots).some(slot=>slot.state==='CONFLICT'))return false;
 if(!input.capabilities.supported.includes('FINITE_DAILY')||input.capabilities.limits.dailyCount!==30)return false;
 for(const field of ['frequency','occurrenceCount'] as const){const slot=active.slots[field];if(slot.state!=='MISSING'||slot.value!==null||slot.fact!==null||input.facts.some(fact=>fact.field===field))return false;}
 const title=active.slots.title,facts=input.facts.filter(fact=>fact.field==='title'),fact=facts[0];
 if(title.state!=='RESOLVED'||title.value===null||facts.length!==1||fact.scope!=='REMINDER'||title.fact!==fact.alias||fact.value!==title.value||fact.provenance.kind!=='EXPLICIT_USER'||fact.dependencies.length||!Number.isFinite(Date.parse(fact.sourceReferenceTime))||Date.parse(fact.sourceReferenceTime)>Date.parse(input.reference.instant))return false;
 const text=current.text;
 if(/[\r\n\t"'`“”‘’]/u.test(text)||text.includes(CONTROL_PLACEHOLDER))return false;
 const match=/^\s*nhắc(?:\s+(?:tôi|mình|tui))?\s+(?:(?:trong|suốt)\s+)?(\d{1,2}|một|hai|ba)\s+ngày\s+(?:liên tiếp|liên tục|liền)\s+trước\s+(?:sự kiện|ngày thi|hôm thi|ngày đó|hôm đó|đó)\s*[.!]?\s*$/iu.exec(text);
 if(!match)return false;
 const words:Readonly<Record<string,number>>={một:1,hai:2,ba:3},count=words[match[1].toLocaleLowerCase('vi')]??Number(match[1]);
 if(!Number.isSafeInteger(count)||count<2||count>30)return false;
 const turn={id:'cadence-source',role:'USER' as const,semanticView:text},length=[...text].length;
 const source:SourceEvidence={kind:'USER_QUOTE',sourceTurnId:turn.id,sourceMapTurnId:turn.id,quote:text,occurrence:1,sourceSpan:{start:0,end:length},viewSpan:{start:0,end:length},normalizationVersion:'nfc-codepoint-v1'};
 return supportsCadenceOperand('frequency','DAILY',[source],[turn])&&supportsCadenceOperand('occurrenceCount',count,[source],[turn]);
}
