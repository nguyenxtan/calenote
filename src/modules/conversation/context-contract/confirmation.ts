import { z } from "zod";
import { CanonicalDetailsV1Schema, ContextSnapshotV1Schema, ContextSnapshotV2Schema, type ContextSnapshotV1, type ContextSnapshotV2, type ControlAuthority } from "./state";
import type { CanonicalPreview, DecisionProof } from "./store";
import { resolveRequest } from "./resolve";
import { lunarCalendar } from "../lunar-calendar";
import { renderReminderDetails } from "@/modules/reminders/detail-presentation";
import { SlotValueSchemas } from "./contracts";
import { requiresBoundPreviewConfirmation } from "./preview-control";
export const CanonicalPreviewSchema = z.strictObject({ schemaVersion: z.literal("calenote-context-preview-1"),
  title: SlotValueSchemas.title, details: CanonicalDetailsV1Schema,
  occurrences: z.array(z.strictObject({ index: z.number().int().min(0).max(29), scheduledAt: z.number().int().nonnegative(), localDate: z.iso.date() })).min(1).max(30),
  prefix: z.string().max(2000), suffix: z.string().max(2000) });
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function previewHash(preview: CanonicalPreview): Promise<string> {
  return digest(CanonicalPreviewSchema.parse(preview));
}
/** A retained preview cannot originate after the snapshot containing it, and
 * SAVE authority can be issued with/after that preview, never before it. */
export function validPreviewOrder(snapshot: ContextSnapshotV1 | ContextSnapshotV2): boolean {
  const p = snapshot.previewReceipt;
  if (!p) return true;
  const after = (a: {receivedAt:string;rowid:number}, b: {receivedAt:string;rowid:number}) =>
    Date.parse(a.receivedAt) > Date.parse(b.receivedAt)
    || (Date.parse(a.receivedAt) === Date.parse(b.receivedAt) && a.rowid > b.rowid);
  const issued = Date.parse(p.issuedAfterOrder.receivedAt);
  return issued >= Date.parse(snapshot.createdAt) && issued < Date.parse(p.expiresAt)
    && !after(p.issuedAfterOrder, snapshot.inbound)
    && (snapshot.pendingDecision?.kind !== "SAVE_PREVIEW"
      || !after(p.issuedAfterOrder, snapshot.pendingDecision.issuedAfterInbound));
}
export function validPreview(snapshot: ContextSnapshotV1 | ContextSnapshotV2, preview: CanonicalPreview, now: number): boolean {
  const parsed = CanonicalPreviewSchema.safeParse(preview);
  if (!parsed.success || !(snapshot.schemaVersion === "calenote-context-state-2" ? ContextSnapshotV2Schema : ContextSnapshotV1Schema).safeParse(snapshot).success || !validPreviewOrder(snapshot)) return false;
  const resolved = resolveRequest(snapshot, now, lunarCalendar);
  return resolved.status === "READY" && preview.title === snapshot.slots.title.value
    && JSON.stringify(parsed.data.details) === JSON.stringify(CanonicalDetailsV1Schema.parse(resolved.details))
    && JSON.stringify(parsed.data.occurrences) === JSON.stringify(resolved.occurrences)
    && renderReminderDetails(preview.title, preview.details, preview.occurrences, preview.prefix.length + preview.suffix.length).status === "COMPLETE";
}
/** No language interpretation here: only exact application controls. Database
 * ownership, inbound order, session and revision are rechecked in the batch. */
export function validDecision(snapshot: ContextSnapshotV1 | ContextSnapshotV2, proof: DecisionProof, authority: ControlAuthority, now: number): boolean {
  const d = snapshot.pendingDecision;
  const owner = authority.kind === "CHAT" ? authority.scope.ownerId : authority.principal.userId;
  const chat = authority.kind === "CHAT" ? authority.scope.chatIdentityId : authority.chat.chatIdentityId;
  if (!d || !Number.isSafeInteger(now) || !proof.operationKey || proof.operationKey.length > 512
    || owner !== snapshot.scope.ownerId || chat !== snapshot.scope.chatIdentityId
    || proof.contextId !== snapshot.id || proof.contextRevision !== snapshot.contextRevision
    || proof.decisionId !== d.decisionId || proof.kind !== d.kind || proof.requestId !== d.target.requestId
    || proof.proposalId !== d.target.proposalId || proof.draftRevision !== d.draftRevision
    || d.deliveryState !== "SENT" || Math.min(Date.parse(d.expiresAt), Date.parse(snapshot.idleExpiresAt), Date.parse(snapshot.absoluteExpiresAt), snapshot.draftExpiresAt ? Date.parse(snapshot.draftExpiresAt) : Infinity) <= now) return false;
  if (authority.kind === "WEB" && (authority.principal.expiresAt <= now || authority.chat.ownerId !== owner
    || JSON.stringify(authority.chat) !== JSON.stringify(snapshot.scope) || proof.response.kind !== "TOKEN")) return false;
  const response = proof.response;
  if (response.kind === "TOKEN") return response.handle === d.tokenHandle && snapshot.controlRegistry.some(c => c.handle === response.handle && c.decisionId === d.decisionId && c.contextRevision === d.contextRevision && c.draftRevision === d.draftRevision && Date.parse(c.expiresAt) > now);
  if (response.kind === "REPLY") return authority.kind === "CHAT" && response.reference === d.replyReference && d.replyReference !== null;
  if (authority.kind !== "CHAT" || (d.kind === "SAVE_PREVIEW" && requiresBoundPreviewConfirmation(snapshot))) return false;
  const normalized = response.text.normalize("NFC").trim().toLocaleLowerCase("vi").replace(/[.!]$/u, "");
  return d.acceptedReplies.some(reply => reply === normalized);
}
export async function validateConfirmation(snapshot: ContextSnapshotV1 | ContextSnapshotV2, preview: CanonicalPreview, proof: DecisionProof, authority: ControlAuthority, now: number): Promise<boolean> {
  if (proof.kind !== "SAVE_PREVIEW" || snapshot.lifecycle !== "AWAITING_CONFIRMATION"
    || !validDecision(snapshot, proof, authority, now) || !validPreview(snapshot, preview, now)) return false;
  const p = snapshot.previewReceipt;
  const selected = snapshot.transcript.filter(t => t.role === "ASSISTANT").at(-1);
  const rendered = renderReminderDetails(preview.title, preview.details, preview.occurrences, preview.prefix.length + preview.suffix.length);
  if (!selected || selected.role !== "ASSISTANT" || selected.kind !== "PREVIEW" || selected.deliveryState !== "SENT"
    || selected.id !== p?.previewId || rendered.status !== "COMPLETE" || selected.text !== preview.prefix + rendered.text + preview.suffix) return false;
  if (proof.response.kind === "TOKEN" && !selected.controlSpans.some(c => c.handle === snapshot.pendingDecision!.tokenHandle)) return false;
  return !!p && p.deliveryState === "SENT" && p.previewId === snapshot.pendingDecision!.previewId
    && p.draftRevision === proof.draftRevision && p.draftHash === proof.draftHash
    && p.draftHash === await previewHash(preview) && Date.parse(p.expiresAt) > now;
}
