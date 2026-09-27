import type { ConversationModel, ConversationSnapshot } from "./contracts";
import type { LunarCalendarAdapter } from "./lunar-calendar";
import { reconcileConversation } from "./reconcile";
import { extractConversationTemporalEvidence } from "./temporal";

const normalize = (text: string) => text.normalize("NFC").trim().toLocaleLowerCase("vi-VN").replace(/\s+/gu, " ");
const words = (text: string) => text.match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
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
  const groundedTask = task.length > 0 && (` ${words(tail)} `).includes(` ${task} `);
  const completeDate = standalone.reminderDate.state === "RESOLVED" || standalone.eventDate.state === "RESOLVED";
  const newRequest = model.intent === "CREATE_REMINDER" && model.titleState === "RESOLVED"
    && model.dialogueAct !== "AMBIGUOUS" && model.dialogueAct !== "EDIT" && !editRequested && groundedTask
    && completeDate && standalone.time.state === "RESOLVED";
  const continuing = previous !== null && !newRequest && model.dialogueAct !== "NEW_REQUEST" && model.continuation === "YES";
  const temporal = continuing
    ? extractConversationTemporalEvidence({ ...input, currentCalendar: previous.request.calendar, previousRequest: previous.request }, calendar)
    : standalone;
  const decision = reconcileConversation({ model, temporal, previous, now: input.now, editRequested, newRequest,
    abandonRequested: isExplicitPendingAbandonment(input.text) });
  return { temporal, decision, continuing };
}
