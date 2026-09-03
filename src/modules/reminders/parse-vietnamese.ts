export const VIETNAM_TIMEZONE = "Asia/Ho_Chi_Minh" as const;
// Leaves at least 200 UTF-16 code units for Zalo's 2,000-unit notification limit.
export const MAX_REMINDER_TITLE_CODE_UNITS = 1_800;

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1_000;
const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60 * 1_000;

export type ReminderParseFailureCode =
  | "UNSUPPORTED_TIMEZONE"
  | "INVALID_REFERENCE_TIME"
  | "INVALID_COMMAND"
  | "MISSING_DATE"
  | "AMBIGUOUS_DATE"
  | "INVALID_DATE"
  | "MISSING_TIME"
  | "AMBIGUOUS_TIME"
  | "INVALID_TIME"
  | "MISSING_TITLE"
  | "TITLE_TOO_LONG"
  | "PAST_TIME"
  | "TOO_FAR";

export interface ParsedReminderCandidate {
  title: string;
  scheduledAt: number;
  timezone: typeof VIETNAM_TIMEZONE;
}

export type ParseVietnameseReminderResult =
  | { ok: true; candidate: ParsedReminderCandidate }
  | { ok: false; code: ReminderParseFailureCode };

interface TextSpan {
  start: number;
  end: number;
}

interface DateToken extends TextSpan {
  kind: "relative" | "explicit";
  relativeDays?: number;
  day?: number;
  month?: number;
  year?: number;
}

interface TimeToken extends TextSpan {
  hour: number;
  minute: number;
}

function normalizeCommand(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(/\s+/gu, " ")
    .trim();
}

function capturedSpan(match: RegExpMatchArray, captured: string): TextSpan {
  const start = (match.index ?? 0) + match[1].length;
  return { start, end: start + captured.length };
}

function findDateTokens(text: string): DateToken[] {
  const tokens: DateToken[] = [];
  const relativePattern = /(^|\s)(hôm nay|ngày kia|mai)(?=\s|$)/giu;
  for (const match of text.matchAll(relativePattern)) {
    const span = capturedSpan(match, match[2]);
    const normalized = match[2].toLocaleLowerCase("vi-VN");
    tokens.push({
      ...span,
      kind: "relative",
      relativeDays: normalized === "hôm nay" ? 0 : normalized === "mai" ? 1 : 2,
    });
  }

  const explicitPattern = /(^|\s)((?:ngày\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?)(?=\s|$)/giu;
  for (const match of text.matchAll(explicitPattern)) {
    tokens.push({
      ...capturedSpan(match, match[2]),
      kind: "explicit",
      day: Number(match[3]),
      month: Number(match[4]),
      year: match[5] === undefined ? undefined : Number(match[5]),
    });
  }
  return tokens.sort((left, right) => left.start - right.start);
}

function findTimeTokens(text: string): TimeToken[] {
  const tokens: TimeToken[] = [];
  const pattern = /(^|\s)((?:lúc\s+)?(\d{1,2})(?:h|:(\d{2})))(?=\s|$)/giu;
  for (const match of text.matchAll(pattern)) {
    tokens.push({
      ...capturedSpan(match, match[2]),
      hour: Number(match[3]),
      minute: match[4] === undefined ? 0 : Number(match[4]),
    });
  }
  return tokens;
}

function findReminderMarkers(text: string): TextSpan[] {
  const markers: TextSpan[] = [];
  const pattern = /(^|\s)(nhắc(?:\s+(?:tôi|tui|mình))?)(?=\s|$)/giu;
  for (const match of text.matchAll(pattern)) {
    markers.push(capturedSpan(match, match[2]));
  }
  return markers;
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1 || year > 9_999) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

function localReferenceParts(now: number): { year: number; month: number; day: number } | null {
  const local = new Date(now + VIETNAM_OFFSET_MS);
  if (Number.isNaN(local.getTime())) return null;
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
  };
}

function resolveDate(
  token: DateToken,
  reference: { year: number; month: number; day: number },
): { year: number; month: number; day: number } | null {
  if (token.kind === "relative") {
    const localMidnight = new Date(Date.UTC(
      reference.year,
      reference.month - 1,
      reference.day + (token.relativeDays ?? 0),
    ));
    return {
      year: localMidnight.getUTCFullYear(),
      month: localMidnight.getUTCMonth() + 1,
      day: localMidnight.getUTCDate(),
    };
  }

  const day = token.day ?? 0;
  const month = token.month ?? 0;
  let year = token.year ?? reference.year;
  if (token.year === undefined) {
    const isEarlier = month < reference.month
      || (month === reference.month && day < reference.day);
    if (isEarlier) year += 1;
  }
  return validCalendarDate(year, month, day) ? { year, month, day } : null;
}

function extractTitle(text: string, spans: TextSpan[]): string {
  // RegExp and String.slice both use UTF-16 offsets, keeping token removal aligned.
  let remainder = text;
  for (const span of [...spans].sort((left, right) => right.start - left.start)) {
    remainder = `${remainder.slice(0, span.start)} ${remainder.slice(span.end)}`;
  }
  return remainder.replace(/\s+/gu, " ").trim();
}

export function parseVietnameseReminder(
  text: string,
  now: number,
  timezone: string,
): ParseVietnameseReminderResult {
  if (timezone !== VIETNAM_TIMEZONE) {
    return { ok: false, code: "UNSUPPORTED_TIMEZONE" };
  }
  if (!Number.isFinite(now)) {
    return { ok: false, code: "INVALID_REFERENCE_TIME" };
  }

  const normalized = normalizeCommand(text);
  const reference = localReferenceParts(now);
  if (!reference) return { ok: false, code: "INVALID_REFERENCE_TIME" };

  const dates = findDateTokens(normalized);
  if (dates.length === 0) return { ok: false, code: "MISSING_DATE" };
  if (dates.length > 1) return { ok: false, code: "AMBIGUOUS_DATE" };

  const times = findTimeTokens(normalized);
  if (times.length === 0) return { ok: false, code: "MISSING_TIME" };
  if (times.length > 1) return { ok: false, code: "AMBIGUOUS_TIME" };
  const time = times[0];
  if (time.hour > 23 || time.minute > 59) {
    return { ok: false, code: "INVALID_TIME" };
  }

  const markers = findReminderMarkers(normalized);
  if (markers.length !== 1) return { ok: false, code: "INVALID_COMMAND" };

  const date = resolveDate(dates[0], reference);
  if (!date) return { ok: false, code: "INVALID_DATE" };

  const title = extractTitle(normalized, [dates[0], time, markers[0]]);
  if (title.length === 0) return { ok: false, code: "MISSING_TITLE" };
  if (title.length > MAX_REMINDER_TITLE_CODE_UNITS) {
    return { ok: false, code: "TITLE_TOO_LONG" };
  }

  const scheduledAt = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    time.hour,
    time.minute,
  ) - VIETNAM_OFFSET_MS;
  if (scheduledAt <= now) return { ok: false, code: "PAST_TIME" };
  if (scheduledAt - now > MAX_SCHEDULE_AHEAD_MS) {
    return { ok: false, code: "TOO_FAR" };
  }

  return {
    ok: true,
    candidate: { title, scheduledAt, timezone: VIETNAM_TIMEZONE },
  };
}
