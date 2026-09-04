import { z } from "zod";

/** Core calendar behavior remains available without an external model. */
export const LLM_REQUIRED_FOR_CORE = "NO" as const;

export const IntentProposalSchema = z
  .object({
    kind: z.enum(["REMINDER", "TASK", "EVENT", "UNKNOWN"]),
    confidence: z.number().min(0).max(1),
    rationale: z.string().max(500),
  })
  .strict();

export const ActionCandidateSchema = z
  .object({
    kind: z.enum(["CREATE_REMINDER", "CREATE_TASK", "CREATE_EVENT"]),
    title: z.string().min(1).max(500),
    source: z.literal("CHAT"),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const ActionProposalSchema = z
  .object({
    candidates: z.array(ActionCandidateSchema).max(10),
  })
  .strict();

export const RelevanceProposalSchema = z
  .object({
    label: z.enum(["RELEVANT", "IRRELEVANT", "UNCERTAIN"]),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type IntentProposal = z.infer<typeof IntentProposalSchema>;
export type ActionCandidate = z.infer<typeof ActionCandidateSchema>;
export type ActionProposal = z.infer<typeof ActionProposalSchema>;
export type RelevanceProposal = z.infer<typeof RelevanceProposalSchema>;
export type IntelligenceInput = { readonly text: string; readonly locale?: string };
export type IntelligenceResult = {
  readonly intent: IntentProposal;
  readonly action: ActionProposal;
  readonly relevance: RelevanceProposal;
};

export interface IntentExtractor {
  extract(input: IntelligenceInput): Promise<IntentProposal>;
}
export interface ActionExtractor {
  extract(input: IntelligenceInput, intent: IntentProposal): Promise<ActionProposal>;
}
export interface RelevanceClassifier {
  classify(input: IntelligenceInput): Promise<RelevanceProposal>;
}

export function parseIntentProposal(value: unknown): IntentProposal {
  return IntentProposalSchema.parse(value);
}
export function parseActionProposal(value: unknown): ActionProposal {
  return ActionProposalSchema.parse(value);
}
export function parseRelevanceProposal(value: unknown): RelevanceProposal {
  return RelevanceProposalSchema.parse(value);
}

export interface IntelligenceFoundation {
  readonly intents: IntentExtractor;
  readonly actions: ActionExtractor;
  readonly relevance: RelevanceClassifier;
  propose(input: IntelligenceInput): Promise<IntelligenceResult>;
}

const REMINDER_WORDS = /\b(nhắc|nhac|remind|nhớ|nho)\b/i;
const TASK_WORDS = /\b(việc|viec|task|todo|làm|lam)\b/i;
const EVENT_WORDS = /\b(họp|hop|lịch|lich|sự kiện|su kien|event)\b/i;

function intentFor(text: string): IntentProposal {
  const kind = REMINDER_WORDS.test(text)
    ? "REMINDER"
    : EVENT_WORDS.test(text)
      ? "EVENT"
      : TASK_WORDS.test(text)
        ? "TASK"
        : "UNKNOWN";
  return {
    kind,
    confidence: kind === "UNKNOWN" ? 0.35 : 0.8,
    rationale: kind === "UNKNOWN" ? "No supported calendar intent detected." : "Matched deterministic calendar vocabulary.",
  };
}

function relevanceFor(text: string): RelevanceProposal {
  const intent = intentFor(text);
  return {
    label: intent.kind === "UNKNOWN" ? "IRRELEVANT" : "RELEVANT",
    confidence: intent.kind === "UNKNOWN" ? 0.75 : intent.confidence,
  };
}

class DeterministicIntentExtractor implements IntentExtractor {
  async extract(input: IntelligenceInput): Promise<IntentProposal> {
    return parseIntentProposal(intentFor(input.text));
  }
}

class DeterministicRelevanceClassifier implements RelevanceClassifier {
  async classify(input: IntelligenceInput): Promise<RelevanceProposal> {
    return parseRelevanceProposal(relevanceFor(input.text));
  }
}

class DeterministicActionExtractor implements ActionExtractor {
  async extract(input: IntelligenceInput, intent: IntentProposal): Promise<ActionProposal> {
    if (intent.kind === "UNKNOWN" || !input.text.trim()) return { candidates: [] };
    const kind = intent.kind === "REMINDER" ? "CREATE_REMINDER" : intent.kind === "TASK" ? "CREATE_TASK" : "CREATE_EVENT";
    return parseActionProposal({ candidates: [{ kind, title: input.text.trim(), source: "CHAT", confidence: intent.confidence }] });
  }
}

export function createDeterministicIntelligence(): IntelligenceFoundation {
  const intents = new DeterministicIntentExtractor();
  const actions = new DeterministicActionExtractor();
  const relevance = new DeterministicRelevanceClassifier();
  return {
    intents,
    actions,
    relevance,
    async propose(input) {
      const intent = await intents.extract(input);
      const [action, relevanceResult] = await Promise.all([actions.extract(input, intent), relevance.classify(input)]);
      return { intent, action, relevance: relevanceResult };
    },
  };
}

/**
 * Adapts an optional model-backed set of ports while keeping validation and
 * the proposal-only boundary in the application layer. No repository or
 * reminder service is accepted here by design.
 */
export function createIntelligenceFoundation(deps: {
  intents: IntentExtractor;
  actions: ActionExtractor;
  relevance: RelevanceClassifier;
}): IntelligenceFoundation {
  return {
    ...deps,
    async propose(input) {
      const intent = parseIntentProposal(await deps.intents.extract(input));
      const [action, relevance] = await Promise.all([
        deps.actions.extract(input, intent),
        deps.relevance.classify(input),
      ]);
      return {
        intent,
        action: parseActionProposal(action),
        relevance: parseRelevanceProposal(relevance),
      };
    },
  };
}
