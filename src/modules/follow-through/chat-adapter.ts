import { botSalutation, type BotReplyPreferences } from "@/modules/preferences/wording";
import type { BoundChatMessage, BoundChatContext } from "@/modules/reminders/command-service";
import { FollowThroughError } from "@/contracts/api/follow-through";
import type { FollowThroughAction, FollowThroughItem, FollowThroughList, FollowThroughScope } from "@/contracts/api/follow-through";
export interface FollowThroughChatService {
  list(scope: FollowThroughScope): Promise<FollowThroughList>;
  resolveReference(scope: FollowThroughScope, reference: string): Promise<FollowThroughItem[]>;
  act(scope: FollowThroughScope, input: FollowThroughAction): Promise<FollowThroughItem>;
  receipt(scope: FollowThroughScope, key: string): Promise<FollowThroughItem | null>;
}
export type FollowThroughChatResult = { handled: false } | { handled: true; text: string };
export type FollowThroughChatHandler = (message: BoundChatMessage, context: BoundChatContext) => Promise<FollowThroughChatResult>;
const DAY = 86_400_000;
const OFFSET = 7 * 3_600_000;
function civil(timestamp: number): string { return new Date(timestamp + OFFSET).toISOString().slice(0, 16).replace("T", " "); }
function parseCivil(input: string, now: number): number | null {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u.test(input)) return null;
  const value = Date.parse(`${input.replace(" ", "T")}:00+07:00`);
  if (!Number.isSafeInteger(value) || civil(value) !== input || value <= now || value - now > 366 * DAY) return null;
  return value;
}
function result(item: FollowThroughItem): FollowThroughChatResult {
  const state = item.progress === "DONE" ? "Đã xong" : item.progress === "STOPPED" ? "Dừng theo dõi" : `Đã đổi lịch: ${civil(item.scheduledAt)} UTC+7`;
  return { handled: true, text: `${state}. Mã việc: ${item.publicId}.` };
}
function selection(items: FollowThroughItem[]): FollowThroughChatResult {
  items=items.filter(item=>item.progress=== "OPEN").slice(0,5);
  return { handled: true, text: items.length ? `Chọn mã việc trong cuộc trò chuyện này:\n${items.map(item => `${item.publicId}: ${item.title.slice(0, 100)}`).join("\n")}\nVí dụ: xong <mã việc>.` : "Không tìm thấy việc được theo dõi trong cuộc trò chuyện này." };
}

export function createFollowThroughChatHandler(service: FollowThroughChatService, now: () => number = Date.now, getReplyPreferences?: (ownerId: string) => Promise<BotReplyPreferences>): FollowThroughChatHandler {
  const handle: FollowThroughChatHandler =
  async (message, context) => {
    const text = message.text.normalize("NFC").trim().replace(/\s+/gu, " ");
    const command = /^(?:(xác nhận) )?(dừng theo dõi|chưa xong|xong|hoãn|đổi lịch)(?: (.*))?$/iu.exec(text);
    if (!command) return { handled: false };
    const confirmed = Boolean(command[1]);
    const verb = command[2].toLocaleLowerCase("vi-VN");
    const scope = { userId: context.userId, chatIdentityId: context.chatIdentityId, connectionId: message.connectionId };
    const idempotencyKey = `chat-${message.id}`;
    const prior = await service.receipt(scope, idempotencyKey);
    if (prior) return result(prior);
    const page = await service.list({...scope,progress:"OPEN"});
    const tracked = page.items.filter(item => item.progress !== "UNTRACKED");
    const args = (command[3] ?? "").split(" ");
    const reference = args.shift() ?? "";
    // A public code only filters an already authenticated chat+connection list.
    // Never derive identity or choose a latest item from its presence.
    const matches = reference.length >= 8 ? await service.resolveReference(scope, reference) : [];
    if (matches.length !== 1 || matches[0].progress === "UNTRACKED" || verb === "chưa xong") return selection(tracked);
    const item = matches[0];
    const timeInput = args.join(" ");
    const action = verb === "xong" ? "DONE" : verb === "dừng theo dõi" ? "STOP" : verb === "hoãn" ? "SNOOZE" : "RESCHEDULE";
    let scheduledAt: number | undefined;
    if (action === "SNOOZE" || action === "RESCHEDULE") {
      const current = now();
      if (action === "SNOOZE" && !confirmed) {
        if (timeInput === "15 phút") scheduledAt = current + 15 * 60_000;
        else if (timeInput === "1 giờ") scheduledAt = current + 60 * 60_000;
        else if (["mai 09:00", "ngày mai 09:00"].includes(timeInput)) {
          const tomorrow = new Date(current + OFFSET + DAY).toISOString().slice(0, 10);
          scheduledAt = parseCivil(`${tomorrow} 09:00`, current) ?? undefined;
        }
      } else scheduledAt = parseCivil(timeInput, current) ?? undefined;
      if (scheduledAt === undefined) return { handled: true, text: "Chọn 15 phút, 1 giờ, mai 09:00 hoặc ngày giờ cụ thể YYYY-MM-DD HH:mm (UTC+7), ở tương lai trong 366 ngày. Chưa đổi lịch." };
      if (!confirmed) return { handled: true, text: `Dự kiến ${civil(scheduledAt)} UTC+7, qua ${item.destinationLabel}.\nĐể xác nhận: xác nhận ${verb} ${item.publicId} ${civil(scheduledAt)}` };
    } else if (timeInput || confirmed) return { handled: true, text: `Dùng: ${verb} ${item.publicId}. Chưa thay đổi việc.` };
    try {
      return result(await service.act({ ...scope, inboundUpdateId: message.id, claimMarker: message.claimMarker }, { action, publicId: item.publicId, expectedRevision: item.revision, idempotencyKey, ...(scheduledAt === undefined ? {} : { scheduledAt }) }));
    } catch (error) {
      if (!(error instanceof FollowThroughError)) throw error;
      return { handled: true, text: error.code === "CONFLICT" ? "Việc vừa thay đổi. Chọn lại mã việc và gửi lệnh mới sau khi kiểm tra." : "Chưa thay đổi việc. Kiểm tra mã việc, trạng thái và bot gốc trong cuộc trò chuyện này." };
    }
  };
  return async (message, context) => {
    const result = await handle(message, context);
    if (!result.handled) return result;
    let preferences: BotReplyPreferences | undefined;
    try { preferences = await getReplyPreferences?.(context.userId); } catch { /* Presentation lookup is best effort. */ }
    return { ...result, text: botSalutation(preferences) + result.text };
  };
}
