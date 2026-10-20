import { z } from "zod";

export const MAX_PERSONAL_ASSISTANT_DOCUMENT_BYTES = 100 * 1024;

const CivilTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const IdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
export const PersonalLifeEventSchema = z.object({
  id: IdSchema,
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["BIRTHDAY", "MEMORIAL", "RENEWAL", "OTHER"]),
  calendar: z.enum(["SOLAR", "LUNAR"]),
  year: z.number().int().min(1900).max(2100).optional(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  time: CivilTimeSchema,
  leapPolicy: z.enum(["REGULAR", "LEAP_OR_REGULAR"]),
  missingDayPolicy: z.enum(["SKIP", "LAST_DAY"]),
  leadDays: z.array(z.number().int().min(0).max(365)).min(1).max(5).refine(values => new Set(values).size === values.length, "Duplicate lead offsets"),
  enabled: z.boolean(),
}).strict().refine(event => event.calendar !== "LUNAR" || event.day <= 30, "Lunar days must be 1 through 30");
export const PersonalAssistantDocumentSchema = z.object({
  events: z.array(PersonalLifeEventSchema).max(100),
  memories: z.array(z.object({ id: IdSchema, label: z.string().trim().min(1).max(100), value: z.string().trim().min(1).max(2000) }).strict()).max(100),
  daily: z.object({ morningEnabled: z.boolean(), morningTime: CivilTimeSchema, eveningEnabled: z.boolean(), eveningTime: CivilTimeSchema }).strict(),
}).strict().superRefine((document, context) => {
  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > MAX_PERSONAL_ASSISTANT_DOCUMENT_BYTES) context.addIssue({ code: "custom", message: "Dữ liệu trợ lý vượt quá giới hạn 100 KiB." });
  for (const field of ["events", "memories"] as const) {
    if (new Set(document[field].map(item => item.id)).size !== document[field].length) context.addIssue({ code: "custom", path: [field], message: "Duplicate IDs" });
  }
});
export type PersonalAssistantDocument = z.infer<typeof PersonalAssistantDocumentSchema>;
export type PersonalLifeEvent = z.infer<typeof PersonalLifeEventSchema>;
export const PersonalAssistantEnvelopeSchema = z.object({ revision: z.number().int().nonnegative(), document: PersonalAssistantDocumentSchema }).strict();
export type PersonalAssistantEnvelope = z.infer<typeof PersonalAssistantEnvelopeSchema>;
export const INITIAL_PERSONAL_ASSISTANT_DOCUMENT: PersonalAssistantDocument = {
  events: [], memories: [], daily: { morningEnabled: false, morningTime: "07:00", eveningEnabled: false, eveningTime: "20:00" },
};
export default INITIAL_PERSONAL_ASSISTANT_DOCUMENT;
export function initialPersonalAssistantDocument(): PersonalAssistantDocument {
  return structuredClone(INITIAL_PERSONAL_ASSISTANT_DOCUMENT);
}
