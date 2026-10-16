import type { SourceMap, TranscriptEntry } from "./state";
export const CONTROL_PLACEHOLDER = "[CONTROL]";
export type ProjectionResult = { status: "READY"; text: string; sourceMap: SourceMap; controlSpans: TranscriptEntry["controlSpans"] } | { status: "REFUSED"; reason: string };
/** @internal Context builder only; this does not confer evidence authority. */
export function projectSemanticView(text: string, handles: readonly string[], spans: TranscriptEntry["controlSpans"] = []): ProjectionResult {
  const refuse = (): ProjectionResult => ({ status: "REFUSED", reason: "CONTROL_PROJECTION_AMBIGUOUS" });
  if (!text.isWellFormed() || text.includes(CONTROL_PLACEHOLDER)) return refuse();
  const source = [...text];
  const decoded = decodedUnits(text);
  if (!decoded) return refuse();
  const visible = decoded.map(u => u.char).join("");
  const ranges: TranscriptEntry["controlSpans"] = [];
  for (const handle of [...handles].sort((a, b) => b.length - a.length)) {
    const handleUnits = decodedUnits(handle);
    if (!handleUnits) return refuse();
    const semanticHandle = handleUnits.map(u => u.char).join("");
    let from = 0;
    for (;;) {
      const at = visible.indexOf(semanticHandle, from);
      if (at < 0) break;
      const end = at + semanticHandle.length;
      const startPoint = [...visible.slice(0, at)].length, endPoint = [...visible.slice(0, end)].length;
      const range = { start: decoded[startPoint].start, end: decoded[endPoint - 1].end, handle };
      if (ranges.some(r => r.start <= range.start && r.end >= range.end)) { from = end; continue; }
      // Issued short controls must use the reserved marker. A registry collision
      // with an ordinary word/number must not erase user meaning.
      if (!/^CN-[A-Za-z0-9_-]+$/u.test(semanticHandle) && !/^https:\/\//u.test(semanticHandle) && !spans.some(s => s.handle === handle && s.start === range.start && s.end === range.end)) return refuse();
      if (/[\p{L}\p{N}_%/=?&.-]/u.test(visible[at - 1] ?? "") || /[\p{L}\p{N}_%/=&-]/u.test(visible[end] ?? "")) return refuse();
      if ((startPoint > 0 && decoded[startPoint - 1].end > range.start) || (endPoint < decoded.length && decoded[endPoint].start < range.end)) return refuse();
      ranges.push(range);
      from = end;
    }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const controls: TranscriptEntry["controlSpans"] = [];
  for (const range of ranges) {
    const last = controls.at(-1);
    if (last && range.start < last.end) {
      if (range.end <= last.end) continue;
      return refuse();
    }
    controls.push(range);
  }
  for (const span of spans) if (!controls.some(c => c.start === span.start && c.end === span.end && c.handle === span.handle)) return refuse();
  const segments: SourceMap["segments"] = [];
  let view = "", sourceOffset = 0, viewOffset = 0;
  const add = (start: number, end: number, value: string, kind: SourceMap["segments"][number]["kind"]) => {
    const length = [...value].length;
    const sourceStride = kind === "CONTROL_REPLACEMENT" ? 0 : kind === "UNCHANGED" ? 1 : end - start;
    const viewStride = kind === "CONTROL_REPLACEMENT" ? 0 : kind === "UNCHANGED" ? 1 : length;
    const last = segments.at(-1);
    if (last && kind !== "CONTROL_REPLACEMENT" && last.kind === kind && last.sourceStride === sourceStride && last.viewStride === viewStride) {
      last.sourceEnd = end; last.viewEnd += length;
    } else segments.push({ sourceStart: start, sourceEnd: end, viewStart: viewOffset, viewEnd: viewOffset + length, kind, sourceStride, viewStride });
    view += value; viewOffset += length;
  };
  const ordinary = (end: number) => {
    const part = source.slice(sourceOffset, end).join("");
    for (const { segment } of new Intl.Segmenter("vi", { granularity: "grapheme" }).segment(part)) {
      const nfc = segment.normalize("NFC"), next = sourceOffset + [...segment].length;
      add(sourceOffset, next, nfc, nfc === segment ? "UNCHANGED" : "NFC_COMPOSITION_RUN");
      sourceOffset = next;
    }
  };
  for (const control of controls) { ordinary(control.start); add(control.start, control.end, CONTROL_PLACEHOLDER, "CONTROL_REPLACEMENT"); sourceOffset = control.end; }
  ordinary(source.length);
  if (segments.length > 128 || containsForbiddenControl(view, handles)) return refuse();
  return { status: "READY", text: view, controlSpans: controls, sourceMap: { normalizationVersion: "nfc-codepoint-v1", sourceCodePoints: source.length, viewCodePoints: viewOffset, segments } };
}

// Decode only for control detection. Ordinary source is never rewritten by URL
// or JSON decoding. Ranges remain anchored to original Unicode code points.
type DetectionUnit = { char: string; start: number; end: number };

/** JSON escapes may produce each half in different passes. Keep one unit per
 * code point, matching the indexes used to map a detected control to source. */
function coalesceSurrogatePairs(units: DetectionUnit[]): DetectionUnit[] {
  const codePoints: DetectionUnit[] = [];
  for (const unit of units) {
    const previous = codePoints.at(-1);
    if (previous && /^[\uD800-\uDBFF]$/u.test(previous.char) && /^[\uDC00-\uDFFF]$/u.test(unit.char)) {
      codePoints[codePoints.length - 1] = {
        char: previous.char + unit.char,
        start: Math.min(previous.start, unit.start),
        end: Math.max(previous.end, unit.end),
      };
    } else codePoints.push(unit);
  }
  return codePoints;
}

/** One bad UTF-8 byte must not hide the valid bytes around it. Keep invalid
 * bytes literal, while mapping each valid scalar back to its precise source. */
function decodeMalformedPercentRun(run: string, units: DetectionUnit[], offset: number): DetectionUnit[] {
  const decoded: DetectionUnit[] = [];
  for (let cursor = 0; cursor < run.length;) {
    const byte = Number.parseInt(run.slice(cursor + 1, cursor + 3), 16);
    const width = byte < 0x80 ? 1 : byte >= 0xc2 && byte <= 0xdf ? 2
      : byte >= 0xe0 && byte <= 0xef ? 3 : byte >= 0xf0 && byte <= 0xf4 ? 4 : 0;
    let scalar: string | null = null;
    if (width && cursor + width * 3 <= run.length) {
      try { scalar = decodeURIComponent(run.slice(cursor, cursor + width * 3)); } catch { /* invalid scalar */ }
    }
    if (scalar !== null) {
      const end = cursor + width * 3;
      decoded.push({ char: scalar, start: units[offset + cursor].start, end: units[offset + end - 1].end });
      cursor = end;
    } else {
      decoded.push(...units.slice(offset + cursor, offset + cursor + 3));
      cursor += 3;
    }
  }
  return decoded;
}

function decodedUnits(text: string) {
  let units = [...text].map((char, start) => ({ char, start, end: start + 1 }));
  for (let pass = 0; pass < 32; pass++) {
    const next: typeof units = [];
    for (let i = 0; i < units.length;) {
      if (units[i].char !== "%" && units[i].char !== "\\") { next.push(units[i++]); continue; }
      const tail = units.slice(i).map(u => u.char).join("");
      const match = /^(?:%[0-9a-f]{2})+/iu.exec(tail) ?? /^\\u[0-9a-f]{4}/iu.exec(tail) ?? /^\\[\\/]/u.exec(tail);
      if (match) {
        let value: string | undefined;
        try {
          value = match[0].startsWith("%") ? decodeURIComponent(match[0]) : JSON.parse('"' + match[0] + '"') as string;
        } catch {
          if (match[0].startsWith("%")) {
            next.push(...decodeMalformedPercentRun(match[0], units, i));
            i += match[0].length;
            continue;
          }
        }
        if (value !== undefined && value !== match[0]) {
          const end = i + match[0].length;
          next.push(...[...value].map(char => ({ char, start: units[i].start, end: units[end - 1].end })));
          i = end; continue;
        }
      }
      next.push(units[i++]);
    }
    const codePoints = coalesceSurrogatePairs(next);
    const decoded = codePoints.map(u => u.char).join("");
    if (decoded === units.map(u => u.char).join("")) {
      // Do not reject an intermediate half: another pass can decode its pair.
      // Once stable, an isolated surrogate has no safe scalar source mapping.
      return decoded.isWellFormed() ? codePoints : null;
    }
    units = codePoints;
  }
  // Excessively nested encodings cannot be classified inside the work bound.
  return null;
}

/** Final recursive wire check; all values, including nested evidence, are checked. */
export function containsForbiddenControl(value: unknown, handles: readonly string[]): boolean {
  if (typeof value === "string") {
    const units = decodedUnits(value);
    if (!units) return true;
    const decoded = units.map(u => u.char).join("");
    return /CN-/iu.test(decoded) || handles.some(handle => {
      const units = decodedUnits(handle);
      if (!units) return true;
      const canonical = units.map(u => u.char).join("");
      if (decoded.includes(canonical)) return true;
      // Unknown handles on this context's registered action route are unsafe;
      // other URLs, hosts and location paths remain ordinary user content.
      if (canonical.startsWith("https://")) {
        try {
          const registered = new URL(canonical);
          return [...decoded.matchAll(/https?:\/\/[^\s<>"']+/giu)].some(match => {
            try { const candidate = new URL(match[0]); return candidate.origin === registered.origin && candidate.pathname === registered.pathname; } catch { return false; }
          });
        } catch { return true; }
      }
      return false;
    });
  }
  return value !== null && typeof value === "object" && Object.values(value).some(v => containsForbiddenControl(v, handles));
}

/** Output-only privacy guard. Reuses the bounded T2 escaped-control detector;
 * rejects contaminated guidance rather than converting it into sendable text. */
export function containsForbiddenGuidanceMaterial(value: unknown, protectedValues: readonly string[] = []): boolean {
  if (typeof value === "string") {
    const units = decodedUnits(value);
    if (!units || containsForbiddenControl(value, protectedValues)) return true;
    const decoded = units.map(u => u.char).join("");
    return /\[CONTROL\]|https?:|www\.|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:owner|chat|context|request|decision|preview|inbound|workspace|connection|user|message)[-_](?:id[-_])?[a-z0-9_-]+|\b(?:sk|api[-_]?key|secret|bearer)[-_ :][a-z0-9_-]+/iu.test(decoded);
  }
  return value !== null && typeof value === "object" && Object.entries(value).some(([key, item]) => containsForbiddenGuidanceMaterial(key, protectedValues) || containsForbiddenGuidanceMaterial(item, protectedValues));
}
