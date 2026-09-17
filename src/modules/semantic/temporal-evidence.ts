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
  structuralGap: boolean[];
  clockGap: boolean[];
};

type Expression =
  | { dimension: "date"; parsed: Parsed<DateCandidate> }
  | { dimension: "time"; parsed: Parsed<TimeCandidate> }
  | { dimension: "range"; parsed: Parsed<RangeCandidate> };

function isSeparator(kind: TokenKind): boolean {
  return kind === "WHITESPACE" || kind === "SLASH" || kind === "COLON"
    || kind === "HYPHEN" || kind === "COMMA" || kind === "DOT" || kind === "PUNCTUATION";
}

function grammarInput(tokens: TemporalToken[], counters: ScannerCounters): GrammarInput {
  const nextAtom = new Array<number>(tokens.length + 1);
  const structuralGap = new Array<boolean>(tokens.length + 1);
  const clockGap = new Array<boolean>(tokens.length + 1);
  nextAtom[tokens.length] = tokens.length;
  structuralGap[tokens.length] = false;
  clockGap[tokens.length] = false;
  // Index separator runs once. Every subsequent grammar probe is O(1), even
  // for arbitrarily long punctuation runs between malformed components.
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    counters.grammarSteps += 1;
    const kind = tokens[index].kind;
    nextAtom[index] = isSeparator(kind) ? nextAtom[index + 1] : index;
    structuralGap[index] = isSeparator(kind)
      && (kind === "SLASH" || kind === "HYPHEN" || structuralGap[index + 1]);
    clockGap[index] = isSeparator(kind) && (kind === "COLON" || clockGap[index + 1]);
  }
  return { tokens, nextAtom, structuralGap, clockGap };
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
    return valid ? null : invalidDate(index + 1);
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

function parseNumericDateAt(
  input: GrammarInput,
  index: number,
  reference: ReferenceDate,
): Parsed<DateCandidate> | null {
  const { tokens } = input;
  const first = tokens[index];
  if (first?.kind !== "NUMBER") return null;
  const separatorIndex = nextNonWhitespace(tokens, index + 1);
  const separator = tokens[separatorIndex];
  if (separator?.kind !== "SLASH" && separator?.kind !== "HYPHEN") {
    return input.structuralGap[index + 1] ? invalidDate(index + 1) : null;
  }
  const isIso = first.raw.length === 4 && separator.kind === "HYPHEN";
  const hadWhitespaceBeforeSeparator = separatorIndex !== index + 1;
  const secondIndex = nextNonWhitespace(tokens, separatorIndex + 1);
  if (hadWhitespaceBeforeSeparator
    || secondIndex !== separatorIndex + 1
    || tokens[secondIndex]?.kind !== "NUMBER") {
    return invalidDate(separatorIndex + 1);
  }

  if (isIso) {
    const secondSeparatorIndex = nextNonWhitespace(tokens, secondIndex + 1);
    const dayIndex = nextNonWhitespace(tokens, secondSeparatorIndex + 1);
    if (secondSeparatorIndex !== secondIndex + 1
      || tokens[secondSeparatorIndex]?.kind !== "HYPHEN"
      || dayIndex !== secondSeparatorIndex + 1
      || tokens[dayIndex]?.kind !== "NUMBER") {
      return invalidDate(secondIndex + 1);
    }
    const endIndex = dayIndex + 1;
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
      return invalidDate(yearSeparatorIndex + 1);
    }
    year = numberValue(tokens[yearIndex]);
    endIndex = yearIndex + 1;
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

function parseTimeFromNumberAt(
  input: GrammarInput,
  index: number,
): Parsed<TimeCandidate> | null {
  const { tokens } = input;
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
      return { candidate: { kind: "INVALID" }, nextIndex: nextIndex + 1 };
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
    return { candidate: { kind: "INVALID" }, nextIndex: nextIndex + 1 };
  } else {
    return input.clockGap[index + 1]
      ? { candidate: { kind: "INVALID" }, nextIndex: index + 1 }
      : null;
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
  } else if (tokens[index]?.kind === "NUMBER" && tokens[index].raw === "7") {
    const ngayIndex = followingAtom(input, index);
    if (tokens[ngayIndex]?.kind !== "NGAY") return null;
    const toiIndex = followingAtom(input, ngayIndex);
    if (tokens[toiIndex]?.kind !== "TOI") {
      return { candidate: { state: "AMBIGUOUS" }, nextIndex: ngayIndex + 1 };
    }
    valid = hasRequiredSpace(tokens, index, ngayIndex) && hasRequiredSpace(tokens, ngayIndex, toiIndex);
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
function expressionAt(input: GrammarInput, index: number, reference: ReferenceDate): Expression | null {
  const { tokens } = input;
  const token = tokens[index];
  if (token === undefined) return null;
  if (token.kind === "SLASH" || token.kind === "HYPHEN") {
    const numberIndex = followingAtom(input, index);
    const numericDate = parseNumericDateAt(input, numberIndex, reference);
    return numericDate === null ? null : {
      dimension: "date", parsed: invalidDate(numericDate.nextIndex),
    };
  }
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

function completeExpression(input: GrammarInput, expression: Expression, reference: ReferenceDate): Expression {
  const { tokens } = input;
  const end = expression.parsed.nextIndex;
  const atomIndex = input.nextAtom[end] ?? tokens.length;
  const atom = tokens[atomIndex];
  const nextExpression = expressionAt(input, atomIndex, reference);
  const separated = atomIndex !== end;

  // Whitespace/message punctuation can separate independent productions,
  // including malformed ones. Slash/hyphen instead structurally extend them.
  if (input.structuralGap[end]) return invalidExpression(expression);
  if (separated && nextExpression !== null) {
    if (expression.dimension === "time" && expression.parsed.candidate.kind === "VALID"
      && (atom?.kind === "DAYPART" || atom?.kind === "MERIDIEM")) {
      return {
        dimension: "time",
        parsed: { candidate: { kind: "MODIFIER" }, nextIndex: nextExpression.parsed.nextIndex },
      };
    }
    return expression;
  }
  if (expression.dimension === "time" && input.clockGap[end]) return invalidExpression(expression);
  if (atom === undefined) return expression;
  // An attached atom or a bare numeric component cannot terminate a complete
  // production. Keep its candidate invalid; the outer scan still visits the
  // remainder, so unrelated subsequent expressions cannot be swallowed.
  if (!separated || atom.kind === "NUMBER") return invalidExpression(expression);
  return expression;
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
    const expression = completeExpression(input, core, reference);
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
