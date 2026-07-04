import { authApiErrorSchema, type AuthSessionResponse } from '@nhdp/contracts';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';

import { ADMIN_SESSION_COOKIE_NAME, type AdminAuthService } from './admin-auth-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    adminSession: AuthSessionResponse | null;
    adminSessionToken: string | null;
  }
}

function authenticationRequired(reply: FastifyReply): FastifyReply {
  const error = authApiErrorSchema.parse({
    code: 'AUTHENTICATION_REQUIRED',
    message: 'Bạn cần đăng nhập để tiếp tục.',
  });

  return reply.code(401).send(error);
}

export function createRequireAdmin(service: AdminAuthService): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');

    const rawToken = request.cookies[ADMIN_SESSION_COOKIE_NAME];

    if (!rawToken) {
      authenticationRequired(reply);
      return;
    }

    const session = await service.restore(rawToken);

    if (!session) {
      authenticationRequired(reply);
      return;
    }

    request.adminSession = session;
    request.adminSessionToken = rawToken;
  };
}
