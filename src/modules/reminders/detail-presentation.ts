import { CanonicalDetailsV1Schema, type CanonicalDetailsV1 } from "@/modules/conversation/context-contract/state";
import { isValidSemanticLocalDate } from "@/modules/semantic/validation";
import type { SeriesOccurrence } from "./series";

export const DELIVERY_PREFIX = "Nhắc bạn: ";
export type RenderResult = { status: "COMPLETE"; text: string } | { status: "TOO_LONG"; units: number; limit: 2000 } | { status: "INVALID" };

/** Complete plain-text projection. Provider adapters send without markup mode;
 * reserve extra preview/control wording via additionalUnits before confirmation. */
export function renderReminderDetails(title: string, details: CanonicalDetailsV1, schedule: readonly SeriesOccurrence[], additionalUnits = 0): RenderResult {
  if (typeof title !== "string" || !title.trim() || !title.isWellFormed() || !CanonicalDetailsV1Schema.safeParse(details).success || !Number.isSafeInteger(additionalUnits) || additionalUnits < 0 || schedule.length < 1 || schedule.length > 30 || (details.eventDate !== null && !isValidSemanticLocalDate(details.eventDate)) || (details.eventTime !== null && details.eventDate === null)) return { status: "INVALID" };
  const notifications: string[] = [];
  for (const [index, occurrence] of schedule.entries()) {
    if (occurrence.index !== index || !Number.isSafeInteger(occurrence.scheduledAt) || !Number.isFinite(new Date(occurrence.scheduledAt).getTime()) || !isValidSemanticLocalDate(occurrence.localDate) || (index > 0 && occurrence.scheduledAt <= schedule[index - 1].scheduledAt)) return { status: "INVALID" };
    const local = new Date(occurrence.scheduledAt + 7 * 3600000).toISOString();
    if (local.slice(0, 10) !== occurrence.localDate) return { status: "INVALID" };
    notifications.push(`${occurrence.localDate} ${local.slice(11, 16)}`);
  }
  const lines = [title];
  if (details.location !== null) lines.push(`Địa điểm: ${details.location}`);
  if (details.notes !== null) lines.push(`Ghi chú: ${details.notes}`);
  if (details.eventDate !== null) lines.push(`Sự kiện: ${details.eventDate}${details.eventTime ? ` ${details.eventTime}` : " (chưa có giờ sự kiện)"}`);
  const source = details.calendarProvenance.sourceDate;
  if (source?.kind === "CIVIL_DATE" && source.calendar === "LUNAR_VN") lines.push(`Ngày âm lịch nguồn: ${source.day}/${source.month}/${source.year}${source.leapMonth ? " nhuận" : ""}`);
  lines.push(`Thông báo (Asia/Ho_Chi_Minh):\n${notifications.join("\n")}`);
  const text = lines.join("\n"), units = text.length + DELIVERY_PREFIX.length + additionalUnits;
  return units <= 2000 ? { status: "COMPLETE", text } : { status: "TOO_LONG", units, limit: 2000 };
}
