import {
  acknowledgeAdminAlertResponseSchema,
  addAdminBillItemRequestSchema,
  adminAlertApiErrorSchema,
  adminAlertsResponseSchema,
  adminBillCompletionApiErrorSchema,
  adminCheckoutApiErrorSchema,
  adminCheckoutPreviewResponseSchema,
  adminBillDetailResponseSchema,
  adminCatalogApiErrorSchema,
  adminCatalogImageUploadSignatureResponseSchema,
  adminCatalogResponseSchema,
  adminCustomChargeApiErrorSchema,
  adminDashboardResponseSchema,
  adminOrderOperationApiErrorSchema,
  adminServicePointsApiErrorSchema,
  adminServicePointsResponseSchema,
  adminSettlementApiErrorSchema,
  attachAdminCatalogItemImageRequestSchema,
  authApiErrorSchema,
  authSessionResponseSchema,
  completeAdminBillRequestSchema,
  completeAdminBillResponseSchema,
  createCourtRentalRequestSchema,
  createCourtRentalResponseSchema,
  createPaymentBatchRequestSchema,
  createPaymentBatchResponseSchema,
  createAdminCatalogCategoryRequestSchema,
  createAdminCatalogItemRequestSchema,
  createAdminCustomChargeRequestSchema,
  createAdminServicePointRequestSchema,
  createAdminSettlementRequestSchema,
  loginRequestSchema,
  logoutResponseSchema,
  openAdminBillResponseSchema,
  resolveAdminServiceRequestResponseSchema,
  reverseAdminSettlementRequestSchema,
  serviceRequestApiErrorSchema,
  updateAdminCatalogCategoryRequestSchema,
  updateAdminCatalogItemRequestSchema,
  updateAdminCustomChargeRequestSchema,
  updateAdminOrderLineRequestSchema,
  updateAdminOrderStatusRequestSchema,
  updateAdminServicePointRequestSchema,
  voidAdminCustomChargeRequestSchema,
  voidAdminOrderLineRequestSchema,
  type AcknowledgeAdminAlertResponse,
  type AddAdminBillItemRequest,
  type AdminAlertsResponse,
  type AdminBillDetailResponse,
  type AdminCheckoutPreviewResponse,
  type AdminCatalogImageUploadSignatureResponse,
  type AdminCatalogResponse,
  type AdminDashboardResponse,
  type AdminServicePointsResponse,
  type AttachAdminCatalogItemImageRequest,
  type AuthSessionResponse,
  type CompleteAdminBillRequest,
  type CompleteAdminBillResponse,
  type CreateCourtRentalRequest,
  type CreateCourtRentalResponse,
  type CreatePaymentBatchRequest,
  type CreatePaymentBatchResponse,
  type CreateAdminCatalogCategoryRequest,
  type CreateAdminCatalogItemRequest,
  type CreateAdminCustomChargeRequest,
  type CreateAdminServicePointRequest,
  type CreateAdminSettlementRequest,
  type LoginRequest,
  type LogoutResponse,
  type OpenAdminBillResponse,
  type ResolveAdminServiceRequestResponse,
  type ReverseAdminSettlementRequest,
  type UpdateAdminCatalogCategoryRequest,
  type UpdateAdminCatalogItemRequest,
  type UpdateAdminCustomChargeRequest,
  type UpdateAdminOrderLineRequest,
  type UpdateAdminOrderStatusRequest,
  type UpdateAdminServicePointRequest,
  type VoidAdminCustomChargeRequest,
  type VoidAdminOrderLineRequest,
} from '@nhdp/contracts';

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    throw new AdminApiError(
      response.status,
      'INVALID_SERVER_RESPONSE',
      'Máy chủ trả về dữ liệu không hợp lệ.',
    );
  }

  return response.json() as Promise<unknown>;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  });
  const body = await readJson(response);

  if (!response.ok) {
    const authError = authApiErrorSchema.safeParse(body);
    if (authError.success) {
      throw new AdminApiError(response.status, authError.data.code, authError.data.message);
    }

    const alertError = adminAlertApiErrorSchema.safeParse(body);
    if (alertError.success) {
      throw new AdminApiError(response.status, alertError.data.code, alertError.data.message);
    }

    const operationError = adminOrderOperationApiErrorSchema.safeParse(body);
    if (operationError.success) {
      throw new AdminApiError(
        response.status,
        operationError.data.code,
        operationError.data.message,
      );
    }

    const checkoutError = adminCheckoutApiErrorSchema.safeParse(body);
    if (checkoutError.success) {
      throw new AdminApiError(response.status, checkoutError.data.code, checkoutError.data.message);
    }

    const completionError = adminBillCompletionApiErrorSchema.safeParse(body);
    if (completionError.success) {
      throw new AdminApiError(
        response.status,
        completionError.data.code,
        completionError.data.message,
      );
    }

    const serviceRequestError = serviceRequestApiErrorSchema.safeParse(body);
    if (serviceRequestError.success) {
      throw new AdminApiError(
        response.status,
        serviceRequestError.data.code,
        serviceRequestError.data.message,
      );
    }

    const catalogError = adminCatalogApiErrorSchema.safeParse(body);
    if (catalogError.success) {
      throw new AdminApiError(response.status, catalogError.data.code, catalogError.data.message);
    }

    const customChargeError = adminCustomChargeApiErrorSchema.safeParse(body);
    if (customChargeError.success) {
      throw new AdminApiError(
        response.status,
        customChargeError.data.code,
        customChargeError.data.message,
      );
    }

    const settlementError = adminSettlementApiErrorSchema.safeParse(body);
    if (settlementError.success) {
      throw new AdminApiError(
        response.status,
        settlementError.data.code,
        settlementError.data.message,
      );
    }

    const servicePointError = adminServicePointsApiErrorSchema.safeParse(body);
    if (servicePointError.success) {
      throw new AdminApiError(
        response.status,
        servicePointError.data.code,
        servicePointError.data.message,
      );
    }

    throw new AdminApiError(
      response.status,
      'ADMIN_REQUEST_FAILED',
      'Không thể xử lý yêu cầu quản trị.',
    );
  }

  return body;
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function loginAdmin(values: LoginRequest): Promise<AuthSessionResponse> {
  const payload = loginRequestSchema.parse(values);
  return authSessionResponseSchema.parse(
    await request('/api/auth/login', jsonRequest('POST', payload)),
  );
}

export async function getAdminSession(): Promise<AuthSessionResponse> {
  return authSessionResponseSchema.parse(await request('/api/auth/session'));
}

export async function logoutAdmin(): Promise<LogoutResponse> {
  return logoutResponseSchema.parse(await request('/api/auth/logout', { method: 'POST' }));
}

export async function getAdminDashboard(): Promise<AdminDashboardResponse> {
  return adminDashboardResponseSchema.parse(await request('/api/admin/dashboard'));
}

export async function getAdminAlerts(): Promise<AdminAlertsResponse> {
  return adminAlertsResponseSchema.parse(await request('/api/admin/alerts'));
}

export async function acknowledgeAdminOrderAlert(
  orderId: string,
): Promise<AcknowledgeAdminAlertResponse> {
  return acknowledgeAdminAlertResponseSchema.parse(
    await request(`/api/admin/alerts/orders/${encodeURIComponent(orderId)}/acknowledge`, {
      method: 'PATCH',
    }),
  );
}

export async function acknowledgeAdminBillOrderAlerts(billId: string): Promise<number> {
  const alerts = await getAdminAlerts();
  const orderIds: string[] = [];

  for (const alert of alerts.alerts) {
    if (alert.kind === 'ORDER' && alert.billId === billId && alert.acknowledgedAt === null) {
      orderIds.push(alert.orderId);
    }
  }

  await Promise.all(
    orderIds.map(async (orderId) => {
      try {
        await acknowledgeAdminOrderAlert(orderId);
      } catch (error) {
        if (error instanceof AdminApiError && error.code === 'ADMIN_ALERT_NOT_ACTIVE') {
          return;
        }

        throw error;
      }
    }),
  );

  return orderIds.length;
}

export async function acknowledgeAdminServiceRequestAlert(
  requestId: string,
): Promise<AcknowledgeAdminAlertResponse> {
  return acknowledgeAdminAlertResponseSchema.parse(
    await request(
      `/api/admin/alerts/service-requests/${encodeURIComponent(requestId)}/acknowledge`,
      { method: 'PATCH' },
    ),
  );
}

export async function openAdminBillForServicePoint(
  servicePointId: string,
): Promise<OpenAdminBillResponse> {
  return openAdminBillResponseSchema.parse(
    await request(`/api/admin/service-points/${encodeURIComponent(servicePointId)}/open-bill`, {
      method: 'POST',
    }),
  );
}

export async function getAdminBill(billId: string): Promise<AdminBillDetailResponse> {
  return adminBillDetailResponseSchema.parse(
    await request(`/api/admin/bills/${encodeURIComponent(billId)}`),
  );
}

export async function updateAdminOrderStatus(
  orderId: string,
  values: UpdateAdminOrderStatusRequest,
): Promise<AdminBillDetailResponse> {
  const payload = updateAdminOrderStatusRequestSchema.parse(values);
  return adminBillDetailResponseSchema.parse(
    await request(
      `/api/admin/orders/${encodeURIComponent(orderId)}/status`,
      jsonRequest('PATCH', payload),
    ),
  );
}

export async function addAdminBillItem(
  billId: string,
  values: AddAdminBillItemRequest,
): Promise<AdminBillDetailResponse> {
  const payload = addAdminBillItemRequestSchema.parse(values);
  return adminBillDetailResponseSchema.parse(
    await request(
      `/api/admin/bills/${encodeURIComponent(billId)}/items`,
      jsonRequest('POST', payload),
    ),
  );
}

export async function updateAdminOrderLine(
  lineId: string,
  values: UpdateAdminOrderLineRequest,
): Promise<AdminBillDetailResponse> {
  const payload = updateAdminOrderLineRequestSchema.parse(values);
  return adminBillDetailResponseSchema.parse(
    await request(
      `/api/admin/order-lines/${encodeURIComponent(lineId)}`,
      jsonRequest('PATCH', payload),
    ),
  );
}

export async function voidAdminOrderLine(
  lineId: string,
  values: VoidAdminOrderLineRequest,
): Promise<AdminBillDetailResponse> {
  const payload = voidAdminOrderLineRequestSchema.parse(values);
  return adminBillDetailResponseSchema.parse(
    await request(
      `/api/admin/order-lines/${encodeURIComponent(lineId)}/void`,
      jsonRequest('POST', payload),
    ),
  );
}

export async function createAdminCustomCharge(
  billId: string,
  values: CreateAdminCustomChargeRequest,
): Promise<AdminBillDetailResponse> {
  const payload = createAdminCustomChargeRequestSchema.parse(values);
  return adminBillDetailResponseSchema.parse(
    await request(
      `/api/admin/bills/${encodeURIComponent(billId)}/custom-charges`,
      jsonRequest('POST', payload),
    ),
  );
}

export async function updateAdminCustomCharge(
  chargeId: string,
  values: UpdateAdminCustomChargeRequest,
): Promise<AdminBillDetailResponse> {
  const payload = updateAdminCustomChargeRequestSchema.parse(values);
  return adminBillDetailResponseSchema.parse(
    await request(
      `/api/admin/custom-charges/${encodeURIComponent(chargeId)}`,
      jsonRequest('PATCH', payload),
    ),
  );
}

export async function voidAdminCustomCharge(
  chargeId: string,
  values: VoidAdminCustomChargeRequest,
): Promise<AdminBillDetailResponse> {
  const payload = voidAdminCustomChargeRequestSchema.parse(values);
  return adminBillDetailResponseSchema.parse(
    await request(
      `/api/admin/custom-charges/${encodeURIComponent(chargeId)}/void`,
      jsonRequest('POST', payload),
    ),
  );
}

export async function createAdminSettlement(
  lineId: string,
  values: CreateAdminSettlementRequest,
): Promise<AdminBillDetailResponse> {
  const payload = createAdminSettlementRequestSchema.parse(values);
  return adminBillDetailResponseSchema.parse(
    await request(
      `/api/admin/order-lines/${encodeURIComponent(lineId)}/settlements`,
      jsonRequest('POST', payload),
    ),
  );
}

export async function reverseAdminSettlement(
  settlementId: string,
  values: ReverseAdminSettlementRequest,
): Promise<AdminBillDetailResponse> {
  const payload = reverseAdminSettlementRequestSchema.parse(values);
  return adminBillDetailResponseSchema.parse(
    await request(
      `/api/admin/settlements/${encodeURIComponent(settlementId)}/reverse`,
      jsonRequest('POST', payload),
    ),
  );
}

export async function getAdminCheckoutPreview(
  billId: string,
): Promise<AdminCheckoutPreviewResponse> {
  return adminCheckoutPreviewResponseSchema.parse(
    await request(`/api/admin/bills/${encodeURIComponent(billId)}/checkout-preview`),
  );
}

export async function createAdminCourtRental(
  billId: string,
  values: CreateCourtRentalRequest,
): Promise<CreateCourtRentalResponse> {
  const payload = createCourtRentalRequestSchema.parse(values);
  return createCourtRentalResponseSchema.parse(
    await request(
      `/api/admin/bills/${encodeURIComponent(billId)}/court-rental`,
      jsonRequest('POST', payload),
    ),
  );
}

export async function createAdminPaymentBatch(
  billId: string,
  values: CreatePaymentBatchRequest,
): Promise<CreatePaymentBatchResponse> {
  const payload = createPaymentBatchRequestSchema.parse(values);
  return createPaymentBatchResponseSchema.parse(
    await request(
      `/api/admin/bills/${encodeURIComponent(billId)}/payment-batches`,
      jsonRequest('POST', payload),
    ),
  );
}

export async function completeAdminBill(
  billId: string,
  values: CompleteAdminBillRequest,
): Promise<CompleteAdminBillResponse> {
  const payload = completeAdminBillRequestSchema.parse(values);
  return completeAdminBillResponseSchema.parse(
    await request(
      `/api/admin/bills/${encodeURIComponent(billId)}/complete`,
      jsonRequest('POST', payload),
    ),
  );
}

export async function resolveAdminServiceRequest(
  requestId: string,
): Promise<ResolveAdminServiceRequestResponse> {
  return resolveAdminServiceRequestResponseSchema.parse(
    await request(`/api/admin/service-requests/${encodeURIComponent(requestId)}/resolve`, {
      method: 'PATCH',
    }),
  );
}

export async function getAdminCatalog(): Promise<AdminCatalogResponse> {
  return adminCatalogResponseSchema.parse(await request('/api/admin/catalog'));
}

export async function createAdminCatalogCategory(
  values: CreateAdminCatalogCategoryRequest,
): Promise<AdminCatalogResponse> {
  const payload = createAdminCatalogCategoryRequestSchema.parse(values);
  return adminCatalogResponseSchema.parse(
    await request('/api/admin/catalog/categories', jsonRequest('POST', payload)),
  );
}

export async function updateAdminCatalogCategory(
  categoryId: string,
  values: UpdateAdminCatalogCategoryRequest,
): Promise<AdminCatalogResponse> {
  const payload = updateAdminCatalogCategoryRequestSchema.parse(values);
  return adminCatalogResponseSchema.parse(
    await request(
      `/api/admin/catalog/categories/${encodeURIComponent(categoryId)}`,
      jsonRequest('PATCH', payload),
    ),
  );
}

export async function createAdminCatalogItem(
  values: CreateAdminCatalogItemRequest,
): Promise<AdminCatalogResponse> {
  const payload = createAdminCatalogItemRequestSchema.parse(values);
  return adminCatalogResponseSchema.parse(
    await request('/api/admin/catalog/items', jsonRequest('POST', payload)),
  );
}

export async function updateAdminCatalogItem(
  itemId: string,
  values: UpdateAdminCatalogItemRequest,
): Promise<AdminCatalogResponse> {
  const payload = updateAdminCatalogItemRequestSchema.parse(values);
  return adminCatalogResponseSchema.parse(
    await request(
      `/api/admin/catalog/items/${encodeURIComponent(itemId)}`,
      jsonRequest('PATCH', payload),
    ),
  );
}

export async function createAdminCatalogImageSignature(
  itemId: string,
): Promise<AdminCatalogImageUploadSignatureResponse> {
  return adminCatalogImageUploadSignatureResponseSchema.parse(
    await request(`/api/admin/catalog/items/${encodeURIComponent(itemId)}/image-signature`, {
      method: 'POST',
    }),
  );
}

export async function attachAdminCatalogItemImage(
  itemId: string,
  values: AttachAdminCatalogItemImageRequest,
): Promise<AdminCatalogResponse> {
  const payload = attachAdminCatalogItemImageRequestSchema.parse(values);
  return adminCatalogResponseSchema.parse(
    await request(
      `/api/admin/catalog/items/${encodeURIComponent(itemId)}/image`,
      jsonRequest('PUT', payload),
    ),
  );
}

export async function removeAdminCatalogItemImage(itemId: string): Promise<AdminCatalogResponse> {
  return adminCatalogResponseSchema.parse(
    await request(`/api/admin/catalog/items/${encodeURIComponent(itemId)}/image`, {
      method: 'DELETE',
    }),
  );
}

export async function getAdminServicePoints(): Promise<AdminServicePointsResponse> {
  return adminServicePointsResponseSchema.parse(await request('/api/admin/service-points'));
}

export async function createAdminServicePoint(
  values: CreateAdminServicePointRequest,
): Promise<AdminServicePointsResponse> {
  const payload = createAdminServicePointRequestSchema.parse(values);
  return adminServicePointsResponseSchema.parse(
    await request('/api/admin/service-points', jsonRequest('POST', payload)),
  );
}

export async function updateAdminServicePoint(
  servicePointId: string,
  values: UpdateAdminServicePointRequest,
): Promise<AdminServicePointsResponse> {
  const payload = updateAdminServicePointRequestSchema.parse(values);
  return adminServicePointsResponseSchema.parse(
    await request(
      `/api/admin/service-points/${encodeURIComponent(servicePointId)}`,
      jsonRequest('PATCH', payload),
    ),
  );
}

export function getAdminServicePointQrUrl(servicePointId: string, format: 'svg' | 'png'): string {
  return `/api/admin/service-points/${encodeURIComponent(servicePointId)}/qr.${format}`;
}

export function getAdminServicePointQrPackUrl(): string {
  return '/api/admin/service-points/qr-pack.zip';
}
