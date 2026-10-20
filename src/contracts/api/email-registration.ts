import { z } from "zod";

const RegistrationEmailSchema = z.string().trim().toLowerCase().max(254).email();
export const RequestEmailRegistrationSchema = z.object({
  email: RegistrationEmailSchema,
  displayName: z.string().trim().min(1).max(80),
}).strict();
export const VerifyEmailRegistrationSchema = z.object({
  challengeId: z.string().min(1).max(128),
  email: RegistrationEmailSchema,
  code: z.string().regex(/^[0-9]{6}$/u),
}).strict();
export const RequestEmailRegistrationResponseSchema = z.object({ data: z.object({
  accepted: z.literal(true),
  challengeId: z.string().min(1).max(128),
  expiresAt: z.number().int().positive(),
}).strict() }).strict();
export const VerifyEmailRegistrationResponseSchema = z.object({ data: z.object({
  registered: z.literal(true),
  next: z.literal("/app/connections"),
}).strict() }).strict();
