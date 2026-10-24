/** Provider JSON must never acquire last-member-wins semantics. Callers bound
 * response bytes before parsing. This iterative scan has one scope per object;
 * escaped member names are compared after JSON string decoding. */
export function parseJsonWithoutDuplicateMembers(source: string): unknown {
  const stack: Array<{ object: boolean; keyExpected: boolean; keys: Set<string> }> = [];
  try {
    for (let i = 0; i < source.length; i++) {
      const token = source[i];
      if (token === '"') {
        const start = i;
        let closed = false;
        while (++i < source.length) {
          if (source[i] === "\\") { i++; continue; }
          if (source[i] === '"') { closed = true; break; }
        }
        if (!closed) throw Error("INVALID_JSON");
        const scope = stack.at(-1);
        if (scope?.object && scope.keyExpected) {
          const key = JSON.parse(source.slice(start, i + 1)) as string;
          if (scope.keys.has(key)) throw Error("DUPLICATE_JSON_MEMBER");
          scope.keys.add(key);
          scope.keyExpected = false;
        }
      } else if (token === "{" || token === "[") {
        stack.push({ object: token === "{", keyExpected: token === "{", keys: new Set() });
      } else if (token === "}" || token === "]") {
        stack.pop();
      } else if (token === ",") {
        const scope = stack.at(-1);
        if (scope?.object) scope.keyExpected = true;
      }
    }
    return JSON.parse(source) as unknown;
  } catch (error) {
    // SyntaxError messages can contain provider-authored text.
    throw Error(error instanceof Error && error.message === "DUPLICATE_JSON_MEMBER"
      ? "DUPLICATE_JSON_MEMBER" : "INVALID_JSON");
  }
}
