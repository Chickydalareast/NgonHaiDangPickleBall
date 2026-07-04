import {
  adminDashboardResponseSchema,
  authApiErrorSchema,
  authSessionResponseSchema,
  loginRequestSchema,
  logoutResponseSchema,
  type AdminDashboardResponse,
  type AuthSessionResponse,
  type LoginRequest,
  type LogoutResponse,
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
    const parsedError = authApiErrorSchema.safeParse(body);

    if (parsedError.success) {
      throw new AdminApiError(response.status, parsedError.data.code, parsedError.data.message);
    }

    throw new AdminApiError(
      response.status,
      'ADMIN_REQUEST_FAILED',
      'Không thể xử lý yêu cầu quản trị.',
    );
  }

  return body;
}

export async function loginAdmin(values: LoginRequest): Promise<AuthSessionResponse> {
  const payload = loginRequestSchema.parse(values);
  const body = await request('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return authSessionResponseSchema.parse(body);
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
