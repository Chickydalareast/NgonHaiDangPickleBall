export const PRODUCT_NAME = 'Ngon Hải Đăng Pickleball' as const;
export const REPOSITORY_NAME = 'ngon-hai-dang-pickleball' as const;

export type IdempotencyKey = string;
export type MoneyVnd = number;

export {
  adminIdentitySchema,
  adminUsernameSchema,
  authApiErrorSchema,
  authSessionResponseSchema,
  loginRequestSchema,
  logoutResponseSchema,
  type AdminIdentity,
  type AdminUsername,
  type AuthApiError,
  type AuthSessionResponse,
  type LoginRequest,
  type LogoutResponse,
} from './admin-auth.js';

export {
  adminDashboardResponseSchema,
  adminDashboardServicePointSchema,
  type AdminDashboardResponse,
  type AdminDashboardServicePoint,
} from './admin-dashboard.js';

export {
  adminRealtimeEventSchema,
  adminRealtimeOrderCreatedEventSchema,
  type AdminRealtimeEvent,
  type AdminRealtimeOrderCreatedEvent,
} from './admin-realtime.js';

export {
  createOrderApiErrorSchema,
  createOrderLineRequestSchema,
  createOrderRequestSchema,
  createOrderResponseSchema,
  type CreateOrderApiError,
  type CreateOrderLineRequest,
  type CreateOrderRequest,
  type CreateOrderResponse,
} from './public-order.js';

export {
  publicApiErrorSchema,
  publicCatalogCategorySchema,
  publicCatalogImageSchema,
  publicCatalogItemSchema,
  publicServicePointContextSchema,
  type PublicApiError,
  type PublicCatalogCategory,
  type PublicCatalogImage,
  type PublicCatalogItem,
  type PublicServicePointContext,
} from './public-context.js';
