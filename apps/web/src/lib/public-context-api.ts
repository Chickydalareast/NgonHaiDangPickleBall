import {
  publicApiErrorSchema,
  publicServicePointContextSchema,
  type PublicServicePointContext,
} from '@nhdp/contracts';

export class PublicApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PublicApiRequestError';
  }
}

export async function fetchPublicServicePointContext(
  slug: string,
  signal?: AbortSignal,
): Promise<PublicServicePointContext> {
  const response = await fetch(`/api/public/service-points/${encodeURIComponent(slug)}/context`, {
    headers: {
      Accept: 'application/json',
    },
    ...(signal === undefined ? {} : { signal }),
  });

  const payload: unknown = await response.json();

  if (!response.ok) {
    const parsedError = publicApiErrorSchema.safeParse(payload);

    throw new PublicApiRequestError(
      parsedError.success ? parsedError.data.message : `API trả về HTTP ${response.status}.`,
      response.status,
    );
  }

  const parsedContext = publicServicePointContextSchema.safeParse(payload);

  if (!parsedContext.success) {
    throw new PublicApiRequestError('Dữ liệu menu từ máy chủ không đúng định dạng.', 502);
  }

  return parsedContext.data;
}
