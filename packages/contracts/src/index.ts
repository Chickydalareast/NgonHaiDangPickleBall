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
  adminBillCompletionApiErrorSchema,
  completeAdminBillResponseSchema,
  type AdminBillCompletionApiError,
  type CompleteAdminBillResponse,
} from './admin-bill-completion.js';

export {
  addAdminBillItemRequestSchema,
  adminBillDetailResponseSchema,
  adminBillOrderLineSchema,
  adminBillOrderSchema,
  adminOrderLineStatusSchema,
  adminOrderOperationApiErrorSchema,
  adminOrderSourceSchema,
  adminOrderStatusSchema,
  updateAdminOrderLineRequestSchema,
  updateAdminOrderStatusRequestSchema,
  voidAdminOrderLineRequestSchema,
  type AddAdminBillItemRequest,
  type AdminBillDetailResponse,
  type AdminBillOrder,
  type AdminBillOrderLine,
  type AdminOrderLineStatus,
  type AdminOrderOperationApiError,
  type AdminOrderSource,
  type AdminOrderStatus,
  type UpdateAdminOrderLineRequest,
  type UpdateAdminOrderStatusRequest,
  type VoidAdminOrderLineRequest,
} from './admin-order-operations.js';

export {
  adminRealtimeBillCompletedEventSchema,
  adminRealtimeBillUpdatedEventSchema,
  adminRealtimeEventSchema,
  adminRealtimeOrderAcceptedEventSchema,
  adminRealtimeOrderCancelledEventSchema,
  adminRealtimeOrderCreatedEventSchema,
  adminRealtimeOrderServedEventSchema,
  adminRealtimeServiceRequestCreatedEventSchema,
  adminRealtimeServiceRequestResolvedEventSchema,
  type AdminRealtimeBillCompletedEvent,
  type AdminRealtimeBillUpdatedEvent,
  type AdminRealtimeEvent,
  type AdminRealtimeOrderAcceptedEvent,
  type AdminRealtimeOrderCancelledEvent,
  type AdminRealtimeOrderCreatedEvent,
  type AdminRealtimeOrderServedEvent,
  type AdminRealtimeServiceRequestCreatedEvent,
  type AdminRealtimeServiceRequestResolvedEvent,
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
  createPublicServiceRequestRequestSchema,
  createPublicServiceRequestResponseSchema,
  pendingServiceRequestSchema,
  readPendingServiceRequestResponseSchema,
  resolveAdminServiceRequestResponseSchema,
  serviceRequestApiErrorSchema,
  serviceRequestMessageSchema,
  type CreatePublicServiceRequestRequest,
  type CreatePublicServiceRequestResponse,
  type PendingServiceRequest,
  type ReadPendingServiceRequestResponse,
  type ResolveAdminServiceRequestResponse,
  type ServiceRequestApiError,
} from './service-request.js';

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
