// @vitest-environment node
import { expect, it } from "vitest";
import { ConversationInterpretationV3Schema } from "../../../conversation/context-contract/contracts";
import { CONTEXT_PROTOCOL_V3 } from "../../../conversation/context-contract/protocol";
import { encodeGoogleLiteEuContextV3, parseGoogleLiteEuContextSectionsV3 } from "./context-provider-wire";

const secret = "PRIVATE_EVIDENCE_CONTENT";
const evidence = { kind: "USER_QUOTE", turn: 0, quote: secret, occurrence: 1 };
const canonical = ConversationInterpretationV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "LIST_REMINDERS", requestTarget: null, changes: [],
  query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [evidence] },
  uncertainties: [], conversationDirective: null, replyProposal: null });

it.each([0, 4, 10000])("array cardinality rejection exposes only structural counts (%i)", count => {
  const wire = encodeGoogleLiteEuContextV3(canonical) as { query: { evidence: unknown } };
  wire.query.evidence = Array(count).fill(evidence);
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, CONTEXT_PROTOCOL_V3, undefined, value => diagnostics.push(value))).toEqual({ status: "REFUSED", reason: "SEMANTIC_PATCH_INVALID" });
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["query", "evidence"], code: "WIRE_SHAPE_INVALID", actualType: "array",
    actualCount: count, minItems: 1, maxItems: 3, constraint: "ARRAY_CARDINALITY" }] }]);
  expect(JSON.stringify(diagnostics)).not.toContain(secret);
  expect(JSON.stringify(diagnostics).length).toBeLessThan(1000);
  expect(ConversationInterpretationV3Schema.safeParse({ ...canonical, query: { ...canonical.query, evidence: Array(count).fill(evidence) } }).success).toBe(false);
});

it.each([1, 2, 3])("in-range evidence keeps canonical and decoder acceptance (%i)", count => {
  const input = ConversationInterpretationV3Schema.parse({ ...canonical, query: { ...canonical.query, evidence: Array(count).fill(evidence) } });
  expect(ConversationInterpretationV3Schema.safeParse(input).success).toBe(true);
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(encodeGoogleLiteEuContextV3(input), CONTEXT_PROTOCOL_V3, undefined, value => diagnostics.push(value))).toMatchObject({ status: "PARSED" });
  expect(diagnostics).toEqual([]);
});

it("unrelated wrong array type keeps existing diagnostics without counts", () => {
  const wire = encodeGoogleLiteEuContextV3(canonical) as { query: { evidence: unknown } };
  wire.query.evidence = secret;
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, CONTEXT_PROTOCOL_V3, undefined, value => diagnostics.push(value))).toMatchObject({ status: "REFUSED" });
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["query", "evidence"], code: "WIRE_SHAPE_INVALID", actualType: "string", expected: "object" }] }]);
  const text = JSON.stringify(diagnostics);
  for (const field of [secret, "actualCount", "minItems", "maxItems", "ARRAY_CARDINALITY"]) expect(text).not.toContain(field);
});
