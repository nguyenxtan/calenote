import { z } from "zod";
import { VietnamTimezoneSchema } from "./session";

export const ReminderStatusSchema = z.enum(["PENDING", "CLAIMED", "RETRYABLE", "SENT", "FAILED", "UNCERTAIN", "CANCELLED"]);
export const PublicReminderSchema = z.object({
  publicId: z.string().min(1).max(128), title: z.string().min(1).max(500), scheduledAt: z.number().int(),
  timezone: VietnamTimezoneSchema, status: ReminderStatusSchema,
}).strict();
export const RemindersResponseSchema = z.object({ data: z.object({ reminders: z.array(PublicReminderSchema) }).strict() }).strict();
export type PublicReminder = z.infer<typeof PublicReminderSchema>;
