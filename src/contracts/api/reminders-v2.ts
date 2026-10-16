import { z } from "zod";
import { ReminderStatusSchema } from "./reminders";
import { VietnamTimezoneSchema } from "./session";
import { SlotValueSchemas } from "@/modules/conversation/context-contract/contracts";
import { CanonicalDetailsV1Schema } from "@/modules/conversation/context-contract/state";

export const ReminderDetailsResponseV2Schema = z.strictObject({
  publicId: z.string().min(1).max(128),
  title: SlotValueSchemas.title,
  scheduledAt: z.number().int(),
  timezone: VietnamTimezoneSchema,
  status: ReminderStatusSchema,
  details: CanonicalDetailsV1Schema.nullable(),
});
export const ReminderListResponseV2Schema = z.strictObject({ data: z.strictObject({
  schemaVersion: z.literal("reminders-2"), reminders: z.array(ReminderDetailsResponseV2Schema).max(100),
  hasMore: z.boolean(), scope: z.literal("OWNER"),
}) });
export type ReminderDetailsResponseV2 = z.infer<typeof ReminderDetailsResponseV2Schema>;
export type ReminderListResponseV2 = z.infer<typeof ReminderListResponseV2Schema>;
