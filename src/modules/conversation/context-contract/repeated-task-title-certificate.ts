import type {ContextInput} from './contracts';
import type {SourceEvidence} from './state';
import {relativeMonthOccurrenceCount} from './relative-month-evidence';

const action='(?:sửa|bảo dưỡng|vệ sinh|kiểm tra)';
const object='\\p{L}[\\p{L}\\p{M}]{0,39}(?: \\p{L}[\\p{L}\\p{M}]{0,39}){0,5}';
const week='(?:[1-9]|[1-4][0-9]|5[0-2])';
const clock='(?:[1-9]|1[01])h(?:[0-5][0-9])? sáng';
const tail=`(?:\\. Nhắc (?:trước ${week} tuần(?:\\. Liên tục vào ${clock})?|một lần trước ${week} tuần lúc ${clock}))?`;
const whole=new RegExp(`^Hôm nay (?<action>${action}) (?<object>${object})\\. Đặt (?:[1-9]|1[0-2]) tháng sau \\k<action> lại${tail}\\.?$`,'iu');
const excludedObjectWord=/(?:^| )(?:không|khong|ko|đừng|dung|chẳng|chưa|nếu|neu|hoặc|hay|và|rồi|nhưng|nhắc|nhac|ngày|tháng|tuần|giờ|lúc|vào|gì|nào|đâu|ai|sao|bản|nháp|lời|câu|chữ|tên|từ|ngữ|trích|dẫn|là|xóa|hủy|bỏ|đổi|thay|sửa|lại|bảo|dưỡng|vệ|sinh|kiểm|tra)(?: |$)/iu;

/** Sufficient presence proof for one explicitly named repeated task. Private
 * matches/probes supply only a Boolean lower bound, never a title, temporal
 * operand, target, source binding or permission to save. */
export function isInitialRepeatedTaskTitleRequired(input:ContextInput):boolean {
 if(input.currentTurn!==0||input.turns.length!==1||input.turns[0]?.role!=='USER'
  ||input.activeRequest!==null||input.facts.length||input.pendingQuestion!==null||input.ambiguities.length
  ||input.currentBurstTurns!==undefined||input.currentBurstReferences!==undefined
  ||!Number.isFinite(Date.parse(input.reference.instant))||!input.capabilities.calendars.includes('GREGORIAN')
  ||!input.capabilities.supported.includes('ONCE'))return false;
 const text=input.turns[0].text;
 if(text!==text.normalize('NFC')||/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(text))return false;
 const match=whole.exec(text);if(!match?.groups||excludedObjectWord.test(match.groups.object))return false;
 const id='repeated-task-title-presence',length=[...text].length,turn={id,role:'USER' as const,semanticView:text};
 const source:SourceEvidence={kind:'USER_QUOTE',sourceTurnId:id,sourceMapTurnId:id,quote:text,occurrence:1,
  sourceSpan:{start:0,end:length},viewSpan:{start:0,end:length},normalizationVersion:'nfc-codepoint-v1'};
 let occurrences=0;
 for(let offsetMonths=1;offsetMonths<=12;offsetMonths++)occurrences+=relativeMonthOccurrenceCount({kind:'RELATIVE_MONTH',offsetMonths},[source],[turn]);
 return occurrences===1;
}
