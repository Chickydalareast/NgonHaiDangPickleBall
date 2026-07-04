export const PRODUCT_NAME = 'Ngon Hải Đăng Pickleball' as const;
export const REPOSITORY_NAME = 'ngon-hai-dang-pickleball' as const;

export type IdempotencyKey = string;
export type MoneyVnd = number;

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
