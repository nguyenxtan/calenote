import { TranscriptEntrySchema, type TranscriptEntry } from "./state";
import { projectSemanticView } from "./projection";
import type { QuoteClassification } from "./downstream";

const nfc = (s: string) => s.normalize("NFC");
const whitespace = (s: string) => nfc(s).replace(/\s+/gu, " ").trim();
const punctuation = (s: string) => whitespace(nfc(s).replace(/\p{P}/gu, " "));
const folded = (s: string) => nfc(s).toLowerCase();
const tokens = (s: string) => new Set(folded(s).match(/[\p{L}\p{N}\p{M}]+/gu) ?? []);

/** Bounded rolling-row substring distance and longest contiguous common span.
 * No matched text/offset escapes. This never participates in evidence validity.
 * Quote and intended view are capped at 2000 code points, at most 4M cells.
 */
function lexical(quote: string, source: string) {
  const q = [...quote], s = [...source];
  let previousSpan = new Uint16Array(s.length + 1), span = 0, spanEnd = 0;
  let previousEdit = new Uint16Array(s.length + 1);
  for (let i = 1; i <= q.length; i++) {
    const nextSpan = new Uint16Array(s.length + 1), nextEdit = new Uint16Array(s.length + 1);
    nextEdit[0] = i;
    for (let j = 1; j <= s.length; j++) {
      const equal = q[i - 1] === s[j - 1];
      if (equal) { nextSpan[j] = previousSpan[j - 1] + 1; if (nextSpan[j] > span) { span = nextSpan[j]; spanEnd = j; } }
      nextEdit[j] = Math.min(previousEdit[j] + 1, nextEdit[j - 1] + 1, previousEdit[j - 1] + (equal ? 0 : 1));
    }
    previousSpan = nextSpan; previousEdit = nextEdit;
  }
  const distance = Math.min(...previousEdit);
  const qt = tokens(quote), st = tokens(source);
  const overlap = qt.size ? [...qt].filter(t => st.has(t)).length / qt.size : 0;
  return { span, spanStart: spanEnd - span, spanEnd, distanceRatio: distance / Math.max(1, q.length), overlap };
}

/** Diagnostic comparisons are scoped to the already-built call-local index.
 * Similarity labels are lexical heuristics, NOT proof of semantic paraphrase.
 * Never call this function from a branch that grants application authority.
 */
export function classifyQuoteMismatch(quote: string, ordinal: number, scoped: readonly TranscriptEntry[], retained: readonly TranscriptEntry[]): QuoteClassification {
  const intended = scoped[ordinal];
  const eligible = scoped.length <= 12 && [...quote].length <= 2000 && quote.length > 0;
  const exact = (s: string) => eligible && s.includes(quote);
  const result: QuoteClassification = {
    classification: "UNKNOWN", confidence: "LOW",
    exactMatchIntendedUser: intended?.role === "USER" && exact(intended.semanticView),
    exactMatchOtherUser: eligible && scoped.some((t, i) => i !== ordinal && t.role === "USER" && exact(t.semanticView)),
    exactMatchAssistant: eligible && scoped.some(t => t.role === "ASSISTANT" && exact(t.semanticView)),
    nfcMatch: false, caseFoldedMatch: false, whitespaceNormalizedMatch: false, punctuationNormalizedMatch: false,
    strictSubstringAfterNormalization: false, longestCommonContiguousSpanLength: 0, tokenOverlapRatio: 0,
    tokenOverlapBucket: "NONE", editDistanceBucket: "NOT_MEASURED", sourceMapStatus: "UNAVAILABLE",
    retainedUserBindingValid: false, removedControlSpanNearby: false, sourceChangedUnderNfc: false,
    normalizationOnlyDifference: false, similarityMeasured: false, semanticParaphraseConfirmed: false,
  };
  if (!eligible || !intended) return result;
  const retainedTurn = retained.find(t => t.id === intended.id);
  result.retainedUserBindingValid = intended.role === "USER" && retainedTurn?.role === "USER" && retainedTurn.text === intended.text;
  const projection = projectSemanticView(intended.text, intended.controlSpans.map(s => s.handle), intended.controlSpans);
  result.sourceMapStatus = TranscriptEntrySchema.safeParse(intended).success && projection.status === "READY"
    && projection.text === intended.semanticView && JSON.stringify(projection.sourceMap) === JSON.stringify(intended.sourceMap)
    && (intended.role !== "USER" || result.retainedUserBindingValid) ? "VALID" : "INVALID";
  result.sourceChangedUnderNfc = intended.text !== nfc(intended.text);
  result.nfcMatch = nfc(intended.semanticView).includes(nfc(quote));
  result.caseFoldedMatch = folded(intended.semanticView).includes(folded(quote));
  result.whitespaceNormalizedMatch = whitespace(quote).length > 0 && whitespace(intended.semanticView).includes(whitespace(quote));
  result.punctuationNormalizedMatch = punctuation(quote).length > 0 && punctuation(intended.semanticView).includes(punctuation(quote));
  result.normalizationOnlyDifference = !result.exactMatchIntendedUser && result.nfcMatch;
  result.strictSubstringAfterNormalization = [nfc, folded, whitespace, punctuation].some(transform => {
    const q = transform(quote), source = transform(intended.semanticView);
    return q.length > 0 && q !== source && source.includes(q);
  });
  if (intended.role === "USER" && [...intended.semanticView].length <= 2000) {
    const m = lexical(quote, intended.semanticView);
    result.similarityMeasured = true;
    result.longestCommonContiguousSpanLength = m.span;
    result.tokenOverlapRatio = Math.round(m.overlap * 1000) / 1000;
    result.tokenOverlapBucket = m.overlap === 0 ? "NONE" : m.overlap < 0.4 ? "LOW" : m.overlap < 0.7 ? "MEDIUM" : "HIGH";
    result.editDistanceBucket = m.distanceRatio === 0 ? "EXACT" : m.distanceRatio <= 0.25 ? "NEAR" : m.overlap >= 0.4 ? "PARAPHRASE_LIKE" : "UNRELATED";
    // Candidate vicinity is lexical, not evidence; controls anywhere else do not
    // imply they caused this mismatch. A meaningful span is needed to locate it.
    result.removedControlSpanNearby = m.span >= 3 && intended.sourceMap.segments.some(s => s.kind === "CONTROL_REPLACEMENT" && s.viewStart <= m.spanEnd + 16 && s.viewEnd >= m.spanStart - 16);
  }
  if (result.sourceMapStatus === "INVALID") { result.classification = "SOURCE_MAP_DEFECT"; result.confidence = "HIGH"; }
  else if (result.exactMatchIntendedUser) { result.confidence = "HIGH"; }
  else if (result.exactMatchOtherUser || result.exactMatchAssistant) { result.classification = "EXACT_WRONG_SOURCE"; result.confidence = "HIGH"; }
  else if (result.normalizationOnlyDifference) { result.classification = "NORMALIZATION_VARIANT"; result.confidence = "HIGH"; }
  else if (result.caseFoldedMatch || result.whitespaceNormalizedMatch || result.punctuationNormalizedMatch) { result.classification = "FORMATTING_VARIANT"; result.confidence = "HIGH"; }
  else if (result.similarityMeasured && !result.removedControlSpanNearby) {
    result.classification = ["NEAR", "PARAPHRASE_LIKE"].includes(result.editDistanceBucket) ? "PARAPHRASED_QUOTE" : "UNRELATED_QUOTE";
  }
  return result;
}
