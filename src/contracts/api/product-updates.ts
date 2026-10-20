import { z } from "zod";
export const ReleaseNoteSchema = z.object({
 id:z.string().min(1).max(100), commit:z.string().regex(/^[a-f0-9]{40}$/u).nullable(),
 releasedAt:z.string().datetime({offset:true}).nullable(), title:z.string().min(1).max(150),
 summary:z.string().min(1).max(500), kind:z.enum(["Sửa lỗi","Tính năng"]),
 changes:z.array(z.string().min(1).max(1000)).min(1).max(15),
 memberChanges:z.array(z.string().min(1).max(1000)).min(1).max(15),
 verification:z.string().min(1).max(2000), caveat:z.string().max(2000).optional(),
}).strict();
export const ReleaseCatalogSchema=z.object({latestId:z.string().min(1).max(100),notes:z.array(ReleaseNoteSchema).min(1).max(100)}).strict()
 .refine(value=>value.notes[0].id===value.latestId&&new Set(value.notes.map(note=>note.id)).size===value.notes.length,"Invalid release ordering");
export const ServingReleaseSchema=z.discriminatedUnion('status',[
 z.object({status:z.literal('SERVING'),versionId:z.string().uuid(),tag:z.string().regex(/^[a-f0-9]{40}$/u).nullable()}).strict(),
 z.object({status:z.literal('NON_PRODUCTION')}).strict(),
 z.object({status:z.literal('UNKNOWN')}).strict(),
]);
export type ServingRelease=z.infer<typeof ServingReleaseSchema>;
export const ProductUpdatesSchema=z.object({readerId:z.string().min(1).max(128),catalog:ReleaseCatalogSchema,runtime:ServingReleaseSchema.optional()}).strict();
export type ReleaseNote=z.infer<typeof ReleaseNoteSchema>;
export type ReleaseCatalog=z.infer<typeof ReleaseCatalogSchema>;
