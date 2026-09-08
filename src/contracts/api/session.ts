import { z } from "zod";

export const VietnamTimezoneSchema = z.literal("Asia/Ho_Chi_Minh");
export const SessionUserSchema = z.object({
  displayName: z.string().min(1).max(80),
  email: z.string().min(3).max(254).email(),
  timezone: VietnamTimezoneSchema,
}).strict();
export const SessionResponseSchema = z.object({ data: z.object({ user: SessionUserSchema }).strict() }).strict();
export type SessionUser = z.infer<typeof SessionUserSchema>;
