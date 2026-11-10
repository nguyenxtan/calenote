import type {ContextInput} from './contracts';
import type {SourceEvidence} from './state';

/** Sufficient source classification only. No date, offset, calendar, evidence
 * alias or operation is produced; unfamiliar or retained inputs decline. */
export function isInitialRelativeCalendarQuestion(input:ContextInput):boolean {
 if(input.currentTurn!==0||input.turns.length!==1||input.turns[0].role!=='USER'
  ||input.activeRequest!==null||input.pendingQuestion!==null||input.facts.length||input.ambiguities.length
  ||input.currentBurstTurns!==undefined||input.currentBurstReferences!==undefined
  ||!Number.isFinite(Date.parse(input.reference.instant))
  ||!input.capabilities.calendars.includes('GREGORIAN')||!input.capabilities.calendars.includes('LUNAR_VN'))return false;
 const text=input.turns[0].text;
 // Context semantic views are already NFC. Exact ordinary spaces and the
 // anchored grammar exclude quotes, negation, extra actions and control text.
 return text===text.normalize('NFC')
  && /^(?:hôm nay|hôm qua|ngày mai)(?: là)? ngày (?:mấy|bao nhiêu) (?:âm|dương) lịch[?!.]?$/iu.test(text);
}

/** Reject-only fidelity for an authored calendar query in the closed source.
 * Null operands remain genuinely missing. Validated citations must cover each
 * supplied operand's cue; comparisons never supply or repair a query value. */
export function supportsInitialRelativeCalendarQuery(value:unknown,input:ContextInput,sources:readonly SourceEvidence[],currentTurnId:string):boolean {
 if(!isInitialRelativeCalendarQuestion(input)||!value||typeof value!=='object'
  ||!('kind'in value)||value.kind!=='CALENDAR_DATE')return true;
 if(!('date'in value)||!('outputCalendar'in value))return false;
 const text=input.turns[0].text.toLocaleLowerCase('vi');
 const cited=(cue:string)=>sources.some(source=>source.sourceTurnId===currentTurnId
  &&source.quote.toLocaleLowerCase('vi').includes(cue));
 if(value.date!==null){
  const date=value.date;
  if(!date||typeof date!=='object'||!('kind'in date)||date.kind!=='RELATIVE_DAY'||!('offsetDays'in date))return false;
  if(!(date.offsetDays===0&&text.startsWith('hôm nay ')&&cited('hôm nay')
   ||date.offsetDays===-1&&text.startsWith('hôm qua ')&&cited('hôm qua')
   ||date.offsetDays===1&&text.startsWith('ngày mai ')&&cited('ngày mai')))return false;
 }
 return value.outputCalendar===null
  ||value.outputCalendar==='LUNAR_VN'&&text.includes(' âm lịch')&&cited('âm lịch')
  ||value.outputCalendar==='GREGORIAN'&&text.includes(' dương lịch')&&cited('dương lịch');
}
