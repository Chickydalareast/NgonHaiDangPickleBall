import {
  createOrderApiErrorSchema,
  createOrderResponseSchema,
  type CreateOrderRequest,
  type CreateOrderResponse,
} from '@nhdp/contracts';

export class CreateOrderRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CreateOrderRequestError';
  }
}

export async function createPublicOrder(
  slug: string,
  request: CreateOrderRequest,
  signal?: AbortSignal,
): Promise<CreateOrderResponse> {
  const response = await fetch(`/api/public/service-points/${encodeURIComponent(slug)}/orders`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    ...(signal === undefined ? {} : { signal }),
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    const parsedError = createOrderApiErrorSchema.safeParse(payload);

    throw new CreateOrderRequestError(
      parsedError.success ? parsedError.data.message : `API trả về HTTP ${response.status}.`,
      response.status,
    );
  }

  const parsedOrder = createOrderResponseSchema.safeParse(payload);

  if (!parsedOrder.success) {
    throw new CreateOrderRequestError(
      'Dữ liệu xác nhận order từ máy chủ không đúng định dạng.',
      502,
    );
  }

  return parsedOrder.data;
}

const lastOrderKey = (slug: string) => `nhdp:last-order:${slug}`;

export function saveLastOrder(slug: string, response: CreateOrderResponse): void {
  window.localStorage.setItem(lastOrderKey(slug), JSON.stringify(response));
}

export function readLastOrder(slug: string): CreateOrderResponse | null {
  try {
    const raw = window.localStorage.getItem(lastOrderKey(slug));

    if (!raw) {
      return null;
    }

    const storedValue: unknown = JSON.parse(raw);
    const parsed = createOrderResponseSchema.safeParse(storedValue);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
