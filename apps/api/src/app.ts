import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

const SERVICE_NAME = '@nhdp/api';
const SERVICE_VERSION = '0.0.0';

export interface HealthResponse {
  status: 'ok';
  service: typeof SERVICE_NAME;
  version: typeof SERVICE_VERSION;
  uptimeSeconds: number;
  timestamp: string;
}

export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

  app.get('/health', () => {
    const response: HealthResponse = {
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    return response;
  });

  return app;
}
