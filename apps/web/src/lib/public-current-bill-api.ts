import {
  publicCurrentBillApiErrorSchema,
  publicCurrentBillResponseSchema,
  type PublicCurrentBillResponse,
} from '@nhdp/contracts';

export class PublicCurrentBillApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PublicCurrentBillApiError';
  }
}

export async function fetchPublicCurrentBill(
  slug: string,
  signal?: AbortSignal,
): Promise<PublicCurrentBillResponse> {
  const response = await fetch(`/api/public/service-points/${encodeURIComponent(slug)}/bill`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    throw new PublicCurrentBillApiError(
      response.status,
      'INVALID_SERVER_RESPONSE',
      'Máy chủ trả về dữ liệu không hợp lệ.',
    );
  }

  const payload: unknown = await response.json();

  if (!response.ok) {
    const parsed = publicCurrentBillApiErrorSchema.safeParse(payload);
    throw new PublicCurrentBillApiError(
      response.status,
      parsed.success ? parsed.data.code : 'PUBLIC_BILL_REQUEST_FAILED',
      parsed.success ? parsed.data.message : 'Không thể tải bill hiện tại.',
    );
  }

  const parsed = publicCurrentBillResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new PublicCurrentBillApiError(
      502,
      'INVALID_PUBLIC_BILL_RESPONSE',
      'Dữ liệu bill từ máy chủ không đúng định dạng.',
    );
  }

  return parsed.data;
}
