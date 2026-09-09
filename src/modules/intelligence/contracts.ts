import { z } from "zod";

export const IntelligenceModeSchema = z.enum(["off", "free", "economy"]);
export type IntelligenceMode = z.infer<typeof IntelligenceModeSchema>;

export const ReminderInterpretationInputSchema = z.object({
  text: z.string().min(1).max(1_800),
  now: z.number().int().safe(),
  timezone: z.literal("Asia/Ho_Chi_Minh"),
}).strict();
export type ReminderInterpretationInput = z.infer<typeof ReminderInterpretationInputSchema>;

const ReminderProposalSchema = z.object({
  status: z.literal("PROPOSED"),
  title: z.string().min(1).max(1_800),
  scheduledAt: z.number().int().safe(),
  timezone: z.literal("Asia/Ho_Chi_Minh"),
  confidence: z.number().min(0).max(1),
}).strict();

const ReminderClarificationSchema = z.object({
  status: z.literal("NEEDS_CLARIFICATION"),
  clarificationQuestion: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
}).strict();

const ReminderUnsupportedSchema = z.object({
  status: z.literal("UNSUPPORTED"),
  confidence: z.number().min(0).max(1),
}).strict();

export const ReminderInterpretationSchema = z.discriminatedUnion("status", [
  ReminderProposalSchema,
  ReminderClarificationSchema,
  ReminderUnsupportedSchema,
]);
export type ReminderInterpretation = z.infer<typeof ReminderInterpretationSchema>;

export const ActionExtractionInputSchema = z.object({
  text: z.string().min(1).max(1_800),
  observedAt: z.number().int().safe(),
  timezone: z.literal("Asia/Ho_Chi_Minh"),
}).strict();
export type ActionExtractionInput = z.infer<typeof ActionExtractionInputSchema>;

export const ActionExtractionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("PROPOSED"),
    title: z.string().min(1).max(1_800),
    scheduledAt: z.number().int().safe(),
    timezone: z.literal("Asia/Ho_Chi_Minh"),
    confidence: z.number().min(0).max(1),
  }).strict(),
  z.object({
    status: z.literal("NEEDS_CLARIFICATION"),
    clarificationQuestion: z.string().min(1).max(500),
    confidence: z.number().min(0).max(1),
  }).strict(),
  z.object({ status: z.literal("UNSUPPORTED"), confidence: z.number().min(0).max(1) }).strict(),
]);
export type ActionExtraction = z.infer<typeof ActionExtractionSchema>;

// This port deliberately has no provider configuration, transport primitives,
// or persistence access. Its output is only a proposal for a caller to review.
export interface IntelligenceGateway {
  interpretReminder(input: ReminderInterpretationInput): Promise<unknown>;
  extractAction(input: ActionExtractionInput): Promise<unknown>;
}

export interface IntelligenceModel {
  id: string;
  class: "FREE" | "ECONOMY";
}
