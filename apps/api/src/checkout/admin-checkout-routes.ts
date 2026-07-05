import {
  adminCheckoutApiErrorSchema,
  adminCheckoutPreviewResponseSchema,
  createCourtRentalRequestSchema,
  createCourtRentalResponseSchema,
  createPaymentBatchRequestSchema,
  createPaymentBatchResponseSchema,
  openAdminBillResponseSchema,
} from '@nhdp/contracts';
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';

import {
  AdminCheckoutDomainError,
  type AdminCheckoutErrorCode,
  type AdminCheckoutService,
} from './admin-checkout-service.js';

interface BillParams {
  billId?: string;
}

interface ServicePointParams {
  servicePointId?: string;
}

const identifierPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const paramsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['billId'],
  properties: { billId: { type: 'string', pattern: identifierPattern } },
} as const;

const servicePointParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['servicePointId'],
  properties: { servicePointId: { type: 'string', pattern: identifierPattern } },
} as const;
const statusByErrorCode: Record<AdminCheckoutErrorCode, number> = {
  ADMIN_SERVICE_POINT_NOT_FOUND: 404,
  ADMIN_SERVICE_POINT_INACTIVE: 409,
  ADMIN_BILL_NOT_FOUND: 404,
  ADMIN_BILL_NOT_OPEN: 409,
  COURT_RENTAL_ALREADY_EXISTS: 409,
  COURT_RENTAL_TOTAL_TOO_LARGE: 422,
  PAYMENT_ALLOCATION_INVALID: 409,
  PAYMENT_BATCH_IDEMPOTENCY_CONFLICT: 409,
  PAYMENT_TOTAL_TOO_LARGE: 422,
};

export interface AdminCheckoutRouteOptions {
  service: AdminCheckoutService;
  requireAdmin: preHandlerAsyncHookHandler;
}

function invalid(reply: FastifyReply): FastifyReply {
  return reply.code(400).send(
    adminCheckoutApiErrorSchema.parse({
      code: 'INVALID_ADMIN_CHECKOUT_REQUEST',
      message: 'Dữ liệu tạm tính hoặc thanh toán không hợp lệ.',
    }),
  );
}

function domain(reply: FastifyReply, error: AdminCheckoutDomainError): FastifyReply {
  return reply
    .code(statusByErrorCode[error.code])
    .send(adminCheckoutApiErrorSchema.parse({ code: error.code, message: error.message }));
}

export function registerAdminCheckoutRoutes(
  app: FastifyInstance,
  options: AdminCheckoutRouteOptions,
): void {
  app.post<{ Params: ServicePointParams }>(
    '/admin/service-points/:servicePointId/open-bill',
    { preHandler: options.requireAdmin, schema: { params: servicePointParamsSchema } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!request.params.servicePointId) return invalid(reply);
      if (!request.adminSession)
        throw new Error('Admin session was not attached by the auth guard.');
      try {
        return openAdminBillResponseSchema.parse(
          await options.service.openBill({
            adminUserId: request.adminSession.admin.id,
            servicePointId: request.params.servicePointId,
          }),
        );
      } catch (error) {
        if (error instanceof AdminCheckoutDomainError) return domain(reply, error);
        throw error;
      }
    },
  );

  app.get<{ Params: BillParams }>(
    '/admin/bills/:billId/checkout-preview',
    { preHandler: options.requireAdmin, schema: { params: paramsSchema } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!request.params.billId) return invalid(reply);
      try {
        return adminCheckoutPreviewResponseSchema.parse(
          await options.service.readPreview(request.params.billId),
        );
      } catch (error) {
        if (error instanceof AdminCheckoutDomainError) return domain(reply, error);
        throw error;
      }
    },
  );

  app.post<{ Params: BillParams; Body: unknown }>(
    '/admin/bills/:billId/court-rental',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: { params: paramsSchema },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const parsed = createCourtRentalRequestSchema.safeParse(request.body);
      if (request.validationError || !request.params.billId || !parsed.success)
        return invalid(reply);
      if (!request.adminSession)
        throw new Error('Admin session was not attached by the auth guard.');
      try {
        return createCourtRentalResponseSchema.parse(
          await options.service.createCourtRental({
            adminUserId: request.adminSession.admin.id,
            billId: request.params.billId,
            request: parsed.data,
          }),
        );
      } catch (error) {
        if (error instanceof AdminCheckoutDomainError) return domain(reply, error);
        throw error;
      }
    },
  );

  app.post<{ Params: BillParams; Body: unknown }>(
    '/admin/bills/:billId/payment-batches',
    {
      preHandler: options.requireAdmin,
      attachValidation: true,
      schema: { params: paramsSchema },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const parsed = createPaymentBatchRequestSchema.safeParse(request.body);
      if (request.validationError || !request.params.billId || !parsed.success)
        return invalid(reply);
      if (!request.adminSession)
        throw new Error('Admin session was not attached by the auth guard.');
      try {
        return createPaymentBatchResponseSchema.parse(
          await options.service.createPaymentBatch({
            adminUserId: request.adminSession.admin.id,
            billId: request.params.billId,
            request: parsed.data,
          }),
        );
      } catch (error) {
        if (error instanceof AdminCheckoutDomainError) return domain(reply, error);
        throw error;
      }
    },
  );
}
