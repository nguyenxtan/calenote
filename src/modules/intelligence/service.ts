import {
  ReminderInterpretationInputSchema,
  ReminderInterpretationSchema,
  type IntelligenceGateway,
  type IntelligenceMode,
  type IntelligenceModel,
  type ReminderInterpretation,
  type ReminderInterpretationInput,
} from "./contracts";

const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60 * 1_000;

type DeterministicResult =
  | { status: "CONFIDENT"; proposal: Extract<ReminderInterpretation, { status: "PROPOSED" }> }
  | { status: "AMBIGUOUS" }
  | { status: "UNSUPPORTED" };

export type IntelligenceResolution =
  | { status: "DETERMINISTIC"; proposal: Extract<ReminderInterpretation, { status: "PROPOSED" }> }
  | { status: "PROPOSED"; proposal: Extract<ReminderInterpretation, { status: "PROPOSED" }> }
  | { status: "NEEDS_CLARIFICATION"; clarificationQuestion: string }
  | { status: "UNSUPPORTED" }
  | { status: "UNAVAILABLE"; reason: "DISABLED" | "UNCONFIGURED" | "INVALID_PROPOSAL" | "SENSITIVE_INPUT" };

export function createNullIntelligenceGateway(): IntelligenceGateway {
  return {
    interpretReminder: async () => ({ status: "UNAVAILABLE" }),
    extractAction: async () => ({ status: "UNAVAILABLE" }),
  };
}

export function selectIntelligenceModel(
  mode: IntelligenceMode,
  models: readonly IntelligenceModel[],
): { status: "SELECTED"; model: IntelligenceModel } | { status: "UNAVAILABLE"; reason: "DISABLED" | "UNCONFIGURED" } {
  if (mode === "off") return { status: "UNAVAILABLE", reason: "DISABLED" };
  const allowedClass = mode === "free" ? "FREE" : "ECONOMY";
  const model = models.find((candidate) => candidate.class === allowedClass);
  return model ? { status: "SELECTED", model } : { status: "UNAVAILABLE", reason: "UNCONFIGURED" };
}

function containsSensitiveInput(text: string, sensitiveValues: readonly string[]): boolean {
  return /\bauthorization\s*:/iu.test(text)
    || /\b(?:api[_ -]?key|secret|password)\s*[:=]/iu.test(text)
    || /__Host-calenote_session=/u.test(text)
    || /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/u.test(text)
    || /(?:^|\s)\/connect\b/iu.test(text)
    || sensitiveValues.some((value) => value.length > 0 && text.includes(value));
}

function validProposal(proposal: Extract<ReminderInterpretation, { status: "PROPOSED" }>, now: number): boolean {
  return proposal.scheduledAt > now && proposal.scheduledAt - now <= MAX_SCHEDULE_AHEAD_MS;
}

export async function interpretReminderDeterministicallyFirst(
  input: ReminderInterpretationInput,
  dependencies: {
    mode: IntelligenceMode;
    gateway: IntelligenceGateway;
    deterministic: (input: ReminderInterpretationInput) => DeterministicResult;
    sensitiveValues?: readonly string[];
  },
): Promise<IntelligenceResolution> {
  const parsedInput = ReminderInterpretationInputSchema.safeParse(input);
  if (!parsedInput.success) return { status: "UNAVAILABLE", reason: "INVALID_PROPOSAL" };

  const deterministic = dependencies.deterministic(parsedInput.data);
  if (deterministic.status === "CONFIDENT") {
    return validProposal(deterministic.proposal, parsedInput.data.now)
      ? { status: "DETERMINISTIC", proposal: deterministic.proposal }
      : { status: "UNAVAILABLE", reason: "INVALID_PROPOSAL" };
  }
  if (deterministic.status === "UNSUPPORTED") return { status: "UNSUPPORTED" };
  if (dependencies.mode === "off") return { status: "UNAVAILABLE", reason: "DISABLED" };
  if (containsSensitiveInput(parsedInput.data.text, dependencies.sensitiveValues ?? [])) {
    return { status: "UNAVAILABLE", reason: "SENSITIVE_INPUT" };
  }

  const rawProposal = await dependencies.gateway.interpretReminder(parsedInput.data);
  if (typeof rawProposal === "object" && rawProposal !== null
    && (rawProposal as { status?: unknown }).status === "UNAVAILABLE") {
    return { status: "UNAVAILABLE", reason: "UNCONFIGURED" };
  }
  const proposed = ReminderInterpretationSchema.safeParse(rawProposal);
  if (!proposed.success) return { status: "UNAVAILABLE", reason: "INVALID_PROPOSAL" };
  if (proposed.data.status === "PROPOSED") {
    return validProposal(proposed.data, parsedInput.data.now)
      ? { status: "PROPOSED", proposal: proposed.data }
      : { status: "UNAVAILABLE", reason: "INVALID_PROPOSAL" };
  }
  if (proposed.data.status === "NEEDS_CLARIFICATION") {
    return { status: "NEEDS_CLARIFICATION", clarificationQuestion: proposed.data.clarificationQuestion };
  }
  return { status: "UNSUPPORTED" };
}
