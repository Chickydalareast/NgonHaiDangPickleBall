import { z } from 'zod';

const identifierSchema = z.string().uuid();

export const adminUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(50)
  .regex(/^[a-z0-9._-]{3,50}$/);

export const loginRequestSchema = z
  .object({
    username: adminUsernameSchema,
    password: z.string().min(1).max(200),
  })
  .strict();

export const adminIdentitySchema = z
  .object({
    id: identifierSchema,
    username: adminUsernameSchema,
    displayName: z.string().min(1).max(120),
    role: z.literal('ADMIN'),
  })
  .strict();

export const authSessionResponseSchema = z
  .object({
    admin: adminIdentitySchema,
    expiresAt: z.string().datetime(),
  })
  .strict();

export const logoutResponseSchema = z
  .object({
    success: z.literal(true),
  })
  .strict();

export const authApiErrorSchema = z
  .object({
    code: z.enum(['INVALID_AUTH_REQUEST', 'INVALID_CREDENTIALS', 'AUTHENTICATION_REQUIRED']),
    message: z.string().min(1),
  })
  .strict();

export type AdminUsername = z.infer<typeof adminUsernameSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AdminIdentity = z.infer<typeof adminIdentitySchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
export type AuthApiError = z.infer<typeof authApiErrorSchema>;
