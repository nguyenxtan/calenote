import {
  MAX_SEMANTIC_TITLE_CODE_UNITS,
  SEMANTIC_TIMEZONE,
  SemanticInterpretationSchema,
  type SemanticInterpretation,
} from "./contracts";

export const MAX_SEMANTIC_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60 * 1_000;

export type SemanticValidationFailureCode =
  | "INVALID_DATE_OR_TIME"
  | "INVALID_RANGE"
  | "PAST_TIME"
  | "TOO_FAR";

export type SemanticValidationResult =
  | {
    kind: "CREATE";
    candidate: {
      title: string;
      scheduledAt: number;
      timezone: typeof SEMANTIC_TIMEZONE;
    };
  }
  | {
    kind: "QUERY";
    rangeKind: "TODAY" | "TOMORROW" | "DATE" | "THIS_WEEK" | "NEXT_7_DAYS" | "UPCOMING";
    localDate: string | null;
  }
  | {
    kind: "CLARIFICATION";
    clarification: {
      targetIntent: "CREATE_REMINDER" | "LIST_REMINDERS";
      missingFields: Array<"date" | "time" | "title" | "range">;
      question: string;
    };
  }
  | { kind: "SAFE_CLARIFICATION"; code: SemanticValidationFailureCode }
  | { kind: "SAFE_HELP"; code: "HELP" | "UNSUPPORTED" | "INVALID_SEMANTIC_INTERPRETATION" | "INVALID_PROCESSING_TIME" };

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

interface LocalTimeParts {
  hour: number;
  minute: number;
}

function parseLocalDate(value: string): LocalDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9_999 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const candidate = new Date(0);
  candidate.setUTCFullYear(year, month - 1, day);
  candidate.setUTCHours(0, 0, 0, 0);
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day
    ? { year, month, day }
    : null;
}

function parseLocalTime(value: string): LocalTimeParts | null {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  if (match === null) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

function vietnamLocalTimestamp(date: LocalDateParts, time: LocalTimeParts): number {
  const local = new Date(0);
  local.setUTCFullYear(date.year, date.month - 1, date.day);
  local.setUTCHours(time.hour, time.minute, 0, 0);
  return local.getTime() - 7 * 60 * 60 * 1_000;
}

function validateCreate(
  interpretation: Extract<SemanticInterpretation, { intent: "CREATE_REMINDER" }>,
  processingNow: number,
): SemanticValidationResult {
  const date = parseLocalDate(interpretation.localDate);
  const time = parseLocalTime(interpretation.localTime);
  if (date === null || time === null) {
    return { kind: "SAFE_CLARIFICATION", code: "INVALID_DATE_OR_TIME" };
  }
  if (interpretation.title.trim().length === 0 || interpretation.title.length > MAX_SEMANTIC_TITLE_CODE_UNITS) {
    return { kind: "SAFE_HELP", code: "INVALID_SEMANTIC_INTERPRETATION" };
  }

  const scheduledAt = vietnamLocalTimestamp(date, time);
  if (scheduledAt <= processingNow) return { kind: "SAFE_CLARIFICATION", code: "PAST_TIME" };
  if (scheduledAt - processingNow > MAX_SEMANTIC_SCHEDULE_AHEAD_MS) {
    return { kind: "SAFE_CLARIFICATION", code: "TOO_FAR" };
  }
  return {
    kind: "CREATE",
    candidate: {
      title: interpretation.title,
      scheduledAt,
      timezone: SEMANTIC_TIMEZONE,
    },
  };
}

function validateQuery(
  interpretation: Extract<SemanticInterpretation, { intent: "LIST_REMINDERS" }>,
): SemanticValidationResult {
  if (interpretation.rangeKind === "DATE") {
    if (interpretation.localDate === null) {
      return { kind: "SAFE_HELP", code: "INVALID_SEMANTIC_INTERPRETATION" };
    }
    if (parseLocalDate(interpretation.localDate) === null) {
      return { kind: "SAFE_CLARIFICATION", code: "INVALID_DATE_OR_TIME" };
    }
  } else if (interpretation.localDate !== null) {
    return { kind: "SAFE_CLARIFICATION", code: "INVALID_RANGE" };
  }

  return {
    kind: "QUERY",
    rangeKind: interpretation.rangeKind,
    localDate: interpretation.localDate,
  };
}

function validateSemanticInterpretation(
  interpretation: SemanticInterpretation,
  processingNow: number,
): SemanticValidationResult {
  if (!Number.isFinite(processingNow)) {
    return { kind: "SAFE_HELP", code: "INVALID_PROCESSING_TIME" };
  }

  switch (interpretation.intent) {
    case "CREATE_REMINDER":
      return validateCreate(interpretation, processingNow);
    case "LIST_REMINDERS":
      return validateQuery(interpretation);
    case "NEEDS_CLARIFICATION":
      return {
        kind: "CLARIFICATION",
        clarification: {
          targetIntent: interpretation.targetIntent,
          missingFields: interpretation.missingFields,
          question: interpretation.question,
        },
      };
    case "HELP":
      return { kind: "SAFE_HELP", code: "HELP" };
    case "UNSUPPORTED":
      return { kind: "SAFE_HELP", code: "UNSUPPORTED" };
  }
}

export function validateSemanticPayload(payload: unknown, processingNow: number): SemanticValidationResult {
  const parsed = SemanticInterpretationSchema.safeParse(payload);
  if (!parsed.success) return { kind: "SAFE_HELP", code: "INVALID_SEMANTIC_INTERPRETATION" };
  return validateSemanticInterpretation(parsed.data, processingNow);
}
