import { z } from "zod";

export const SEMANTIC_TIMEZONE = "Asia/Ho_Chi_Minh" as const;
export const MAX_SEMANTIC_TITLE_CODE_UNITS = 1_800;
export const MAX_CLARIFICATION_QUESTION_CODE_UNITS = 500;
export const MAX_CLARIFICATION_MISSING_FIELDS = 4;

export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const LocalTimeSchema = z.string().regex(/^\d{2}:\d{2}$/);

const CreateReminderSchema = z.object({
  intent: z.literal("CREATE_REMINDER"),
  title: z.string().min(1).max(MAX_SEMANTIC_TITLE_CODE_UNITS),
  localDate: LocalDateSchema,
  localTime: LocalTimeSchema,
  timezone: z.literal(SEMANTIC_TIMEZONE),
  needsClarification: z.literal(false),
}).strict();

const ListRemindersSchema = z.object({
  intent: z.literal("LIST_REMINDERS"),
  rangeKind: z.enum(["TODAY", "TOMORROW", "DATE", "THIS_WEEK", "NEXT_7_DAYS", "UPCOMING"]),
  localDate: LocalDateSchema.nullable(),
}).strict();

const ClarificationMissingFieldsSchema = z.array(z.enum(["date", "time", "title", "range"]))
  .min(1)
  .max(MAX_CLARIFICATION_MISSING_FIELDS)
  .refine((fields) => new Set(fields).size === fields.length, {
    message: "Clarification fields must be unique",
  });

const NeedsClarificationSchema = z.object({
  intent: z.literal("NEEDS_CLARIFICATION"),
  targetIntent: z.enum(["CREATE_REMINDER", "LIST_REMINDERS"]),
  missingFields: ClarificationMissingFieldsSchema,
  question: z.string().min(1).max(MAX_CLARIFICATION_QUESTION_CODE_UNITS),
}).strict();

const HelpSchema = z.object({ intent: z.literal("HELP") }).strict();
const UnsupportedSchema = z.object({ intent: z.literal("UNSUPPORTED") }).strict();

export const SemanticInterpretationSchema = z.discriminatedUnion("intent", [
  CreateReminderSchema,
  ListRemindersSchema,
  NeedsClarificationSchema,
  HelpSchema,
  UnsupportedSchema,
]);
export type SemanticInterpretation = z.infer<typeof SemanticInterpretationSchema>;

export const SemanticInterpretationJsonSchema = z.toJSONSchema(SemanticInterpretationSchema, {
  target: "draft-07",
});
