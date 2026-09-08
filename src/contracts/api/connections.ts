import { z } from "zod";

export const ConnectionStateSchema = z.enum(["VALIDATING", "ACTIVE_UNBOUND", "ACTIVE_BOUND", "WEBHOOK_FAILED", "SUSPENDED"]);
export const PublicConnectionSchema = z.object({
  publicId: z.string().min(1).max(128), provider: z.enum(["zalo", "telegram"]),
  displayName: z.string().min(1).max(160), handle: z.string().max(160).nullable(), state: ConnectionStateSchema,
}).strict();
export const ConnectionsResponseSchema = z.object({ data: z.object({ connections: z.array(PublicConnectionSchema) }).strict() }).strict();
export type PublicConnection = z.infer<typeof PublicConnectionSchema>;
