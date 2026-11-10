import type {ContextInput} from '../../../conversation/context-contract/contracts';
import type {SourceEvidence} from '../../../conversation/context-contract/state';
import {CONTROL_PLACEHOLDER} from '../../../conversation/context-contract/projection';
import {isBareNumericClockAnswer} from '../../../conversation/context-contract/semantic-completeness';
import {supportsCadenceOperand} from '../../../conversation/context-contract/cadence-count-evidence';
import {relativeMonthOccurrenceCount} from '../../../conversation/context-contract/relative-month-evidence';
import {hasLeadWeekOffsetEvidence} from '../../../conversation/context-contract/lead-week-evidence';

const unsafe=/[\r\n\t\v\f\u0085\u2028\u2029"'“”‘’\x60?]/u;
const uncertain=/(?:^|[^\p{L}\p{M}\p{N}_])(?:không|khong|ko|đừng|dung|chẳng|chang|chưa|chua|nếu|neu|ví dụ|vi du|giả sử|gia su|hoặc|hoac|hay là|và)(?:$|[^\p{L}\p{M}\p{N}_])/iu;
export type ClosedWindowSourcePolicy={leadField:'leadOffsetWeeks'|'leadOffsetDays';clockRequired:boolean};

/** Intersect new owner obligations with the unchanged backend week language.
 * The older date-role certificate deliberately keeps its original scope. */
export function keyedWeekLeadSourceSupported(input:ContextInput):boolean {
 const current=input.turns[input.currentTurn];if(current?.role!=='USER')return false;
 const text=current.text,id='window-week-current',length=[...text].length,turn={id,role:'USER' as const,semanticView:text};
 const source:SourceEvidence={kind:'USER_QUOTE',sourceTurnId:id,sourceMapTurnId:id,quote:text,occurrence:1,sourceSpan:{start:0,end:length},viewSpan:{start:0,end:length},normalizationVersion:'nfc-codepoint-v1'};
 return hasLeadWeekOffsetEvidence([source],[turn],!!input.activeRequest?.slots.eventDate.value);
}

/** Boolean support for an existing clock; no newly parsed clock is returned. */
export function restatesKnownClock(value:unknown,atom:string,morning:boolean,reference:string):boolean {
 if(!value||typeof value!=='object'||!('hour'in value)||!('minute'in value)||!('qualifier'in value))return false;
 const {hour,minute,qualifier}=value;
 if(typeof hour!=='number'||!Number.isInteger(hour)||hour<0||hour>23
  ||typeof minute!=='number'||!Number.isInteger(minute)||minute<0||minute>59
  ||qualifier!=='H24'&&qualifier!=='AM'||qualifier==='AM'&&(hour<1||hour>11)
  ||morning&&(hour<1||hour>11)||!isBareNumericClockAnswer(atom,reference))return false;
 const h=String(hour),hh=h.padStart(2,'0'),m=String(minute).padStart(2,'0');
 const forms=[`${h}:${m}`,`${hh}:${m}`,`${h}h${m}`,`${hh}h${m}`,...(minute===0?[`${h}h`,`${hh}h`]:[])];
 return forms.includes(atom.toLocaleLowerCase('vi'));
}

/** Whole-source eligibility only. The lexical unit selects a field name;
 * quantities, clocks and evidence never leave these private support probes. */
export function keyedClosedDailyWindowSource(input:ContextInput,retainedClock?:unknown):ClosedWindowSourcePolicy|undefined {
 const current=input.turns[input.currentTurn],reference=input.reference.instant;
 if(current?.role!=='USER'||!Number.isFinite(Date.parse(reference)))return;
 const text=current.text;if(unsafe.test(text)||uncertain.test(text)||text.includes(CONTROL_PLACEHOLDER))return;
 const match=/^\s*nhắc(?:\s+(?:tôi|mình|tui))?\s+trước\s+(\d{1,2}|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)\s+(tuần|ngày)[.,]?\s+(?:liên tục|liên tiếp|mỗi ngày|hằng ngày|hàng ngày)\s+(?:vào|lúc)\s+(\d{1,2}(?:h(?:\d{1,2})?|:\d{2}))(?:\s+(sáng|trưa|chiều|tối))?\s*[.!]?\s*$/iu.exec(text);
 if(!match||!isBareNumericClockAnswer(match[3],reference))return;
 const words:Readonly<Record<string,number>>={một:1,hai:2,ba:3,bốn:4,năm:5,sáu:6,bảy:7,tám:8,chín:9,mười:10};
 const count=words[match[1].toLocaleLowerCase('vi')]??Number(match[1]),weeks=match[2].toLocaleLowerCase('vi')==='tuần';
 if(!Number.isSafeInteger(count)||count<1||count>(weeks?4:30))return;
 const daypart=match[4]?.toLocaleLowerCase('vi'),hour=Number(/^\d{1,2}/u.exec(match[3])![0]);
 const clockRequired=!daypart||daypart==='sáng'&&hour>=1&&hour<=11;
 if(retainedClock!==undefined&&(!clockRequired||!restatesKnownClock(retainedClock,match[3],daypart==='sáng',reference)))return;
 const id='closed-window-current',length=[...text].length,turn={id,role:'USER' as const,semanticView:text};
 const source:SourceEvidence={kind:'USER_QUOTE',sourceTurnId:id,sourceMapTurnId:id,quote:text,occurrence:1,sourceSpan:{start:0,end:length},viewSpan:{start:0,end:length},normalizationVersion:'nfc-codepoint-v1'};
 for(let offsetMonths=1;offsetMonths<=12;offsetMonths++)if(relativeMonthOccurrenceCount({kind:'RELATIVE_MONTH',offsetMonths},[source],[turn]))return;
 if(!supportsCadenceOperand('frequency','DAILY',[source],[turn]))return;
 return {leadField:weeks?'leadOffsetWeeks':'leadOffsetDays',clockRequired};
}
