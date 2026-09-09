import { z } from "zod";

export const AddressStyleSchema = z.enum(["ban", "anh_chi", "ong_tui", "minh", "sep", "custom"]);
export const ToneSchema = z.enum(["concise", "friendly", "professional", "playful"]);

export const PresentationPreferencesSchema = z.object({
  addressStyle: AddressStyleSchema,
  customDisplayName: z.string().nullable(),
  tone: ToneSchema,
}).strict();

export const UpdatePreferencesSchema = z.object({
  addressStyle: AddressStyleSchema.optional(),
  customDisplayName: z.string().nullable().optional(),
  tone: ToneSchema.optional(),
}).strict();

export const PreferencesResponseSchema = z.object({
  data: z.object({ preferences: PresentationPreferencesSchema }).strict(),
}).strict();

export type PublicPreferences = z.infer<typeof PresentationPreferencesSchema>;
export type UpdatePreferences = z.infer<typeof UpdatePreferencesSchema>;
