import { z } from "zod";
import { VietnamTimezoneSchema } from "./session";

export const ReminderStatusSchema = z.enum(["PENDING", "CLAIMED", "RETRYABLE", "SENT", "FAILED", "UNCERTAIN", "CANCELLED"]);
export const PublicReminderSchema = z.object({
  publicId: z.string().min(1).max(128), title: z.string().min(1).max(500), scheduledAt: z.number().int(),
  timezone: VietnamTimezoneSchema, status: ReminderStatusSchema,
}).strict();
export const RemindersResponseSchema = z.object({ data: z.object({ reminders: z.array(PublicReminderSchema).max(100), nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u).optional() }).strict() }).strict();
export type PublicReminder = z.infer<typeof PublicReminderSchema>;

export const CreateReminderResponseSchema = z.object({ reminder: PublicReminderSchema }).strict();
export const ResolveReminderIntentResponseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("CREATED"), publicId: PublicReminderSchema.shape.publicId }).strict(),
  z.object({ state: z.literal("ABANDONED") }).strict(),
]);
