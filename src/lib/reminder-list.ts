import { RemindersResponseSchema, type PublicReminder } from "@/contracts/api/reminders";
import { apiRequest } from "./client-api";

/** Bound each response and the total traversal; never present a truncated list as complete. */
export async function loadReminderList(onUnauthorized: () => void): Promise<PublicReminder[]> {
  const rows = new Map<string, PublicReminder>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const data = await apiRequest<unknown>("/api/reminders", {
      authenticated: true, onUnauthorized,
      ...(cursor === undefined ? {} : { reminderCursor: cursor }),
    });
    const result = RemindersResponseSchema.parse({ data }).data;
    for (const reminder of result.reminders) {
      if (rows.has(reminder.publicId) || (cursor !== undefined && reminder.publicId <= cursor)) throw new Error("Invalid reminder page");
      rows.set(reminder.publicId, reminder);
    }
    if (result.nextCursor === undefined) return [...rows.values()];
    if (result.nextCursor !== result.reminders.at(-1)?.publicId || (cursor !== undefined && result.nextCursor <= cursor) || result.reminders.length === 0) throw new Error("Invalid reminder page");
    cursor = result.nextCursor;
  }
  throw new Error("Reminder list traversal limit reached");
}
