import {localReadOnlyCommand,vietnamReceiptDate,localReadOnlyRange,LOCAL_HELP,LOCAL_MONTH_STATUSES,type LocalMonthQuery,type LocalMonthResult} from './local-read-only';
import { failureDetails, observeConversationFailure, type ConversationFailureDetails, type ConversationFailureObserver, type ConversationFailureStage } from "./failure-observation";
import { randomOpaqueId } from "@/modules/platform/types";
import type { Keyring } from "@/modules/security/keyring";
import { semanticReferenceWallClock, type SemanticGateway, type SemanticAttemptResult } from "@/modules/intelligence/semantic-gateway";
import type { SemanticBudgetStore } from "@/modules/semantic/budget-store";
import { extractTemporalEvidence } from "@/modules/semantic/temporal-evidence";
import { reconcileSemanticInterpretation } from "@/modules/semantic/reconciliation";
import { MAX_SEMANTIC_SCHEDULE_AHEAD_MS } from "@/modules/semantic/validation";
import type { BoundChatContext, BoundChatMessage, ProcessBoundChatResult, ReminderCommandStore } from "@/modules/reminders/command-service";
import { semanticQueryRange, type SemanticReminderQuery, type QueriedReminder } from "@/modules/reminders/semantic-query";
import { expandFiniteOccurrences, expandFiniteSeries, type SeriesStore } from "@/modules/reminders/series";
import { CONVERSATION_ABSOLUTE_TTL_MS, CONVERSATION_IDLE_TTL_MS, ConversationSnapshotSchema,
  ConversationModelSchema, type ConversationModel, type ConversationScope, type ConversationSnapshot, type PendingRequest } from "./contracts";
import type { ConversationInput } from "./prompt";
import type { ConversationStore } from "./context-store";
import type { ConversationRuntimeStore } from "./infrastructure/d1/runtime-store";
import type { LunarCalendarAdapter } from "./lunar-calendar";
import { evaluateConversationTurn } from "./turn";
import { addressConversationText, type ReplyPreferences, composeConversationReply } from "./responses";
import { observeTiming, type ConversationTiming } from "./processing-feedback";

export interface ConversationServiceDependencies {
  getReminderConfirmation?(ownerId: string): Promise<"auto" | "preview">;
  contextStore: ConversationStore; seriesStore: SeriesStore; commandStore: ReminderCommandStore;
  runtimeStore: ConversationRuntimeStore; calendar: LunarCalendarAdapter;
  gateway: SemanticGateway<ConversationModel, ConversationInput>; budgetStore: SemanticBudgetStore;
  keyring: Pick<Keyring, "encryptSensitive" | "decryptSensitive">;
  now(): number; reply(text: string): Promise<void>;
  list(input: SemanticReminderQuery): Promise<QueriedReminder[]>;
  listMonth?(input: LocalMonthQuery): Promise<LocalMonthResult>;
  processingFeedback?: () => void;
  observeTiming?: (value: ConversationTiming) => void;
  observeFailure?: ConversationFailureObserver;
  tone?: "friendly" | "concise";
  getReplyPreferences?(ownerId: string): Promise<ReplyPreferences>;
  getTone?(ownerId: string): Promise<"friendly" | "concise">;
}
const confirm = new Set(["có", "ok", "1", "xác nhận"]);
const cancel = new Set(["hủy", "huỷ", "không", "2"]);
const greeting = /^(?:chào(?: bạn| calenote)?|xin chào(?: bạn| calenote)?|hello|hi)[!.\s]*$/u;
const unavailable = "Mình chưa xử lý được yêu cầu này lúc này. Bạn thử lại sau ít phút nhé.";
const displayDate = (date: string) => date.split("-").reverse().join("/");

export function createConversationService(deps: ConversationServiceDependencies) {
  async function reply(text: string) { try { await deps.reply(text); } catch { /* Never retry an uncertain outbound. */ } }
  async function terminalFinish(scope: ConversationScope, text: string, status: ProcessBoundChatResult["status"] = "REJECTED", failure?: ConversationFailureDetails): Promise<ProcessBoundChatResult> {
    if (!await deps.runtimeStore.complete({ ...scope, now: deps.now() })) return { status: "SUPERSEDED" };
    if (failure) observeConversationFailure(deps.observeFailure, scope.sourceInboundId, failure);
    await reply(text); return { status };
  }
  async function interpret(scope: ConversationScope, input: ConversationInput): Promise<
    { status: "SUCCESS"; model: ConversationModel } | { status: "FAILURE"; failure: ConversationFailureDetails }> {
    let stage: ConversationFailureStage = "GATEWAY_PREPARE";
    const failed = (category: unknown) => ({ status: "FAILURE" as const, failure: failureDetails(stage, category) });
    try {
      const attempt = deps.gateway.prepare("PRIMARY", input);
      if (attempt.status !== "READY") return failed(attempt.category);
      stage = "BUDGET_RESERVE";
      const reservation = await deps.budgetStore.reservePaidCall({ ownerId: scope.ownerId, sourceInboundId: scope.sourceInboundId, now: deps.now() });
      if (reservation.status !== "RESERVED") return failed("BUDGET_EXHAUSTED");
      const budgetScope = { ownerId: scope.ownerId, reservationId: reservation.reservationId };
      stage = "BUDGET_FUNDING";
      if (!Number.isSafeInteger(reservation.reservedMaximumMicrounits) || reservation.reservedMaximumMicrounits < attempt.maximumCostMicrounits) {
        await deps.budgetStore.releaseOrExpireReservation({ ...budgetScope, reason: "SAFE_FAILURE", now: deps.now() });
        return failed("RESERVATION_UNDERFUNDED");
      }
      stage = "DISPATCH_FENCE";
      if (!await deps.budgetStore.markDispatched({ ...budgetScope, now: deps.now() })) return failed("DISPATCH_FENCE_DENIED");
      stage = "MODEL_RESULT";
      let result: SemanticAttemptResult<ConversationModel>;
      const modelStarted = performance.now();
      try { result = await attempt.dispatch(); } catch { result = { status: "FAILURE", category: "PROVIDER_FAILURE" }; }
      observeTiming(deps.observeTiming, "MODEL", performance.now() - modelStarted);
      try { await deps.budgetStore.finalizeUsage({ ...budgetScope, actualCostMicrounits: result.usage?.costMicrounits ?? null, now: deps.now() }); } catch { /* Expiry charges dispatched ceiling. */ }
      if (result.status !== "SUCCESS") return failed(result.category);
      stage = "MODEL_SCHEMA";
      const parsed = ConversationModelSchema.safeParse(result.interpretation);
      return parsed.success ? { status: "SUCCESS", model: parsed.data } : failed("SCHEMA_INVALID");
    } catch { return failed("LOCAL_FAILURE"); }
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
    async ownsPendingDraft(message: BoundChatMessage, context: BoundChatContext, draftId: string): Promise<boolean> {
      return deps.runtimeStore.ownsPendingDraft({ ownerId: context.userId, chatIdentityId: context.chatIdentityId,
        sourceInboundId: message.id, claimMarker: message.claimMarker, now: deps.now() }, draftId);
    },
    async handle(message: BoundChatMessage, context: BoundChatContext): Promise<ProcessBoundChatResult> {
      const scope: ConversationScope = { ownerId: context.userId, chatIdentityId: context.chatIdentityId,
        sourceInboundId: message.id, claimMarker: message.claimMarker, now: deps.now() };
      let preferences: ReplyPreferences | undefined;
      try { preferences = await deps.getReplyPreferences?.(scope.ownerId); } catch { /* Wording never changes authority or retries a send. */ }
      const finish: typeof terminalFinish = (scope, text, status = "REJECTED", failure) => terminalFinish(scope,
        status === "REMINDERS_LISTED" || status === "DRAFT_CREATED" ? text : addressConversationText(text, preferences), status, failure);
      const sendProse = (text: string) => reply(addressConversationText(text, preferences));
      const normalized = message.text.normalize("NFC").trim().toLocaleLowerCase("vi-VN");
      let stage: ConversationFailureStage = "PRECONDITION";
      try {
        if (context.timezone !== "Asia/Ho_Chi_Minh") return finish(scope, unavailable, "REJECTED", failureDetails(stage, "UNSUPPORTED_TIMEZONE"));
        const local = localReadOnlyCommand(message.text);
        if (local) {
          stage = "READ_ONLY_QUERY";
          if (local === 'HELP') return finish(scope, LOCAL_HELP);
          if (local === 'LUNAR_TODAY') {
            const date = vietnamReceiptDate(message.receivedAt), lunar = date ? deps.calendar.toLunar(date) : null;
            return finish(scope, lunar ? `Ngày ${displayDate(date!)} dương lịch là ${lunar.day}/${lunar.month}/${lunar.year}${lunar.leap ? ' (tháng nhuận)' : ''} âm lịch Việt Nam.` : 'Mình chưa có dữ liệu âm lịch cho ngày này.');
          }
          const month = localReadOnlyRange(message.text,message.receivedAt);
          if (!month || !deps.listMonth) return finish(scope, 'Mình chưa thể đọc lịch lúc này. Bạn thử lại sau nhé.');
          const result = await deps.listMonth({ message, context, range: { start: month.start, end: month.end } });
          if (result.status !== 'RESULTS') return finish(scope, 'Mình chưa thể đọc lịch lúc này. Bạn thử lại sau nhé.');
          const lines = await Promise.all(result.rows.map(async row => `${new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(row.scheduledAt)} — ${(await deps.keyring.decryptSensitive('reminder-title', row.id, row.titleKeyVersion, row.encryptedTitle)).slice(0, 200)} (${LOCAL_MONTH_STATUSES[row.status]})`));
          return finish(scope, `Lịch ${local === 'MONTH' ? 'tháng ' : ''}${month.label} trong cuộc trò chuyện này: ${lines.length ? '\n' + lines.join('\n') : 'chưa có lời nhắc.'}${result.hasMore ? '\n5 kết quả đầu; còn kết quả khác.' : ''}`, 'REMINDERS_LISTED');
        }
        const deterministic = confirm.has(normalized) || cancel.has(normalized) || greeting.test(normalized)
          || ["help", "/help", "trợ giúp", "hướng dẫn"].includes(normalized);
        if (!deterministic) {
          stage = "ATTEMPT_CLAIM";
          if (!await deps.runtimeStore.claimAttempt(scope)) return finish(scope, unavailable, "REJECTED", failureDetails(stage, "ATTEMPT_CLAIM_DENIED"));
          try { deps.processingFeedback?.(); } catch { /* Managed UX feedback has no business authority. */ }
        }
        stage = "CONTEXT_LOAD";
        const previous = await deps.contextStore.load(scope);
        stage = "PENDING_LOAD";
        const pending = await deps.seriesStore.findPending(scope);
        if (confirm.has(normalized)) {
          stage = "CONFIRM";
          if (!pending) return finish(scope, "Không có đề xuất nào đang chờ xác nhận.");
          if (pending.action === "CANCEL") {
            const result = await deps.seriesStore.cancelRemaining(scope, pending.proposalId, pending.revision);
            if (result !== "CANCELLED") return finish(scope, "Đề xuất hủy không còn hiệu lực; chưa thay đổi chuỗi nhắc.");
            await sendProse("Đã hủy các lần nhắc tương lai chưa được gửi xử lý. Lần đang gửi hoặc chưa rõ kết quả không thể thu hồi.");
            return { status: "CANCELLED" };
          }
          const result = await deps.seriesStore.confirm(scope, pending.proposalId, pending.revision);
          if (result.status !== "CONFIRMED") return finish(scope, "Đề xuất không còn hiệu lực. Bạn gửi lại yêu cầu để xem lịch mới nhé.");
          await sendProse("Đã xác nhận chuỗi lời nhắc đúng lịch bạn vừa duyệt."); return { status: "CONFIRMED" };
        }
        if (cancel.has(normalized)) {
          stage = "CANCEL";
          if (previous && !await deps.contextStore.finish(scope, previous.id, previous.revision, "CANCELLED")) return { status: "SUPERSEDED" };
          if (pending && !await deps.seriesStore.discard(scope, pending.proposalId, pending.revision)) return { status: "SUPERSEDED" };
          return finish(scope, "Mình đã bỏ yêu cầu đang chờ. Lời nhắc đã xác nhận không thay đổi.", "CANCELLED");
        }
        let tone = deps.tone ?? "friendly";
        try { tone = preferences?.tone ? (preferences.tone === "concise" || preferences.tone === "professional" ? "concise" : "friendly") : await deps.getTone?.(scope.ownerId) ?? tone; } catch { /* Personalization is best-effort, not authority. */ }
        const wording = (decision: Parameters<typeof composeConversationReply>[0]["decision"]) => composeConversationReply({ decision,
          previousQuestion: previous?.request.missing[0] ?? null, tone, lunarAvailable: true });
        if (greeting.test(normalized)) return finish(scope, wording({ kind: "GREET" }));
        if (["help", "/help", "trợ giúp", "hướng dẫn"].includes(normalized)) return finish(scope, wording({ kind: "HELP" }));
        if (pending?.action === "CANCEL") return finish(scope, "Bạn đang có đề xuất hủy chuỗi. Gửi “có” để xác nhận hoặc “hủy” để bỏ đề xuất.");
        const priorStatus = previous?.status;
        if (priorStatus !== undefined && priorStatus !== "CLARIFYING" && priorStatus !== "DRAFT_READY") return finish(scope, unavailable, "REJECTED", failureDetails(stage, "INVALID_LIFECYCLE"));
        stage = "GATEWAY_PREPARE";
        const interpreted = await interpret(scope, { text: message.text, ...semanticReferenceWallClock(message.receivedAt),
          ...(previous ? { conversationContext: { title: previous.request.title, status: priorStatus,
            pendingQuestion: previous.request.missing[0] ?? null,
            turns: previous.turns.map(({ userText, outcomeCode }) => ({ userText, outcomeCode })) } } : {}) });
        if (interpreted.status === "FAILURE") return finish(scope, unavailable, "REJECTED", interpreted.failure);
        const model = interpreted.model;
        stage = "RECONCILE";
        const { decision } = evaluateConversationTurn({ text: message.text, receivedAt: message.receivedAt,
          sourceInboundId: message.id, model, previous, now: deps.now() }, deps.calendar);
        if (decision.kind === "ABANDON_PENDING") {
          if (previous && !await deps.contextStore.finish(scope, previous.id, previous.revision, "CANCELLED")) return { status: "SUPERSEDED" };
          if (pending) await deps.seriesStore.discard(scope, pending.proposalId, pending.revision);
          return finish(scope, wording(decision), "CANCELLED");
        }
        if (decision.kind === "READ_ONLY_LIST") {
          stage = "READ_ONLY_QUERY";
          const query = reconcileSemanticInterpretation({ text: message.text,
            modelInterpretation: { intent: "LIST_REMINDERS", title: null, titleState: "NOT_APPLICABLE", targetIntent: null },
            temporalEvidence: extractTemporalEvidence({ text: message.text, referenceNow: message.receivedAt }), processingNow: deps.now() });
          if (query.kind !== "QUERY") return finish(scope, "Bạn muốn xem lời nhắc trong ngày hoặc khoảng thời gian nào?");
          const range = semanticQueryRange(query, message.receivedAt);
          if (!range) return finish(scope, unavailable, "REJECTED", failureDetails(stage, "INVALID_RANGE"));
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
        const auto = await deps.getReminderConfirmation?.(scope.ownerId) === "auto";
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
            const expansion = request.relation ? expandFiniteOccurrences({ ...request, count: request.count ?? 1 }, deps.now()) : null;
            scheduledAt = expansion ? expansion.status === "READY" ? expansion.occurrences[0].scheduledAt : NaN
              : date && request.reminderTime ? Date.parse(`${date.solarDate}T${request.reminderTime}:00+07:00`) : NaN;
            if (!Number.isSafeInteger(scheduledAt) || scheduledAt <= deps.now() || scheduledAt - deps.now() > MAX_SEMANTIC_SCHEDULE_AHEAD_MS) return finish(scope, "Thời điểm nhắc chưa hợp lệ hoặc đã qua. Bạn chọn lại ngày giờ nhé; chưa tạo lời nhắc nào.");
            const localDate = expansion?.status === "READY" ? expansion.occurrences[0].localDate : date!.solarDate;
            preview = `${request.title}\n${displayDate(localDate)} ${request.reminderTime} · Asia/Ho_Chi_Minh`;
          }
          if (request.eventDate) preview += `\nNgày sự kiện: ${displayDate(request.eventDate.solarDate)} dương lịch.`;
          const anchor = request.reminderDate ?? request.eventDate;
          preview += anchor?.lunar ? `\nÂm lịch: ${anchor.lunar.day}/${anchor.lunar.month}/${anchor.lunar.year}${anchor.lunar.leap ? " tháng nhuận" : " tháng thường"}; lịch nhắc ở trên là dương lịch.` : "\nLịch dương.";
          if (!auto) preview += "\nChưa tạo lời nhắc. Gửi “có” để xác nhận hoặc “hủy” để bỏ. Sau khi xác nhận, chỉ hủy được lần tương lai chưa xử lý.";
          if (preview.length > 2000) return finish(scope, "Nội dung quá dài để hiển thị trọn lịch nhắc. Bạn viết tiêu đề ngắn hơn nhé; mình chưa tạo đề xuất xác nhận.");
        }
        stage = "CONTEXT_SAVE";
        if (await deps.contextStore.save(scope, previous?.revision ?? null, next) !== "SAVED") return { status: "SUPERSEDED" };
        if (decision.kind === "CLARIFY") return finish(scope, wording(decision), "CLARIFICATION_REQUESTED");
        if (scheduledAt === undefined) {
          stage = "SERIES_PROPOSE";
          const proposed = await deps.seriesStore.propose(scope, next.request, next.id, next.revision);
          if (!proposed) return finish(scope, unavailable, "REJECTED", failureDetails(stage, "PROPOSAL_DENIED"));
          if (auto) {
            const result = await deps.seriesStore.confirm(scope, proposed.proposalId, proposed.revision, true);
            if (result.status !== "CONFIRMED") return finish(scope, unavailable);
            await reply(addressConversationText("Đã tạo chuỗi lời nhắc.", preferences) + `\n${preview}`); return { status: "CONFIRMED" };
          }
          return finish(scope, preview, "DRAFT_CREATED");
        }
        const draftId = randomOpaqueId();
        stage = "DRAFT_ENCRYPT";
        const encryptedTitle = await deps.keyring.encryptSensitive("draft-title", draftId, 1, next.request.title!);
        const encryptedCalendarFacts = await deps.keyring.encryptSensitive("reminder-calendar", JSON.stringify([scope.ownerId, scope.chatIdentityId, draftId]), 1,
          JSON.stringify({ calendar: next.request.calendar, eventDate: next.request.eventDate, reminderDate: next.request.reminderDate }));
        stage = "DRAFT_PERSIST";
        const reminderId = auto ? randomOpaqueId() : null;
        const autoConfirm = reminderId ? { reminderId, reminderPublicId: randomOpaqueId(), titleKeyVersion: 1,
          encryptedTitle: await deps.keyring.encryptSensitive("reminder-title", reminderId, 1, next.request.title!) } : undefined;
        const mutation = await deps.commandStore.createDraft({ message, context, now: deps.now(), auditId: randomOpaqueId(), autoConfirm,
          draftId, encryptedTitle, titleKeyVersion: 1, scheduledAt, timezone: "Asia/Ho_Chi_Minh", expiresAt: next.expiresAt,
          encryptedCalendarFacts, enforceConversationOrder: true, conversationFence: { id: next.id, revision: next.revision } });
        if (mutation !== "COMMITTED") return { status: "SUPERSEDED" };
        await reply(auto ? addressConversationText("Đã tạo lời nhắc.", preferences) + `\n${preview}` : preview); return { status: auto ? "CONFIRMED" : "DRAFT_CREATED" };
      } catch {
        // Do not fall through to V1 after a partially handled V2 request, and
        // never forward exception text containing provider/context material.
        try { return await finish(scope, unavailable, "REJECTED", failureDetails(stage, "LOCAL_FAILURE")); } catch {
          await deps.commandStore.rejectMessage(message, randomOpaqueId(), deps.now(), true);
          return { status: "REJECTED" };
        }
      }
    },
  };
}
