import { expect, it } from "vitest";
import { renderReminderDetails } from "@/modules/reminders/detail-presentation";
import { previewHash, validateConfirmation } from "./confirmation";
import { addConfirmationToken, confirmationFixture } from "./confirmation-test-support";
import { projectSemanticView } from "./projection";
import { now } from "./resolution-test-support";
import { ContextSnapshotV1Schema, ContextSnapshotV2Schema, type ControlAuthority } from "./state";

/** Keep the issued web handle and receipt, while presenting only natural chat controls. */
async function hiddenControlFixture() {
  const f = await confirmationFixture();
  await addConfirmationToken(f);
  f.preview.suffix = "\nTrả lời Có hoặc Không.";
  const rendered = renderReminderDetails(f.preview.title, f.preview.details, f.preview.occurrences, f.preview.prefix.length + f.preview.suffix.length);
  if (rendered.status !== "COMPLETE") throw new Error("preview cannot render");
  const text = f.preview.prefix + rendered.text + f.preview.suffix;
  const projection = projectSemanticView(text, [f.snapshot.pendingDecision!.tokenHandle!]);
  if (projection.status !== "READY") throw new Error("preview cannot project");
  Object.assign(f.snapshot.transcript.at(-1)!, { text, semanticView: projection.text, controlSpans: projection.controlSpans, sourceMap: projection.sourceMap });
  const hash = await previewHash(f.preview);
  f.snapshot.previewReceipt!.draftHash = hash;
  f.proof.draftHash = hash;
  const snapshot = ContextSnapshotV2Schema.parse({ ...f.snapshot, schemaVersion: "calenote-context-state-2", pendingSemanticCandidate: null,
    pendingDecision: { ...f.snapshot.pendingDecision, deliveredAt: new Date(now).toISOString() } });
  const web: ControlAuthority = { kind: "WEB", principal: { sessionId: "session", userId: snapshot.scope.ownerId, expiresAt: now + 60000 }, chat: snapshot.scope };
  return { ...f, snapshot, web };
}

it("accepts a current owner-authenticated web token without printing it in the sent preview", async () => {
  const f = await hiddenControlFixture();
  expect(f.snapshot.transcript.at(-1)!.text).not.toContain("CN-");
  expect(f.snapshot.transcript.at(-1)!.controlSpans).toEqual([]);
  expect(await validateConfirmation(f.snapshot, f.preview, f.proof, f.web, now + 1)).toBe(true);
});

it("rejects a wrong web token even when the current preview and session match", async () => {
  const f = await hiddenControlFixture();
  expect(await validateConfirmation(f.snapshot, f.preview, { ...f.proof, response: { kind: "TOKEN", handle: "CN-wrong-token" } }, f.web, now + 1)).toBe(false);
});

it("rejects an earlier web token proof after the current context revision advances", async () => {
  const f = await hiddenControlFixture();
  const snapshot = ContextSnapshotV2Schema.parse({ ...f.snapshot, contextRevision: 2,
    pendingDecision: { ...f.snapshot.pendingDecision, contextRevision: 2 },
    controlRegistry: f.snapshot.controlRegistry.map(control => ({ ...control, contextRevision: 2 })) });
  expect(await validateConfirmation(snapshot, f.preview, f.proof, f.web, now + 1)).toBe(false);
});

it("rejects a hidden web handle submitted as an addressed chat token", async () => {
  const f = await hiddenControlFixture();
  expect(await validateConfirmation(f.snapshot, f.preview, f.proof, f.authority, now + 1)).toBe(false);
});

it("preserves an old displayed chat token and its visible receipt authority", async () => {
  const f = await confirmationFixture();
  await addConfirmationToken(f);
  expect(ContextSnapshotV1Schema.safeParse(f.snapshot).success).toBe(true);
  expect(f.snapshot.transcript.at(-1)!.controlSpans).toMatchObject([{ handle: "CN-test-token" }]);
  expect(await validateConfirmation(f.snapshot, f.preview, f.proof, f.authority, now + 1)).toBe(true);
});

it("accepts a separate natural Có after the current V2 preview was sent", async () => {
  const f = await hiddenControlFixture();
  expect(await validateConfirmation(f.snapshot, f.preview, { ...f.proof, response: { kind: "BARE", text: "Có." } }, f.authority, now + 1)).toBe(true);
});
