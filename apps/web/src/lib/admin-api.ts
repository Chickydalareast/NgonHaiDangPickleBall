import {
  addAdminBillItemRequestSchema,
  adminBillCompletionApiErrorSchema,
  adminBillDetailResponseSchema,
  adminDashboardResponseSchema,
  adminOrderOperationApiErrorSchema,
  authApiErrorSchema,
  authSessionResponseSchema,
  completeAdminBillResponseSchema,
  loginRequestSchema,
  logoutResponseSchema,
  resolveAdminServiceRequestResponseSchema,
  serviceRequestApiErrorSchema,
  updateAdminOrderLineRequestSchema,
  updateAdminOrderStatusRequestSchema,
  voidAdminOrderLineRequestSchema,
  type AddAdminBillItemRequest,
  type CompleteAdminBillResponse,
  type AdminBillDetailResponse,
  type AdminDashboardResponse,
  type AuthSessionResponse,
  type LoginRequest,
  type LogoutResponse,
  type ResolveAdminServiceRequestResponse,
  type UpdateAdminOrderLineRequest,
  type UpdateAdminOrderStatusRequest,
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

    const operationError = adminOrderOperationApiErrorSchema.safeParse(body);

    if (operationError.success) {
      throw new AdminApiError(
        response.status,
        operationError.data.code,
        operationError.data.message,
      );
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

export async function completeAdminBill(billId: string): Promise<CompleteAdminBillResponse> {
  return completeAdminBillResponseSchema.parse(
    await request(`/api/admin/bills/${encodeURIComponent(billId)}/complete`, {
      method: 'POST',
    }),
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
