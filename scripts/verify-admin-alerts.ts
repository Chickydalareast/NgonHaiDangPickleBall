import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  acknowledgeAdminAlertResponseSchema,
  adminAlertsResponseSchema,
  adminBillDetailResponseSchema,
  adminRealtimeEventSchema,
  authSessionResponseSchema,
  createOrderResponseSchema,
  createPublicServiceRequestResponseSchema,
  resolveAdminServiceRequestResponseSchema,
  type AdminRealtimeEvent,
} from '../packages/contracts/dist/index.js';
import { parse } from 'dotenv';
import { Pool } from 'pg';
import { z } from 'zod';

const localEnvironment = existsSync('.env')
  ? parse(readFileSync('.env'))
  : parse(readFileSync('.env.example'));

const environmentSchema = z.object({
  ADMIN_SEED_PASSWORD: z.string().min(16).max(200),
  ADMIN_SEED_USERNAME: z.string().regex(/^[a-z0-9._-]{3,50}$/),
  CADDY_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
});
const environment = environmentSchema.parse(localEnvironment);
const baseUrl = `http://127.0.0.1:${environment.CADDY_HTTP_PORT}`;

function hashToken(rawToken: string): string {
  return createHmac('sha256', environment.SESSION_SECRET).update(rawToken).digest('hex');
}

async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), 15_000);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function createEventReader(response: Response) {
  if (!response.body) {
    throw new Error('SSE response did not provide a body stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    async next(expectedType: AdminRealtimeEvent['type']): Promise<AdminRealtimeEvent> {
      while (true) {
        while (buffer.includes('\n\n')) {
          const boundary = buffer.indexOf('\n\n');
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const lines = block.split('\n');
          const eventName = lines.find((line) => line.startsWith('event: '))?.slice(7);
          const data = lines.find((line) => line.startsWith('data: '))?.slice(6);

          if (eventName === expectedType && data) {
            return adminRealtimeEventSchema.parse(JSON.parse(data) as unknown);
          }
        }

        const chunk = await reader.read();

        if (chunk.done) {
          throw new Error(`SSE connection closed before ${expectedType} was received.`);
        }

        buffer += decoder.decode(chunk.value, { stream: true }).replaceAll('\r\n', '\n');
      }
    },
  };
}

async function cleanupStaleVerifierArtifacts(pool: Pool): Promise<void> {
  await pool.query('BEGIN');

  try {
    await pool.query(`
      DELETE FROM activity_logs
      WHERE entity_id IN (
        SELECT id
        FROM orders
        WHERE service_point_id IN (
          SELECT id FROM service_points WHERE slug LIKE 'verify-alert-%'
        )
        UNION
        SELECT id
        FROM service_requests
        WHERE service_point_id IN (
          SELECT id FROM service_points WHERE slug LIKE 'verify-alert-%'
        )
        UNION
        SELECT id
        FROM bills
        WHERE service_point_id IN (
          SELECT id FROM service_points WHERE slug LIKE 'verify-alert-%'
        )
      )
      OR metadata ->> 'servicePointId' IN (
        SELECT id::text FROM service_points WHERE slug LIKE 'verify-alert-%'
      )
    `);
    await pool.query(`
      DELETE FROM order_line_settlements
      WHERE bill_id IN (
        SELECT id
        FROM bills
        WHERE service_point_id IN (
          SELECT id FROM service_points WHERE slug LIKE 'verify-alert-%'
        )
      )
    `);
    await pool.query(`
      DELETE FROM order_lines
      WHERE bill_id IN (
        SELECT id
        FROM bills
        WHERE service_point_id IN (
          SELECT id FROM service_points WHERE slug LIKE 'verify-alert-%'
        )
      )
    `);
    await pool.query(`
      DELETE FROM orders
      WHERE service_point_id IN (
        SELECT id FROM service_points WHERE slug LIKE 'verify-alert-%'
      )
    `);
    await pool.query(`
      DELETE FROM service_requests
      WHERE service_point_id IN (
        SELECT id FROM service_points WHERE slug LIKE 'verify-alert-%'
      )
    `);
    await pool.query(`
      DELETE FROM bills
      WHERE service_point_id IN (
        SELECT id FROM service_points WHERE slug LIKE 'verify-alert-%'
      )
    `);
    await pool.query(`DELETE FROM service_points WHERE slug LIKE 'verify-alert-%'`);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: 2,
    application_name: 'nhdp-stepx-alert-http-verifier',
  });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const servicePointSlug = `verify-alert-${suffix}`;
  const abortController = new AbortController();
  let servicePointId: string | null = null;
  let orderId: string | null = null;
  let serviceRequestId: string | null = null;
  let sessionTokenHash: string | null = null;

  try {
    await cleanupStaleVerifierArtifacts(pool);

    const venue = (
      await pool.query<{ id: string }>(
        `SELECT id FROM venues WHERE slug = 'ngon-hai-dang-pickleball' LIMIT 1`,
      )
    ).rows[0];
    const item = (
      await pool.query<{ id: string }>(
        `SELECT id FROM catalog_items WHERE is_available = TRUE ORDER BY created_at, id LIMIT 1`,
      )
    ).rows[0];
    assert.ok(venue);
    assert.ok(item);

    servicePointId =
      (
        await pool.query<{ id: string }>(
          `
            INSERT INTO service_points (venue_id, code, name, slug, status, sort_order)
            VALUES ($1, $2, $3, $4, 'ACTIVE', 9999)
            RETURNING id
          `,
          [venue.id, `ALERT-${suffix}`, 'Sân kiểm thử cảnh báo', servicePointSlug],
        )
      ).rows[0]?.id ?? null;
    assert.ok(servicePointId);

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: environment.ADMIN_SEED_USERNAME,
        password: environment.ADMIN_SEED_PASSWORD,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(loginResponse.status, 200);
    authSessionResponseSchema.parse(await loginResponse.json());
    const setCookie = loginResponse.headers.get('set-cookie');
    assert.ok(setCookie);
    const cookiePair = setCookie.split(';')[0];
    assert.ok(cookiePair);
    sessionTokenHash = hashToken(cookiePair.slice(cookiePair.indexOf('=') + 1));

    const eventResponse = await fetch(`${baseUrl}/api/admin/events`, {
      headers: { Accept: 'text/event-stream', Cookie: cookiePair },
      signal: abortController.signal,
    });
    assert.equal(eventResponse.status, 200);
    const eventReader = createEventReader(eventResponse);

    const orderCreatedEventPromise = withTimeout(
      eventReader.next('order.created'),
      'Timed out waiting for order.created.',
    );
    const orderResponse = await fetch(
      `${baseUrl}/api/public/service-points/${servicePointSlug}/orders`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: randomUUID(),
          note: 'HTTP verifier realtime alert',
          items: [{ catalogItemId: item.id, quantity: 2 }],
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(orderResponse.status, 201);
    const order = createOrderResponseSchema.parse(await orderResponse.json());
    orderId = order.order.id;
    assert.equal((await orderCreatedEventPromise).type, 'order.created');

    const serviceRequestCreatedEventPromise = withTimeout(
      eventReader.next('service-request.created'),
      'Timed out waiting for service-request.created.',
    );
    const serviceRequestResponse = await fetch(
      `${baseUrl}/api/public/service-points/${servicePointSlug}/service-requests`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Cần hỗ trợ kiểm thử cảnh báo' }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(serviceRequestResponse.status, 201);
    const serviceRequest = createPublicServiceRequestResponseSchema.parse(
      await serviceRequestResponse.json(),
    );
    serviceRequestId = serviceRequest.request.id;
    assert.equal((await serviceRequestCreatedEventPromise).type, 'service-request.created');

    const activeResponse = await fetch(`${baseUrl}/api/admin/alerts`, {
      headers: { Accept: 'application/json', Cookie: cookiePair },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(activeResponse.status, 200);
    const active = adminAlertsResponseSchema.parse(await activeResponse.json());
    const verifierAlerts = active.alerts.filter(
      (alert) => alert.servicePoint.id === servicePointId,
    );
    assert.equal(verifierAlerts.length, 2);
    assert.equal(verifierAlerts[0]?.kind, 'SERVICE_REQUEST');
    assert.equal(verifierAlerts[1]?.kind, 'ORDER');

    const unauthorizedAcknowledge = await fetch(
      `${baseUrl}/api/admin/alerts/orders/${orderId}/acknowledge`,
      { method: 'PATCH', signal: AbortSignal.timeout(15_000) },
    );
    assert.equal(unauthorizedAcknowledge.status, 401);

    const orderAcknowledgedEventPromise = withTimeout(
      eventReader.next('order.alert-acknowledged'),
      'Timed out waiting for order.alert-acknowledged.',
    );
    const acknowledgeOrderResponse = await fetch(
      `${baseUrl}/api/admin/alerts/orders/${orderId}/acknowledge`,
      {
        method: 'PATCH',
        headers: { Accept: 'application/json', Cookie: cookiePair },
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(acknowledgeOrderResponse.status, 200);
    const acknowledgedOrder = acknowledgeAdminAlertResponseSchema.parse(
      await acknowledgeOrderResponse.json(),
    );
    assert.equal(acknowledgedOrder.replayed, false);
    assert.equal((await orderAcknowledgedEventPromise).type, 'order.alert-acknowledged');

    const replayOrderResponse = await fetch(
      `${baseUrl}/api/admin/alerts/orders/${orderId}/acknowledge`,
      {
        method: 'PATCH',
        headers: { Accept: 'application/json', Cookie: cookiePair },
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(replayOrderResponse.status, 200);
    assert.equal(
      acknowledgeAdminAlertResponseSchema.parse(await replayOrderResponse.json()).replayed,
      true,
    );

    const requestAcknowledgedEventPromise = withTimeout(
      eventReader.next('service-request.alert-acknowledged'),
      'Timed out waiting for service-request.alert-acknowledged.',
    );
    const acknowledgeRequestResponse = await fetch(
      `${baseUrl}/api/admin/alerts/service-requests/${serviceRequestId}/acknowledge`,
      {
        method: 'PATCH',
        headers: { Accept: 'application/json', Cookie: cookiePair },
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(acknowledgeRequestResponse.status, 200);
    assert.equal(
      acknowledgeAdminAlertResponseSchema.parse(await acknowledgeRequestResponse.json()).replayed,
      false,
    );
    assert.equal(
      (await requestAcknowledgedEventPromise).type,
      'service-request.alert-acknowledged',
    );

    const acknowledgedResponse = await fetch(`${baseUrl}/api/admin/alerts`, {
      headers: { Accept: 'application/json', Cookie: cookiePair },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(acknowledgedResponse.status, 200);
    const acknowledgedAlerts = adminAlertsResponseSchema
      .parse(await acknowledgedResponse.json())
      .alerts.filter((alert) => alert.servicePoint.id === servicePointId);
    assert.equal(acknowledgedAlerts.length, 2);
    assert.equal(
      acknowledgedAlerts.every((alert) => alert.acknowledgedAt !== null),
      true,
    );

    const acceptOrderResponse = await fetch(`${baseUrl}/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: cookiePair,
      },
      body: JSON.stringify({ status: 'ACCEPTED' }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(acceptOrderResponse.status, 200);
    adminBillDetailResponseSchema.parse(await acceptOrderResponse.json());

    const resolveRequestResponse = await fetch(
      `${baseUrl}/api/admin/service-requests/${serviceRequestId}/resolve`,
      {
        method: 'PATCH',
        headers: { Accept: 'application/json', Cookie: cookiePair },
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.equal(resolveRequestResponse.status, 200);
    resolveAdminServiceRequestResponseSchema.parse(await resolveRequestResponse.json());

    const finalResponse = await fetch(`${baseUrl}/api/admin/alerts`, {
      headers: { Accept: 'application/json', Cookie: cookiePair },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(finalResponse.status, 200);
    const finalAlerts = adminAlertsResponseSchema
      .parse(await finalResponse.json())
      .alerts.filter((alert) => alert.servicePoint.id === servicePointId);
    assert.deepEqual(finalAlerts, []);

    abortController.abort();

    console.log(`Admin realtime alert HTTP verification PASS: ${baseUrl}`);
    console.log(
      JSON.stringify(
        {
          servicePointId,
          orderId,
          serviceRequestId,
          priorityOrder: verifierAlerts.map((alert) => alert.kind),
          acknowledgementReplay: true,
          finalActiveAlerts: finalAlerts.length,
        },
        null,
        2,
      ),
    );
  } finally {
    abortController.abort();

    try {
      if (sessionTokenHash) {
        await pool.query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [sessionTokenHash]);
      }

      if (servicePointId) {
        await pool.query(
          `
            DELETE FROM activity_logs
            WHERE entity_id IN (
              SELECT id FROM orders WHERE service_point_id = $1
              UNION
              SELECT id FROM service_requests WHERE service_point_id = $1
              UNION
              SELECT id FROM bills WHERE service_point_id = $1
            )
            OR metadata ->> 'servicePointId' = $2
          `,
          [servicePointId, servicePointId],
        );
        await pool.query(
          `
            DELETE FROM order_line_settlements
            WHERE bill_id IN (SELECT id FROM bills WHERE service_point_id = $1)
          `,
          [servicePointId],
        );
        await pool.query(
          `DELETE FROM order_lines WHERE bill_id IN (SELECT id FROM bills WHERE service_point_id = $1)`,
          [servicePointId],
        );
        await pool.query(`DELETE FROM orders WHERE service_point_id = $1`, [servicePointId]);
        await pool.query(`DELETE FROM service_requests WHERE service_point_id = $1`, [
          servicePointId,
        ]);
        await pool.query(`DELETE FROM bills WHERE service_point_id = $1`, [servicePointId]);
        await pool.query(`DELETE FROM service_points WHERE id = $1`, [servicePointId]);
      }

      const remainingVerifierServicePoints = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM service_points WHERE slug LIKE 'verify-alert-%'`,
      );
      assert.equal(Number(remainingVerifierServicePoints.rows[0]?.count ?? '0'), 0);
      console.log('Admin realtime alert cleanup PASS.');
    } finally {
      await pool.end();
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
