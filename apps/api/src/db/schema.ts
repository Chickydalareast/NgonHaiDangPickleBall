import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const adminRoleEnum = pgEnum('admin_role', ['ADMIN']);
export const adminUserStatusEnum = pgEnum('admin_user_status', ['ACTIVE', 'INACTIVE']);
export const venueStatusEnum = pgEnum('venue_status', ['ACTIVE', 'INACTIVE']);
export const servicePointStatusEnum = pgEnum('service_point_status', ['ACTIVE', 'INACTIVE']);
export const catalogRecordStatusEnum = pgEnum('catalog_record_status', ['ACTIVE', 'INACTIVE']);
export const billStatusEnum = pgEnum('bill_status', ['OPEN', 'COMPLETED', 'CANCELLED']);
export const orderStatusEnum = pgEnum('order_status', [
  'PENDING',
  'ACCEPTED',
  'SERVED',
  'CANCELLED',
]);
export const orderLineStatusEnum = pgEnum('order_line_status', ['ACTIVE', 'VOIDED']);
export const orderLineKindEnum = pgEnum('order_line_kind', [
  'CATALOG',
  'MANUAL_PRODUCT',
  'MANUAL_TIME',
]);
export const settlementTypeEnum = pgEnum('settlement_type', ['PAID', 'WAIVED']);
export const settlementStatusEnum = pgEnum('settlement_status', ['ACTIVE', 'REVERSED']);
export const serviceRequestStatusEnum = pgEnum('service_request_status', [
  'PENDING',
  'RESOLVED',
  'CANCELLED',
]);
export const activityActorTypeEnum = pgEnum('activity_actor_type', ['SYSTEM', 'ADMIN', 'CUSTOMER']);

export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    username: varchar('username', { length: 50 }).notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    role: adminRoleEnum('role').notNull().default('ADMIN'),
    status: adminUserStatusEnum('status').notNull().default('ACTIVE'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    check('admin_users_username_format_check', sql`${table.username} ~ '^[a-z0-9._-]{3,50}$'`),
    index('admin_users_status_idx').on(table.status),
  ],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    index('admin_sessions_admin_user_idx').on(table.adminUserId),
    index('admin_sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const venues = pgTable(
  'venues',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    name: varchar('name', { length: 160 }).notNull(),
    slug: varchar('slug', { length: 120 }).notNull().unique(),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Ho_Chi_Minh'),
    currency: varchar('currency', { length: 3 }).notNull().default('VND'),
    status: venueStatusEnum('status').notNull().default('ACTIVE'),
    createdAt,
    updatedAt,
  },
  (table) => [index('venues_status_idx').on(table.status)],
);

export const servicePoints = pgTable(
  'service_points',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 120 }).notNull().unique(),
    status: servicePointStatusEnum('status').notNull().default('ACTIVE'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('service_points_venue_code_unique').on(table.venueId, table.code),
    index('service_points_venue_status_idx').on(table.venueId, table.status),
    check('service_points_sort_order_nonnegative_check', sql`${table.sortOrder} >= 0`),
  ],
);

export const catalogCategories = pgTable(
  'catalog_categories',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 120 }).notNull(),
    description: text('description'),
    status: catalogRecordStatusEnum('status').notNull().default('ACTIVE'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('catalog_categories_venue_slug_unique').on(table.venueId, table.slug),
    index('catalog_categories_venue_status_sort_idx').on(
      table.venueId,
      table.status,
      table.sortOrder,
    ),
    check('catalog_categories_sort_order_nonnegative_check', sql`${table.sortOrder} >= 0`),
  ],
);

export const catalogItems = pgTable(
  'catalog_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => catalogCategories.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 160 }).notNull(),
    slug: varchar('slug', { length: 160 }).notNull(),
    description: text('description'),
    unitName: varchar('unit_name', { length: 40 }).notNull(),
    priceVnd: integer('price_vnd').notNull(),
    status: catalogRecordStatusEnum('status').notNull().default('ACTIVE'),
    isAvailable: boolean('is_available').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    imagePublicId: text('image_public_id'),
    imageVersion: bigint('image_version', { mode: 'number' }),
    imageWidth: integer('image_width'),
    imageHeight: integer('image_height'),
    imageFormat: varchar('image_format', { length: 20 }),
    imageAlt: varchar('image_alt', { length: 200 }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('catalog_items_venue_slug_unique').on(table.venueId, table.slug),
    index('catalog_items_category_status_sort_idx').on(
      table.categoryId,
      table.status,
      table.isAvailable,
      table.sortOrder,
    ),
    check('catalog_items_price_nonnegative_check', sql`${table.priceVnd} >= 0`),
    check('catalog_items_sort_order_nonnegative_check', sql`${table.sortOrder} >= 0`),
    check(
      'catalog_items_image_dimensions_positive_check',
      sql`(${table.imageWidth} IS NULL OR ${table.imageWidth} > 0) AND (${table.imageHeight} IS NULL OR ${table.imageHeight} > 0)`,
    ),
  ],
);

export const bills = pgTable(
  'bills',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    servicePointId: uuid('service_point_id')
      .notNull()
      .references(() => servicePoints.id, { onDelete: 'restrict' }),
    status: billStatusEnum('status').notNull().default('OPEN'),
    subtotalVnd: integer('subtotal_vnd').notNull().default(0),
    totalVnd: integer('total_vnd').notNull().default(0),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('one_open_bill_per_service_point')
      .on(table.servicePointId)
      .where(sql`${table.status} = 'OPEN'`),
    index('bills_venue_status_idx').on(table.venueId, table.status),
    index('bills_service_point_created_idx').on(table.servicePointId, table.createdAt),
    check('bills_subtotal_nonnegative_check', sql`${table.subtotalVnd} >= 0`),
    check('bills_total_nonnegative_check', sql`${table.totalVnd} >= 0`),
    check('bills_total_not_below_subtotal_check', sql`${table.totalVnd} >= ${table.subtotalVnd}`),
    check(
      'bills_terminal_timestamp_consistency_check',
      sql`(${table.status} = 'COMPLETED' AND ${table.completedAt} IS NOT NULL AND ${table.cancelledAt} IS NULL) OR (${table.status} = 'CANCELLED' AND ${table.cancelledAt} IS NOT NULL AND ${table.completedAt} IS NULL) OR (${table.status} = 'OPEN' AND ${table.completedAt} IS NULL AND ${table.cancelledAt} IS NULL)`,
    ),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    servicePointId: uuid('service_point_id')
      .notNull()
      .references(() => servicePoints.id, { onDelete: 'restrict' }),
    billId: uuid('bill_id')
      .notNull()
      .references(() => bills.id, { onDelete: 'restrict' }),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull().unique(),
    status: orderStatusEnum('status').notNull().default('PENDING'),
    note: text('note'),
    totalVnd: integer('total_vnd').notNull().default(0),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    servedAt: timestamp('served_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('orders_bill_created_idx').on(table.billId, table.createdAt),
    index('orders_service_point_status_idx').on(table.servicePointId, table.status),
    check('orders_total_nonnegative_check', sql`${table.totalVnd} >= 0`),
    check(
      'orders_status_timestamp_consistency_check',
      sql`(${table.status} = 'PENDING' AND ${table.acceptedAt} IS NULL AND ${table.servedAt} IS NULL AND ${table.cancelledAt} IS NULL AND ${table.cancellationReason} IS NULL) OR (${table.status} = 'ACCEPTED' AND ${table.acceptedAt} IS NOT NULL AND ${table.servedAt} IS NULL AND ${table.cancelledAt} IS NULL AND ${table.cancellationReason} IS NULL) OR (${table.status} = 'SERVED' AND ${table.acceptedAt} IS NOT NULL AND ${table.servedAt} IS NOT NULL AND ${table.cancelledAt} IS NULL AND ${table.cancellationReason} IS NULL) OR (${table.status} = 'CANCELLED' AND ${table.servedAt} IS NULL AND ${table.cancelledAt} IS NOT NULL AND ${table.cancellationReason} IS NOT NULL)`,
    ),
  ],
);

export const orderLines = pgTable(
  'order_lines',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    billId: uuid('bill_id')
      .notNull()
      .references(() => bills.id, { onDelete: 'restrict' }),
    lineKind: orderLineKindEnum('line_kind').notNull().default('CATALOG'),
    catalogItemId: uuid('catalog_item_id').references(() => catalogItems.id, {
      onDelete: 'restrict',
    }),
    itemNameSnapshot: varchar('item_name_snapshot', { length: 160 }).notNull(),
    unitNameSnapshot: varchar('unit_name_snapshot', { length: 40 }).notNull(),
    imagePublicIdSnapshot: text('image_public_id_snapshot'),
    unitPriceSnapshotVnd: integer('unit_price_snapshot_vnd').notNull(),
    quantity: integer('quantity').notNull(),
    durationMinutes: integer('duration_minutes'),
    billingIntervalMinutes: integer('billing_interval_minutes'),
    lineTotalVnd: integer('line_total_vnd').notNull(),
    status: orderLineStatusEnum('status').notNull().default('ACTIVE'),
    voidReason: text('void_reason'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('order_lines_order_idx').on(table.orderId),
    index('order_lines_bill_status_idx').on(table.billId, table.status),
    check('order_lines_unit_price_nonnegative_check', sql`${table.unitPriceSnapshotVnd} >= 0`),
    check('order_lines_quantity_positive_check', sql`${table.quantity} > 0`),
    check(
      'order_lines_total_formula_check',
      sql`${table.lineTotalVnd} = ${table.unitPriceSnapshotVnd} * ${table.quantity}`,
    ),
    check(
      'order_lines_kind_metadata_check',
      sql`(${table.lineKind} = 'CATALOG' AND ${table.catalogItemId} IS NOT NULL AND ${table.durationMinutes} IS NULL AND ${table.billingIntervalMinutes} IS NULL) OR (${table.lineKind} = 'MANUAL_PRODUCT' AND ${table.catalogItemId} IS NULL AND ${table.imagePublicIdSnapshot} IS NULL AND ${table.durationMinutes} IS NULL AND ${table.billingIntervalMinutes} IS NULL) OR (${table.lineKind} = 'MANUAL_TIME' AND ${table.catalogItemId} IS NULL AND ${table.imagePublicIdSnapshot} IS NULL AND ${table.durationMinutes} IS NOT NULL AND ${table.durationMinutes} > 0 AND ${table.billingIntervalMinutes} IS NOT NULL AND ${table.billingIntervalMinutes} > 0 AND ${table.quantity} = CEIL(${table.durationMinutes}::numeric / ${table.billingIntervalMinutes}::numeric))`,
    ),
    check(
      'order_lines_void_consistency_check',
      sql`(${table.status} = 'VOIDED' AND ${table.voidedAt} IS NOT NULL AND ${table.voidReason} IS NOT NULL) OR (${table.status} = 'ACTIVE' AND ${table.voidedAt} IS NULL AND ${table.voidReason} IS NULL)`,
    ),
  ],
);

export const orderLineSettlements = pgTable(
  'order_line_settlements',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    billId: uuid('bill_id')
      .notNull()
      .references(() => bills.id, { onDelete: 'restrict' }),
    orderLineId: uuid('order_line_id')
      .notNull()
      .references(() => orderLines.id, { onDelete: 'restrict' }),
    settlementType: settlementTypeEnum('settlement_type').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceSnapshotVnd: integer('unit_price_snapshot_vnd').notNull(),
    amountVnd: integer('amount_vnd').notNull(),
    reason: text('reason'),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull().unique(),
    status: settlementStatusEnum('status').notNull().default('ACTIVE'),
    createdByAdminUserId: uuid('created_by_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'restrict' }),
    reversedByAdminUserId: uuid('reversed_by_admin_user_id').references(() => adminUsers.id, {
      onDelete: 'restrict',
    }),
    reversalReason: text('reversal_reason'),
    reversalIdempotencyKey: varchar('reversal_idempotency_key', { length: 128 }).unique(),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('order_line_settlements_bill_created_idx').on(table.billId, table.createdAt),
    index('order_line_settlements_line_status_idx').on(table.orderLineId, table.status),
    check('order_line_settlements_quantity_positive_check', sql`${table.quantity} > 0`),
    check(
      'order_line_settlements_unit_price_nonnegative_check',
      sql`${table.unitPriceSnapshotVnd} >= 0`,
    ),
    check(
      'order_line_settlements_amount_formula_check',
      sql`${table.amountVnd} = ${table.unitPriceSnapshotVnd} * ${table.quantity}`,
    ),
    check(
      'order_line_settlements_reason_consistency_check',
      sql`(${table.settlementType} = 'PAID' AND ${table.reason} IS NULL) OR (${table.settlementType} = 'WAIVED' AND ${table.reason} IS NOT NULL)`,
    ),
    check(
      'order_line_settlements_reversal_consistency_check',
      sql`(${table.status} = 'ACTIVE' AND ${table.reversedByAdminUserId} IS NULL AND ${table.reversalReason} IS NULL AND ${table.reversalIdempotencyKey} IS NULL AND ${table.reversedAt} IS NULL) OR (${table.status} = 'REVERSED' AND ${table.reversedByAdminUserId} IS NOT NULL AND ${table.reversalReason} IS NOT NULL AND ${table.reversalIdempotencyKey} IS NOT NULL AND ${table.reversedAt} IS NOT NULL)`,
    ),
  ],
);

export const serviceRequests = pgTable(
  'service_requests',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    servicePointId: uuid('service_point_id')
      .notNull()
      .references(() => servicePoints.id, { onDelete: 'restrict' }),
    billId: uuid('bill_id').references(() => bills.id, { onDelete: 'restrict' }),
    status: serviceRequestStatusEnum('status').notNull().default('PENDING'),
    message: text('message'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('one_pending_service_request_per_service_point')
      .on(table.servicePointId)
      .where(sql`${table.status} = 'PENDING'`),
    index('service_requests_venue_status_idx').on(table.venueId, table.status),
    check(
      'service_requests_terminal_timestamp_consistency_check',
      sql`(${table.status} = 'RESOLVED' AND ${table.resolvedAt} IS NOT NULL AND ${table.cancelledAt} IS NULL) OR (${table.status} = 'CANCELLED' AND ${table.cancelledAt} IS NOT NULL AND ${table.resolvedAt} IS NULL) OR (${table.status} = 'PENDING' AND ${table.resolvedAt} IS NULL AND ${table.cancelledAt} IS NULL)`,
    ),
  ],
);

export const activityLogs = pgTable(
  'activity_logs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    venueId: uuid('venue_id').references(() => venues.id, {
      onDelete: 'restrict',
    }),
    actorType: activityActorTypeEnum('actor_type').notNull(),
    actorAdminUserId: uuid('actor_admin_user_id').references(() => adminUsers.id, {
      onDelete: 'restrict',
    }),
    action: varchar('action', { length: 120 }).notNull(),
    entityType: varchar('entity_type', { length: 80 }),
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt,
  },
  (table) => [
    index('activity_logs_venue_created_idx').on(table.venueId, table.createdAt),
    index('activity_logs_entity_idx').on(table.entityType, table.entityId),
  ],
);

export type AdminUser = typeof adminUsers.$inferSelect;
export type Venue = typeof venues.$inferSelect;
export type ServicePoint = typeof servicePoints.$inferSelect;
export type CatalogCategory = typeof catalogCategories.$inferSelect;
export type CatalogItem = typeof catalogItems.$inferSelect;
export type Bill = typeof bills.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderLine = typeof orderLines.$inferSelect;
export type OrderLineSettlement = typeof orderLineSettlements.$inferSelect;
export type ServiceRequest = typeof serviceRequests.$inferSelect;
