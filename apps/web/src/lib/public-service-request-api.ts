import {
  createPublicServiceRequestRequestSchema,
  createPublicServiceRequestResponseSchema,
  readPendingServiceRequestResponseSchema,
  serviceRequestApiErrorSchema,
  type CreatePublicServiceRequestRequest,
  type CreatePublicServiceRequestResponse,
  type ReadPendingServiceRequestResponse,
} from '@nhdp/contracts';

export class PublicServiceRequestApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PublicServiceRequestApiError';
  }
}

async function readPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    throw new PublicServiceRequestApiError(
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
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  });
  const payload = await readPayload(response);

  if (!response.ok) {
    const parsed = serviceRequestApiErrorSchema.safeParse(payload);

    throw new PublicServiceRequestApiError(
      response.status,
      parsed.success ? parsed.data.code : 'SERVICE_REQUEST_FAILED',
      parsed.success ? parsed.data.message : 'Không thể gửi yêu cầu hỗ trợ.',
    );
  }

  return payload;
}

export async function getPendingServiceRequest(
  slug: string,
  signal?: AbortSignal,
): Promise<ReadPendingServiceRequestResponse> {
  return readPendingServiceRequestResponseSchema.parse(
    await request(
      `/api/public/service-points/${encodeURIComponent(slug)}/service-requests/pending`,
      signal === undefined ? undefined : { signal },
    ),
  );
}

export async function createPublicServiceRequest(
  slug: string,
  values: CreatePublicServiceRequestRequest,
): Promise<CreatePublicServiceRequestResponse> {
  const payload = createPublicServiceRequestRequestSchema.parse(values);

  return createPublicServiceRequestResponseSchema.parse(
    await request(`/api/public/service-points/${encodeURIComponent(slug)}/service-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}
