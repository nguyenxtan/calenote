import { expect, it } from "vitest";
import { buildContextInputV2 } from "./context";
import { chat, message, observation } from "./context-test-fixtures";
import { SemanticPatchProposalV3Schema } from "./contracts";
import { validateEvidenceV3 } from "./evidence";
import { projectSemanticView } from "./projection";
import { now } from "./resolution-test-support";
import { addressContextReply } from "./responses";
import { ContextSnapshotV2Schema, type ContextSnapshotV2 } from "./state";
import { transitionConversationV3 } from "./transition";

const modelQuestion = "Bạn muốn mình xử lý yêu cầu này thế nào?";
async function operationTurn(snapshot: ContextSnapshotV2 | null, index: number, model = false) {
  const text = index === 0 ? "nhắc đi thi" : "chưa rõ";
  const msg = { ...message(text), id: `input-${index}`, receivedAt: now + index * 60000 };
  const context = { ...chat, inboundRowId: index + 1 };
  const seen = observation(null, msg, context);
  const built = buildContextInputV2({ message: msg, context, snapshot,
    observation: snapshot ? { ...seen, observed: { presence: "PRESENT", contextId: snapshot.id, contextRevision: snapshot.contextRevision } } : seen });
  if (built.status !== "READY") throw new Error(built.reason);
  const evidence = [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote: text, occurrence: 1 }];
  const checked = validateEvidenceV3(SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "UNRESOLVED", evidence },
    changes: index === 0 ? [{ field: "title", operation: "SET", value: "đi thi", evidence }] : [], query: null,
    uncertainties: index === 0 ? [] : [{ field: "operation", reason: "AMBIGUOUS", alternatives: [] }] }), built);
  if (checked.status !== "VALID") throw new Error(checked.reason);
  const result = await transitionConversationV3({ snapshot, interpretation: checked.patch, control: { kind: "NONE" }, now: msg.receivedAt,
    ...(model ? { guidance: { source: "MODEL_GUIDANCE" as const, text: modelQuestion } } : {}) });
  if ("kind" in result) throw new Error(result.reason);
  return result;
}

it.each(["model", "personalized"] as const)("rebuilds a canonical operation question instead of readdressing retained %s presentation", async presentation => {
  const initial = await operationTurn(null, 0, presentation === "model");
  const presented = presentation === "model" ? initial.reply : addressContextReply(initial.reply, { addressStyle: "custom", customDisplayName: "Bạn Mình" });
  if (presented.status !== "READY") throw new Error("unrenderable");
  const projection = projectSemanticView(presented.text, []);
  if (projection.status !== "READY") throw new Error("unprojectable");
  Object.assign(initial.snapshot.transcript.at(-1)!, { text: presented.text, semanticView: projection.text, sourceMap: projection.sourceMap, controlSpans: projection.controlSpans, deliveryState: "SENT" });
  initial.snapshot.pendingReminderQuestion!.text = presented.text;
  initial.snapshot.pendingReminderQuestion!.deliveryState = "SENT";
  const before = ContextSnapshotV2Schema.parse(initial.snapshot);
  expect(before.pendingReminderQuestion!.text).toBe(presentation === "model" ? modelQuestion : "Bạn Mình muốn cập nhật yêu cầu hiện tại hay tạo yêu cầu mới?");
  const repeated = await operationTurn(before, 1);
  const addressed = addressContextReply(repeated.reply, { addressStyle: "sep", customDisplayName: null });
  expect(addressed).toMatchObject({ status: "READY", source: "BACKEND", text: "Sếp muốn cập nhật yêu cầu hiện tại hay tạo yêu cầu mới?" });
  expect(repeated.snapshot.pendingReminderQuestion?.questionId).toBe(before.pendingReminderQuestion!.questionId);
  expect(repeated.snapshot.pendingSemanticCandidate?.proposal).toEqual(before.pendingSemanticCandidate?.proposal);
});
