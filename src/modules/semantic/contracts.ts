import { z } from "zod";

export const SEMANTIC_TIMEZONE = "Asia/Ho_Chi_Minh" as const;
export const MAX_SEMANTIC_TITLE_CODE_UNITS = 1_800;
export const MAX_CLARIFICATION_QUESTION_CODE_UNITS = 500;
export const MAX_CLARIFICATION_MISSING_FIELDS = 4;
/** Bump with any Zod-only validation behavior not represented in JSON Schema. */
export const SEMANTIC_RUNTIME_VALIDATION_CONTRACT_VERSION = "semantic-runtime-validation-2-hybrid-model";

export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const LocalTimeSchema = z.string().regex(/^\d{2}:\d{2}$/);

/** Provider output is semantic only. Temporal authority belongs to the backend. */
export const ModelSemanticInterpretationSchema = z.object({
  intent: z.enum(["CREATE_REMINDER", "LIST_REMINDERS", "HELP", "UNSUPPORTED", "AMBIGUOUS"]),
  title: z.string().min(1).max(MAX_SEMANTIC_TITLE_CODE_UNITS).nullable(),
  titleState: z.enum(["RESOLVED", "MISSING", "AMBIGUOUS", "NOT_APPLICABLE"]),
  targetIntent: z.enum(["CREATE_REMINDER", "LIST_REMINDERS"]).nullable(),
}).strict().superRefine((value, ctx) => {
  const titleApplicable = value.intent === "CREATE_REMINDER"
    || (value.intent === "AMBIGUOUS" && value.targetIntent === "CREATE_REMINDER");
  if (value.intent !== "AMBIGUOUS" && value.targetIntent !== null) {
    ctx.addIssue({ code: "custom", path: ["targetIntent"], message: "Only ambiguous intent may have a target intent" });
  }
  if (!titleApplicable) {
    if (value.title !== null || value.titleState !== "NOT_APPLICABLE") {
      ctx.addIssue({ code: "custom", path: ["titleState"], message: "Non-create semantics must not carry a title" });
    }
  } else if (value.titleState === "NOT_APPLICABLE"
    || (value.titleState === "RESOLVED" ? value.title === null || value.title.trim().length === 0 : value.title !== null)) {
    ctx.addIssue({ code: "custom", path: ["titleState"], message: "Create semantics require a resolved nonblank title or an unresolved null title" });
  }
});
export type ModelSemanticInterpretation = z.infer<typeof ModelSemanticInterpretationSchema>;
export const ModelSemanticInterpretationJsonSchema = z.toJSONSchema(ModelSemanticInterpretationSchema, {
  target: "draft-07",
});

/** Backend/application outcome contract, never a provider response schema. */
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
