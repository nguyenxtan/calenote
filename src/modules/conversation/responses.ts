import type { UserPreferences } from "@/modules/preferences/service";
import type { MissingField } from "./contracts";
import type { ConversationDecision } from "./reconcile";

const questions: Record<MissingField, string> = {
  title: "Bạn muốn mình nhắc việc gì?",
  eventDate: "Sự kiện đó diễn ra ngày nào?",
  date: "Bạn muốn được nhắc vào ngày nào?",
  time: "Bạn muốn mình nhắc lúc mấy giờ?",
  year: "Ngày âm lịch đó thuộc năm nào?",
  leapMonth: "Bạn muốn tháng thường hay tháng nhuận?",
  seriesCount: "Bạn muốn nhắc mỗi ngày trong bao nhiêu ngày (tối đa 30 ngày)?",
  seriesRelation: "Bạn muốn bắt đầu từ ngày đã nói, nhắc trước sự kiện hay tính cả ngày sự kiện?",
  intent: "Bạn muốn tiếp tục yêu cầu đang chờ, sửa lại hay bỏ yêu cầu đó?",
};
const displayDate = (date: string) => date.split("-").reverse().join("/");

/** Wording is a stable projection of a decision; never another model call. */
function composeBaseReply(input: {
  decision: ConversationDecision; previousQuestion: MissingField | null;
  tone: "friendly" | "concise"; lunarAvailable: boolean;
}): string {
  const decision = input.decision;
  switch (decision.kind) {
    case "GREET": return input.tone === "friendly" ? "Chào bạn! Hôm nay có việc gì bạn muốn mình ghi nhớ không?" : "Chào bạn! Bạn cần nhắc việc gì?";
    case "LUNAR_HELP": return input.lunarAvailable
      ? "Có, mình hỗ trợ ngày âm lịch Việt Nam. Bạn chỉ cần nói rõ âm lịch và năm, ví dụ: nhắc chuẩn bị lễ lúc 8h ngày 15/8/2027 âm lịch. Mình sẽ cho bạn xem cả ngày dương trước khi xác nhận."
      : "Hiện tính năng âm lịch chưa được bật. Bạn có thể dùng ngày dương lịch trước nhé.";
    case "ABANDON_PENDING": return "Mình đã bỏ yêu cầu đang chờ. Các lời nhắc đã xác nhận vẫn giữ nguyên.";
    case "HELP": return "Bạn nói việc cần nhắc cùng ngày và giờ nhé. Nếu còn thiếu thông tin, mình sẽ hỏi thêm trước khi bạn xác nhận.";
    case "READ_ONLY_LIST": return "Mình sẽ xem lời nhắc trong khoảng bạn yêu cầu, không thay đổi lời nhắc nào.";
    case "PROPOSE": return "Mình đã có đủ thông tin để lập bản nháp. Bạn kiểm tra các ngày giờ trong đề xuất rồi xác nhận nhé; chưa có lời nhắc nào được tạo.";
    case "SAFE_REJECT": return decision.code === "CONFLICT"
      ? "Thông tin mới chưa khớp với yêu cầu đang chờ. Bạn nói rõ muốn đổi ngày, giờ hay nội dung nào nhé; mình chưa tạo lời nhắc."
      : decision.code === "LIMIT" ? "Yêu cầu vượt giới hạn hỗ trợ. Mình có thể nhắc một lần mỗi ngày, tối đa 30 ngày; chưa tạo lời nhắc nào."
        : "Mình chưa thể xử lý yêu cầu này an toàn. Chưa có lời nhắc nào được tạo; bạn thử nói lại việc cần nhắc nhé.";
    case "CLARIFY": {
      const request = decision.request;
      const known = request.eventDate ?? request.reminderDate;
      const prefix = input.tone === "friendly" && input.previousQuestion !== decision.field && known
        && !["date", "eventDate", "year", "leapMonth", "intent"].includes(decision.field)
        ? `Mình đã ghi nhận ngày ${displayDate(known.solarDate)}${known.calendar === "LUNAR_VN" ? " dương lịch" : ""}. ` : "";
      return prefix + questions[decision.field];
    }
  }
}

export type ReplyPreferences = Pick<UserPreferences, "addressStyle" | "customDisplayName"> & Partial<Pick<UserPreferences, "tone">>;
/** Only application-owned prose. Never run replacement over titles, lists or previews. */
export function addressConversationText(text: string, preferences?: ReplyPreferences): string {
  if (!preferences || preferences.addressStyle === "ban") return text;
  const custom = preferences.customDisplayName?.replace(/[\r\n\t]/gu, " ").trim().slice(0,80);
  const address = ({ban:"bạn",anh_chi:"anh/chị",ong_tui:"ông",minh:"mình",sep:"sếp",custom:custom || "bạn"})[preferences.addressStyle];
  const self = preferences.addressStyle === "ong_tui" ? "tui" : preferences.addressStyle === "minh" ? "tớ" : "mình";
  return text.replace(/(^|[^\p{L}\p{N}_])(bạn|Bạn|mình|Mình)(?=$|[^\p{L}\p{N}_])/gu, (_match, prefix:string, word:string) => {
    const replacement = word.toLowerCase() === "bạn" ? address : self;
    const capitalized = word[0] === word[0].toUpperCase() && preferences.addressStyle !== "custom"
      ? replacement[0].toLocaleUpperCase("vi-VN") + replacement.slice(1) : replacement;
    return prefix + capitalized;
  });
}
export function composeConversationReply(input: Parameters<typeof composeBaseReply>[0] & { preferences?: ReplyPreferences }): string {
  return addressConversationText(composeBaseReply(input), input.preferences);
}
