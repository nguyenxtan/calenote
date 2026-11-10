import type {ContextInput} from '../../../conversation/context-contract/contracts';
import {isFirstPersonExamClockAssertion,isInitialIsolatedExamNotesFree} from '../../../conversation/context-contract/semantic-completeness';

/** Sufficient fresh event assertion only. Supplies no operand, source or
 * persistence authority; an incomplete reminder remains a known action. */
export function keyedInitialEventOperationRequired(input:ContextInput):boolean {
 return isInitialIsolatedExamNotesFree(input)
  && !/[\r\n]/u.test(input.turns[0].text)
  && isFirstPersonExamClockAssertion(input.turns[0].text);
}
