import type { ParsedReminderCandidate, ReminderParseFailureCode } from "../reminders/parse-vietnamese";

export type ConversationIntent =
  | "CREATE_REMINDER"
  | "LIST_REMINDERS"
  | "CONFIRM_PENDING"
  | "CANCEL_PENDING"
  | "HELP"
  | "UNKNOWN";

export type ReminderQueryRangeKind = "TODAY" | "TOMORROW" | "DATE" | "UPCOMING";

export interface DeterministicConversationInput {
  text: string;
  receivedAt: number;
  processingNow: number;
  timezone?: string;
}

export type DeterministicConversationResult =
  | { kind: "CREATE_CANDIDATE"; intent: "CREATE_REMINDER"; candidate: ParsedReminderCandidate }
  | { kind: "LIST_QUERY"; intent: "LIST_REMINDERS"; rangeKind: ReminderQueryRangeKind; localDate?: string }
  | {
    kind: "CLARIFICATION";
    intent: "CREATE_REMINDER";
    target: "CREATE_REMINDER";
    missingFields: Array<"date" | "time" | "title">;
    context: { localDate?: string; localTime?: string; title?: string };
    reply: string;
  }
  | {
    kind: "REJECTED";
    intent: "CREATE_REMINDER";
    code: Extract<ReminderParseFailureCode, "PAST_TIME" | "INVALID_TIME" | "INVALID_DATE" | "TOO_FAR" | "TITLE_TOO_LONG">;
    reply: string;
  }
  | { kind: "PENDING_ACTION"; intent: "CONFIRM_PENDING" | "CANCEL_PENDING" }
  | { kind: "QUERY_REJECTED"; intent: "LIST_REMINDERS"; code: "INVALID_DATE"; reply: string }
  | { kind: "AI_ELIGIBLE"; intent: "UNKNOWN" }
  | { kind: "HELP"; intent: "HELP"; reply: string };
