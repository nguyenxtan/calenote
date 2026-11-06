// @vitest-environment node
import { expect, it } from "vitest";
import { ConversationInterpretationV3Schema } from "../../src/modules/conversation/context-contract/contracts";
import { createContextContractProbe } from "./context-contract-probe";

it("a supported weekly task without a notification clock asks for that clock and creates no schedule", async () => {
  const receipt = "2026-09-28T03:00:00Z";
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse(receipt) }, input => {
    const evidence = [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }];
    return ConversationInterpretationV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER",
      requestTarget: { kind: "NEW", evidence }, changes: [
        { field: "title", operation: "SET", value: "gọi khách hàng", evidence },
        { field: "frequency", operation: "SET", value: "WEEKLY", evidence },
      ], query: null, uncertainties: [], conversationDirective: null, replyProposal: null });
  });
  try {
    const result = await probe.turn("Mỗi thứ hai nhắc tôi gọi khách hàng.", receipt);
    expect(probe.inputs[0].capabilities.supported).toContain("FINITE_WEEKLY");
    expect(result).toMatchObject({ status: "CLARIFICATION_REQUESTED", pendingField: "reminderTime", fullSchemaValid: true,
      fields: { title: "gọi khách hàng", frequency: "WEEKLY", reminderTime: null, occurrenceCount: null },
      actualDispatches: 1, mutations: 0, apiPreviews: 0, occurrences: [] });
  } finally { probe.dispose(); }
});
