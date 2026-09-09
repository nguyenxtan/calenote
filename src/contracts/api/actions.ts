import { z } from "zod";
import { VietnamTimezoneSchema } from "./session";

const OpaqueActionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/u);

export const PublicPendingActionSchema = z.object({
  id: OpaqueActionIdSchema,
  title: z.string().min(1).max(1_800),
  scheduledAt: z.number().int(),
  timezone: VietnamTimezoneSchema,
  status: z.literal("PENDING"),
}).strict();

export const ActionsResponseSchema = z.object({
  data: z.object({ actions: z.array(PublicPendingActionSchema) }).strict(),
}).strict();

export const ActionDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("APPROVED"), reminderPublicId: OpaqueActionIdSchema }).strict(),
  z.object({ decision: z.literal("REJECTED") }).strict(),
]);

export const ActionDecisionResponseSchema = z.object({
  data: ActionDecisionSchema,
}).strict();

export type PublicPendingAction = z.infer<typeof PublicPendingActionSchema>;
export type ActionDecision = z.infer<typeof ActionDecisionSchema>;
