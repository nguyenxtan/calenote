import { randomOpaqueId } from "@/modules/platform/types";
import type { Keyring } from "@/modules/security/keyring";
import { semanticReferenceWallClock, type SemanticGateway, type SemanticAttemptResult } from "@/modules/intelligence/semantic-gateway";
import type { SemanticBudgetStore } from "@/modules/semantic/budget-store";
import { extractTemporalEvidence } from "@/modules/semantic/temporal-evidence";
import { reconcileSemanticInterpretation } from "@/modules/semantic/reconciliation";
import { MAX_SEMANTIC_SCHEDULE_AHEAD_MS } from "@/modules/semantic/validation";
import type { BoundChatContext, BoundChatMessage, ProcessBoundChatResult, ReminderCommandStore } from "@/modules/reminders/command-service";
import { semanticQueryRange, type SemanticReminderQuery, type QueriedReminder } from "@/modules/reminders/semantic-query";
import { expandFiniteSeries, type SeriesStore } from "@/modules/reminders/series";
import { CONVERSATION_ABSOLUTE_TTL_MS, CONVERSATION_IDLE_TTL_MS, ConversationSnapshotSchema,
  ConversationModelSchema, type ConversationModel, type ConversationScope, type ConversationSnapshot, type PendingRequest } from "./contracts";
import type { ConversationInput } from "./prompt";
import type { ConversationStore } from "./context-store";
import type { ConversationRuntimeStore } from "./infrastructure/d1/runtime-store";
import type { LunarCalendarAdapter } from "./lunar-calendar";
import { extractConversationTemporalEvidence } from "./temporal";
import { reconcileConversation } from "./reconcile";
import { composeConversationReply } from "./responses";

export interface ConversationServiceDependencies {
  contextStore: ConversationStore; seriesStore: SeriesStore; commandStore: ReminderCommandStore;
  runtimeStore: ConversationRuntimeStore; calendar: LunarCalendarAdapter;
  gateway: SemanticGateway<ConversationModel, ConversationInput>; budgetStore: SemanticBudgetStore;
  keyring: Pick<Keyring, "encryptSensitive" | "decryptSensitive">;
  now(): number; reply(text: string): Promise<void>;
  list(input: SemanticReminderQuery): Promise<QueriedReminder[]>;
  processingFeedback?: () => Promise<void>;
  tone?: "friendly" | "concise";
  getTone?(ownerId: string): Promise<"friendly" | "concise">;
}
const confirm = new Set(["có", "ok", "1", "xác nhận"]);
const cancel = new Set(["hủy", "huỷ", "không", "2"]);
const greeting = /^(?:chào(?: bạn| calenote)?|xin chào(?: bạn| calenote)?|hello|hi)[!.\s]*$/u;
const edit = /^(?:đổi|sửa|chuyển|điều chỉnh)(?:\s|$)/u;
const unavailable = "Mình chưa xử lý được yêu cầu này lúc này. Chưa có lời nhắc mới; thông tin đang chờ vẫn giữ nguyên, bạn thử lại sau nhé.";
const displayDate = (date: string) => date.split("-").reverse().join("/");

export function createConversationService(deps: ConversationServiceDependencies) {
  async function reply(text: string) { try { await deps.reply(text); } catch { /* Never retry an uncertain outbound. */ } }
  async function finish(scope: ConversationScope, text: string, status: ProcessBoundChatResult["status"] = "REJECTED"): Promise<ProcessBoundChatResult> {
    if (!await deps.runtimeStore.complete({ ...scope, now: deps.now() })) return { status: "SUPERSEDED" };
    await reply(text); return { status };
  }
  async function interpret(scope: ConversationScope, input: ConversationInput): Promise<ConversationModel | null> {
    if (!await deps.runtimeStore.claimAttempt(scope)) return null;
    const attempt = deps.gateway.prepare("PRIMARY", input);
    if (attempt.status !== "READY") return null;
    const reservation = await deps.budgetStore.reservePaidCall({ ownerId: scope.ownerId, sourceInboundId: scope.sourceInboundId, now: deps.now() });
    if (reservation.status !== "RESERVED") return null;
    const budgetScope = { ownerId: scope.ownerId, reservationId: reservation.reservationId };
    if (!Number.isSafeInteger(reservation.reservedMaximumMicrounits) || reservation.reservedMaximumMicrounits < attempt.maximumCostMicrounits) {
      await deps.budgetStore.releaseOrExpireReservation({ ...budgetScope, reason: "SAFE_FAILURE", now: deps.now() }); return null;
    }
    if (!await deps.budgetStore.markDispatched({ ...budgetScope, now: deps.now() })) return null;
    try { await deps.processingFeedback?.(); } catch { /* Task 7 supplies managed nonblocking feedback. */ }
    let result: SemanticAttemptResult<ConversationModel>;
    try { result = await attempt.dispatch(); } catch { result = { status: "FAILURE", category: "PROVIDER_FAILURE" }; }
    try { await deps.budgetStore.finalizeUsage({ ...budgetScope, actualCostMicrounits: result.usage?.costMicrounits ?? null, now: deps.now() }); } catch { /* Expiry charges dispatched ceiling. */ }
    if (result.status !== "SUCCESS") return null;
    const parsed = ConversationModelSchema.safeParse(result.interpretation);
    return parsed.success ? parsed.data : null;
  }
  function snapshot(message: BoundChatMessage, prior: ConversationSnapshot | null, request: PendingRequest, draft: boolean): ConversationSnapshot {
    const now = deps.now();
    const createdAt = prior?.createdAt ?? message.receivedAt;
    return { id: prior?.id ?? randomOpaqueId(), revision: (prior?.revision ?? 0) + 1,
      status: draft ? "DRAFT_READY" : "CLARIFYING", createdAt, request,
      expiresAt: Math.min(createdAt + CONVERSATION_ABSOLUTE_TTL_MS, message.receivedAt + CONVERSATION_IDLE_TTL_MS,
        draft ? now + 600_000 : Infinity, prior?.status === "DRAFT_READY" ? prior.expiresAt : Infinity),
      turns: [...(prior?.turns ?? []), { userText: message.text, receivedAt: message.receivedAt,
        outcomeCode: draft ? "PROPOSE" : `CLARIFY_${request.missing[0]?.toUpperCase() ?? "INTENT"}` }],
    };
  }
  return {
    async handle(message: BoundChatMessage, context: BoundChatContext): Promise<ProcessBoundChatResult> {
      const scope: ConversationScope = { ownerId: context.userId, chatIdentityId: context.chatIdentityId,
        sourceInboundId: message.id, claimMarker: message.claimMarker, now: deps.now() };
      const normalized = message.text.normalize("NFC").trim().toLocaleLowerCase("vi-VN");
      try {
        if (context.timezone !== "Asia/Ho_Chi_Minh") return finish(scope, unavailable);
        const previous = await deps.contextStore.load(scope);
        const pending = await deps.seriesStore.findPending(scope);
        if (confirm.has(normalized)) {
          if (!pending) return finish(scope, "Không có đề xuất nào đang chờ xác nhận.");
          if (pending.action === "CANCEL") {
            const result = await deps.seriesStore.cancelRemaining(scope, pending.proposalId, pending.revision);
            if (result !== "CANCELLED") return finish(scope, "Đề xuất hủy không còn hiệu lực; chưa thay đổi chuỗi nhắc.");
            await reply("Đã hủy các lần nhắc tương lai chưa được gửi xử lý. Lần đang gửi hoặc chưa rõ kết quả không thể thu hồi.");
            return { status: "CANCELLED" };
          }
          const result = await deps.seriesStore.confirm(scope, pending.proposalId, pending.revision);
          if (result.status !== "CONFIRMED") return finish(scope, "Đề xuất không còn hiệu lực. Bạn gửi lại yêu cầu để xem lịch mới nhé.");
          await reply("Đã xác nhận chuỗi lời nhắc đúng lịch bạn vừa duyệt."); return { status: "CONFIRMED" };
        }
        if (cancel.has(normalized)) {
          if (previous && !await deps.contextStore.finish(scope, previous.id, previous.revision, "CANCELLED")) return { status: "SUPERSEDED" };
          if (pending && !await deps.seriesStore.discard(scope, pending.proposalId, pending.revision)) return { status: "SUPERSEDED" };
          return finish(scope, "Mình đã bỏ yêu cầu đang chờ. Lời nhắc đã xác nhận không thay đổi.", "CANCELLED");
        }
        let tone = deps.tone ?? "friendly";
        try { tone = await deps.getTone?.(scope.ownerId) ?? tone; } catch { /* Personalization is best-effort, not authority. */ }
        const wording = (decision: Parameters<typeof composeConversationReply>[0]["decision"]) => composeConversationReply({ decision,
          previousQuestion: previous?.request.missing[0] ?? null, tone, lunarAvailable: true });
        if (greeting.test(normalized)) return finish(scope, wording({ kind: "GREET" }));
        if (["help", "/help", "trợ giúp", "hướng dẫn"].includes(normalized)) return finish(scope, wording({ kind: "HELP" }));
        if (pending?.action === "CANCEL") return finish(scope, "Bạn đang có đề xuất hủy chuỗi. Gửi “có” để xác nhận hoặc “hủy” để bỏ đề xuất.");
        const model = await interpret(scope, { text: message.text, ...semanticReferenceWallClock(message.receivedAt),
          ...(previous ? { conversationContext: { title: previous.request.title,
            turns: previous.turns.map(({ userText, outcomeCode }) => ({ userText, outcomeCode })) } } : {}) });
        if (!model) return finish(scope, unavailable);
        const continuing = previous !== null && model.dialogueAct !== "NEW_REQUEST" && model.continuation === "YES";
        const temporal = extractConversationTemporalEvidence({ text: message.text, receivedAt: message.receivedAt,
          sourceInboundId: message.id, currentCalendar: continuing ? previous.request.calendar : "GREGORIAN",
          ...(continuing ? { previousRequest: previous.request } : {}) }, deps.calendar);
        const decision = reconcileConversation({ model, temporal, previous, now: deps.now(), editRequested: edit.test(normalized) });
        if (decision.kind === "ABANDON_PENDING") {
          if (previous && !await deps.contextStore.finish(scope, previous.id, previous.revision, "CANCELLED")) return { status: "SUPERSEDED" };
          if (pending) await deps.seriesStore.discard(scope, pending.proposalId, pending.revision);
          return finish(scope, wording(decision), "CANCELLED");
        }
        if (decision.kind === "READ_ONLY_LIST") {
          const query = reconcileSemanticInterpretation({ text: message.text,
            modelInterpretation: { intent: "LIST_REMINDERS", title: null, titleState: "NOT_APPLICABLE", targetIntent: null },
            temporalEvidence: extractTemporalEvidence({ text: message.text, referenceNow: message.receivedAt }), processingNow: deps.now() });
          if (query.kind !== "QUERY") return finish(scope, "Bạn muốn xem lời nhắc trong ngày hoặc khoảng thời gian nào?");
          const range = semanticQueryRange(query, message.receivedAt);
          if (!range) return finish(scope, unavailable);
          const rows = await deps.list({ message, context, range });
          const lines = await Promise.all(rows.slice(0, 5).map(async row => {
            const title = await deps.keyring.decryptSensitive("reminder-title", row.id, row.titleKeyVersion, row.encryptedTitle);
            return `${new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(row.scheduledAt)} — ${title.slice(0, 200)}`;
          }));
          return finish(scope, lines.length ? lines.join("\n") : "Bạn chưa có lời nhắc trong khoảng này.", "REMINDERS_LISTED");
        }
        if (decision.kind !== "CLARIFY" && decision.kind !== "PROPOSE") return finish(scope, wording(decision));
        const next = snapshot(message, previous, decision.request, decision.kind === "PROPOSE");
        if (!ConversationSnapshotSchema.safeParse(next).success) return finish(scope, "Yêu cầu đã vượt giới hạn hội thoại. Bạn gửi “hủy” rồi bắt đầu một yêu cầu ngắn hơn nhé.");
        let scheduledAt: number | undefined;
        let preview = "";
        if (decision.kind === "PROPOSE") {
          const request = decision.request;
          if ((request.count ?? 1) > 1) {
            const expansion = expandFiniteSeries(request, deps.now());
            if (expansion.status !== "READY") return finish(scope, "Lịch nhắc chưa hợp lệ hoặc đã có thời điểm qua hạn. Mình chưa tạo lời nhắc nào; bạn đổi lịch nhé.");
            preview = `${request.title}\n${expansion.occurrences.length} lần · Asia/Ho_Chi_Minh\n`
              + expansion.occurrences.map(item => `${displayDate(item.localDate)} ${request.reminderTime}`).join("\n");
          } else {
            const date = request.reminderDate ?? request.eventDate;
            scheduledAt = date && request.reminderTime ? Date.parse(`${date.solarDate}T${request.reminderTime}:00+07:00`) : NaN;
            if (!Number.isSafeInteger(scheduledAt) || scheduledAt <= deps.now() || scheduledAt - deps.now() > MAX_SEMANTIC_SCHEDULE_AHEAD_MS) return finish(scope, "Thời điểm nhắc chưa hợp lệ hoặc đã qua. Bạn chọn lại ngày giờ nhé; chưa tạo lời nhắc nào.");
            preview = `${request.title}\n${displayDate(date!.solarDate)} ${request.reminderTime} · Asia/Ho_Chi_Minh`;
          }
          if (request.eventDate) preview += `\nNgày sự kiện: ${displayDate(request.eventDate.solarDate)} dương lịch.`;
          const anchor = request.reminderDate ?? request.eventDate;
          preview += anchor?.lunar ? `\nÂm lịch: ${anchor.lunar.day}/${anchor.lunar.month}/${anchor.lunar.year}${anchor.lunar.leap ? " tháng nhuận" : " tháng thường"}; lịch nhắc ở trên là dương lịch.` : "\nLịch dương.";
          preview += "\nChưa tạo lời nhắc. Gửi “có” để xác nhận hoặc “hủy” để bỏ. Sau khi xác nhận, chỉ hủy được lần tương lai chưa xử lý.";
          if (preview.length > 2000) return finish(scope, "Nội dung quá dài để hiển thị trọn lịch nhắc. Bạn viết tiêu đề ngắn hơn nhé; mình chưa tạo đề xuất xác nhận.");
        }
        if (await deps.contextStore.save(scope, previous?.revision ?? null, next) !== "SAVED") return { status: "SUPERSEDED" };
        if (decision.kind === "CLARIFY") return finish(scope, wording(decision), "CLARIFICATION_REQUESTED");
        if (scheduledAt === undefined) {
          if (!await deps.seriesStore.propose(scope, next.request, next.id, next.revision)) return finish(scope, unavailable);
          return finish(scope, preview, "DRAFT_CREATED");
        }
        const draftId = randomOpaqueId();
        const encryptedTitle = await deps.keyring.encryptSensitive("draft-title", draftId, 1, next.request.title!);
        const encryptedCalendarFacts = await deps.keyring.encryptSensitive("reminder-calendar", JSON.stringify([scope.ownerId, scope.chatIdentityId, draftId]), 1,
          JSON.stringify({ calendar: next.request.calendar, eventDate: next.request.eventDate, reminderDate: next.request.reminderDate }));
        const mutation = await deps.commandStore.createDraft({ message, context, now: deps.now(), auditId: randomOpaqueId(),
          draftId, encryptedTitle, titleKeyVersion: 1, scheduledAt, timezone: "Asia/Ho_Chi_Minh", expiresAt: next.expiresAt,
          encryptedCalendarFacts, enforceConversationOrder: true, conversationFence: { id: next.id, revision: next.revision } });
        if (mutation !== "COMMITTED") return { status: "SUPERSEDED" };
        await reply(preview); return { status: "DRAFT_CREATED" };
      } catch {
        // Do not fall through to V1 after a partially handled V2 request, and
        // never forward exception text containing provider/context material.
        try { return await finish(scope, unavailable); } catch {
          await deps.commandStore.rejectMessage(message, randomOpaqueId(), deps.now(), true);
          return { status: "REJECTED" };
        }
      }
    },
  };
}
