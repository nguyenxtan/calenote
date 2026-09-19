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

// Completion describes syntax, not value validity: 20/13 has both date
// operands, while 20/ still owes an operand to its temporal island.
type Parsed<T> = { candidate: T; nextIndex: number; complete: boolean };

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
    } else if ((character === "h" || character === "H") && tokens.at(-1)?.kind === "NUMBER") {
      // An attached hour marker is a lexical token even when unsupported
      // letters follow it. The island grammar will consume those letters;
      // no raw-word prefix or suffix guard is needed in a time parser.
      index += 1;
      kind = "H";
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

function invalidDate(nextIndex: number, complete = false): Parsed<DateCandidate> {
  return {
    candidate: { source: "EXPLICIT_DATE", localDate: null },
    nextIndex,
    complete,
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

function followingCoreToken(input: GrammarInput, index: number): number {
  // Only an adjacent atom or one whitespace token can extend a word-led
  // production. Leave every punctuation run at the cursor for the island
  // machine to classify before any later atom can be consumed. The broader
  // followingAtom index is for structural discovery, not parser advancement.
  return nextNonWhitespace(input.tokens, index + 1);
}

// Ownership is structural, including RANGE; it never comes from a parser's
// selected production. DATE also owns its derived list-range evidence.
const DATE_OWNERSHIP = 1;
const TIME_OWNERSHIP = 2;
const RANGE_OWNERSHIP = 4;
type DimensionOwnership = number;

function wordOwnership(kind: TokenKind, previousAtom?: TokenKind): DimensionOwnership {
  switch (kind) {
    case "NGAY":
      return previousAtom === "NUMBER" ? RANGE_OWNERSHIP : DATE_OWNERSHIP | RANGE_OWNERSHIP;
    case "HOM": case "MAI": case "MOT": case "THANG": case "NAM":
      return DATE_OWNERSHIP | RANGE_OWNERSHIP;
    case "TUAN": case "SAP":
      return RANGE_OWNERSHIP;
    case "LUC": case "H": case "GIO": case "RUOI": case "MERIDIEM": case "DAYPART":
      return TIME_OWNERSHIP;
    default:
      return 0;
  }
}

function isMeridiemInitial(input: GrammarInput, index: number): boolean {
  const token = input.tokens[index];
  return token?.kind === "UNKNOWN_WORD"
    && (token.raw.toLowerCase() === "a" || token.raw.toLowerCase() === "p")
    && input.tokens[nextNonWhitespace(input.tokens, index + 1)]?.kind === "DOT";
}

// A seed identifies temporal syntax, including unfinished productions, without
// parsing a date or a clock. Lookups inspect a bounded number of indexed atoms.
function structuralSeedAt(input: GrammarInput, index: number): DimensionOwnership {
  const { tokens } = input;
  const token = tokens[index];
  if (token === undefined) return 0;
  const separator = SEPARATOR_CLASSES[token.kind];
  if (separator === "DATE_INTERNAL" || separator === "CLOCK_INTERNAL") {
    const atom = followingAtom(input, index);
    const next = tokens[atom];
    if (next === undefined || (next.kind !== "NUMBER" && wordOwnership(next.kind) === 0
      && !isMeridiemInitial(input, atom))) return 0;
    return separator === "DATE_INTERNAL" ? DATE_OWNERSHIP | RANGE_OWNERSHIP : TIME_OWNERSHIP;
  }
  if (token.kind === "NUMBER") {
    let ownership = 0;
    if (input.firstDateSeparator[index + 1] < tokens.length) ownership |= DATE_OWNERSHIP | RANGE_OWNERSHIP;
    if (input.firstClockSeparator[index + 1] < tokens.length) ownership |= TIME_OWNERSHIP;
    const following = tokens[followingAtom(input, index)]?.kind;
    if (following === "NGAY") ownership |= RANGE_OWNERSHIP;
    if (following === "THANG") ownership |= DATE_OWNERSHIP | RANGE_OWNERSHIP;
    const adjacent = tokens[nextNonWhitespace(tokens, index + 1)]?.kind;
    if (adjacent === "H" || adjacent === "GIO") ownership |= TIME_OWNERSHIP;
    return ownership;
  }
  return wordOwnership(token.kind) | (isMeridiemInitial(input, index) ? TIME_OWNERSHIP : 0);
}

function collectIslandOwnership(
  input: GrammarInput,
  start: number,
  end: number,
  counters: ScannerCounters,
): DimensionOwnership {
  let ownership = 0;
  let previousAtom: TokenKind | undefined;
  let leadingClockRun = false;
  for (let index = start; index < end; index += 1) {
    counters.grammarSteps += 1;
    const kind = input.tokens[index].kind;
    const separator = SEPARATOR_CLASSES[kind];
    if (separator !== undefined) {
      if (separator === "CLOCK_INTERNAL") {
        ownership |= TIME_OWNERSHIP;
        if (previousAtom === undefined) leadingClockRun = true;
      } else if (separator === "DATE_INTERNAL" && !leadingClockRun) {
        ownership |= DATE_OWNERSHIP | RANGE_OWNERSHIP;
      }
      continue;
    }
    ownership |= wordOwnership(kind, previousAtom);
    if (isMeridiemInitial(input, index)) ownership |= TIME_OWNERSHIP;
    previousAtom = kind;
    leadingClockRun = false;
  }
  return ownership;
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
    const nayIndex = followingCoreToken(input, index);
    if (tokens[nayIndex]?.kind !== "NAY") return invalidDate(index + 1);
    if (!hasRequiredSpace(tokens, index, nayIndex)) return invalidDate(nayIndex + 1, true);
    source = "TODAY";
    endIndex = nayIndex + 1;
  } else if (tokens[index]?.kind === "NGAY") {
    const maiIndex = followingCoreToken(input, index);
    if (tokens[maiIndex]?.kind !== "MAI") return null;
    if (!hasRequiredSpace(tokens, index, maiIndex)) return invalidDate(maiIndex + 1, true);
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
    complete: true,
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
    const following = followingCoreToken(input, index);
    if (tokens[following]?.kind !== "NUMBER") return null;
    valid = hasRequiredSpace(tokens, index, following);
    dayIndex = following;
  }
  if (tokens[dayIndex]?.kind !== "NUMBER") return null;
  const monthWordIndex = followingCoreToken(input, dayIndex);
  if (tokens[monthWordIndex]?.kind !== "THANG") {
    if (tokens[index]?.kind !== "NGAY") return null;
    // A day introducer commits to a date production. A complete numeric date
    // is still supported; an unfinished day alone is malformed, not absent.
    const numeric = parseNumericDateAt(input, dayIndex, reference);
    return valid && numeric !== null ? numeric
      : invalidDate(numeric?.nextIndex ?? dayIndex + 1, numeric?.complete ?? false);
  }
  const monthIndex = followingCoreToken(input, monthWordIndex);
  if (tokens[monthIndex]?.kind !== "NUMBER") return invalidDate(monthWordIndex + 1);
  valid &&= hasRequiredSpace(tokens, dayIndex, monthWordIndex)
    && hasRequiredSpace(tokens, monthWordIndex, monthIndex);

  let year: number | undefined;
  let endIndex = monthIndex + 1;
  const maybeYearWord = followingCoreToken(input, monthIndex);
  if (tokens[maybeYearWord]?.kind === "NAM") {
    const yearIndex = followingCoreToken(input, maybeYearWord);
    if (tokens[yearIndex]?.kind !== "NUMBER") return invalidDate(maybeYearWord + 1);
    if (tokens[yearIndex].raw.length !== 4) {
      return invalidDate(yearIndex + 1, true);
    }
    valid &&= hasRequiredSpace(tokens, monthIndex, maybeYearWord)
      && hasRequiredSpace(tokens, maybeYearWord, yearIndex);
    year = numberValue(tokens[yearIndex]);
    endIndex = yearIndex + 1;
  }
  if (!valid) return invalidDate(endIndex, true);
  return {
    candidate: resolveExplicitDate(
      year,
      numberValue(tokens[monthIndex]),
      numberValue(tokens[dayIndex]),
      reference,
    ),
    nextIndex: endIndex,
    complete: true,
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
      if (tokens[cursor].raw.length !== 4) return invalidDate(cursor + 1, true);
      year = numberValue(tokens[cursor]);
    }
    cursor += 1;
  }
  if (state !== "MONTH" && state !== "YEAR" && state !== "ISO_DAY") return invalidDate(cursor);
  return {
    candidate: resolveExplicitDate(year, month, day, reference),
    nextIndex: cursor,
    complete: true,
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
  const unitStarter = next?.kind === "H" || next?.kind === "GIO";
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
        return { candidate: { kind: "INVALID" }, nextIndex: endIndex + 1, complete: true };
      }
      minute = numberValue(tokens[endIndex]);
    }
    endIndex += 1;
  }
  if (state !== "MINUTE" && state !== "HOUR_MARKER") {
    // Whitespace only belongs to the hour-marker production when GIO follows;
    // otherwise leave it for the island boundary state machine.
    if (state === "SPACE_AFTER_HOUR") endIndex -= 1;
    return { candidate: { kind: "INVALID" }, nextIndex: endIndex, complete: false };
  }

  const hour = numberValue(hourToken);
  if (hour > 23 || minute > 59) {
    return { candidate: { kind: "INVALID" }, nextIndex: endIndex, complete: true };
  }
  return {
    candidate: {
      kind: "VALID",
      localTime: `${padTwo(hour)}:${padTwo(minute)}` as LocalTime,
    },
    nextIndex: endIndex,
    complete: true,
  };
}

function parseTimeAt(input: GrammarInput, index: number): Parsed<TimeCandidate> | null {
  const { tokens } = input;
  if (tokens[index]?.kind === "LUC") {
    const hourIndex = followingCoreToken(input, index);
    if (tokens[hourIndex]?.kind !== "NUMBER" || !hasRequiredSpace(tokens, index, hourIndex)) {
      return { candidate: { kind: "INVALID" }, nextIndex: index + 1, complete: false };
    }
    return parseTimeFromNumberAt(input, hourIndex)
      ?? { candidate: { kind: "INVALID" }, nextIndex: hourIndex + 1, complete: false };
  }
  return parseTimeFromNumberAt(input, index);
}

function parseRangeAt(input: GrammarInput, index: number): Parsed<RangeCandidate> | null {
  const { tokens } = input;
  let kind: ResolvedRangeCandidate["kind"] | null = null;
  let endIndex = index;
  let valid = true;
  if (tokens[index]?.kind === "TUAN" || tokens[index]?.kind === "SAP") {
    const secondIndex = followingCoreToken(input, index);
    const expected = tokens[index].kind === "TUAN" ? "NAY" : "TOI";
    if (tokens[secondIndex]?.kind !== expected) {
      return { candidate: { state: "AMBIGUOUS" }, nextIndex: index + 1, complete: false };
    }
    valid = hasRequiredSpace(tokens, index, secondIndex);
    kind = expected === "NAY" ? "THIS_WEEK" : "UPCOMING";
    endIndex = secondIndex + 1;
  } else if (tokens[index]?.kind === "NUMBER") {
    const ngayIndex = followingCoreToken(input, index);
    if (tokens[ngayIndex]?.kind !== "NGAY") return null;
    const toiIndex = followingCoreToken(input, ngayIndex);
    if (tokens[toiIndex]?.kind !== "TOI") {
      return { candidate: { state: "AMBIGUOUS" }, nextIndex: ngayIndex + 1, complete: false };
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
    complete: true,
  };
}

// Core parsers advance through adjacent grammar transitions only. They stop
// before punctuation that needs island-boundary classification, and cannot
// remove structural ownership when a production fails.
function expressionAt(input: GrammarInput, index: number, reference: ReferenceDate): Expression | null {
  const { tokens } = input;
  const token = tokens[index];
  if (token === undefined) return null;
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
    return { dimension: "date", parsed: invalidDate(index + 1, token.kind === "MOT") };
  }
  if (token.kind === "H" || token.kind === "GIO" || token.kind === "RUOI"
    || token.kind === "MERIDIEM" || token.kind === "DAYPART") {
    return {
      dimension: "time",
      parsed: { candidate: { kind: token.kind === "DAYPART" ? "DAYPART" : "INVALID" },
        nextIndex: index + 1, complete: true },
    };
  }
  if (isMeridiemInitial(input, index)) {
    return {
      dimension: "time",
      parsed: {
        candidate: { kind: "INVALID" },
        nextIndex: index + 1,
        complete: false,
      },
    };
  }
  return null;
}

function islandCoreAt(input: GrammarInput, index: number, reference: ReferenceDate): Expression | null {
  const ownership = structuralSeedAt(input, index);
  if (ownership === 0) return null;
  const parsed = expressionAt(input, index, reference);
  if (parsed !== null) return parsed;
  // A separator-led island must still consume the complete following atom's
  // production. Skipping its first token would lose word-led clock syntax.
  const nextIndex = index + 1;
  if (ownership & DATE_OWNERSHIP) return { dimension: "date", parsed: invalidDate(nextIndex) };
  if (ownership & TIME_OWNERSHIP) {
    return { dimension: "time", parsed: { candidate: { kind: "INVALID" }, nextIndex, complete: false } };
  }
  return { dimension: "range", parsed: { candidate: { state: "AMBIGUOUS" }, nextIndex, complete: false } };
}

function invalidExpression(expression: Expression): Expression {
  const nextIndex = expression.parsed.nextIndex;
  const complete = expression.parsed.complete;
  if (expression.dimension === "date") return { dimension: "date", parsed: invalidDate(nextIndex, complete) };
  if (expression.dimension === "range") {
    return { dimension: "range", parsed: { candidate: { state: "AMBIGUOUS" }, nextIndex, complete } };
  }
  return { dimension: "time", parsed: { candidate: { kind: "INVALID" }, nextIndex, complete } };
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

function independentStarterAt(input: GrammarInput, index: number): boolean {
  // Suffixes borrow an operand from the left. Their whitespace does not prove
  // a new expression, even if the left parser has just consumed that operand.
  switch (input.tokens[index].kind) {
    case "H": case "GIO": case "RUOI": case "MERIDIEM": case "THANG": case "NAM":
      return false;
    default:
      return !isMeridiemInitial(input, index);
  }
}

type IslandBounds = { core: Expression; contentEnd: number; nextIndex: number };

type TemporalIsland = {
  startIndex: number;
  contentEnd: number;
  nextIndex: number;
  ownership: DimensionOwnership;
  candidates: ScanCandidates;
  malformedDimensions: TemporalEvidenceField[];
};

// Consumes the maximal span, with an irreversible COMPLETE -> MALFORMED
// transition. Recognition of a later expression is only a recovery boundary;
// it never changes the classification of the span already consumed.
function consumeIslandBounds(
  input: GrammarInput,
  start: number,
  initial: Expression,
  reference: ReferenceDate,
  counters: ScannerCounters,
): IslandBounds {
  const { tokens } = input;
  let expression = initial;
  let cursor = initial.parsed.nextIndex;
  let separatorState: SeparatorState = "EMPTY";
  let sentenceBoundary = false;
  let contentEnd = cursor;
  let complete = initial.parsed.complete;
  const coreOwnership = collectIslandOwnership(input, start, cursor, counters);
  let clockOnlyRun = true;

  const finish = (nextIndex: number): IslandBounds => {
    return { core: expression, contentEnd: Math.min(contentEnd, nextIndex), nextIndex };
  };
  const malformed = () => {
    expression = invalidExpression(expression);
    contentEnd = Math.max(contentEnd, cursor);
  };

  while (cursor < tokens.length) {
    counters.grammarSteps += 1;
    const token = tokens[cursor];
    const separator = SEPARATOR_CLASSES[token.kind];
    if (separator !== undefined) {
      // Sentence punctuation can close a complete run only before a new
      // expression or ordinary text. Numeric tails are classified below.
      // A sentence can also terminate an erroneous numeric operand (ngày 21.)
      // but cannot erase a pending separator or word connector.
      const terminalOperand = tokens[contentEnd - 1]?.kind === "NUMBER";
      const closedRun = (complete || terminalOperand)
        && (separatorState === "EMPTY" || separatorState === "SPACE");
      const closedClock = initial.parsed.complete && contentEnd === initial.parsed.nextIndex
        && coreOwnership === TIME_OWNERSHIP && clockOnlyRun;
      const periodBoundary = separator === "DOT_INTERNAL"
        && (tokens[cursor + 1]?.kind === "WHITESPACE" || cursor + 1 === tokens.length)
        && (closedRun || closedClock);
      if (separator === "SENTENCE" || periodBoundary) {
        if (separatorState !== "EMPTY" && separatorState !== "SPACE") malformed();
        sentenceBoundary = true;
        separatorState = "SPACE";
        clockOnlyRun = true;
        cursor += 1;
        // A separator-led fragment after sentence punctuation belongs to
        // the next candidate, including incomplete /09 and :.30 forms.
        const next = nextNonWhitespace(tokens, cursor);
        if (isSeparator(tokens[next]?.kind) && structuralSeedAt(input, next) !== 0) return finish(next);
        continue;
      }
      separatorState = SEPARATOR_TRANSITIONS[separatorState][separator];
      clockOnlyRun &&= separator === "SPACE" || separator === "CLOCK_INTERNAL";
      cursor += 1;
      continue;
    }

    const following = islandCoreAt(input, cursor, reference);
    const separated = separatorState === "SPACE" || separatorState === "COLON_BOUNDARY";
    const independent = following !== null && independentStarterAt(input, cursor);
    if (following !== null && separated && (complete || sentenceBoundary)) {
      if (expression.dimension === "time" && expression.parsed.candidate.kind === "VALID"
        && (token.kind === "DAYPART" || token.kind === "MERIDIEM")) {
        expression = { dimension: "time", parsed: {
          candidate: { kind: "MODIFIER" }, nextIndex: following.parsed.nextIndex, complete: true,
        } };
        cursor = following.parsed.nextIndex;
        contentEnd = cursor;
        separatorState = "EMPTY";
        continue;
      }
      if (independent || sentenceBoundary) return finish(cursor);
    }
    if (following === null && separatorState === "SPACE" && token.kind !== "NUMBER") return finish(cursor);

    // Only a completed clock can own a clock-only malformed continuation
    // before an independent DATE/RANGE starter. DATE separators or unfinished
    // connectors cannot use this recovery: they still own the right operand.
    const recoverClock = independent && initial.parsed.complete
      && contentEnd === initial.parsed.nextIndex && coreOwnership === TIME_OWNERSHIP
      && clockOnlyRun && separatorState !== "EMPTY" && separatorState !== "SPACE"
      && (structuralSeedAt(input, cursor) & TIME_OWNERSHIP) === 0;

    // An attached word, bare number, or internal separator continuation is
    // part of this span. Once invalid, later text cannot authorize its prefix.
    malformed();
    if (recoverClock) return finish(cursor);
    if (following !== null) {
      const terminalOperand = token.kind === "NUMBER" && following.parsed.nextIndex === cursor + 1;
      cursor = following.parsed.nextIndex;
      complete = following.parsed.complete || terminalOperand;
    } else {
      cursor += 1;
      // A terminal atom closes an erroneous production; its malformed
      // evidence remains. A later safe boundary can then separate an island.
      complete = true;
    }
    contentEnd = cursor;
    separatorState = "EMPTY";
    clockOnlyRun = true;
    sentenceBoundary = false;
  }
  if (separatorState !== "EMPTY" && separatorState !== "SPACE") malformed();
  // isMalformed documents the absorbing span classification, including
  // malformed core productions that never reached COMPLETE.
  if (isMalformed(initial) && !isMalformed(expression)) expression = invalidExpression(expression);
  return finish(cursor);
}

function collectTemporalIsland(
  input: GrammarInput,
  start: number,
  bounds: IslandBounds,
  counters: ScannerCounters,
): TemporalIsland {
  const ownership = collectIslandOwnership(input, start, bounds.contentEnd, counters);
  const primary = bounds.core;
  const expectedOwnership = primary.dimension === "date" ? DATE_OWNERSHIP | RANGE_OWNERSHIP
    : primary.dimension === "time" ? TIME_OWNERSHIP : RANGE_OWNERSHIP;
  const candidates: ScanCandidates = { dates: [], times: [], ranges: [] };
  const malformedDimensions: TemporalEvidenceField[] = [];
  // A parsed subexpression authorizes a value only when it accounts for the
  // entire island's dimensions. Keep malformed ownership separate from value
  // candidates so no successful production can erase a malformed dimension.
  const matchesOwnership = ownership === expectedOwnership;
  if (ownership & DATE_OWNERSHIP) {
    const date = matchesOwnership && primary.dimension === "date"
      ? primary.parsed.candidate : invalidDate(bounds.nextIndex).candidate;
    if (date.localDate === null) {
      malformedDimensions.push("date", "range");
    } else {
      candidates.dates.push(date);
      candidates.ranges.push(rangeFromDate(date));
    }
  } else if (ownership & RANGE_OWNERSHIP) {
    const range: RangeCandidate = matchesOwnership && primary.dimension === "range"
      ? primary.parsed.candidate : { state: "AMBIGUOUS" };
    if (range.state === "AMBIGUOUS") malformedDimensions.push("range");
    else candidates.ranges.push(range);
  }
  if (ownership & TIME_OWNERSHIP) {
    const time: TimeCandidate = matchesOwnership && primary.dimension === "time"
      ? primary.parsed.candidate : { kind: "INVALID" };
    if (time.kind === "INVALID") malformedDimensions.push("time");
    else candidates.times.push(time);
  }
  return { startIndex: start, contentEnd: bounds.contentEnd, nextIndex: bounds.nextIndex,
    ownership, candidates, malformedDimensions };
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
    const core = islandCoreAt(input, index, reference);
    if (core === null) {
      index += 1;
      continue;
    }
    const bounds = consumeIslandBounds(input, index, core, reference, counters);
    const island = collectTemporalIsland(input, index, bounds, counters);
    candidates.dates.push(...island.candidates.dates);
    candidates.times.push(...island.candidates.times);
    candidates.ranges.push(...island.candidates.ranges);
    for (const dimension of island.malformedDimensions) {
      if (dimension === "date") candidates.dates.push(invalidDate(island.nextIndex).candidate);
      else if (dimension === "time") candidates.times.push({ kind: "INVALID" });
      else candidates.ranges.push({ state: "AMBIGUOUS" });
    }
    counters.candidateCount += island.candidates.dates.length + island.candidates.times.length
      + island.candidates.ranges.length + island.malformedDimensions.length;
    index = island.nextIndex;
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
