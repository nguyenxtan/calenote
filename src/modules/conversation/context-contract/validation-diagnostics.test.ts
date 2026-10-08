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
import { projectWireValidation } from "./validation-diagnostics";

it("retains the trusted date-encoding failure family without operand content", () => {
  const diagnostic = projectWireValidation({ changes: [{ field: "reminderDate", value: "SYNTHETIC_PRIVATE_DATE" }] }, ["changes", 0, "value"], "DATE_OPERAND_JSON", undefined, "calenote-context-3");
  expect(diagnostic.issues[0]).toMatchObject({ path: ["changes", 0, "value"], expected: "DATE_OPERAND_JSON", actualType: "string" });
  expect(JSON.stringify(diagnostic)).not.toContain("SYNTHETIC_PRIVATE_DATE");
});

it.each([
  [JSON.stringify({ evidence: { ref: sentinel } }), "object"],
  [JSON.stringify([sentinel]), "array"],
  ["null", "null"],
  ["2", "number"],
  ["true", "boolean"],
  [JSON.stringify(sentinel), "string"],
  [sentinel, "INVALID_JSON"],
  [" ".repeat(32769), "OVERSIZED"],
  [JSON.stringify("ộ".repeat(11000)), "OVERSIZED"],
  [" ".repeat(32764) + "null", "null"],
] as const)("reports only bounded embedded type for rejected requestTarget string (%#)", (value, embeddedJsonType) => {
  const diagnostic = projectWireValidation({ requestTarget: value }, ["requestTarget"], "object", undefined, "calenote-context-3");
  expect(diagnostic.issues[0]).toMatchObject({ actualType: "string", embeddedJsonType });
  expect(JSON.stringify(diagnostic)).not.toContain(sentinel);
  expect(JSON.stringify(diagnostic).length).toBeLessThan(1000);
});

it("does not inspect business strings or change actual type of requestTarget", () => {
  const diagnostic = projectWireValidation({ changes: [{ value: JSON.stringify({ location: sentinel }) }] }, ["changes", 0, "value"], "object");
  expect(diagnostic.issues[0]).not.toHaveProperty("embeddedJsonType");
  expect(JSON.stringify(diagnostic)).not.toContain(sentinel);
});

it.each(["CURRENT", "NEW", "UNRESOLVED"])("retains only exact approved misplaced requestTarget control literal %s", token => {
  const diagnostic = projectWireValidation({ requestTarget: token }, ["requestTarget"], "object", undefined, "calenote-context-3");
  expect(diagnostic.issues[0]).toMatchObject({ expected: "object", actualType: "string", actualSafeToken: token, embeddedJsonType: "INVALID_JSON" });
});

it.each([sentinel, "current", "CURRENT ", "NEW_PRIVATE", JSON.stringify("CURRENT"), "X".repeat(40000)])("never retains unknown misplaced target contents (%#)", token => {
  const diagnostic = projectWireValidation({ requestTarget: token }, ["requestTarget"], "object", undefined, "calenote-context-3");
  expect(diagnostic.issues[0]).not.toHaveProperty("actualSafeToken");
  expect(JSON.stringify(diagnostic)).not.toContain(token);
});

it("never grants target-token telemetry to a business value", () => {
  const diagnostic = projectWireValidation({ changes: [{ value: "CURRENT" }] }, ["changes", 0, "value"], "object");
  expect(diagnostic.issues[0]).not.toHaveProperty("actualSafeToken");
});
