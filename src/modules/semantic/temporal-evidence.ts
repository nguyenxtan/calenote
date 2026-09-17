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
  // Unicode White_Space plus BOM, which ECMAScript also treats as whitespace.
  // Classification does not rewrite the input: token offsets/raw remain exact.
  return /[\p{White_Space}\uFEFF]/u.test(character);
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

function numberValue(token: TemporalToken | undefined): number {
  return token?.kind === "NUMBER" ? Number(token.raw) : Number.NaN;
}

function invalidDate(nextIndex: number): Parsed<DateCandidate> {
  return {
    candidate: { source: "EXPLICIT_DATE", localDate: null },
    nextIndex,
  };
}

type GrammarInput = {
  tokens: TemporalToken[];
  nextAtom: number[];
  firstDateSeparator: number[];
  firstClockSeparator: number[];
};

type Expression =
  | { dimension: "date"; parsed: Parsed<DateCandidate> }
  | { dimension: "time"; parsed: Parsed<TimeCandidate> }
  | { dimension: "range"; parsed: Parsed<RangeCandidate> };

type SeparatorClass = "SPACE" | "DATE_INTERNAL" | "CLOCK_INTERNAL" | "DOT_INTERNAL" | "SENTENCE";

// The sole lexical separator registry. DOT remains internal until the span
// machine proves a sentence boundary; no production can silently skip it.
const SEPARATOR_CLASSES: Partial<Record<TokenKind, SeparatorClass>> = {
  WHITESPACE: "SPACE", SLASH: "DATE_INTERNAL", HYPHEN: "DATE_INTERNAL",
  COLON: "CLOCK_INTERNAL", DOT: "DOT_INTERNAL", COMMA: "SENTENCE", PUNCTUATION: "SENTENCE",
};

function isSeparator(kind: TokenKind): boolean {
  return SEPARATOR_CLASSES[kind] !== undefined;
}

function grammarInput(tokens: TemporalToken[], counters: ScannerCounters): GrammarInput {
  const nextAtom = new Array<number>(tokens.length + 1);
  const firstDateSeparator = new Array<number>(tokens.length + 1);
  const firstClockSeparator = new Array<number>(tokens.length + 1);
  nextAtom[tokens.length] = tokens.length;
  firstDateSeparator[tokens.length] = tokens.length;
  firstClockSeparator[tokens.length] = tokens.length;
  // Index separator runs once. Every subsequent grammar probe is O(1), even
  // for arbitrarily long punctuation runs. Positions preserve which side of
  // a message delimiter owns structural date/clock syntax.
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    counters.grammarSteps += 1;
    const kind = tokens[index].kind;
    const separator = isSeparator(kind);
    nextAtom[index] = separator ? nextAtom[index + 1] : index;
    firstDateSeparator[index] = kind === "SLASH" || kind === "HYPHEN"
      ? index : separator ? firstDateSeparator[index + 1] : tokens.length;
    firstClockSeparator[index] = kind === "COLON"
      ? index : separator ? firstClockSeparator[index + 1] : tokens.length;
  }
  return { tokens, nextAtom, firstDateSeparator, firstClockSeparator };
}

function followingAtom(input: GrammarInput, index: number): number {
  return input.nextAtom[index + 1] ?? input.tokens.length;
}

function hasRequiredSpace(tokens: TemporalToken[], left: number, right: number): boolean {
  return right === left + 2 && tokens[left + 1]?.kind === "WHITESPACE";
}

function parseRelativeDateAt(
  input: GrammarInput,
  index: number,
  reference: ReferenceDate,
): Parsed<DateCandidate> | null {
  const { tokens } = input;
  let source: "TODAY" | "TOMORROW";
  let endIndex: number;
  if (tokens[index]?.kind === "HOM") {
    const nayIndex = followingAtom(input, index);
    if (tokens[nayIndex]?.kind !== "NAY") return invalidDate(index + 1);
    if (!hasRequiredSpace(tokens, index, nayIndex)) return invalidDate(nayIndex + 1);
    source = "TODAY";
    endIndex = nayIndex + 1;
  } else if (tokens[index]?.kind === "NGAY") {
    const maiIndex = followingAtom(input, index);
    if (tokens[maiIndex]?.kind !== "MAI") return null;
    if (!hasRequiredSpace(tokens, index, maiIndex)) return invalidDate(maiIndex + 1);
    source = "TOMORROW";
    endIndex = maiIndex + 1;
  } else if (tokens[index]?.kind === "MAI") {
    source = "TOMORROW";
    endIndex = index + 1;
  } else {
    return null;
  }

  const days = source === "TOMORROW" ? 1 : 0;
  return {
    candidate: { source, localDate: formatDate(addLocalDays(reference, days)) },
    nextIndex: endIndex,
  };
}

function parseVietnameseDateAt(
  input: GrammarInput,
  index: number,
  reference: ReferenceDate,
): Parsed<DateCandidate> | null {
  const { tokens } = input;
  let dayIndex = index;
  let valid = true;
  if (tokens[index]?.kind === "NGAY") {
    const following = followingAtom(input, index);
    if (tokens[following]?.kind !== "NUMBER") return null;
    valid = hasRequiredSpace(tokens, index, following);
    dayIndex = following;
  }
  if (tokens[dayIndex]?.kind !== "NUMBER") return null;
  const monthWordIndex = followingAtom(input, dayIndex);
  if (tokens[monthWordIndex]?.kind !== "THANG") {
    if (tokens[index]?.kind !== "NGAY") return null;
    // A day introducer commits to a date production. A complete numeric date
    // is still supported; an unfinished day alone is malformed, not absent.
    const numeric = parseNumericDateAt(input, dayIndex, reference);
    return valid && numeric !== null ? numeric : invalidDate(numeric?.nextIndex ?? dayIndex + 1);
  }
  const monthIndex = followingAtom(input, monthWordIndex);
  if (tokens[monthIndex]?.kind !== "NUMBER") return invalidDate(monthWordIndex + 1);
  valid &&= hasRequiredSpace(tokens, dayIndex, monthWordIndex)
    && hasRequiredSpace(tokens, monthWordIndex, monthIndex);

  let year: number | undefined;
  let endIndex = monthIndex + 1;
  const maybeYearWord = followingAtom(input, monthIndex);
  if (tokens[maybeYearWord]?.kind === "NAM") {
    const yearIndex = followingAtom(input, maybeYearWord);
    if (tokens[yearIndex]?.kind !== "NUMBER") return invalidDate(maybeYearWord + 1);
    if (tokens[yearIndex].raw.length !== 4) {
      return invalidDate(yearIndex + 1);
    }
    valid &&= hasRequiredSpace(tokens, monthIndex, maybeYearWord)
      && hasRequiredSpace(tokens, maybeYearWord, yearIndex);
    year = numberValue(tokens[yearIndex]);
    endIndex = yearIndex + 1;
  }
  if (!valid) return invalidDate(endIndex);
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

type NumericDateState = "DAY" | "MONTH_SEPARATOR" | "MONTH" | "YEAR_SEPARATOR" | "YEAR"
  | "ISO_YEAR" | "ISO_MONTH_SEPARATOR" | "ISO_MONTH" | "ISO_DAY_SEPARATOR" | "ISO_DAY";

const NUMERIC_DATE_TRANSITIONS: Record<NumericDateState, Partial<Record<TokenKind, NumericDateState>>> = {
  DAY: { SLASH: "MONTH_SEPARATOR", HYPHEN: "MONTH_SEPARATOR" },
  MONTH_SEPARATOR: { NUMBER: "MONTH" },
  MONTH: { SLASH: "YEAR_SEPARATOR" },
  YEAR_SEPARATOR: { NUMBER: "YEAR" },
  YEAR: {},
  ISO_YEAR: { HYPHEN: "ISO_MONTH_SEPARATOR" },
  ISO_MONTH_SEPARATOR: { NUMBER: "ISO_MONTH" },
  ISO_MONTH: { HYPHEN: "ISO_DAY_SEPARATOR" },
  ISO_DAY_SEPARATOR: { NUMBER: "ISO_DAY" },
  ISO_DAY: {},
};

function parseNumericDateAt(
  input: GrammarInput,
  index: number,
  reference: ReferenceDate,
): Parsed<DateCandidate> | null {
  const { tokens } = input;
  const first = tokens[index];
  if (first?.kind !== "NUMBER") return null;
  if (input.firstDateSeparator[index + 1] === tokens.length) return null;
  const isIso = first.raw.length === 4 && tokens[index + 1]?.kind === "HYPHEN";
  let state: NumericDateState = isIso ? "ISO_YEAR" : "DAY";
  let cursor = index + 1;
  let day = numberValue(first);
  let month = Number.NaN;
  let year: number | undefined;
  if (isIso) year = numberValue(first);
  // This acyclic grammar takes at most four transitions. Terminal MONTH,
  // YEAR and ISO_DAY states still require maximal-span validation below.
  while (cursor < tokens.length) {
    const next: NumericDateState | undefined = NUMERIC_DATE_TRANSITIONS[state][tokens[cursor].kind];
    if (next === undefined) break;
    state = next;
    if (state === "MONTH" || state === "ISO_MONTH") month = numberValue(tokens[cursor]);
    if (state === "ISO_DAY") day = numberValue(tokens[cursor]);
    if (state === "YEAR") {
      if (tokens[cursor].raw.length !== 4) return invalidDate(cursor + 1);
      year = numberValue(tokens[cursor]);
    }
    cursor += 1;
  }
  if (state !== "MONTH" && state !== "YEAR" && state !== "ISO_DAY") return invalidDate(cursor);
  return {
    candidate: resolveExplicitDate(year, month, day, reference),
    nextIndex: cursor,
  };
}

type ClockState = "HOUR" | "SPACE_AFTER_HOUR" | "TIME_SEPARATOR" | "MINUTE" | "HOUR_MARKER";
const CLOCK_TRANSITIONS: Record<ClockState, Partial<Record<TokenKind, ClockState>>> = {
  HOUR: { COLON: "TIME_SEPARATOR", H: "HOUR_MARKER", WHITESPACE: "SPACE_AFTER_HOUR" },
  SPACE_AFTER_HOUR: { GIO: "HOUR_MARKER" },
  TIME_SEPARATOR: { NUMBER: "MINUTE" },
  MINUTE: {},
  HOUR_MARKER: {},
};

function parseTimeFromNumberAt(
  input: GrammarInput,
  index: number,
): Parsed<TimeCandidate> | null {
  const { tokens } = input;
  const hourToken = tokens[index];
  if (hourToken?.kind !== "NUMBER") return null;
  const nextIndex = nextNonWhitespace(tokens, index + 1);
  const next = tokens[nextIndex];
  const unitStarter = next?.kind === "H" || next?.kind === "GIO"
    || (nextIndex === index + 1 && next?.kind === "UNKNOWN_WORD"
      && next.raw.toLocaleLowerCase("vi-VN").startsWith("h"));
  if (!unitStarter && input.firstClockSeparator[index + 1] === tokens.length) return null;

  let state: ClockState = "HOUR";
  let endIndex = index + 1;
  let minute = 0;
  while (endIndex < tokens.length) {
    const nextState: ClockState | undefined = CLOCK_TRANSITIONS[state][tokens[endIndex].kind];
    if (nextState === undefined) break;
    state = nextState;
    if (state === "MINUTE") {
      if (tokens[endIndex].raw.length !== 2) {
        return { candidate: { kind: "INVALID" }, nextIndex: endIndex + 1 };
      }
      minute = numberValue(tokens[endIndex]);
    }
    endIndex += 1;
  }
  if (state !== "MINUTE" && state !== "HOUR_MARKER") {
    return { candidate: { kind: "INVALID" }, nextIndex: endIndex };
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

function parseTimeAt(input: GrammarInput, index: number): Parsed<TimeCandidate> | null {
  const { tokens } = input;
  if (tokens[index]?.kind === "LUC") {
    const hourIndex = followingAtom(input, index);
    if (tokens[hourIndex]?.kind !== "NUMBER" || !hasRequiredSpace(tokens, index, hourIndex)) {
      return { candidate: { kind: "INVALID" }, nextIndex: index + 1 };
    }
    return parseTimeFromNumberAt(input, hourIndex)
      ?? { candidate: { kind: "INVALID" }, nextIndex: hourIndex + 1 };
  }
  return parseTimeFromNumberAt(input, index);
}

function parseRangeAt(input: GrammarInput, index: number): Parsed<RangeCandidate> | null {
  const { tokens } = input;
  let kind: ResolvedRangeCandidate["kind"] | null = null;
  let endIndex = index;
  let valid = true;
  if (tokens[index]?.kind === "TUAN" || tokens[index]?.kind === "SAP") {
    const secondIndex = followingAtom(input, index);
    const expected = tokens[index].kind === "TUAN" ? "NAY" : "TOI";
    if (tokens[secondIndex]?.kind !== expected) {
      return { candidate: { state: "AMBIGUOUS" }, nextIndex: index + 1 };
    }
    valid = hasRequiredSpace(tokens, index, secondIndex);
    kind = expected === "NAY" ? "THIS_WEEK" : "UPCOMING";
    endIndex = secondIndex + 1;
  } else if (tokens[index]?.kind === "NUMBER") {
    const ngayIndex = followingAtom(input, index);
    if (tokens[ngayIndex]?.kind !== "NGAY") return null;
    const toiIndex = followingAtom(input, ngayIndex);
    if (tokens[toiIndex]?.kind !== "TOI") {
      return { candidate: { state: "AMBIGUOUS" }, nextIndex: ngayIndex + 1 };
    }
    valid = tokens[index].raw === "7"
      && hasRequiredSpace(tokens, index, ngayIndex) && hasRequiredSpace(tokens, ngayIndex, toiIndex);
    kind = "NEXT_7_DAYS";
    endIndex = toiIndex + 1;
  } else {
    return null;
  }

  return {
    candidate: valid ? { state: "RESOLVED", kind, localDate: null } : { state: "AMBIGUOUS" },
    nextIndex: endIndex,
  };
}

// Core productions own positive AND malformed recognition. No production
// resolves evidence or decides whether the following expression is separate.
// These finite starter classes deliberately recognize incomplete productions.
// A leading separator commits the fragment to its dimension even when the
// remaining numeric component cannot form a complete date or clock.
const INCOMPLETE_STARTERS: Partial<Record<TokenKind, "date" | "time">> = {
  SLASH: "date", HYPHEN: "date", COLON: "time",
};

function incompleteStarterAt(input: GrammarInput, index: number, reference: ReferenceDate): Expression | null {
  const dimension = INCOMPLETE_STARTERS[input.tokens[index]?.kind];
  if (dimension === undefined) return null;
  const numberIndex = followingAtom(input, index);
  if (input.tokens[numberIndex]?.kind !== "NUMBER") return null;
  if (dimension === "date") {
    const numeric = parseNumericDateAt(input, numberIndex, reference);
    return { dimension, parsed: invalidDate(numeric?.nextIndex ?? numberIndex + 1) };
  }
  return { dimension, parsed: { candidate: { kind: "INVALID" }, nextIndex: numberIndex + 1 } };
}

function expressionAt(input: GrammarInput, index: number, reference: ReferenceDate): Expression | null {
  const { tokens } = input;
  const token = tokens[index];
  if (token === undefined) return null;
  const incomplete = incompleteStarterAt(input, index, reference);
  if (incomplete !== null) return incomplete;
  if (isSeparator(token.kind)) return null;
  const range = parseRangeAt(input, index);
  if (range !== null) return { dimension: "range", parsed: range };
  const date = parseRelativeDateAt(input, index, reference)
    ?? parseVietnameseDateAt(input, index, reference)
    ?? parseNumericDateAt(input, index, reference);
  if (date !== null) return { dimension: "date", parsed: date };
  const time = parseTimeAt(input, index);
  if (time !== null) return { dimension: "time", parsed: time };
  if (token.kind === "MOT" || token.kind === "THANG" || token.kind === "NAM") {
    return { dimension: "date", parsed: invalidDate(index + 1) };
  }
  if (token.kind === "H" || token.kind === "GIO" || token.kind === "RUOI"
    || token.kind === "MERIDIEM" || token.kind === "DAYPART") {
    return {
      dimension: "time",
      parsed: { candidate: { kind: token.kind === "DAYPART" ? "DAYPART" : "INVALID" }, nextIndex: index + 1 },
    };
  }
  if (token.kind === "UNKNOWN_WORD") {
    const letter = token.raw.toLowerCase();
    const mIndex = followingAtom(input, index);
    if ((letter === "a" || letter === "p")
      && tokens[nextNonWhitespace(tokens, index + 1)]?.kind === "DOT") {
      return {
        dimension: "time",
        parsed: {
          candidate: { kind: "INVALID" },
          nextIndex: tokens[mIndex]?.raw.toLowerCase() === "m" ? mIndex + 1 : index + 1,
        },
      };
    }
  }
  return null;
}

function invalidExpression(expression: Expression): Expression {
  const nextIndex = expression.parsed.nextIndex;
  if (expression.dimension === "date") return { dimension: "date", parsed: invalidDate(nextIndex) };
  if (expression.dimension === "range") {
    return { dimension: "range", parsed: { candidate: { state: "AMBIGUOUS" }, nextIndex } };
  }
  return { dimension: "time", parsed: { candidate: { kind: "INVALID" }, nextIndex } };
}

type SeparatorState = "EMPTY" | "SPACE" | "COLON" | "SPACED_COLON" | "COLON_BOUNDARY" | "INTERNAL" | "MALFORMED";
type InternalClass = Exclude<SeparatorClass, "SENTENCE">;

// A repeated/mixed internal run has an absorbing MALFORMED state. The sole
// colon boundary production is SPACE COLON SPACE between separate starters.
// This preserves the reviewed punctuation form without accepting attached or
// repeated colons because a later expression happens to be recognizable.
const SEPARATOR_TRANSITIONS: Record<SeparatorState, Record<InternalClass, SeparatorState>> = {
  EMPTY: { SPACE: "SPACE", CLOCK_INTERNAL: "COLON", DATE_INTERNAL: "INTERNAL", DOT_INTERNAL: "INTERNAL" },
  SPACE: { SPACE: "SPACE", CLOCK_INTERNAL: "SPACED_COLON", DATE_INTERNAL: "INTERNAL", DOT_INTERNAL: "INTERNAL" },
  COLON: { SPACE: "COLON", CLOCK_INTERNAL: "MALFORMED", DATE_INTERNAL: "MALFORMED", DOT_INTERNAL: "MALFORMED" },
  SPACED_COLON: { SPACE: "COLON_BOUNDARY", CLOCK_INTERNAL: "MALFORMED", DATE_INTERNAL: "MALFORMED", DOT_INTERNAL: "MALFORMED" },
  COLON_BOUNDARY: { SPACE: "COLON_BOUNDARY", CLOCK_INTERNAL: "MALFORMED", DATE_INTERNAL: "MALFORMED", DOT_INTERNAL: "MALFORMED" },
  INTERNAL: { SPACE: "INTERNAL", CLOCK_INTERNAL: "MALFORMED", DATE_INTERNAL: "MALFORMED", DOT_INTERNAL: "MALFORMED" },
  MALFORMED: { SPACE: "MALFORMED", CLOCK_INTERNAL: "MALFORMED", DATE_INTERNAL: "MALFORMED", DOT_INTERNAL: "MALFORMED" },
};

function isMalformed(expression: Expression): boolean {
  if (expression.dimension === "date") return expression.parsed.candidate.localDate === null;
  if (expression.dimension === "range") return expression.parsed.candidate.state === "AMBIGUOUS";
  return expression.parsed.candidate.kind !== "VALID";
}

// Consumes the maximal span, with an irreversible COMPLETE -> MALFORMED
// transition. Recognition of a later expression is only a recovery boundary;
// it never changes the classification of the span already consumed.
function consumeTemporalSpan(
  input: GrammarInput,
  initial: Expression,
  reference: ReferenceDate,
  counters: ScannerCounters,
): Expression {
  const { tokens } = input;
  let expression = initial;
  let cursor = initial.parsed.nextIndex;
  let separatorState: SeparatorState = "EMPTY";
  let leadingDateSeparator: number | null = null;
  let sentenceBoundary = false;

  const finish = (nextIndex: number): Expression => {
    expression.parsed.nextIndex = nextIndex;
    return expression;
  };
  const malformed = () => { expression = invalidExpression(expression); };

  while (cursor < tokens.length) {
    counters.grammarSteps += 1;
    const token = tokens[cursor];
    const separator = SEPARATOR_CLASSES[token.kind];
    if (separator !== undefined) {
      // Sentence punctuation can close a complete run only before a new
      // expression or ordinary text. Numeric tails are classified below.
      const periodBoundary = separator === "DOT_INTERNAL"
        && (tokens[cursor + 1]?.kind === "WHITESPACE" || cursor + 1 === tokens.length)
        && (separatorState === "EMPTY" || separatorState === "SPACE");
      if (separator === "SENTENCE" || periodBoundary) {
        if (separatorState !== "EMPTY" && separatorState !== "SPACE") malformed();
        sentenceBoundary = true;
        separatorState = "SPACE";
        cursor += 1;
        // A separator-led fragment after sentence punctuation belongs to
        // the next candidate, including incomplete /09 and :.30 forms.
        const next = nextNonWhitespace(tokens, cursor);
        if (incompleteStarterAt(input, next, reference) !== null) return finish(next);
        continue;
      }
      if (separator === "DATE_INTERNAL" && leadingDateSeparator === null) leadingDateSeparator = cursor;
      separatorState = SEPARATOR_TRANSITIONS[separatorState][separator];
      cursor += 1;
      continue;
    }

    const following = expressionAt(input, cursor, reference);
    const safe = separatorState === "SPACE" || separatorState === "COLON_BOUNDARY";
    if (following !== null && safe) {
      if (expression.dimension === "time" && expression.parsed.candidate.kind === "VALID"
        && (token.kind === "DAYPART" || token.kind === "MERIDIEM")) {
        expression = { dimension: "time", parsed: {
          candidate: { kind: "MODIFIER" }, nextIndex: following.parsed.nextIndex,
        } };
        cursor = following.parsed.nextIndex;
        separatorState = "EMPTY";
        continue;
      }
      return finish(cursor);
    }
    if (separatorState === "SPACE" && token.kind !== "NUMBER") return finish(cursor);

    // An attached word, bare number, or internal separator continuation is
    // part of this span. Once invalid, later text cannot authorize its prefix.
    malformed();
    if (leadingDateSeparator !== null && expression.dimension !== "date") {
      // Overlapping date syntax invalidates this span, and is also retained
      // as a malformed DATE starter instead of silently dropping a dimension.
      return finish(leadingDateSeparator);
    }
    if (following !== null && separatorState !== "EMPTY") {
      // Internal colons belong to the current span; an independent date or
      // range beginning at the next atom remains available after recovery.
      if (following.dimension !== expression.dimension || sentenceBoundary) return finish(cursor);
      cursor = following.parsed.nextIndex;
    } else {
      cursor += 1;
    }
    separatorState = "EMPTY";
    sentenceBoundary = false;
  }
  if (separatorState !== "EMPTY" && separatorState !== "SPACE") malformed();
  // isMalformed documents the absorbing span classification, including
  // malformed core productions that never reached COMPLETE.
  if (isMalformed(initial) && !isMalformed(expression)) expression = invalidExpression(expression);
  return finish(cursor);
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
  const input = grammarInput(tokens, counters);
  let index = 0;
  while (index < tokens.length) {
    counters.grammarSteps += 1;
    const core = expressionAt(input, index, reference);
    if (core === null) {
      index += 1;
      continue;
    }
    const expression = consumeTemporalSpan(input, core, reference, counters);
    if (expression.dimension === "date") {
      candidates.dates.push(expression.parsed.candidate);
      candidates.ranges.push(rangeFromDate(expression.parsed.candidate));
      counters.candidateCount += 2;
    } else if (expression.dimension === "time") {
      candidates.times.push(expression.parsed.candidate);
      counters.candidateCount += 1;
    } else {
      candidates.ranges.push(expression.parsed.candidate);
      counters.candidateCount += 1;
    }
    index = Math.max(index + 1, expression.parsed.nextIndex);
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
