import type { ServerResponse } from 'node:http';

import type { AdminRealtimeEvent } from '@nhdp/contracts';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';

import type { AdminRealtimeHub } from './admin-realtime-hub.js';

const HEARTBEAT_INTERVAL_MS = 15_000;
const RECONNECT_DELAY_MS = 5_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface AdminRealtimeRouteOptions {
  hub: AdminRealtimeHub;
  requireAdmin: preHandlerAsyncHookHandler;
}

function writeEvent(response: ServerResponse, event: AdminRealtimeEvent): void {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function registerAdminRealtimeRoutes(
  app: FastifyInstance,
  options: AdminRealtimeRouteOptions,
): void {
  app.get(
    '/admin/events',
    {
      preHandler: options.requireAdmin,
    },
    (request, reply) => {
      if (!request.adminSession) {
        throw new Error('Admin session was not attached by the auth guard.');
      }

      reply.hijack();

      const response = reply.raw;
      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      response.setHeader('Cache-Control', 'no-cache, no-transform');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();
      response.write(`retry: ${RECONNECT_DELAY_MS}\n`);
      response.write(': connected\n\n');

      let cleanedUp = false;
      let unsubscribe: () => void = () => undefined;
      let sessionExpiryTimer: NodeJS.Timeout | null = null;

      const heartbeatTimer = setInterval(() => {
        response.write(': heartbeat\n\n');
      }, HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref();

      const cleanup = (): void => {
        if (cleanedUp) {
          return;
        }

        cleanedUp = true;
        clearInterval(heartbeatTimer);

        if (sessionExpiryTimer) {
          clearTimeout(sessionExpiryTimer);
        }

        unsubscribe();
      };

      unsubscribe = options.hub.subscribe({
        send(event) {
          writeEvent(response, event);
        },
        close() {
          cleanup();

          if (!response.writableEnded) {
            response.end();
          }
        },
      });

      const expiresAt = Date.parse(request.adminSession.expiresAt);
      const remainingSessionMs = Math.min(Math.max(0, expiresAt - Date.now()), MAX_TIMER_DELAY_MS);

      sessionExpiryTimer = setTimeout(() => {
        cleanup();

        if (!response.writableEnded) {
          response.end();
        }
      }, remainingSessionMs);
      sessionExpiryTimer.unref();

      request.raw.once('aborted', cleanup);
      response.once('close', cleanup);
    },
  );
}
