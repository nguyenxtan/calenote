import type { PublicReminder } from "@/contracts/api/reminders";

export const REMINDER_TIMEZONE = "Asia/Ho_Chi_Minh";
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: REMINDER_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
export const localDay = (at: number) => dateFormatter.format(at);
export const isActiveReminder = (item: PublicReminder) => ["PENDING", "CLAIMED", "RETRYABLE"].includes(item.status);

/** Presentation only. Delivery state always remains server-owned. */
export function projectReminders(items: readonly PublicReminder[], now: number) {
  const today: PublicReminder[] = [], future: PublicReminder[] = [], attention: PublicReminder[] = [], sentToday: PublicReminder[] = [];
  const day = localDay(now);
  for (const item of items) {
    if (item.status === "FAILED" || item.status === "UNCERTAIN" || (isActiveReminder(item) && item.scheduledAt <= now)) attention.push(item);
    else if (isActiveReminder(item)) (localDay(item.scheduledAt) === day ? today : future).push(item);
    else if (item.status === "SENT" && localDay(item.scheduledAt) === day) sentToday.push(item);
  }
  for (const group of [today, future, attention, sentToday]) group.sort((a, b) => a.scheduledAt - b.scheduledAt);
  return { today, future, attention, sentToday };
}
