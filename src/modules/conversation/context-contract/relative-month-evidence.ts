import type {SourceEvidence,TranscriptEntry} from './state';

type Turn=Pick<TranscriptEntry,'id'|'role'|'semanticView'>;
const words=['không','một','hai','ba','bốn','năm','sáu','bảy','tám','chín','mười','mười một','mười hai'] as const;
const dateFields=new Set(['eventDate','reminderDate','endDate']);
const lower=(text:string)=>[...text].map(c=>{const folded=c.toLocaleLowerCase('vi');return [...folded].length===1?folded:c;}).join('');

/** Verify a model-authored month operand against its exact source. This never
 * returns a date, chooses a slot, or converts a month into a day count. */
export function supportsRelativeMonthDate(value:unknown,sources:readonly SourceEvidence[],turns:readonly Turn[]):boolean {
 if(!value||typeof value!=='object'||!('kind'in value)||value.kind!=='RELATIVE_MONTH'||!('offsetMonths'in value)||typeof value.offsetMonths!=='number'||!Number.isSafeInteger(value.offsetMonths)||Math.abs(value.offsetMonths)>12)return false;
 const amount=Math.abs(value.offsetMonths),token=`(?:${amount}|${words[amount]})`;
 const pattern=value.offsetMonths<0?new RegExp(`${token}\\s+tháng\\s+trước`,'gu'):new RegExp(`(?:sau\\s+${token}\\s+tháng|${token}\\s+tháng\\s+(?:sau|nữa|tới))`,'gu');
 return sources.some(source=>{
  const turn=turns.find(t=>t.id===source.sourceTurnId);if(turn?.role!=='USER')return false;
  const text=lower(turn.semanticView),quote=lower(source.quote),view=[...text];
  if(/["'“”‘’`]/u.test(text)||/(?:^|[^\p{L}\p{M}\p{N}_])(?:nếu|ví dụ|giả sử|cụm từ|từ ngữ|trích dẫn)(?:$|[^\p{L}\p{M}\p{N}_])/u.test(text))return false;
  for(const match of quote.matchAll(pattern)){
   const start=source.viewSpan.start+[...quote.slice(0,match.index)].length,end=start+[...match[0]].length;
   if(/[\p{L}\p{M}\p{N}_.,/:+-]/u.test(view[start-1]??'')||/[\p{L}\p{M}\p{N}_]/u.test(view[end]??''))continue;
   const prefix=view.slice(0,start).join('').split(/[;,.!?\n]/u).at(-1)??'',suffix=view.slice(end).join('').replace(/^[\s\p{P}]+/u,'');
   if(/(?:^|[^\p{L}\p{M}\p{N}_])(?:không|ko|đừng|chẳng|chưa|tên|chữ)(?:$|[^\p{L}\p{M}\p{N}_])/u.test(prefix)||/^(?:thì\s+)?(?:không|ko|đừng|chẳng|chưa)(?:$|[^\p{L}\p{M}\p{N}_])/u.test(suffix))continue;
   return true;
  }
  return false;
 });
}

/** Reject-only coverage of a bounded positive relative-month expression.
 * Constant typed probes exercise the same verifier; no source-derived amount
 * or role is supplied to generation, merge, or storage. */
export function relativeMonthDateCovered(turn:Turn,changes:readonly {field:string;value:unknown}[],alternatives:readonly {field:string;value:unknown}[],retained:readonly unknown[]=[]):boolean {
 if(turn.role!=='USER')return true;
 const length=[...turn.semanticView].length,source:SourceEvidence={kind:'USER_QUOTE',sourceTurnId:turn.id,sourceMapTurnId:turn.id,quote:turn.semanticView,occurrence:1,sourceSpan:{start:0,end:length},viewSpan:{start:0,end:length},normalizationVersion:'nfc-codepoint-v1'};
 for(let offsetMonths=1;offsetMonths<=12;offsetMonths++){
  const probe={kind:'RELATIVE_MONTH',offsetMonths};if(!supportsRelativeMonthDate(probe,[source],[turn]))continue;
  if([...retained,...[...changes,...alternatives].filter(change=>dateFields.has(change.field)).map(change=>change.value)].some(value=>value&&typeof value==='object'&&'kind'in value&&value.kind==='RELATIVE_MONTH'&&'offsetMonths'in value&&value.offsetMonths===offsetMonths))continue;
  return false;
 }
 return true;
}

/** Reject a historical receipt-relative date borrowed by a notification in
 * the same source as an already-proposed future month event. No date, role or
 * instruction is extracted: only this typed pair's source support is checked. */
export function monthEventReminderDateRolesSupported(event:unknown,eventSources:readonly SourceEvidence[],reminder:unknown,reminderSources:readonly SourceEvidence[],turns:readonly Turn[]):boolean {
 if(!event||typeof event!=='object'||!('kind'in event)||event.kind!=='RELATIVE_MONTH'||!('offsetMonths'in event)||typeof event.offsetMonths!=='number'||event.offsetMonths<=0)return true;
 if(!reminder||typeof reminder!=='object'||!('kind'in reminder)||reminder.kind!=='RELATIVE_DAY'||!('offsetDays'in reminder)||typeof reminder.offsetDays!=='number'||!Number.isSafeInteger(reminder.offsetDays)||reminder.offsetDays>0)return true;
 const shared=reminderSources.filter(source=>eventSources.some(eventSource=>eventSource.sourceTurnId===source.sourceTurnId));
 if(!shared.length)return true;
 const amount=Math.abs(reminder.offsetDays),token=`(?:${amount}${amount<words.length?`|${words[amount]}`:''})`;
 const day=reminder.offsetDays===0?'hôm nay':reminder.offsetDays===-1?'hôm qua':`${token}\\s+ngày\\s+trước`;
 const clock='\\d{1,2}(?:h(?:\\d{1,2})?|:\\d{2})(?:\\s+(?:sáng|trưa|chiều|tối))?';
 const patterns=[
  `nhắc(?:\\s+(?:tôi|mình|tui))?(?:\\s+(?:vào|trong|ngày))?\\s+(?<day>${day})`,
  `nhắc(?:\\s+(?:tôi|mình|tui))?\\s+(?:lúc|vào)\\s+${clock}\\s+(?<day>${day})`,
  `(?<day>${day})(?:\\s+(?:lúc|vào)\\s+${clock})?\\s+nhắc`,
 ];
 return shared.every(source=>{
  const turn=turns.find(turn=>turn.id===source.sourceTurnId);if(turn?.role!=='USER')return false;
  const text=lower(turn.semanticView);
  if(/["'“”‘’`]/u.test(text)||/(?:^|[^\p{L}\p{M}\p{N}_])(?:nếu|ví dụ|giả sử|cụm từ|từ ngữ|trích dẫn)(?:$|[^\p{L}\p{M}\p{N}_])/u.test(text))return false;
  return patterns.some(pattern=>[...text.matchAll(new RegExp(pattern,'gu'))].some(match=>{
   const start=match.index!,end=start+match[0].length;
   if(/[\p{L}\p{M}\p{N}_]/u.test(text[start-1]??'')||/[\p{L}\p{M}\p{N}_]/u.test(text[end]??''))return false;
   const prefix=text.slice(0,start).split(/[;,.!?\n]/u).at(-1)??'',suffix=text.slice(end).replace(/^[\s\p{P}]+/u,'');
   if(/(?:^|[^\p{L}\p{M}\p{N}_])(?:không|ko|đừng|chẳng|chưa|tên|chữ)(?:$|[^\p{L}\p{M}\p{N}_])/u.test(prefix)||/^(?:thì\s+)?(?:không|ko|đừng|chẳng|chưa)(?:$|[^\p{L}\p{M}\p{N}_])/u.test(suffix))return false;
   const dayStart=[...text.slice(0,start+match[0].indexOf(match.groups!.day))].length,dayEnd=dayStart+[...match.groups!.day].length;
   return source.viewSpan.start<=dayStart&&source.viewSpan.end>=dayEnd;
  }));
 });
}
