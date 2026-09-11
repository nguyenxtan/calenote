import { z } from "zod";
export const PublicActivitySchema=z.object({action:z.enum(["REMINDER_CREATED","REMINDER_CANCELLED","CONNECT_CODE_ROTATED","CHAT_BOUND"]),createdAt:z.number().int().nonnegative()}).strict();
export const ActivityResponseSchema=z.object({data:z.object({activities:z.array(PublicActivitySchema).max(50)}).strict()}).strict();
export type PublicActivity=z.infer<typeof PublicActivitySchema>;
