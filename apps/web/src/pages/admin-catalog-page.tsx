import type {
  AdminCatalogCategory,
  AdminCatalogItem,
  AdminCatalogResponse,
  CreateAdminCatalogCategoryRequest,
  CreateAdminCatalogItemRequest,
} from '@nhdp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useAdminAlertRuntime } from '../components/admin-alert-runtime';
import { AdminPageHeader } from '../components/admin-page-header';
import {
  AdminApiError,
  attachAdminCatalogItemImage,
  createAdminCatalogCategory,
  createAdminCatalogImageSignature,
  createAdminCatalogItem,
  getAdminCatalog,
  getAdminSession,
  logoutAdmin,
  removeAdminCatalogItemImage,
  updateAdminCatalogCategory,
  updateAdminCatalogItem,
} from '../lib/admin-api';
import { buildCloudinaryImageUrl } from '../lib/cloudinary-image';

const catalogQueryKey = ['admin', 'catalog'] as const;
const moneyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

type CatalogStatus = 'ACTIVE' | 'INACTIVE';
type CatalogVisibilityFilter = 'ALL' | 'VISIBLE' | 'HIDDEN';
type CatalogSort = 'DEFAULT' | 'NAME' | 'PRICE_ASC' | 'PRICE_DESC';

type CategoryModalTarget =
  | {
      mode: 'CREATE';
    }
  | {
      mode: 'EDIT';
      categoryId: string;
    };

type ItemModalTarget =
  | {
      mode: 'CREATE';
    }
  | {
      mode: 'EDIT';
      itemId: string;
    };

interface FlatCatalogItem {
  item: AdminCatalogItem;
  category: AdminCatalogCategory;
}

function isAuthenticationError(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 401;
}

function toNullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/giu, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function initials(value: string): string {
  const words = value.trim().split(/\s+/u).filter(Boolean);

  if (words.length === 0) {
    return 'MH';
  }

  return words
    .slice(0, 2)
    .map((word) => word.slice(0, 1))
    .join('')
    .toLocaleUpperCase('vi-VN');
}

function itemIsVisible(item: AdminCatalogItem, category: AdminCatalogCategory): boolean {
  return category.status === 'ACTIVE' && item.status === 'ACTIVE' && item.isAvailable;
}

function itemStatusLabel(item: AdminCatalogItem, category: AdminCatalogCategory): string {
  if (category.status === 'INACTIVE') {
    return 'Danh mục đang ẩn';
  }

  if (item.status === 'INACTIVE') {
    return 'Ngừng hoạt động';
  }

  if (!item.isAvailable) {
    return 'Tạm ngừng bán';
  }

  return 'Đang bán';
}

function itemStatusClass(item: AdminCatalogItem, category: AdminCatalogCategory): string {
  if (itemIsVisible(item, category)) {
    return 'is-visible';
  }

  if (item.status === 'INACTIVE' || category.status === 'INACTIVE') {
    return 'is-inactive';
  }

  return 'is-paused';
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="m14 5 5 5M4 20l4-1 11-11-3-3L5 16l-1 4Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="2" />
      <path d="m5 18 5-5 3 3 2-2 4 4" />
    </svg>
  );
}

function useModalLifecycle(onClose: () => void) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);
}

async function uploadCatalogItemImage(
  itemId: string,
  file: File,
  alt: string,
): Promise<AdminCatalogResponse> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.');
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Ảnh phải nhỏ hơn hoặc bằng 10 MB.');
  }

  const signed = await createAdminCatalogImageSignature(itemId);
  const form = new FormData();
  form.set('file', file);
  form.set('api_key', signed.apiKey);
  form.set('timestamp', String(signed.timestamp));
  form.set('signature', signed.signature);
  form.set('public_id', signed.publicId);
  form.set('allowed_formats', signed.parameters.allowedFormats);
  form.set('transformation', signed.parameters.transformation);

  const uploadResponse = await fetch(signed.uploadUrl, {
    method: 'POST',
    body: form,
  });
  const uploaded = (await uploadResponse.json()) as Record<string, unknown>;

  if (!uploadResponse.ok) {
    const cloudinaryError = uploaded.error;
    const message =
      typeof cloudinaryError === 'object' &&
      cloudinaryError !== null &&
      'message' in cloudinaryError
        ? String(cloudinaryError.message)
        : 'Cloudinary từ chối ảnh tải lên.';
    throw new Error(message);
  }

  const publicId = typeof uploaded.public_id === 'string' ? uploaded.public_id : '';
  const format = typeof uploaded.format === 'string' ? uploaded.format : '';
  const signature = typeof uploaded.signature === 'string' ? uploaded.signature : '';

  return attachAdminCatalogItemImage(itemId, {
    publicId,
    version: Number(uploaded.version),
    width: Number(uploaded.width),
    height: Number(uploaded.height),
    format: format as 'jpg' | 'jpeg' | 'png' | 'webp',
    signature,
    alt: toNullableText(alt),
  });
}

interface CategoryModalProps {
  category: AdminCatalogCategory | null;
  onClose: () => void;
  onSaved: (catalog: AdminCatalogResponse, message: string) => void;
  onError: (message: string) => void;
}

function CategoryModal({ category, onClose, onSaved, onError }: CategoryModalProps) {
  const editing = category !== null;
  const [name, setName] = useState(category?.name ?? '');
  const [slug, setSlug] = useState(category?.slug ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [status, setStatus] = useState<CatalogStatus>(category?.status ?? 'ACTIVE');
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 0));
  const [saving, setSaving] = useState(false);

  useModalLifecycle(onClose);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    onError('');

    const request: CreateAdminCatalogCategoryRequest = {
      name,
      slug,
      description: toNullableText(description),
      status,
      sortOrder: Number(sortOrder),
    };

    try {
      const catalog = category
        ? await updateAdminCatalogCategory(category.id, request)
        : await createAdminCatalogCategory(request);
      onSaved(catalog, editing ? 'Đã lưu thay đổi danh mục.' : 'Đã tạo danh mục mới.');
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Không thể lưu danh mục.');
    } finally {
      setSaving(false);
    }
  }

  function updateName(value: string) {
    setName(value);

    if (!editing) {
      setSlug(slugify(value));
    }
  }

  return (
    <div
      className="admin-catalog-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="admin-catalog-modal is-category"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-catalog-category-modal-title"
      >
        <header className="admin-catalog-modal-header">
          <div className="admin-catalog-modal-title">
            <span className="admin-catalog-modal-icon">
              <PlusIcon />
            </span>
            <div>
              <h2 id="admin-catalog-category-modal-title">
                {editing ? 'Chỉnh sửa danh mục' : 'Thêm danh mục'}
              </h2>
              <p>Tạo hoặc cập nhật nhóm mặt hàng trong menu.</p>
            </div>
          </div>
          <button
            type="button"
            className="admin-catalog-modal-close"
            aria-label="Đóng"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <form onSubmit={submit}>
          <div className="admin-catalog-modal-body is-category">
            <section className="admin-catalog-form-section">
              <div className="admin-catalog-form-grid">
                <label>
                  <span>Tên danh mục *</span>
                  <input
                    autoFocus
                    required
                    maxLength={120}
                    value={name}
                    onChange={(event) => updateName(event.target.value)}
                  />
                </label>
                <label>
                  <span>Slug *</span>
                  <input
                    required
                    maxLength={160}
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    value={slug}
                    onChange={(event) => setSlug(event.target.value)}
                  />
                </label>
                <label>
                  <span>Trạng thái *</span>
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value as CatalogStatus)}
                  >
                    <option value="ACTIVE">Đang hoạt động</option>
                    <option value="INACTIVE">Ngừng hoạt động</option>
                  </select>
                </label>
                <label>
                  <span>Thứ tự hiển thị *</span>
                  <input
                    required
                    type="number"
                    min={0}
                    max={1000000}
                    value={sortOrder}
                    onChange={(event) => setSortOrder(event.target.value)}
                  />
                </label>
                <label className="is-full">
                  <span>Mô tả</span>
                  <textarea
                    maxLength={1000}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
              </div>
            </section>
          </div>

          <footer className="admin-catalog-modal-footer">
            <div>
              {editing ? (
                <button
                  type="button"
                  className="admin-catalog-button is-danger"
                  onClick={() => setStatus('INACTIVE')}
                >
                  Ngừng hoạt động
                </button>
              ) : null}
            </div>
            <div>
              <button type="button" className="admin-catalog-button is-secondary" onClick={onClose}>
                Hủy
              </button>
              <button type="submit" className="admin-catalog-button is-primary" disabled={saving}>
                {saving ? 'Đang lưu…' : 'Lưu danh mục'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

interface ItemModalProps {
  item: AdminCatalogItem | null;
  categories: AdminCatalogCategory[];
  cloudName: string | null;
  mediaConfigured: boolean;
  onClose: () => void;
  onSaved: (catalog: AdminCatalogResponse, message: string) => void;
  onError: (message: string) => void;
}

function ItemModal({
  item,
  categories,
  cloudName,
  mediaConfigured,
  onClose,
  onSaved,
  onError,
}: ItemModalProps) {
  const editing = item !== null;
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? categories[0]?.id ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [slug, setSlug] = useState(item?.slug ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [unitName, setUnitName] = useState(item?.unitName ?? 'chai');
  const [priceVnd, setPriceVnd] = useState(String(item?.priceVnd ?? 0));
  const [status, setStatus] = useState<CatalogStatus>(item?.status ?? 'ACTIVE');
  const [isAvailable, setIsAvailable] = useState(item?.isAvailable ?? true);
  const [sortOrder, setSortOrder] = useState(String(item?.sortOrder ?? 0));
  const [imageAlt, setImageAlt] = useState(item?.image?.alt ?? item?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useModalLifecycle(onClose);

  const imageUrl = buildCloudinaryImageUrl(
    cloudName,
    item?.image ?? null,
    'f_auto,q_auto,c_fill,w_560,h_420',
  );

  function updateName(value: string) {
    setName(value);

    if (!editing) {
      setSlug(slugify(value));
      setImageAlt(value);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    onError('');

    const request: CreateAdminCatalogItemRequest = {
      categoryId,
      name,
      slug,
      description: toNullableText(description),
      unitName,
      priceVnd: Number(priceVnd),
      status,
      isAvailable,
      sortOrder: Number(sortOrder),
    };

    try {
      const catalog = item
        ? await updateAdminCatalogItem(item.id, request)
        : await createAdminCatalogItem(request);
      onSaved(catalog, editing ? 'Đã lưu thay đổi mặt hàng.' : 'Đã tạo mặt hàng mới.');
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Không thể lưu mặt hàng.');
    } finally {
      setSaving(false);
    }
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';

    if (!file || !item) {
      return;
    }

    if (!mediaConfigured) {
      onError('Cloudinary chưa được cấu hình trên máy chủ.');
      return;
    }

    setUploading(true);
    onError('');

    try {
      const catalog = await uploadCatalogItemImage(item.id, file, imageAlt);
      onSaved(catalog, item.image ? 'Đã thay ảnh mặt hàng.' : 'Đã tải ảnh mặt hàng.');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Không thể tải ảnh mặt hàng.');
    } finally {
      setUploading(false);
    }
  }

  async function removeImage() {
    if (!item?.image) {
      return;
    }

    setUploading(true);
    onError('');

    try {
      onSaved(await removeAdminCatalogItemImage(item.id), 'Đã gỡ ảnh mặt hàng.');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Không thể gỡ ảnh mặt hàng.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="admin-catalog-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="admin-catalog-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-catalog-item-modal-title"
      >
        <header className="admin-catalog-modal-header">
          <div className="admin-catalog-modal-title">
            <span className="admin-catalog-modal-icon">
              {editing ? <EditIcon /> : <PlusIcon />}
            </span>
            <div>
              <h2 id="admin-catalog-item-modal-title">
                {editing ? 'Chỉnh sửa mặt hàng' : 'Thêm mặt hàng'}
              </h2>
              <p>
                {editing
                  ? 'Cập nhật thông tin, trạng thái bán và ảnh đại diện.'
                  : 'Tạo mặt hàng trước, sau đó mở chỉnh sửa để tải ảnh.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="admin-catalog-modal-close"
            aria-label="Đóng"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <form onSubmit={submit}>
          <div className="admin-catalog-modal-body">
            <aside className="admin-catalog-media-panel">
              <div className="admin-catalog-media-preview">
                {imageUrl ? (
                  <img src={imageUrl} alt={item?.image?.alt ?? item?.name ?? ''} />
                ) : (
                  <span>{initials(name)}</span>
                )}
              </div>

              <label
                className={`admin-catalog-image-upload ${
                  editing && mediaConfigured ? '' : 'is-disabled'
                }`}
              >
                <ImageIcon />
                {uploading ? 'Đang xử lý…' : item?.image ? 'Thay ảnh' : 'Tải ảnh'}
                <input
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={!editing || !mediaConfigured || uploading}
                  onChange={(event) => void uploadImage(event)}
                />
              </label>

              {editing ? (
                <label className="admin-catalog-image-alt">
                  <span>Alt ảnh</span>
                  <input
                    maxLength={200}
                    value={imageAlt}
                    onChange={(event) => setImageAlt(event.target.value)}
                  />
                </label>
              ) : null}

              {item?.image ? (
                <button
                  type="button"
                  className="admin-catalog-button is-secondary is-full"
                  disabled={uploading}
                  onClick={() => void removeImage()}
                >
                  Gỡ ảnh hiện tại
                </button>
              ) : null}

              <p className="admin-catalog-media-note">
                {editing
                  ? mediaConfigured
                    ? 'Hỗ trợ JPG, PNG, WebP tối đa 10 MB. Ảnh được tải trực tiếp lên Cloudinary.'
                    : 'Cloudinary chưa cấu hình — các thao tác CRUD khác vẫn hoạt động.'
                  : 'Theo flow hiện tại, cần tạo mặt hàng trước rồi mới tải ảnh bằng signed upload.'}
              </p>
            </aside>

            <div className="admin-catalog-form-area">
              <section className="admin-catalog-form-section">
                <h3>Thông tin cơ bản</h3>
                <div className="admin-catalog-form-grid">
                  <label>
                    <span>Tên mặt hàng *</span>
                    <input
                      autoFocus
                      required
                      maxLength={160}
                      value={name}
                      onChange={(event) => updateName(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Slug *</span>
                    <input
                      required
                      maxLength={160}
                      pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                      value={slug}
                      onChange={(event) => setSlug(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Danh mục *</span>
                    <select
                      required
                      value={categoryId}
                      onChange={(event) => setCategoryId(event.target.value)}
                    >
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Đơn vị *</span>
                    <input
                      required
                      maxLength={40}
                      value={unitName}
                      onChange={(event) => setUnitName(event.target.value)}
                    />
                  </label>
                  <label className="is-full">
                    <span>Mô tả</span>
                    <textarea
                      maxLength={1000}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </label>
                </div>
              </section>

              <section className="admin-catalog-form-section">
                <h3>Giá và trạng thái</h3>
                <div className="admin-catalog-form-grid">
                  <label>
                    <span>Giá bán (VND) *</span>
                    <input
                      required
                      type="number"
                      min={0}
                      max={2000000000}
                      value={priceVnd}
                      onChange={(event) => setPriceVnd(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Thứ tự hiển thị *</span>
                    <input
                      required
                      type="number"
                      min={0}
                      max={1000000}
                      value={sortOrder}
                      onChange={(event) => setSortOrder(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Trạng thái dữ liệu *</span>
                    <select
                      value={status}
                      onChange={(event) => setStatus(event.target.value as CatalogStatus)}
                    >
                      <option value="ACTIVE">Đang hoạt động</option>
                      <option value="INACTIVE">Ngừng hoạt động</option>
                    </select>
                  </label>
                  <div className="admin-catalog-availability">
                    <div>
                      <strong>Đang bán trên menu khách</strong>
                      <span>Tắt để tạm ẩn mà không xóa mặt hàng.</span>
                    </div>
                    <button
                      type="button"
                      className={`admin-catalog-switch ${isAvailable ? 'is-on' : ''}`}
                      aria-label="Bật tắt trạng thái bán"
                      aria-pressed={isAvailable}
                      onClick={() => setIsAvailable((current) => !current)}
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>

          <footer className="admin-catalog-modal-footer">
            <div>
              {editing ? (
                <button
                  type="button"
                  className="admin-catalog-button is-danger"
                  onClick={() => {
                    setStatus('INACTIVE');
                    setIsAvailable(false);
                  }}
                >
                  Ngừng hoạt động
                </button>
              ) : null}
            </div>
            <div>
              <button type="button" className="admin-catalog-button is-secondary" onClick={onClose}>
                Hủy
              </button>
              <button
                type="submit"
                className="admin-catalog-button is-primary"
                disabled={saving || categories.length === 0}
              >
                {saving ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Tạo mặt hàng'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function CatalogLoading() {
  return (
    <main className="admin-catalog-page admin-catalog-state-page" aria-busy="true">
      <section className="admin-catalog-state-card">
        <span className="admin-catalog-spinner" />
        <h1>Đang tải catalog</h1>
        <p>Đang đồng bộ danh mục, mặt hàng và trạng thái ảnh.</p>
      </section>
    </main>
  );
}

export function AdminCatalogPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { realtimeStatus } = useAdminAlertRuntime();

  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [visibilityFilter, setVisibilityFilter] = useState<CatalogVisibilityFilter>('ALL');
  const [sort, setSort] = useState<CatalogSort>('DEFAULT');
  const [categoryModal, setCategoryModal] = useState<CategoryModalTarget | null>(null);
  const [itemModal, setItemModal] = useState<ItemModalTarget | null>(null);

  const closeCategoryModal = useCallback(() => setCategoryModal(null), []);
  const closeItemModal = useCallback(() => setItemModal(null), []);

  const sessionQuery = useQuery({
    queryKey: ['admin', 'session'],
    queryFn: getAdminSession,
    retry: false,
    staleTime: 60_000,
  });
  const catalogQuery = useQuery({
    queryKey: catalogQueryKey,
    queryFn: getAdminCatalog,
    enabled: sessionQuery.isSuccess,
    retry: false,
    staleTime: 10_000,
  });
  const logoutMutation = useMutation({
    mutationFn: logoutAdmin,
    onSettled() {
      queryClient.removeQueries({ queryKey: ['admin'] });
      void navigate('/admin/login', { replace: true });
    },
  });

  useEffect(() => {
    if (
      (sessionQuery.isError && isAuthenticationError(sessionQuery.error)) ||
      (catalogQuery.isError && isAuthenticationError(catalogQuery.error))
    ) {
      queryClient.removeQueries({ queryKey: ['admin'] });
      void navigate('/admin/login', { replace: true });
    }
  }, [
    catalogQuery.error,
    catalogQuery.isError,
    navigate,
    queryClient,
    sessionQuery.error,
    sessionQuery.isError,
  ]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function onSaved(catalog: AdminCatalogResponse, message: string) {
    queryClient.setQueryData(catalogQueryKey, catalog);
    setPageError(null);
    setNotice(message);
  }

  if (sessionQuery.isPending || (sessionQuery.isSuccess && catalogQuery.isPending)) {
    return <CatalogLoading />;
  }

  if (sessionQuery.isError || catalogQuery.isError || !sessionQuery.data || !catalogQuery.data) {
    return (
      <main className="admin-catalog-page admin-catalog-state-page">
        <section className="admin-catalog-state-card">
          <h1>Không thể tải catalog</h1>
          <p>Kiểm tra kết nối rồi thử tải lại dữ liệu.</p>
          <button
            type="button"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ['admin'] });
            }}
          >
            Thử lại
          </button>
        </section>
      </main>
    );
  }

  const catalog = catalogQuery.data;
  const allItems: FlatCatalogItem[] = catalog.categories.flatMap((category) =>
    category.items.map((item) => ({ item, category })),
  );
  const visibleItemCount = allItems.filter(({ item, category }) =>
    itemIsVisible(item, category),
  ).length;

  const filteredItems = [...allItems]
    .filter(({ item, category }) => {
      const normalizedSearch = search.trim().toLocaleLowerCase('vi-VN');
      const matchesSearch =
        normalizedSearch.length === 0 ||
        [item.name, item.slug, item.description ?? '', item.unitName, category.name]
          .join(' ')
          .toLocaleLowerCase('vi-VN')
          .includes(normalizedSearch);
      const matchesCategory = categoryFilter === 'ALL' || category.id === categoryFilter;
      const visible = itemIsVisible(item, category);
      const matchesVisibility =
        visibilityFilter === 'ALL' ||
        (visibilityFilter === 'VISIBLE' && visible) ||
        (visibilityFilter === 'HIDDEN' && !visible);

      return matchesSearch && matchesCategory && matchesVisibility;
    })
    .sort((left, right) => {
      if (sort === 'NAME') {
        return left.item.name.localeCompare(right.item.name, 'vi-VN');
      }

      if (sort === 'PRICE_ASC') {
        return left.item.priceVnd - right.item.priceVnd;
      }

      if (sort === 'PRICE_DESC') {
        return right.item.priceVnd - left.item.priceVnd;
      }

      return (
        left.category.sortOrder - right.category.sortOrder ||
        left.item.sortOrder - right.item.sortOrder ||
        left.item.name.localeCompare(right.item.name, 'vi-VN')
      );
    });

  const editingCategory =
    categoryModal?.mode === 'EDIT'
      ? (catalog.categories.find((category) => category.id === categoryModal.categoryId) ?? null)
      : null;
  const editingItem =
    itemModal?.mode === 'EDIT'
      ? (allItems.find(({ item }) => item.id === itemModal.itemId)?.item ?? null)
      : null;

  return (
    <main className="admin-catalog-page">
      <div className="admin-catalog-shell">
        <AdminPageHeader
          activePage="catalog"
          admin={sessionQuery.data.admin}
          realtimeStatus={realtimeStatus}
          logoutPending={logoutMutation.isPending}
          onLogout={() => logoutMutation.mutate()}
        />

        <section className="admin-catalog-content">
          <header className="admin-catalog-heading">
            <div>
              <h1>Quản lý catalog</h1>
              <p>Danh sách chỉ đọc. Thêm mới và chỉnh sửa được thực hiện trong modal riêng.</p>
            </div>

            <dl className="admin-catalog-kpis">
              <div>
                <dt>Danh mục</dt>
                <dd>{catalog.categories.length}</dd>
              </div>
              <div>
                <dt>Mặt hàng</dt>
                <dd>{allItems.length}</dd>
              </div>
              <div>
                <dt>Đang bán</dt>
                <dd>{visibleItemCount}</dd>
              </div>
            </dl>
          </header>

          <div className="admin-catalog-toolbar">
            <label className="admin-catalog-search">
              <SearchIcon />
              <input
                type="search"
                placeholder="Tìm tên món, slug hoặc mô tả..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>

            <select
              aria-label="Lọc danh mục"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="ALL">Tất cả danh mục</option>
              {catalog.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Lọc trạng thái"
              value={visibilityFilter}
              onChange={(event) =>
                setVisibilityFilter(event.target.value as CatalogVisibilityFilter)
              }
            >
              <option value="ALL">Mọi trạng thái</option>
              <option value="VISIBLE">Đang bán</option>
              <option value="HIDDEN">Đang ẩn</option>
            </select>

            <select
              aria-label="Sắp xếp"
              value={sort}
              onChange={(event) => setSort(event.target.value as CatalogSort)}
            >
              <option value="DEFAULT">Thứ tự hiển thị</option>
              <option value="NAME">Tên A–Z</option>
              <option value="PRICE_DESC">Giá cao trước</option>
              <option value="PRICE_ASC">Giá thấp trước</option>
            </select>

            <button
              type="button"
              className="admin-catalog-button is-secondary"
              onClick={() => {
                setPageError(null);
                setCategoryModal({ mode: 'CREATE' });
              }}
            >
              <PlusIcon />
              Thêm danh mục
            </button>

            <button
              type="button"
              className="admin-catalog-button is-primary"
              disabled={catalog.categories.length === 0}
              onClick={() => {
                setPageError(null);
                setItemModal({ mode: 'CREATE' });
              }}
            >
              <PlusIcon />
              Thêm mặt hàng
            </button>
          </div>

          {catalog.media.configured ? null : (
            <div className="admin-catalog-media-warning">
              Cloudinary chưa cấu hình — CRUD catalog vẫn hoạt động, thao tác tải ảnh đang khóa.
            </div>
          )}

          {pageError ? (
            <div className="admin-catalog-error" role="alert">
              <strong>Không thể hoàn tất thao tác</strong>
              <span>{pageError}</span>
              <button type="button" aria-label="Đóng lỗi" onClick={() => setPageError(null)}>
                <CloseIcon />
              </button>
            </div>
          ) : null}

          <div className="admin-catalog-layout">
            <aside className="admin-catalog-sidebar">
              <div className="admin-catalog-sidebar-header">
                <h2>Bộ lọc</h2>
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setCategoryFilter('ALL');
                    setVisibilityFilter('ALL');
                    setSort('DEFAULT');
                  }}
                >
                  Đặt lại
                </button>
              </div>

              <section className="admin-catalog-filter-group">
                <p>Danh mục</p>
                <div>
                  <button
                    type="button"
                    className={categoryFilter === 'ALL' ? 'is-active' : ''}
                    onClick={() => setCategoryFilter('ALL')}
                  >
                    <span>Tất cả</span>
                    <b>{allItems.length}</b>
                  </button>
                  {catalog.categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      className={categoryFilter === category.id ? 'is-active' : ''}
                      onClick={() => setCategoryFilter(category.id)}
                    >
                      <span>{category.name}</span>
                      <b>{category.items.length}</b>
                    </button>
                  ))}
                </div>
              </section>

              <section className="admin-catalog-filter-group">
                <p>Trạng thái</p>
                <div>
                  <button
                    type="button"
                    className={visibilityFilter === 'ALL' ? 'is-active' : ''}
                    onClick={() => setVisibilityFilter('ALL')}
                  >
                    <span>Tất cả</span>
                    <b>{allItems.length}</b>
                  </button>
                  <button
                    type="button"
                    className={visibilityFilter === 'VISIBLE' ? 'is-active' : ''}
                    onClick={() => setVisibilityFilter('VISIBLE')}
                  >
                    <span>Đang bán</span>
                    <b>{visibleItemCount}</b>
                  </button>
                  <button
                    type="button"
                    className={visibilityFilter === 'HIDDEN' ? 'is-active' : ''}
                    onClick={() => setVisibilityFilter('HIDDEN')}
                  >
                    <span>Đang ẩn</span>
                    <b>{allItems.length - visibleItemCount}</b>
                  </button>
                </div>
              </section>

              <section className="admin-catalog-filter-group is-management">
                <p>Quản lý danh mục</p>
                <div>
                  {catalog.categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      className={category.status === 'INACTIVE' ? 'is-inactive' : ''}
                      onClick={() => {
                        setPageError(null);
                        setCategoryModal({ mode: 'EDIT', categoryId: category.id });
                      }}
                    >
                      <span>{category.name}</span>
                      <EditIcon />
                    </button>
                  ))}
                </div>
              </section>
            </aside>

            <section className="admin-catalog-main">
              <div className="admin-catalog-result-row">
                <div>
                  <strong>{filteredItems.length} mặt hàng</strong>
                  <span> · Mặc định sắp theo thứ tự hiển thị</span>
                </div>
              </div>

              {filteredItems.length === 0 ? (
                <div className="admin-catalog-empty">
                  <strong>Không tìm thấy mặt hàng</strong>
                  <p>Đổi từ khóa hoặc đặt lại bộ lọc.</p>
                </div>
              ) : (
                <div className="admin-catalog-grid">
                  {filteredItems.map(({ item, category }) => {
                    const imageUrl = buildCloudinaryImageUrl(
                      catalog.media.cloudName,
                      item.image,
                      'f_auto,q_auto,c_fill,w_480,h_360',
                    );
                    const statusClass = itemStatusClass(item, category);

                    return (
                      <article key={item.id} className={`admin-catalog-card ${statusClass}`}>
                        <div className="admin-catalog-card-visual">
                          {imageUrl ? (
                            <img src={imageUrl} alt={item.image?.alt ?? item.name} />
                          ) : (
                            <span className="admin-catalog-card-fallback">
                              {initials(item.name)}
                            </span>
                          )}

                          <span className="admin-catalog-status-chip">
                            {itemStatusLabel(item, category)}
                          </span>

                          <button
                            type="button"
                            className="admin-catalog-card-edit-icon"
                            aria-label={`Chỉnh sửa ${item.name}`}
                            onClick={() => {
                              setPageError(null);
                              setItemModal({ mode: 'EDIT', itemId: item.id });
                            }}
                          >
                            <EditIcon />
                          </button>
                        </div>

                        <div className="admin-catalog-card-body">
                          <span className="admin-catalog-category-label">{category.name}</span>
                          <h3>{item.name}</h3>
                          <p>{item.description ?? 'Chưa có mô tả cho mặt hàng này.'}</p>

                          <footer>
                            <div>
                              <strong>{moneyFormatter.format(item.priceVnd)}</strong>
                              <span>/ {item.unitName}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setPageError(null);
                                setItemModal({ mode: 'EDIT', itemId: item.id });
                              }}
                            >
                              Chỉnh sửa
                            </button>
                          </footer>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </section>
      </div>

      {categoryModal ? (
        <CategoryModal
          key={
            categoryModal.mode === 'EDIT' ? `edit:${categoryModal.categoryId}` : 'create-category'
          }
          category={editingCategory}
          onClose={closeCategoryModal}
          onSaved={onSaved}
          onError={(message) => setPageError(message || null)}
        />
      ) : null}

      {itemModal ? (
        <ItemModal
          key={itemModal.mode === 'EDIT' ? `edit:${itemModal.itemId}` : 'create-item'}
          item={editingItem}
          categories={catalog.categories}
          cloudName={catalog.media.cloudName}
          mediaConfigured={catalog.media.configured}
          onClose={closeItemModal}
          onSaved={onSaved}
          onError={(message) => setPageError(message || null)}
        />
      ) : null}

      <div className={`admin-catalog-toast ${notice ? 'is-visible' : ''}`} role="status">
        <span>✓</span>
        <strong>{notice ?? 'Đã lưu thay đổi.'}</strong>
      </div>
    </main>
  );
}
