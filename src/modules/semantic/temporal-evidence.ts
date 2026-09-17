export const TEMPORAL_EVIDENCE_TIMEZONE = "Asia/Ho_Chi_Minh" as const;

type LocalDate = `${number}-${number}-${number}`;
type LocalTime = `${number}:${number}`;

export type TemporalDateEvidence =
  | {
    state: "RESOLVED";
    source: "TODAY" | "TOMORROW" | "EXPLICIT_DATE" | "DAY_MONTH";
    localDate: LocalDate;
  }
  | { state: "MISSING" }
  | {
    state: "AMBIGUOUS";
    reason: "MULTIPLE_DATE_EXPRESSIONS" | "INVALID_DATE" | "CONFLICTING_DATE_EXPRESSIONS";
  };

export type TemporalTimeEvidence =
  | { state: "RESOLVED"; source: "EXACT_TIME"; localTime: LocalTime }
  | { state: "MISSING" }
  | {
    state: "AMBIGUOUS";
    reason: "MULTIPLE_TIME_EXPRESSIONS" | "INVALID_TIME" | "DAYPART_WITHOUT_EXACT_TIME";
  };

export type TemporalRangeEvidence =
  | {
    state: "RESOLVED";
    kind: "TODAY" | "TOMORROW" | "DATE" | "THIS_WEEK" | "NEXT_7_DAYS" | "UPCOMING";
    localDate: LocalDate | null;
  }
  | { state: "MISSING" }
  | { state: "AMBIGUOUS" };

export type TemporalEvidence = {
  timezone: typeof TEMPORAL_EVIDENCE_TIMEZONE;
  referenceLocalDate: LocalDate;
  referenceLocalTime: LocalTime;
  date: TemporalDateEvidence;
  time: TemporalTimeEvidence;
  range: TemporalRangeEvidence;
};

export type TemporalEvidenceField = "date" | "time" | "range";

export type TemporalEvidenceMergeResult =
  | { kind: "MERGED"; evidence: TemporalEvidence }
  | {
    kind: "CONFLICT";
    conflicts: TemporalEvidenceField[];
    evidence: TemporalEvidence;
  };

type ReferenceDate = { year: number; month: number; day: number };

type DateCandidate = {
  source: "TODAY" | "TOMORROW" | "EXPLICIT_DATE" | "DAY_MONTH";
  localDate: LocalDate | null;
};

type RangeCandidate = Extract<TemporalRangeEvidence, { state: "RESOLVED" }>;

type TemporalTokenClass = "DATE" | "RELATIVE_DATE" | "TIME" | "RANGE";
type TemporalContinuation = "NONE" | "INVALID" | "MODIFIER";

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1_000;

function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDate({ year, month, day }: ReferenceDate): LocalDate {
  return `${String(year).padStart(4, "0")}-${padTwo(month)}-${padTwo(day)}` as LocalDate;
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

function localReferenceParts(referenceNow: number): ReferenceDate & { hour: number; minute: number } {
  if (!Number.isFinite(referenceNow)) {
    throw new RangeError("referenceNow must be a finite epoch millisecond value");
  }
  const local = new Date(referenceNow + VIETNAM_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}

function addLocalDays(reference: ReferenceDate, days: number): ReferenceDate {
  const shifted = new Date(Date.UTC(reference.year, reference.month - 1, reference.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function resolveExplicitDate(
  year: number | undefined,
  month: number,
  day: number,
  reference: ReferenceDate,
): { source: "EXPLICIT_DATE" | "DAY_MONTH"; localDate: LocalDate | null } {
  const source = year === undefined ? "DAY_MONTH" : "EXPLICIT_DATE";
  let resolvedYear = year ?? reference.year;
  if (year === undefined) {
    const isEarlier = month < reference.month || (month === reference.month && day < reference.day);
    if (isEarlier) resolvedYear += 1;
  }
  return {
    source,
    localDate: validCalendarDate(resolvedYear, month, day)
      ? formatDate({ year: resolvedYear, month, day })
      : null,
  };
}

function classifyTemporalContinuation(
  text: string,
  tokenEnd: number,
  tokenClass: TemporalTokenClass,
): TemporalContinuation {
  const suffix = text.slice(tokenEnd);

  if (tokenClass === "TIME") {
    if (/^:\s*\d/u.test(suffix) || /^\s+\d{1,2}(?=$|[^\p{L}\p{N}])/u.test(suffix)) {
      return "INVALID";
    }
    if (/^\s+(?:sáng|chiều|tối|am|pm)(?=$|[^\p{L}\p{N}])/iu.test(suffix)) {
      return "MODIFIER";
    }
    return "NONE";
  }

  if (tokenClass === "DATE") {
    if (/^[\/-]\s*[\p{L}\p{N}]/u.test(suffix) || /^\s+năm(?=$|[^\p{L}\p{N}])/iu.test(suffix)) {
      return "INVALID";
    }
    return "NONE";
  }

  if (tokenClass === "RELATIVE_DATE") {
    return /^\s+mốt(?=$|[^\p{L}\p{N}])/iu.test(suffix) ? "INVALID" : "NONE";
  }

  return /^[\/:\-]\s*[\p{L}\p{N}]/u.test(suffix) ? "INVALID" : "NONE";
}

function findDateCandidates(text: string, reference: ReferenceDate): DateCandidate[] {
  const candidates: DateCandidate[] = [];
  const pattern = /(^|[^\p{L}\p{N}])((hôm nay|ngày mai|mai)|(\d{4})-(\d{1,2})-(\d{1,2})|(?:ngày\s+)?(\d{1,2})\s+tháng\s+(\d{1,2})(?:\s+năm\s+(\d{4}))?|(?:ngày\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?)(?=$|[^\p{L}\p{N}])/giu;

  for (const match of text.matchAll(pattern)) {
    const tokenClass = match[3] === undefined ? "DATE" : "RELATIVE_DATE";
    const continuation = classifyTemporalContinuation(
      text,
      (match.index ?? 0) + match[0].length,
      tokenClass,
    );
    if (continuation !== "NONE") {
      candidates.push({ source: "EXPLICIT_DATE", localDate: null });
      continue;
    }

    if (match[3] !== undefined) {
      const relative = match[3].toLocaleLowerCase("vi-VN");
      const tomorrow = relative === "mai" || relative === "ngày mai";
      candidates.push({
        source: tomorrow ? "TOMORROW" : "TODAY",
        localDate: formatDate(addLocalDays(reference, tomorrow ? 1 : 0)),
      });
      continue;
    }

    if (match[4] !== undefined) {
      candidates.push({
        source: "EXPLICIT_DATE",
        localDate: resolveExplicitDate(
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
          reference,
        ).localDate,
      });
      continue;
    }

    const day = Number(match[7] ?? match[10]);
    const month = Number(match[8] ?? match[11]);
    const yearText = match[9] ?? match[12];
    candidates.push(resolveExplicitDate(
      yearText === undefined ? undefined : Number(yearText),
      month,
      day,
      reference,
    ));
  }
  return candidates;
}

function resolveDateEvidence(candidates: DateCandidate[]): TemporalDateEvidence {
  if (candidates.length === 0) return { state: "MISSING" };
  if (candidates.some((candidate) => candidate.localDate === null)) {
    return { state: "AMBIGUOUS", reason: "INVALID_DATE" };
  }
  if (candidates.length > 1) {
    const values = new Set(candidates.map((candidate) => candidate.localDate));
    return {
      state: "AMBIGUOUS",
      reason: values.size === 1 ? "MULTIPLE_DATE_EXPRESSIONS" : "CONFLICTING_DATE_EXPRESSIONS",
    };
  }
  const candidate = candidates[0];
  return {
    state: "RESOLVED",
    source: candidate.source,
    localDate: candidate.localDate as LocalDate,
  };
}

function resolveTimeEvidence(text: string): TemporalTimeEvidence {
  const candidates: Array<{
    hour: number;
    minute: number;
    continuation: TemporalContinuation;
  }> = [];
  const pattern = /(^|[^\p{L}\p{N}])(?:(?:lúc\s+)?(\d{1,2}):(\d{2})|(?:lúc\s+)?(\d{1,2})h|(?:lúc\s+)?(\d{1,2})\s+giờ)(?=$|[^\p{L}\p{N}])/giu;
  for (const match of text.matchAll(pattern)) {
    candidates.push({
      hour: Number(match[2] ?? match[4] ?? match[5]),
      minute: match[3] === undefined ? 0 : Number(match[3]),
      continuation: classifyTemporalContinuation(
        text,
        (match.index ?? 0) + match[0].length,
        "TIME",
      ),
    });
  }

  if (candidates.some(({ hour, minute }) => hour > 23 || minute > 59)) {
    return { state: "AMBIGUOUS", reason: "INVALID_TIME" };
  }
  if (candidates.length > 1) {
    return { state: "AMBIGUOUS", reason: "MULTIPLE_TIME_EXPRESSIONS" };
  }
  if (candidates[0]?.continuation === "INVALID") {
    return { state: "AMBIGUOUS", reason: "INVALID_TIME" };
  }
  if (candidates[0]?.continuation === "MODIFIER") {
    return { state: "AMBIGUOUS", reason: "MULTIPLE_TIME_EXPRESSIONS" };
  }
  if (candidates.length === 1) {
    return {
      state: "RESOLVED",
      source: "EXACT_TIME",
      localTime: `${padTwo(candidates[0].hour)}:${padTwo(candidates[0].minute)}` as LocalTime,
    };
  }
  if (/(^|[^\p{L}\p{N}])(sáng|chiều|tối)(?=$|[^\p{L}\p{N}])/iu.test(text)) {
    return { state: "AMBIGUOUS", reason: "DAYPART_WITHOUT_EXACT_TIME" };
  }
  return { state: "MISSING" };
}

function rangeFromDate(candidate: DateCandidate): RangeCandidate | null {
  if (candidate.localDate === null) return null;
  if (candidate.source === "TODAY" || candidate.source === "TOMORROW") {
    return { state: "RESOLVED", kind: candidate.source, localDate: null };
  }
  return { state: "RESOLVED", kind: "DATE", localDate: candidate.localDate };
}

function resolveRangeEvidence(text: string, dates: DateCandidate[]): TemporalRangeEvidence {
  const candidates: RangeCandidate[] = [];
  for (const date of dates) {
    const range = rangeFromDate(date);
    if (range !== null) candidates.push(range);
  }

  const reviewedRanges = [
    { pattern: /(^|[^\p{L}\p{N}])tuần\s+này(?=$|[^\p{L}\p{N}])/iu, kind: "THIS_WEEK" },
    { pattern: /(^|[^\p{L}\p{N}])7\s+ngày\s+tới(?=$|[^\p{L}\p{N}])/iu, kind: "NEXT_7_DAYS" },
    { pattern: /(^|[^\p{L}\p{N}])sắp\s+tới(?=$|[^\p{L}\p{N}])/iu, kind: "UPCOMING" },
  ] as const;
  for (const reviewed of reviewedRanges) {
    const match = reviewed.pattern.exec(text);
    if (match !== null && classifyTemporalContinuation(
      text,
      (match.index ?? 0) + match[0].length,
      "RANGE",
    ) !== "NONE") {
      return { state: "AMBIGUOUS" };
    }
    if (match !== null) {
      candidates.push({ state: "RESOLVED", kind: reviewed.kind, localDate: null });
    }
  }

  if (dates.some((date) => date.localDate === null) || candidates.length > 1) {
    return { state: "AMBIGUOUS" };
  }
  return candidates[0] ?? { state: "MISSING" };
}

export function extractTemporalEvidence(input: {
  text: string;
  referenceNow: number;
}): TemporalEvidence {
  const normalized = input.text.normalize("NFC").replace(/\s+/gu, " ").trim();
  const reference = localReferenceParts(input.referenceNow);
  const referenceLocalDate = formatDate(reference);
  const referenceLocalTime = `${padTwo(reference.hour)}:${padTwo(reference.minute)}` as LocalTime;
  const dates = findDateCandidates(normalized, reference);

  return {
    timezone: TEMPORAL_EVIDENCE_TIMEZONE,
    referenceLocalDate,
    referenceLocalTime,
    date: resolveDateEvidence(dates),
    time: resolveTimeEvidence(normalized),
    range: resolveRangeEvidence(normalized, dates),
  };
}

function resolvedValuesMatch(
  field: TemporalEvidenceField,
  previous: TemporalDateEvidence | TemporalTimeEvidence | TemporalRangeEvidence,
  next: TemporalDateEvidence | TemporalTimeEvidence | TemporalRangeEvidence,
): boolean {
  if (previous.state !== "RESOLVED" || next.state !== "RESOLVED") return false;
  if (field === "date") {
    return (previous as Extract<TemporalDateEvidence, { state: "RESOLVED" }>).localDate
      === (next as Extract<TemporalDateEvidence, { state: "RESOLVED" }>).localDate;
  }
  if (field === "time") {
    return (previous as Extract<TemporalTimeEvidence, { state: "RESOLVED" }>).localTime
      === (next as Extract<TemporalTimeEvidence, { state: "RESOLVED" }>).localTime;
  }
  const previousRange = previous as Extract<TemporalRangeEvidence, { state: "RESOLVED" }>;
  const nextRange = next as Extract<TemporalRangeEvidence, { state: "RESOLVED" }>;
  return previousRange.kind === nextRange.kind && previousRange.localDate === nextRange.localDate;
}

function mergeField<T extends TemporalDateEvidence | TemporalTimeEvidence | TemporalRangeEvidence>(
  field: TemporalEvidenceField,
  previous: T,
  next: T,
): { value: T; conflict: boolean } {
  if (previous.state === "RESOLVED") {
    if (next.state === "MISSING" || resolvedValuesMatch(field, previous, next)) {
      return { value: previous, conflict: false };
    }
    return { value: previous, conflict: true };
  }
  if (next.state === "MISSING") return { value: previous, conflict: false };
  return { value: next, conflict: false };
}

export function mergeTemporalEvidence(
  previous: TemporalEvidence,
  next: TemporalEvidence,
): TemporalEvidenceMergeResult {
  const date = mergeField("date", previous.date, next.date);
  const time = mergeField("time", previous.time, next.time);
  const range = mergeField("range", previous.range, next.range);
  const evidence: TemporalEvidence = {
    ...next,
    date: date.value,
    time: time.value,
    range: range.value,
  };
  const conflicts = ([
    ["date", date.conflict],
    ["time", time.conflict],
    ["range", range.conflict],
  ] as const)
    .filter((entry) => entry[1])
    .map((entry) => entry[0]);

  return conflicts.length === 0
    ? { kind: "MERGED", evidence }
    : { kind: "CONFLICT", conflicts, evidence };
}
