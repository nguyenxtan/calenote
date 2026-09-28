import type { ConversationModel, ConversationSnapshot } from "./contracts";
import type { LunarCalendarAdapter } from "./lunar-calendar";
import { reconcileConversation } from "./reconcile";
import { extractConversationTemporalEvidence } from "./temporal";
import { isExplicitListQuery } from "../semantic/reconciliation";

const normalize = (text: string) => text.normalize("NFC").trim().toLocaleLowerCase("vi-VN").replace(/\s+/gu, " ");
const words = (text: string) => text.match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
function containsTaskWords(source: string, task: string): boolean {
  const wanted = task.split(" ").filter(Boolean);
  let cursor = 0;
  for (const token of words(source).split(" ")) if (token === wanted[cursor]) cursor++;
  return wanted.length > 0 && cursor === wanted.length;
}
const editControl = /^(?:đổi|sửa|chuyển|điều chỉnh)(?:\s|$)/u;
// Positive, whole-utterance control grammar. Negations, conditionals, quoted
// commands and ambiguous closure are not cancellation authority.
export function isExplicitPendingAbandonment(text: string): boolean {
  return /^(?:(?:xin|vui lòng) )?(?:bỏ|hủy|huỷ) (?:yêu cầu|đề xuất|bản nháp)(?: này| đó| đang chờ)?(?: giúp (?:mình|tôi))?(?: nhé| nha| đi)?[.!]*$/u.test(normalize(text));
}

/** One application-owned relation boundary shared by runtime and evaluation.
 * Never import a calendar before checking standalone temporal evidence.
 * The model still supplies task semantics, not scheduling or control authority.
 */
export function evaluateConversationTurn(input: {
  text: string; receivedAt: number; sourceInboundId: string; now: number;
  model: ConversationModel; previous: ConversationSnapshot | null;
}, calendar: LunarCalendarAdapter) {
  const { model } = input;
  const previous = input.previous && ["CLARIFYING", "DRAFT_READY"].includes(input.previous.status)
    && input.previous.expiresAt > input.now ? input.previous : null;
  const text = normalize(input.text);
  const editRequested = editControl.test(text);
  const standalone = extractConversationTemporalEvidence({ ...input, currentCalendar: "GREGORIAN" }, calendar);
  const reminderVerb = /(?:^|[\s,;])nhắc(?:\s|$)/u.exec(text);
  const task = model.title === null ? "" : words(normalize(model.title));
  const tail = reminderVerb ? text.slice(reminderVerb.index + reminderVerb[0].length) : "";
  const groundedTask = containsTaskWords(tail, task);
  const completeDate = standalone.reminderDate.state === "RESOLVED" || standalone.eventDate.state === "RESOLVED";
  const newRequest = model.intent === "CREATE_REMINDER" && model.titleState === "RESOLVED"
    && model.dialogueAct !== "AMBIGUOUS" && model.dialogueAct !== "EDIT" && !editRequested && groundedTask
    && completeDate && standalone.time.state === "RESOLVED";
  const continuing = previous !== null && !newRequest && model.dialogueAct !== "NEW_REQUEST" && model.continuation === "YES";
  const temporal = continuing
    ? extractConversationTemporalEvidence({ ...input, currentCalendar: previous.request.calendar, previousRequest: previous.request }, calendar)
    : standalone;
  // A model relation label cannot turn an acknowledgment into a slot answer.
  // Require current-turn evidence, not just a copy of the pending title.
  const hasTemporalOperand = [temporal.eventDate, temporal.reminderDate, temporal.time, temporal.count, temporal.relation]
    .some(fact => fact.state !== "MISSING") || !!temporal.lunarInput || !!temporal.unsupportedCadence;
  const currentTitle = containsTaskWords(text, task);
  // Bounded unresolved-reference grammar, not an enumeration of failed inputs.
  // Only a whole generic noun + demonstrative lacks a task referent; embedded
  // references in an otherwise concrete title are not stripped or rewritten.
  const unresolvedReference = /^(?:làm )?(?:việc|cái|chuyện|điều) (?:đó|ấy|này|kia)$/u.test(task);
  // Bounded preparation summaries may add a preparation verb to a grounded
  // event referent. Every remaining word must occur in order in the source;
  // sharing incidental words such as a place preposition is not evidence.
  const eventFrame = temporal.eventDate.state !== "MISSING" || temporal.missing.includes("eventDate");
  const eventReferent = task.replace(/^(?:ôn|chuẩn bị(?: cho)?) /u, "");
  const eventTitle = eventFrame && /^(?:thi|deadline|hạn chót)(?: |$)/u.test(eventReferent)
    && containsTaskWords(text, eventReferent);
  const titleUnresolved = model.titleState === "RESOLVED" && (unresolvedReference
    || (!currentTitle && !eventTitle && (!continuing || model.title !== previous?.request.title)));
  const intentUncertain = model.intent === "CREATE_REMINDER" && (
    (continuing && !hasTemporalOperand && !currentTitle)
    || (!previous && !reminderVerb && model.titleState === "MISSING" && temporal.eventDate.state === "MISSING"));
  const decision = reconcileConversation({ model, temporal, previous, now: input.now, editRequested, newRequest,
    abandonRequested: isExplicitPendingAbandonment(input.text), listRequested: isExplicitListQuery(input.text),
    intentUncertain, titleUnresolved });
  return { temporal, decision, continuing };
}
