import {
  authApiErrorSchema,
  authSessionResponseSchema,
  loginRequestSchema,
  logoutResponseSchema,
} from '@nhdp/contracts';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';

import {
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  InvalidCredentialsError,
  type AdminAuthService,
} from './admin-auth-service.js';

const loginBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['username', 'password'],
  properties: {
    username: {
      type: 'string',
      minLength: 3,
      maxLength: 50,
      pattern: '^[a-zA-Z0-9._-]{3,50}$',
    },
    password: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
    },
  },
} as const;

export interface AdminAuthRouteOptions {
  service: AdminAuthService;
  requireAdmin: preHandlerAsyncHookHandler;
  secureCookie: boolean;
}

export function registerAdminAuthRoutes(
  app: FastifyInstance,
  options: AdminAuthRouteOptions,
): void {
  const cookieOptions = {
    httpOnly: true,
    maxAge: ADMIN_SESSION_TTL_SECONDS,
    path: '/api',
    sameSite: 'strict' as const,
    secure: options.secureCookie,
  };

  app.post<{ Body: unknown }>(
    '/auth/login',
    {
      attachValidation: true,
      schema: {
        body: loginBodySchema,
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');

      if (request.validationError) {
        const error = authApiErrorSchema.parse({
          code: 'INVALID_AUTH_REQUEST',
          message: 'Thông tin đăng nhập không hợp lệ.',
        });

        return reply.code(400).send(error);
      }

      const parsedRequest = loginRequestSchema.safeParse(request.body);

      if (!parsedRequest.success) {
        const error = authApiErrorSchema.parse({
          code: 'INVALID_AUTH_REQUEST',
          message: 'Thông tin đăng nhập không hợp lệ.',
        });

        return reply.code(400).send(error);
      }

      try {
        const result = await options.service.login(parsedRequest.data);

        reply.setCookie(ADMIN_SESSION_COOKIE_NAME, result.rawToken, cookieOptions);

        return authSessionResponseSchema.parse(result.session);
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          const payload = authApiErrorSchema.parse({
            code: 'INVALID_CREDENTIALS',
            message: 'Tên tài khoản hoặc mật khẩu không đúng.',
          });

          return reply.code(401).send(payload);
        }

        throw error;
      }
    },
  );

  app.get('/auth/session', { preHandler: options.requireAdmin }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');

    if (!request.adminSession) {
      throw new Error('Admin session was not attached by the auth guard.');
    }

    return authSessionResponseSchema.parse(request.adminSession);
  });

  app.post('/auth/logout', { preHandler: options.requireAdmin }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');

    if (!request.adminSessionToken) {
      throw new Error('Admin session token was not attached by the auth guard.');
    }

    await options.service.revoke(request.adminSessionToken);
    reply.clearCookie(ADMIN_SESSION_COOKIE_NAME, {
      httpOnly: cookieOptions.httpOnly,
      path: cookieOptions.path,
      sameSite: cookieOptions.sameSite,
      secure: cookieOptions.secure,
    });

    return logoutResponseSchema.parse({ success: true });
  });
}
