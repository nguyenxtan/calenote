import { expect, it } from "vitest";
import { LegacyV2parseInterpretationSections as parseInterpretationSections } from "./contracts";

const valid = { schemaVersion: "calenote-context-2", intent: "HELP", dialogueAct: "NEW_REQUEST", continuation: "NO", changes: [], query: null, uncertainties: [], controlEvidence: [], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: null };
const sentinel = "SENSITIVE_ATTACK_DO_NOT_RETAIN";
it.each([
  ["missing", { ...valid, replyProposal: undefined }, "replyProposal", "missing"],
  ["wrong enum", { ...valid, intent: sentinel }, "intent", "value"],
  ["primitive", 42, undefined, "value"],
  ["unknown key", { ...valid, [sentinel]: sentinel }, undefined, "extra"],
  ["nested union", { ...valid, changes: [{ field: "title", operation: "SET", value: 12, evidence: [{ kind: "USER_QUOTE", turn: 0, quote: sentinel, occurrence: 1 }] }] }, "value", "value"],
  ["malformed evidence", { ...valid, controlEvidence: [{ kind: "USER_QUOTE", turn: sentinel, quote: sentinel, occurrence: 1 }] }, "turn", "value"],
  ["sensitive reply", { ...valid, replyProposal: { text: sentinel, [sentinel]: sentinel } }, "replyProposal", "extra"],
] as const)("projects canonical %s failure without values or raw issue messages", (_name, raw, path, classification) => {
  let diagnostics: unknown;
  parseInterpretationSections(raw, value => { diagnostics = value; });
  expect(diagnostics).toBeDefined();
  const projected = diagnostics as { issues: Array<{ path: Array<string | number>; classification: string; actualType: string; code: string }> };
  expect(projected.issues.some(issue => issue.classification === classification && (path === undefined || issue.path.includes(path)))).toBe(true);
  expect(JSON.stringify(projected)).not.toContain(sentinel);
  expect(JSON.stringify(projected)).not.toContain("message");
  expect(projected.issues.every(issue => typeof issue.actualType === "string" && typeof issue.code === "string")).toBe(true);
});
it("bounds nested union issues, paths and unknown key names", () => {
  let diagnostics: unknown;
  const raw = { ...valid, changes: Array.from({ length: 100 }, () => ({ [sentinel]: sentinel })) };
  parseInterpretationSections(raw, value => { diagnostics = value; });
  expect(diagnostics).toMatchObject({ truncated: true });
  expect(JSON.stringify(diagnostics).length).toBeLessThan(12000);
  expect(JSON.stringify(diagnostics)).not.toContain(sentinel);
});
it("does not emit diagnostics or change canonical acceptance on valid input", () => {
  let diagnostics: unknown;
  expect(parseInterpretationSections(valid, value => { diagnostics = value; })).toMatchObject({ status: "PARSED", value: { fullSchemaValid: true } });
  expect(diagnostics).toBeUndefined();
});
it("retains malformed evidence in a late field union branch", () => {
  let diagnostics: unknown;
  parseInterpretationSections({ ...valid, changes: [{ field: "endDate", operation: "SET", value: { kind: "RELATIVE_DAY", offsetDays: 1 }, evidence: [{ kind: "USER_QUOTE", turn: 0, quote: sentinel, occurrence: sentinel }] }] }, value => { diagnostics = value; });
  expect((diagnostics as { issues: Array<{ path: Array<string | number> }> }).issues.some(issue => issue.path.join(".") === "changes.0.evidence.0.occurrence")).toBe(true);
});
