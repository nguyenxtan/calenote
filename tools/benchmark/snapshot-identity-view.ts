/** T0 storage representation experiment only; not persistence or a state schema. */
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid snapshot object");
  return value as Record<string, unknown>;
}
export function encodeIdentityViews(snapshotJson: string): string {
  const snapshot = object(JSON.parse(snapshotJson));
  if (!Array.isArray(snapshot.transcript)) throw new Error("Missing transcript");
  snapshot.transcript = snapshot.transcript.map(value => {
    const turn = object(value);
    if ("viewFromSource" in turn || typeof turn.text !== "string" || typeof turn.semanticView !== "string") throw new Error("Invalid transcript view");
    return Object.fromEntries(Object.entries(turn).map(([key, value]) => key === "semanticView" && value === turn.text ? ["viewFromSource", true] : [key, value]));
  });
  return JSON.stringify({ encoding: "identity-view-v1", snapshot });
}
export function decodeIdentityViews(encodedJson: string): string {
  const envelope = object(JSON.parse(encodedJson));
  if (envelope.encoding !== "identity-view-v1") throw new Error("Unsupported snapshot encoding");
  if (Object.keys(envelope).length !== 2 || !("snapshot" in envelope)) throw new Error("Unknown snapshot envelope fields");
  const snapshot = object(envelope.snapshot);
  if (!Array.isArray(snapshot.transcript)) throw new Error("Missing transcript");
  snapshot.transcript = snapshot.transcript.map(value => {
    const turn = object(value);
    if (typeof turn.text !== "string") throw new Error("Missing source text");
    if ("viewFromSource" in turn) {
      if (turn.viewFromSource !== true || "semanticView" in turn) throw new Error("Invalid identity reference");
      return Object.fromEntries(Object.entries(turn).map(([key, value]) => key === "viewFromSource" ? ["semanticView", turn.text] : [key, value]));
    }
    if (typeof turn.semanticView !== "string") throw new Error("Missing transformed view");
    return turn;
  });
  return JSON.stringify(snapshot);
}
