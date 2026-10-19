import { z } from "zod";
import { SessionUserSchema } from "./session";
export const UpdateProfileSchema = z.object({displayName:z.string().trim().min(1).max(80)}).strict();
export const ProfileResponseSchema = z.object({data:z.object({user:SessionUserSchema}).strict()}).strict();
export const PublicSessionSchema = z.object({id:z.string().min(1).max(128),createdAt:z.number().int().nonnegative(),expiresAt:z.number().int().positive(),current:z.boolean()}).strict();
export const SessionsResponseSchema = z.object({data:z.object({sessions:z.array(PublicSessionSchema).max(100)}).strict()}).strict();
export const RevokeSessionsResponseSchema = z.object({data:z.object({revoked:z.number().int().nonnegative()}).strict()}).strict();
export type PublicSession = z.infer<typeof PublicSessionSchema>;
