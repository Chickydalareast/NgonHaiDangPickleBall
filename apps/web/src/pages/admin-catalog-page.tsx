import type {
  AdminCatalogCategory,
  AdminCatalogItem,
  AdminCatalogResponse,
  CreateAdminCatalogCategoryRequest,
  CreateAdminCatalogItemRequest,
} from '@nhdp/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  AdminApiError,
  attachAdminCatalogItemImage,
  createAdminCatalogCategory,
  createAdminCatalogImageSignature,
  createAdminCatalogItem,
  getAdminCatalog,
  getAdminSession,
  removeAdminCatalogItemImage,
  updateAdminCatalogCategory,
  updateAdminCatalogItem,
} from '../lib/admin-api';
import { buildCloudinaryImageUrl } from '../lib/cloudinary-image';

const catalogQueryKey = ['admin', 'catalog'] as const;
type CatalogStatus = 'ACTIVE' | 'INACTIVE';

function isAuthenticationError(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 401;
}

function toNullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readFormText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

function replaceCatalog(
  queryClient: ReturnType<typeof useQueryClient>,
  catalog: AdminCatalogResponse,
) {
  queryClient.setQueryData(catalogQueryKey, catalog);
}

interface CategoryEditorProps {
  category: AdminCatalogCategory;
  onSaved: (catalog: AdminCatalogResponse) => void;
  setPageError: (message: string | null) => void;
}

function CategoryEditor({ category, onSaved, setPageError }: CategoryEditorProps) {
  const [name, setName] = useState(category.name);
  const [slug, setSlug] = useState(category.slug);
  const [description, setDescription] = useState(category.description ?? '');
  const [status, setStatus] = useState<CatalogStatus>(category.status);
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder));
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setPageError(null);

    try {
      const catalog = await updateAdminCatalogCategory(category.id, {
        name,
        slug,
        description: toNullableText(description),
        status,
        sortOrder: Number(sortOrder),
      });
      onSaved(catalog);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Không thể cập nhật danh mục.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded-2xl border border-line bg-neutral-soft p-4 md:grid-cols-2"
    >
      <label className="block">
        <span className="text-xs font-black uppercase tracking-wide text-muted">Tên danh mục</span>
        <input
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2"
        />
      </label>
      <label className="block">
        <span className="text-xs font-black uppercase tracking-wide text-muted">Slug</span>
        <input
          required
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          maxLength={160}
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2"
        />
      </label>
      <label className="block md:col-span-2">
        <span className="text-xs font-black uppercase tracking-wide text-muted">Mô tả</span>
        <textarea
          maxLength={1000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="mt-1 min-h-20 w-full rounded-xl border border-line bg-white px-3 py-2"
        />
      </label>
      <label className="block">
        <span className="text-xs font-black uppercase tracking-wide text-muted">Trạng thái</span>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as CatalogStatus)}
          className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2"
        >
          <option value="ACTIVE">Đang hiển thị</option>
          <option value="INACTIVE">Đang ẩn</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-black uppercase tracking-wide text-muted">Thứ tự</span>
        <input
          required
          min={0}
          max={1000000}
          type="number"
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value)}
          className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2"
        />
      </label>
      <button
        disabled={saving}
        type="submit"
        className="rounded-xl border border-brand px-4 py-2 font-black text-brand disabled:opacity-60 md:col-span-2"
      >
        {saving ? 'Đang lưu…' : 'Lưu danh mục'}
      </button>
    </form>
  );
}

interface ItemEditorProps {
  item: AdminCatalogItem;
  categories: AdminCatalogCategory[];
  cloudName: string | null;
  mediaConfigured: boolean;
  onSaved: (catalog: AdminCatalogResponse) => void;
  setPageError: (message: string | null) => void;
}

function ItemEditor({
  item,
  categories,
  cloudName,
  mediaConfigured,
  onSaved,
  setPageError,
}: ItemEditorProps) {
  const [categoryId, setCategoryId] = useState(item.categoryId);
  const [name, setName] = useState(item.name);
  const [slug, setSlug] = useState(item.slug);
  const [description, setDescription] = useState(item.description ?? '');
  const [unitName, setUnitName] = useState(item.unitName);
  const [priceVnd, setPriceVnd] = useState(String(item.priceVnd));
  const [status, setStatus] = useState<CatalogStatus>(item.status);
  const [isAvailable, setIsAvailable] = useState(item.isAvailable);
  const [sortOrder, setSortOrder] = useState(String(item.sortOrder));
  const [imageAlt, setImageAlt] = useState(item.image?.alt ?? item.name);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const imageUrl = buildCloudinaryImageUrl(
    cloudName,
    item.image,
    'f_auto,q_auto,c_fill,w_360,h_270',
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setPageError(null);

    try {
      const catalog = await updateAdminCatalogItem(item.id, {
        categoryId,
        name,
        slug,
        description: toNullableText(description),
        unitName,
        priceVnd: Number(priceVnd),
        status,
        isAvailable,
        sortOrder: Number(sortOrder),
      });
      onSaved(catalog);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Không thể cập nhật mặt hàng.');
    } finally {
      setSaving(false);
    }
  }

  async function uploadImage(file: File) {
    if (!mediaConfigured) {
      setPageError('Cloudinary chưa được cấu hình trên máy chủ.');
      return;
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPageError('Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setPageError('Ảnh phải nhỏ hơn hoặc bằng 10 MB.');
      return;
    }

    setUploading(true);
    setPageError(null);

    try {
      const signed = await createAdminCatalogImageSignature(item.id);
      const form = new FormData();
      form.set('file', file);
      form.set('api_key', signed.apiKey);
      form.set('timestamp', String(signed.timestamp));
      form.set('signature', signed.signature);
      form.set('public_id', signed.publicId);
      form.set('allowed_formats', signed.parameters.allowedFormats);
      form.set('transformation', signed.parameters.transformation);

      const uploadResponse = await fetch(signed.uploadUrl, { method: 'POST', body: form });
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
      const catalog = await attachAdminCatalogItemImage(item.id, {
        publicId,
        version: Number(uploaded.version),
        width: Number(uploaded.width),
        height: Number(uploaded.height),
        format: format as 'jpg' | 'jpeg' | 'png' | 'webp',
        signature,
        alt: toNullableText(imageAlt),
      });
      onSaved(catalog);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Không thể tải ảnh mặt hàng.');
    } finally {
      setUploading(false);
    }
  }

  async function removeImage() {
    setUploading(true);
    setPageError(null);

    try {
      onSaved(await removeAdminCatalogItemImage(item.id));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Không thể gỡ ảnh mặt hàng.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <article className="rounded-2xl border border-line bg-white p-4 shadow-panel">
      <div className="grid gap-4 lg:grid-cols-[180px_1fr]">
        <div>
          <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-2xl bg-neutral-soft text-3xl font-black text-brand">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={item.image?.alt ?? item.name}
                className="h-full w-full object-cover"
              />
            ) : (
              item.name.slice(0, 1).toUpperCase()
            )}
          </div>
          <label className="mt-3 block">
            <span className="text-xs font-black uppercase tracking-wide text-muted">Alt ảnh</span>
            <input
              maxLength={200}
              value={imageAlt}
              onChange={(event) => setImageAlt(event.target.value)}
              className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm"
            />
          </label>
          <label
            className={`mt-3 block rounded-xl px-3 py-2 text-center text-sm font-black ${mediaConfigured ? 'cursor-pointer bg-brand text-white' : 'cursor-not-allowed bg-neutral-soft text-muted'}`}
          >
            {uploading ? 'Đang xử lý…' : item.image ? 'Thay ảnh' : 'Tải ảnh'}
            <input
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={!mediaConfigured || uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = '';
                if (file) void uploadImage(file);
              }}
            />
          </label>
          {item.image ? (
            <button
              type="button"
              disabled={uploading}
              onClick={() => void removeImage()}
              className="mt-2 w-full rounded-xl border border-danger px-3 py-2 text-sm font-black text-danger disabled:opacity-60"
            >
              Gỡ ảnh hiện tại
            </button>
          ) : null}
        </div>

        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-black uppercase tracking-wide text-muted">
              Tên mặt hàng
            </span>
            <input
              required
              maxLength={160}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-xl border border-line px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-wide text-muted">Slug</span>
            <input
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              maxLength={160}
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              className="mt-1 w-full rounded-xl border border-line px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-wide text-muted">Danh mục</span>
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="mt-1 w-full rounded-xl border border-line px-3 py-2"
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-wide text-muted">Đơn vị</span>
            <input
              required
              maxLength={40}
              value={unitName}
              onChange={(event) => setUnitName(event.target.value)}
              className="mt-1 w-full rounded-xl border border-line px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-wide text-muted">Giá VND</span>
            <input
              required
              min={0}
              max={2000000000}
              type="number"
              value={priceVnd}
              onChange={(event) => setPriceVnd(event.target.value)}
              className="mt-1 w-full rounded-xl border border-line px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-wide text-muted">Thứ tự</span>
            <input
              required
              min={0}
              max={1000000}
              type="number"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
              className="mt-1 w-full rounded-xl border border-line px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-wide text-muted">Bản ghi</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as CatalogStatus)}
              className="mt-1 w-full rounded-xl border border-line px-3 py-2"
            >
              <option value="ACTIVE">Đang dùng</option>
              <option value="INACTIVE">Đang ẩn</option>
            </select>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
            <input
              type="checkbox"
              checked={isAvailable}
              onChange={(event) => setIsAvailable(event.target.checked)}
            />
            <span className="text-sm font-black">Đang bán</span>
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs font-black uppercase tracking-wide text-muted">Mô tả</span>
            <textarea
              maxLength={1000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1 min-h-20 w-full rounded-xl border border-line px-3 py-2"
            />
          </label>
          <button
            disabled={saving}
            type="submit"
            className="rounded-xl bg-brand px-4 py-3 font-black text-white disabled:opacity-60 md:col-span-2"
          >
            {saving ? 'Đang lưu…' : 'Lưu mặt hàng'}
          </button>
        </form>
      </div>
    </article>
  );
}

export function AdminCatalogPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pageError, setPageError] = useState<string | null>(null);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [creatingItem, setCreatingItem] = useState(false);
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

  function onSaved(catalog: AdminCatalogResponse) {
    replaceCatalog(queryClient, catalog);
  }

  async function submitNewCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingCategory(true);
    setPageError(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const values: CreateAdminCatalogCategoryRequest = {
      name: readFormText(form, 'name'),
      slug: readFormText(form, 'slug'),
      description: toNullableText(readFormText(form, 'description')),
      status: 'ACTIVE',
      sortOrder: Number(form.get('sortOrder') ?? 0),
    };

    try {
      onSaved(await createAdminCatalogCategory(values));
      formElement.reset();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Không thể tạo danh mục.');
    } finally {
      setCreatingCategory(false);
    }
  }

  async function submitNewItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingItem(true);
    setPageError(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const values: CreateAdminCatalogItemRequest = {
      categoryId: readFormText(form, 'categoryId'),
      name: readFormText(form, 'name'),
      slug: readFormText(form, 'slug'),
      description: toNullableText(readFormText(form, 'description')),
      unitName: readFormText(form, 'unitName'),
      priceVnd: Number(form.get('priceVnd') ?? 0),
      status: 'ACTIVE',
      isAvailable: true,
      sortOrder: Number(form.get('sortOrder') ?? 0),
    };

    try {
      onSaved(await createAdminCatalogItem(values));
      formElement.reset();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Không thể tạo mặt hàng.');
    } finally {
      setCreatingItem(false);
    }
  }

  if (sessionQuery.isPending || (sessionQuery.isSuccess && catalogQuery.isPending)) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface text-ink">
        <p className="font-bold text-muted">Đang tải catalog…</p>
      </main>
    );
  }

  if (sessionQuery.isError || catalogQuery.isError || !catalogQuery.data) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface px-5 text-ink">
        <section className="max-w-md rounded-2xl border border-line bg-white p-6 text-center shadow-panel">
          <h1 className="text-xl font-black">Không thể tải catalog</h1>
          <button
            type="button"
            onClick={() => void catalogQuery.refetch()}
            className="mt-5 rounded-xl bg-brand px-5 py-3 font-bold text-white"
          >
            Thử lại
          </button>
        </section>
      </main>
    );
  }

  const catalog = catalogQuery.data;
  const allItems = catalog.categories.flatMap((category) => category.items);

  return (
    <main className="min-h-screen bg-surface px-4 py-6 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl border border-line bg-white p-5 shadow-panel sm:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-brand">Catalog V1</p>
              <h1 className="mt-2 text-3xl font-black">Danh mục và mặt hàng</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                V1 không quản lý tồn kho hoặc số lượng. Mặt hàng được xem là vô hạn và chỉ ngừng bán
                khi tắt “Đang bán” hoặc chuyển bản ghi sang “Đang ẩn”.
              </p>
            </div>
            <Link
              to="/admin"
              className="rounded-xl border border-line px-4 py-3 text-center font-black hover:border-brand hover:text-brand"
            >
              Về dashboard
            </Link>
          </div>
          <div
            className={`mt-4 rounded-xl px-4 py-3 text-sm font-bold ${catalog.media.configured ? 'bg-success-soft text-success' : 'bg-neutral-soft text-muted'}`}
          >
            {catalog.media.configured
              ? `Cloudinary đã sẵn sàng: ${catalog.media.cloudName}`
              : 'Cloudinary chưa cấu hình — CRUD catalog vẫn dùng được, chức năng tải ảnh đang khóa.'}
          </div>
        </header>

        {pageError ? (
          <div className="mt-4 rounded-xl bg-danger-soft px-4 py-3 font-bold text-danger">
            {pageError}
          </div>
        ) : null}

        <section className="mt-6 grid gap-5 lg:grid-cols-2">
          <form
            onSubmit={submitNewCategory}
            className="rounded-2xl border border-line bg-white p-5 shadow-panel"
          >
            <h2 className="text-xl font-black">Tạo danh mục</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input
                name="name"
                required
                maxLength={120}
                placeholder="Tên danh mục"
                className="rounded-xl border border-line px-3 py-2"
              />
              <input
                name="slug"
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                maxLength={160}
                placeholder="slug-khong-dau"
                className="rounded-xl border border-line px-3 py-2"
              />
              <textarea
                name="description"
                maxLength={1000}
                placeholder="Mô tả tùy chọn"
                className="min-h-20 rounded-xl border border-line px-3 py-2 sm:col-span-2"
              />
              <input
                name="sortOrder"
                required
                min={0}
                max={1000000}
                type="number"
                defaultValue={0}
                className="rounded-xl border border-line px-3 py-2"
              />
              <button
                disabled={creatingCategory}
                className="rounded-xl bg-brand px-4 py-2 font-black text-white disabled:opacity-60"
              >
                {creatingCategory ? 'Đang tạo…' : 'Tạo danh mục'}
              </button>
            </div>
          </form>

          <form
            onSubmit={submitNewItem}
            className="rounded-2xl border border-line bg-white p-5 shadow-panel"
          >
            <h2 className="text-xl font-black">Tạo mặt hàng</h2>
            {catalog.categories.length === 0 ? (
              <p className="mt-4 text-sm text-muted">Tạo danh mục trước khi tạo mặt hàng.</p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <select
                  name="categoryId"
                  required
                  className="rounded-xl border border-line px-3 py-2"
                >
                  {catalog.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <input
                  name="name"
                  required
                  maxLength={160}
                  placeholder="Tên mặt hàng"
                  className="rounded-xl border border-line px-3 py-2"
                />
                <input
                  name="slug"
                  required
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  maxLength={160}
                  placeholder="slug-khong-dau"
                  className="rounded-xl border border-line px-3 py-2"
                />
                <input
                  name="unitName"
                  required
                  maxLength={40}
                  placeholder="Đơn vị: chai, lon…"
                  className="rounded-xl border border-line px-3 py-2"
                />
                <input
                  name="priceVnd"
                  required
                  min={0}
                  max={2000000000}
                  type="number"
                  placeholder="Giá VND"
                  className="rounded-xl border border-line px-3 py-2"
                />
                <input
                  name="sortOrder"
                  required
                  min={0}
                  max={1000000}
                  type="number"
                  defaultValue={0}
                  className="rounded-xl border border-line px-3 py-2"
                />
                <textarea
                  name="description"
                  maxLength={1000}
                  placeholder="Mô tả tùy chọn"
                  className="min-h-20 rounded-xl border border-line px-3 py-2 sm:col-span-2"
                />
                <button
                  disabled={creatingItem}
                  className="rounded-xl bg-brand px-4 py-2 font-black text-white disabled:opacity-60 sm:col-span-2"
                >
                  {creatingItem ? 'Đang tạo…' : 'Tạo mặt hàng'}
                </button>
              </div>
            )}
          </form>
        </section>

        <section className="mt-6 space-y-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-brand">
                Đang quản lý
              </p>
              <h2 className="mt-1 text-2xl font-black">
                {catalog.categories.length} danh mục · {allItems.length} mặt hàng
              </h2>
            </div>
          </div>
          {catalog.categories.map((category) => (
            <section
              key={category.id}
              className="rounded-3xl border border-line bg-white p-5 shadow-panel sm:p-6"
            >
              <CategoryEditor
                key={`${category.id}:${category.updatedAt}`}
                category={category}
                onSaved={onSaved}
                setPageError={setPageError}
              />
              <div className="mt-5 space-y-4">
                {category.items.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
                    Danh mục chưa có mặt hàng.
                  </p>
                ) : (
                  category.items.map((item) => (
                    <ItemEditor
                      key={item.id}
                      item={item}
                      categories={catalog.categories}
                      cloudName={catalog.media.cloudName}
                      mediaConfigured={catalog.media.configured}
                      onSaved={onSaved}
                      setPageError={setPageError}
                    />
                  ))
                )}
              </div>
            </section>
          ))}
        </section>
      </div>
    </main>
  );
}
