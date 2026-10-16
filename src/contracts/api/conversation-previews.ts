import { z } from "zod";
import { base64UrlToBytes } from "@/modules/security/encoding";
import { SlotValueSchemas } from "@/modules/conversation/context-contract/contracts";
import { CanonicalDetailsV1Schema } from "@/modules/conversation/context-contract/state";

const publicId = z.string().length(22).refine(value => base64UrlToBytes(value)?.byteLength === 16);
const revision = z.number().int().positive();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const occurrence = z.strictObject({ index: z.number().int().min(0).max(29), scheduledAt: z.number().int().nonnegative(), localDate: z.iso.date() });
export const PublicPreviewV1Schema = z.strictObject({
  publicId, draftRevision: revision, previewHash: hash, expiresAt: z.number().int().positive(),
  title: SlotValueSchemas.title, details: CanonicalDetailsV1Schema,
  occurrences: z.array(occurrence).min(1).max(30), decisionToken: z.string().min(1).max(512),
});
export const PreviewResponseV1Schema = z.strictObject({ data: z.strictObject({
  schemaVersion: z.literal("conversation-previews-1"), previews: z.array(PublicPreviewV1Schema).max(10), hasMore: z.boolean(),
}) });
export const PreviewDecisionRequestV1Schema = z.strictObject({
  schemaVersion: z.literal("conversation-previews-1"), publicId, draftRevision: revision,
  previewHash: hash, decisionToken: z.string().min(1).max(512),
  action: z.enum(["SAVE_PREVIEW", "DECLINE"]), idempotencyKey: z.string().min(1).max(128),
});
export const PreviewDecisionResponseV1Schema = z.strictObject({ data: z.strictObject({
  result: z.enum(["COMMITTED", "IDEMPOTENT", "DECLINED", "ALREADY_DECLINED"]),
  reminderPublicIds: z.array(z.string()).optional(), seriesPublicId: z.string().nullable().optional(), childCount: z.number().int().optional(),
}) });
export type PublicPreviewV1 = z.infer<typeof PublicPreviewV1Schema>;
export type PreviewDecisionRequestV1 = z.infer<typeof PreviewDecisionRequestV1Schema>;
