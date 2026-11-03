import { z } from "zod";
export const ContinueEmailRequestSchema = z.object({ email: z.string().trim().toLowerCase().max(254).email() }).strict();
export const ContinueEmailResponseSchema = z.object({ data: z.object({ next: z.enum(["SETUP", "LOGIN", "RECOVERY"]) }).strict() }).strict();
export type AuthNextStep = z.infer<typeof ContinueEmailResponseSchema>["data"]["next"];
