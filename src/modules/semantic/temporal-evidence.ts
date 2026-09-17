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

type TimeCandidate =
  | { kind: "VALID"; localTime: LocalTime }
  | { kind: "INVALID" }
  | { kind: "MODIFIER" }
  | { kind: "DAYPART" };

type ResolvedRangeCandidate = Extract<TemporalRangeEvidence, { state: "RESOLVED" }>;
type RangeCandidate = ResolvedRangeCandidate | { state: "AMBIGUOUS" };

type TokenKind =
  | "NUMBER"
  | "WHITESPACE"
  | "SLASH"
  | "COLON"
  | "HYPHEN"
  | "COMMA"
  | "DOT"
  | "H"
  | "HOM"
  | "NAY"
  | "MAI"
  | "MOT"
  | "NGAY"
  | "THANG"
  | "NAM"
  | "LUC"
  | "GIO"
  | "TUAN"
  | "TOI"
  | "SAP"
  | "DAYPART"
  | "RUOI"
  | "MERIDIEM"
  | "UNKNOWN_WORD"
  | "PUNCTUATION";

type TemporalToken = {
  kind: TokenKind;
  start: number;
  end: number;
  raw: string;
};

type ScannerCounters = {
  lexicalSteps: number;
  grammarSteps: number;
  candidateCount: number;
};

export type TemporalScannerDiagnostics = {
  strategy: "SINGLE_LINEAR_LEXICAL_SCAN_BOUNDED_GRAMMAR";
  inputCodeUnits: number;
  lexicalSteps: number;
  tokenCount: number;
  grammarSteps: number;
  candidateCount: number;
  llmCalls: 0;
  networkCalls: 0;
  dbCalls: 0;
};

type ScanCandidates = {
  dates: DateCandidate[];
  times: TimeCandidate[];
  ranges: RangeCandidate[];
};

type Parsed<T> = { candidate: T; nextIndex: number };

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
  if (Number.isNaN(local.getTime())) {
    throw new RangeError("referenceNow must be a valid epoch millisecond value");
  }
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
): DateCandidate {
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

function isDigit(character: string): boolean {
  const code = character.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

function isWordCharacter(character: string): boolean {
  return /[\p{L}\p{M}]/u.test(character);
}

function wordKind(raw: string): TokenKind {
  switch (raw.normalize("NFC").toLocaleLowerCase("vi-VN")) {
    case "h": return "H";
    case "hôm": return "HOM";
    case "nay":
    case "này": return "NAY";
    case "mai": return "MAI";
    case "mốt": return "MOT";
    case "ngày": return "NGAY";
    case "tháng": return "THANG";
    case "năm": return "NAM";
    case "lúc": return "LUC";
    case "giờ": return "GIO";
    case "tuần": return "TUAN";
    case "tới": return "TOI";
    case "sắp": return "SAP";
    case "sáng":
    case "chiều":
    case "tối": return "DAYPART";
    case "rưỡi": return "RUOI";
    case "am":
    case "pm": return "MERIDIEM";
    default: return "UNKNOWN_WORD";
  }
}

function tokenizeTemporalText(text: string, counters: ScannerCounters): TemporalToken[] {
  const tokens: TemporalToken[] = [];
  let index = 0;
  while (index < text.length) {
    const start = index;
    const character = text[index];
    let kind: TokenKind;

    if (isWhitespace(character)) {
      index += 1;
      while (index < text.length && isWhitespace(text[index])) index += 1;
      kind = "WHITESPACE";
    } else if (isDigit(character)) {
      index += 1;
      while (index < text.length && isDigit(text[index])) index += 1;
      kind = "NUMBER";
    } else if (isWordCharacter(character)) {
      index += 1;
      while (index < text.length && isWordCharacter(text[index])) index += 1;
      kind = wordKind(text.slice(start, index));
    } else {
      index += 1;
      switch (character) {
        case "/": kind = "SLASH"; break;
        case ":": kind = "COLON"; break;
        case "-": kind = "HYPHEN"; break;
        case ",": kind = "COMMA"; break;
        case ".": kind = "DOT"; break;
        default: kind = "PUNCTUATION";
      }
    }

    counters.lexicalSteps += index - start;
    tokens.push({ kind, start, end: index, raw: text.slice(start, index) });
  }
  return tokens;
}

function nextNonWhitespace(tokens: TemporalToken[], index: number): number {
  return tokens[index]?.kind === "WHITESPACE" ? index + 1 : index;
}

function afterRequiredWhitespace(
  tokens: TemporalToken[],
  index: number,
  kind: TokenKind,
): number | null {
  if (tokens[index]?.kind !== "WHITESPACE" || tokens[index + 1]?.kind !== kind) return null;
  return index + 1;
}

function adjacent(tokens: TemporalToken[], leftIndex: number, rightIndex: number): boolean {
  return tokens[leftIndex] !== undefined
    && tokens[rightIndex] !== undefined
    && tokens[leftIndex].end === tokens[rightIndex].start;
}

function numberValue(token: TemporalToken | undefined): number {
  return token?.kind === "NUMBER" ? Number(token.raw) : Number.NaN;
}

function invalidDate(nextIndex: number): Parsed<DateCandidate> {
  return {
    candidate: { source: "EXPLICIT_DATE", localDate: null },
    nextIndex,
  };
}

function temporalTailEnd(tokens: TemporalToken[], index: number): number {
  let cursor = index;
  let remaining = 4;
  while (cursor < tokens.length && remaining > 0) {
    if (tokens[cursor].kind === "WHITESPACE" && remaining < 4) break;
    cursor += 1;
    remaining -= 1;
  }
  return Math.max(index + 1, cursor);
}

function dateHasUnsupportedTail(tokens: TemporalToken[], endIndex: number): boolean {
  const nextIndex = nextNonWhitespace(tokens, endIndex);
  const next = tokens[nextIndex];
  if (next === undefined) return false;
  if (next.kind === "SLASH" || next.kind === "HYPHEN") return true;
  if (next.kind === "COMMA" || next.kind === "DOT" || next.kind === "COLON") {
    return tokens[nextNonWhitespace(tokens, nextIndex + 1)]?.kind === "NUMBER";
  }
  return nextIndex === endIndex
    && (next.kind === "NUMBER" || next.kind === "UNKNOWN_WORD")
    && adjacent(tokens, endIndex - 1, nextIndex);
}

function parseRelativeDateAt(
  tokens: TemporalToken[],
  index: number,
  reference: ReferenceDate,
): Parsed<DateCandidate> | null {
  let source: "TODAY" | "TOMORROW";
  let endIndex: number;
  if (tokens[index]?.kind === "HOM") {
    const nayIndex = afterRequiredWhitespace(tokens, index + 1, "NAY");
    if (nayIndex === null) return null;
    source = "TODAY";
    endIndex = nayIndex + 1;
  } else if (tokens[index]?.kind === "NGAY") {
    const maiIndex = afterRequiredWhitespace(tokens, index + 1, "MAI");
    if (maiIndex === null) return null;
    source = "TOMORROW";
    endIndex = maiIndex + 1;
  } else if (tokens[index]?.kind === "MAI") {
    source = "TOMORROW";
    endIndex = index + 1;
  } else {
    return null;
  }

  const continuationIndex = nextNonWhitespace(tokens, endIndex);
  const continuationKind = tokens[continuationIndex]?.kind;
  if (continuationKind === "MOT"
    || ((continuationKind === "HYPHEN"
      || continuationKind === "SLASH"
      || continuationKind === "DOT"
      || continuationKind === "COMMA")
      && tokens[nextNonWhitespace(tokens, continuationIndex + 1)]?.kind === "MOT")) {
    return invalidDate(temporalTailEnd(tokens, continuationIndex));
  }
  const days = source === "TOMORROW" ? 1 : 0;
  return {
    candidate: { source, localDate: formatDate(addLocalDays(reference, days)) },
    nextIndex: endIndex,
  };
}

function parseVietnameseDateAt(
  tokens: TemporalToken[],
  index: number,
  reference: ReferenceDate,
): Parsed<DateCandidate> | null {
  let dayIndex = index;
  if (tokens[index]?.kind === "NGAY") {
    const following = afterRequiredWhitespace(tokens, index + 1, "NUMBER");
    if (following === null) return null;
    dayIndex = following;
  }
  if (tokens[dayIndex]?.kind !== "NUMBER") return null;
  const monthWordIndex = afterRequiredWhitespace(tokens, dayIndex + 1, "THANG");
  if (monthWordIndex === null) return null;
  const monthIndex = afterRequiredWhitespace(tokens, monthWordIndex + 1, "NUMBER");
  if (monthIndex === null) return invalidDate(temporalTailEnd(tokens, monthWordIndex + 1));

  let year: number | undefined;
  let endIndex = monthIndex + 1;
  const maybeYearWord = afterRequiredWhitespace(tokens, endIndex, "NAM");
  if (maybeYearWord !== null) {
    const yearIndex = afterRequiredWhitespace(tokens, maybeYearWord + 1, "NUMBER");
    if (yearIndex === null || tokens[yearIndex].raw.length !== 4) {
      return invalidDate(temporalTailEnd(tokens, maybeYearWord));
    }
    year = numberValue(tokens[yearIndex]);
    endIndex = yearIndex + 1;
  }
  if (dateHasUnsupportedTail(tokens, endIndex)) {
    return invalidDate(temporalTailEnd(tokens, nextNonWhitespace(tokens, endIndex)));
  }
  return {
    candidate: resolveExplicitDate(
      year,
      numberValue(tokens[monthIndex]),
      numberValue(tokens[dayIndex]),
      reference,
    ),
    nextIndex: endIndex,
  };
}

function parseNumericDateAt(
  tokens: TemporalToken[],
  index: number,
  reference: ReferenceDate,
): Parsed<DateCandidate> | null {
  const first = tokens[index];
  if (first?.kind !== "NUMBER") return null;
  const separatorIndex = nextNonWhitespace(tokens, index + 1);
  const separator = tokens[separatorIndex];
  if (separator?.kind !== "SLASH" && separator?.kind !== "HYPHEN") return null;
  const isIso = first.raw.length === 4 && separator.kind === "HYPHEN";
  const hadWhitespaceBeforeSeparator = separatorIndex !== index + 1;
  const secondIndex = nextNonWhitespace(tokens, separatorIndex + 1);
  if (hadWhitespaceBeforeSeparator
    || secondIndex !== separatorIndex + 1
    || tokens[secondIndex]?.kind !== "NUMBER") {
    return invalidDate(temporalTailEnd(tokens, separatorIndex));
  }

  if (isIso) {
    const secondSeparatorIndex = nextNonWhitespace(tokens, secondIndex + 1);
    const dayIndex = nextNonWhitespace(tokens, secondSeparatorIndex + 1);
    if (secondSeparatorIndex !== secondIndex + 1
      || tokens[secondSeparatorIndex]?.kind !== "HYPHEN"
      || dayIndex !== secondSeparatorIndex + 1
      || tokens[dayIndex]?.kind !== "NUMBER") {
      return invalidDate(temporalTailEnd(tokens, secondSeparatorIndex));
    }
    const endIndex = dayIndex + 1;
    if (dateHasUnsupportedTail(tokens, endIndex)) {
      return invalidDate(temporalTailEnd(tokens, nextNonWhitespace(tokens, endIndex)));
    }
    return {
      candidate: resolveExplicitDate(
        numberValue(first),
        numberValue(tokens[secondIndex]),
        numberValue(tokens[dayIndex]),
        reference,
      ),
      nextIndex: endIndex,
    };
  }

  let year: number | undefined;
  let endIndex = secondIndex + 1;
  const yearSeparatorIndex = nextNonWhitespace(tokens, endIndex);
  if (tokens[yearSeparatorIndex]?.kind === "SLASH") {
    const yearIndex = nextNonWhitespace(tokens, yearSeparatorIndex + 1);
    if (yearSeparatorIndex !== endIndex
      || yearIndex !== yearSeparatorIndex + 1
      || tokens[yearIndex]?.kind !== "NUMBER"
      || tokens[yearIndex].raw.length !== 4) {
      return invalidDate(temporalTailEnd(tokens, yearSeparatorIndex));
    }
    year = numberValue(tokens[yearIndex]);
    endIndex = yearIndex + 1;
  }
  if (dateHasUnsupportedTail(tokens, endIndex)) {
    return invalidDate(temporalTailEnd(tokens, nextNonWhitespace(tokens, endIndex)));
  }
  return {
    candidate: resolveExplicitDate(
      year,
      numberValue(tokens[secondIndex]),
      numberValue(first),
      reference,
    ),
    nextIndex: endIndex,
  };
}

function looksLikeDateStart(tokens: TemporalToken[], index: number): boolean {
  if (tokens[index]?.kind !== "NUMBER") return false;
  const nextIndex = nextNonWhitespace(tokens, index + 1);
  return tokens[nextIndex]?.kind === "SLASH"
    || tokens[nextIndex]?.kind === "HYPHEN"
    || tokens[nextIndex]?.kind === "THANG";
}

function looksLikeTimeStart(tokens: TemporalToken[], index: number): boolean {
  if (tokens[index]?.kind === "LUC") return true;
  if (tokens[index]?.kind !== "NUMBER") return false;
  const nextIndex = nextNonWhitespace(tokens, index + 1);
  return tokens[nextIndex]?.kind === "COLON"
    || tokens[nextIndex]?.kind === "H"
    || tokens[nextIndex]?.kind === "GIO";
}

function isDottedMeridiem(tokens: TemporalToken[], index: number): boolean {
  if (tokens[index]?.kind !== "UNKNOWN_WORD"
    || tokens[index].raw.toLocaleLowerCase("vi-VN") !== "p") return false;
  const firstDot = nextNonWhitespace(tokens, index + 1);
  const mIndex = nextNonWhitespace(tokens, firstDot + 1);
  const secondDot = nextNonWhitespace(tokens, mIndex + 1);
  return tokens[firstDot]?.kind === "DOT"
    && tokens[mIndex]?.kind === "UNKNOWN_WORD"
    && tokens[mIndex].raw.toLocaleLowerCase("vi-VN") === "m"
    && tokens[secondDot]?.kind === "DOT";
}

function timeContinuation(
  tokens: TemporalToken[],
  endIndex: number,
): { kind: "NONE" | "INVALID" | "MODIFIER"; nextIndex: number } {
  const continuationIndex = nextNonWhitespace(tokens, endIndex);
  const continuation = tokens[continuationIndex];
  if (continuation === undefined) return { kind: "NONE", nextIndex: endIndex };
  const separated = continuationIndex !== endIndex;

  if (separated && (
    looksLikeDateStart(tokens, continuationIndex)
    || looksLikeTimeStart(tokens, continuationIndex)
  )) {
    return { kind: "NONE", nextIndex: endIndex };
  }
  if (continuation.kind === "DAYPART" || continuation.kind === "MERIDIEM") {
    return { kind: "MODIFIER", nextIndex: temporalTailEnd(tokens, continuationIndex) };
  }
  if (continuation.kind === "RUOI" || isDottedMeridiem(tokens, continuationIndex)) {
    return { kind: "INVALID", nextIndex: temporalTailEnd(tokens, continuationIndex) };
  }
  if (continuation.kind === "COLON"
    || continuation.kind === "HYPHEN"
    || continuation.kind === "COMMA"
    || continuation.kind === "SLASH"
    || continuation.kind === "NUMBER") {
    return { kind: "INVALID", nextIndex: temporalTailEnd(tokens, continuationIndex) };
  }
  if (!separated && continuation.kind === "UNKNOWN_WORD") {
    return { kind: "INVALID", nextIndex: temporalTailEnd(tokens, continuationIndex) };
  }
  return { kind: "NONE", nextIndex: endIndex };
}

function parseTimeFromNumberAt(
  tokens: TemporalToken[],
  index: number,
): Parsed<TimeCandidate> | null {
  const hourToken = tokens[index];
  if (hourToken?.kind !== "NUMBER") return null;
  const nextIndex = nextNonWhitespace(tokens, index + 1);
  const next = tokens[nextIndex];
  let minute = 0;
  let endIndex: number;

  if (next?.kind === "COLON") {
    const minuteIndex = nextNonWhitespace(tokens, nextIndex + 1);
    if (nextIndex !== index + 1
      || minuteIndex !== nextIndex + 1
      || tokens[minuteIndex]?.kind !== "NUMBER"
      || tokens[minuteIndex].raw.length !== 2) {
      return { candidate: { kind: "INVALID" }, nextIndex: temporalTailEnd(tokens, nextIndex) };
    }
    minute = numberValue(tokens[minuteIndex]);
    endIndex = minuteIndex + 1;
  } else if (next?.kind === "H" && nextIndex === index + 1) {
    endIndex = nextIndex + 1;
  } else if (next?.kind === "GIO" && tokens[index + 1]?.kind === "WHITESPACE") {
    endIndex = nextIndex + 1;
  } else if (next?.kind === "H" || next?.kind === "GIO") {
    return { candidate: { kind: "INVALID" }, nextIndex: nextIndex + 1 };
  } else if (nextIndex === index + 1
    && next?.kind === "UNKNOWN_WORD"
    && next.raw.toLocaleLowerCase("vi-VN").startsWith("h")) {
    return { candidate: { kind: "INVALID" }, nextIndex: temporalTailEnd(tokens, nextIndex) };
  } else {
    return null;
  }

  const continuation = timeContinuation(tokens, endIndex);
  if (continuation.kind === "INVALID") {
    return { candidate: { kind: "INVALID" }, nextIndex: continuation.nextIndex };
  }
  if (continuation.kind === "MODIFIER") {
    return { candidate: { kind: "MODIFIER" }, nextIndex: continuation.nextIndex };
  }
  const hour = numberValue(hourToken);
  if (hour > 23 || minute > 59) {
    return { candidate: { kind: "INVALID" }, nextIndex: endIndex };
  }
  return {
    candidate: {
      kind: "VALID",
      localTime: `${padTwo(hour)}:${padTwo(minute)}` as LocalTime,
    },
    nextIndex: endIndex,
  };
}

function parseTimeAt(tokens: TemporalToken[], index: number): Parsed<TimeCandidate> | null {
  if (tokens[index]?.kind === "LUC") {
    const hourIndex = afterRequiredWhitespace(tokens, index + 1, "NUMBER");
    if (hourIndex === null) {
      return { candidate: { kind: "INVALID" }, nextIndex: index + 1 };
    }
    return parseTimeFromNumberAt(tokens, hourIndex)
      ?? { candidate: { kind: "INVALID" }, nextIndex: hourIndex + 1 };
  }
  return parseTimeFromNumberAt(tokens, index);
}

function rangeHasUnsupportedTail(tokens: TemporalToken[], endIndex: number): boolean {
  const nextIndex = nextNonWhitespace(tokens, endIndex);
  const kind = tokens[nextIndex]?.kind;
  return kind === "SLASH" || kind === "COLON" || kind === "HYPHEN";
}

function parseRangeAt(tokens: TemporalToken[], index: number): Parsed<RangeCandidate> | null {
  let kind: ResolvedRangeCandidate["kind"] | null = null;
  let endIndex = index;
  if (tokens[index]?.kind === "TUAN") {
    const nayIndex = afterRequiredWhitespace(tokens, index + 1, "NAY");
    if (nayIndex === null) return null;
    kind = "THIS_WEEK";
    endIndex = nayIndex + 1;
  } else if (tokens[index]?.kind === "SAP") {
    const toiIndex = afterRequiredWhitespace(tokens, index + 1, "TOI");
    if (toiIndex === null) return null;
    kind = "UPCOMING";
    endIndex = toiIndex + 1;
  } else if (tokens[index]?.kind === "NUMBER" && tokens[index].raw === "7") {
    const ngayIndex = afterRequiredWhitespace(tokens, index + 1, "NGAY");
    if (ngayIndex === null) return null;
    const toiIndex = afterRequiredWhitespace(tokens, ngayIndex + 1, "TOI");
    if (toiIndex === null) return { candidate: { state: "AMBIGUOUS" }, nextIndex: ngayIndex + 1 };
    kind = "NEXT_7_DAYS";
    endIndex = toiIndex + 1;
  } else {
    return null;
  }

  if (rangeHasUnsupportedTail(tokens, endIndex)) {
    return {
      candidate: { state: "AMBIGUOUS" },
      nextIndex: temporalTailEnd(tokens, nextNonWhitespace(tokens, endIndex)),
    };
  }
  return {
    candidate: { state: "RESOLVED", kind, localDate: null },
    nextIndex: endIndex,
  };
}

function rangeFromDate(candidate: DateCandidate): RangeCandidate {
  if (candidate.localDate === null) return { state: "AMBIGUOUS" };
  if (candidate.source === "TODAY" || candidate.source === "TOMORROW") {
    return { state: "RESOLVED", kind: candidate.source, localDate: null };
  }
  return { state: "RESOLVED", kind: "DATE", localDate: candidate.localDate };
}

function scanTemporalGrammar(
  tokens: TemporalToken[],
  reference: ReferenceDate,
  counters: ScannerCounters,
): ScanCandidates {
  const candidates: ScanCandidates = { dates: [], times: [], ranges: [] };
  let index = 0;
  while (index < tokens.length) {
    counters.grammarSteps += 1;
    const token = tokens[index];
    if (token.kind === "WHITESPACE" || token.kind === "UNKNOWN_WORD" || token.kind === "PUNCTUATION") {
      index += 1;
      continue;
    }

    const range = parseRangeAt(tokens, index);
    if (range !== null) {
      candidates.ranges.push(range.candidate);
      counters.candidateCount += 1;
      index = Math.max(index + 1, range.nextIndex);
      continue;
    }

    const relativeDate = parseRelativeDateAt(tokens, index, reference);
    if (relativeDate !== null) {
      candidates.dates.push(relativeDate.candidate);
      candidates.ranges.push(rangeFromDate(relativeDate.candidate));
      counters.candidateCount += 2;
      index = Math.max(index + 1, relativeDate.nextIndex);
      continue;
    }

    const vietnameseDate = parseVietnameseDateAt(tokens, index, reference);
    if (vietnameseDate !== null) {
      candidates.dates.push(vietnameseDate.candidate);
      candidates.ranges.push(rangeFromDate(vietnameseDate.candidate));
      counters.candidateCount += 2;
      index = Math.max(index + 1, vietnameseDate.nextIndex);
      continue;
    }

    const numericDate = parseNumericDateAt(tokens, index, reference);
    if (numericDate !== null) {
      candidates.dates.push(numericDate.candidate);
      candidates.ranges.push(rangeFromDate(numericDate.candidate));
      counters.candidateCount += 2;
      index = Math.max(index + 1, numericDate.nextIndex);
      continue;
    }

    const time = parseTimeAt(tokens, index);
    if (time !== null) {
      candidates.times.push(time.candidate);
      counters.candidateCount += 1;
      index = Math.max(index + 1, time.nextIndex);
      continue;
    }

    if (token.kind === "DAYPART") {
      candidates.times.push({ kind: "DAYPART" });
      counters.candidateCount += 1;
    } else if (token.kind === "MERIDIEM" || token.kind === "RUOI") {
      candidates.times.push({ kind: "INVALID" });
      counters.candidateCount += 1;
    }
    index += 1;
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

function resolveTimeEvidence(candidates: TimeCandidate[]): TemporalTimeEvidence {
  if (candidates.some((candidate) => candidate.kind === "INVALID")) {
    return { state: "AMBIGUOUS", reason: "INVALID_TIME" };
  }
  if (candidates.some((candidate) => candidate.kind === "MODIFIER")) {
    return { state: "AMBIGUOUS", reason: "MULTIPLE_TIME_EXPRESSIONS" };
  }
  const valid = candidates.filter((candidate): candidate is Extract<TimeCandidate, { kind: "VALID" }> => (
    candidate.kind === "VALID"
  ));
  if (valid.length > 1) {
    return { state: "AMBIGUOUS", reason: "MULTIPLE_TIME_EXPRESSIONS" };
  }
  if (valid.length === 1 && candidates.length === 1) {
    return { state: "RESOLVED", source: "EXACT_TIME", localTime: valid[0].localTime };
  }
  if (candidates.some((candidate) => candidate.kind === "DAYPART")) {
    return { state: "AMBIGUOUS", reason: "DAYPART_WITHOUT_EXACT_TIME" };
  }
  return { state: "MISSING" };
}

function resolveRangeEvidence(candidates: RangeCandidate[]): TemporalRangeEvidence {
  if (candidates.length === 0) return { state: "MISSING" };
  if (candidates.some((candidate) => candidate.state === "AMBIGUOUS") || candidates.length > 1) {
    return { state: "AMBIGUOUS" };
  }
  return candidates[0];
}

function runTemporalScanner(input: {
  text: string;
  referenceNow: number;
}): { evidence: TemporalEvidence; diagnostics: TemporalScannerDiagnostics } {
  const reference = localReferenceParts(input.referenceNow);
  const counters: ScannerCounters = { lexicalSteps: 0, grammarSteps: 0, candidateCount: 0 };
  const tokens = tokenizeTemporalText(input.text, counters);
  const candidates = scanTemporalGrammar(tokens, reference, counters);
  const evidence: TemporalEvidence = {
    timezone: TEMPORAL_EVIDENCE_TIMEZONE,
    referenceLocalDate: formatDate(reference),
    referenceLocalTime: `${padTwo(reference.hour)}:${padTwo(reference.minute)}` as LocalTime,
    date: resolveDateEvidence(candidates.dates),
    time: resolveTimeEvidence(candidates.times),
    range: resolveRangeEvidence(candidates.ranges),
  };
  return {
    evidence,
    diagnostics: {
      strategy: "SINGLE_LINEAR_LEXICAL_SCAN_BOUNDED_GRAMMAR",
      inputCodeUnits: input.text.length,
      lexicalSteps: counters.lexicalSteps,
      tokenCount: tokens.length,
      grammarSteps: counters.grammarSteps,
      candidateCount: counters.candidateCount,
      llmCalls: 0,
      networkCalls: 0,
      dbCalls: 0,
    },
  };
}

export function extractTemporalEvidence(input: {
  text: string;
  referenceNow: number;
}): TemporalEvidence {
  return runTemporalScanner(input).evidence;
}

export function inspectTemporalScanner(input: {
  text: string;
  referenceNow: number;
}): { evidence: TemporalEvidence; diagnostics: TemporalScannerDiagnostics } {
  return runTemporalScanner(input);
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
