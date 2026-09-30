import { digest, validDecision } from "./confirmation";
import { selectControl, type ControlSelection } from "./decisions";
import type { ContextSnapshotV1, ControlAuthority } from "./state";
import type { DecisionProof } from "./store";

/** Local UI authority does not need provider-context capacity. Both T5 and
 * the service use this exact construction; T4 remains the final atomic guard. */
export async function createControlProof(snapshot: ContextSnapshotV1, inbound: ContextSnapshotV1["inbound"], text: string,
  control: Extract<ControlSelection, { kind: "APPROVE" }>, authority: ControlAuthority, now: number): Promise<DecisionProof | null> {
  if (authority.kind !== "CHAT" || authority.scope.sourceInboundId !== inbound.id || authority.scope.claimMarker !== inbound.claimMarker) return null;
  const selected = selectControl(text, snapshot.pendingDecision, authority, { snapshot, now, replyReference: control.response.kind === "REPLY" ? control.response.reference : null });
  if (JSON.stringify(selected) !== JSON.stringify(control)) return null;
  const decision = snapshot.pendingDecision;
  if (!decision || Date.parse(inbound.receivedAt) < Date.parse(decision.issuedAfterInbound.receivedAt)
    || (inbound.receivedAt === decision.issuedAfterInbound.receivedAt && inbound.rowid <= decision.issuedAfterInbound.rowid)) return null;
  const seed = await digest([snapshot.scope.ownerId, snapshot.scope.chatIdentityId, snapshot.id, inbound.id, snapshot.contextRevision + 1]);
  const proof: DecisionProof = { operationKey: `operation-${seed}`, contextId: snapshot.id, contextRevision: snapshot.contextRevision,
    decisionId: decision.decisionId, kind: decision.kind, requestId: decision.target.requestId, proposalId: decision.target.proposalId,
    draftRevision: decision.draftRevision, draftHash: snapshot.previewReceipt?.draftHash ?? null, response: control.response };
  return validDecision(snapshot, proof, authority, now) ? proof : null;
}
