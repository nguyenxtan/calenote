import type {ContextInput} from './contracts';

/** Sufficient classification of a whole read-only question beside one ready
 * draft. This returns no period, intent object, target, evidence or patch. */
export function isCertifiedRetainedListQuestion(input:ContextInput):boolean {
 const current=input.turns[input.currentTurn];
 if(input.activeRequest?.lifecycle!=='AWAITING_CONFIRMATION'||input.pendingQuestion!==null
  ||input.ambiguities.length||input.currentBurstTurns!==undefined||input.currentBurstReferences!==undefined
  ||!Number.isSafeInteger(input.currentTurn)||input.currentTurn<=0||input.currentTurn!==input.turns.length-1
  ||current?.role!=='USER'||!input.capabilities.supported.includes('LIST')
  ||!Number.isFinite(Date.parse(input.reference.instant)))return false;
 const text=current.text;
 // Exact spaces and a whole-string grammar exclude fragments, payload quotes,
 // negation, extra actions and calendar-conversion questions. Decline past
 // periods here; their general interpretation remains unchanged.
 return text===text.normalize('NFC')&&!/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(text)
  &&/^tháng (?:này|sau|tới) có (?:lịch|lời nhắc) gì[?!.]?$/iu.test(text);
}
