import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { AdminServicePoint } from '@nhdp/contracts';

import {
  AdminApiError,
  createAdminServicePoint,
  getAdminServicePointQrPackUrl,
  getAdminServicePointQrUrl,
  getAdminServicePoints,
  getAdminSession,
  updateAdminServicePoint,
} from '../lib/admin-api';

function isAuthenticationError(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 401;
}

interface ServicePointCardProps {
  servicePoint: AdminServicePoint;
  busy: boolean;
  onSave: (
    servicePointId: string,
    values: { code: string; name: string; sortOrder: number },
  ) => void;
  onToggle: (servicePoint: AdminServicePoint) => void;
}

function ServicePointCard({ servicePoint, busy, onSave, onToggle }: ServicePointCardProps) {
  const [code, setCode] = useState(servicePoint.code);
  const [name, setName] = useState(servicePoint.name);
  const [sortOrder, setSortOrder] = useState(servicePoint.sortOrder);

  const normalizedCode = code.trim().toUpperCase();
  const normalizedName = name.trim();
  const canSave =
    normalizedCode.length >= 2 &&
    normalizedName.length > 0 &&
    Number.isInteger(sortOrder) &&
    sortOrder >= 0;

  return (
    <article className="rounded-2xl border border-line bg-white p-5 shadow-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">
            {servicePoint.slug}
          </p>
          <h2 className="mt-1 text-2xl font-black">{servicePoint.name}</h2>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-black ${
            servicePoint.status === 'ACTIVE'
              ? 'bg-success-soft text-success'
              : 'bg-neutral-soft text-muted'
          }`}
        >
          {servicePoint.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đang tắt'}
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-bold">Mã sân</span>
          <input
            value={code}
            maxLength={40}
            disabled={busy}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold">Thứ tự</span>
          <input
            type="number"
            min={0}
            max={1_000_000}
            value={sortOrder}
            disabled={busy}
            onChange={(event) => setSortOrder(Number(event.target.value))}
            className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm font-bold">Tên hiển thị</span>
          <input
            value={name}
            maxLength={120}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
          />
        </label>
      </div>

      <div className="mt-4 rounded-xl bg-neutral-soft p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Đường dẫn khách</p>
        <a
          href={servicePoint.customerUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block break-all text-sm font-bold text-brand hover:underline"
        >
          {servicePoint.customerUrl}
        </a>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button
          type="button"
          disabled={busy || !canSave}
          onClick={() =>
            onSave(servicePoint.id, {
              code: normalizedCode,
              name: normalizedName,
              sortOrder,
            })
          }
          className="rounded-xl bg-brand px-3 py-2.5 text-sm font-black text-white disabled:opacity-50"
        >
          Lưu
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onToggle(servicePoint)}
          className={`rounded-xl border px-3 py-2.5 text-sm font-black disabled:opacity-50 ${
            servicePoint.status === 'ACTIVE'
              ? 'border-danger text-danger'
              : 'border-success text-success'
          }`}
        >
          {servicePoint.status === 'ACTIVE' ? 'Tắt sân' : 'Bật sân'}
        </button>
        <a
          href={getAdminServicePointQrUrl(servicePoint.id, 'png')}
          className="rounded-xl border border-line px-3 py-2.5 text-center text-sm font-black"
        >
          QR PNG
        </a>
        <a
          href={getAdminServicePointQrUrl(servicePoint.id, 'svg')}
          className="rounded-xl border border-line px-3 py-2.5 text-center text-sm font-black"
        >
          QR SVG
        </a>
      </div>
    </article>
  );
}

export function AdminServicePointsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [createCode, setCreateCode] = useState('');
  const [createName, setCreateName] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [createSortOrder, setCreateSortOrder] = useState(0);
  const [operationError, setOperationError] = useState<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: ['admin', 'session'],
    queryFn: getAdminSession,
    retry: false,
    staleTime: 60_000,
  });
  const servicePointsQuery = useQuery({
    queryKey: ['admin', 'service-points'],
    queryFn: getAdminServicePoints,
    enabled: sessionQuery.isSuccess,
    retry: false,
  });

  useEffect(() => {
    if (
      (sessionQuery.isError && isAuthenticationError(sessionQuery.error)) ||
      (servicePointsQuery.isError && isAuthenticationError(servicePointsQuery.error))
    ) {
      queryClient.removeQueries({ queryKey: ['admin'] });
      void navigate('/admin/login', { replace: true });
    }
  }, [
    navigate,
    queryClient,
    servicePointsQuery.error,
    servicePointsQuery.isError,
    sessionQuery.error,
    sessionQuery.isError,
  ]);

  const applySnapshot = (snapshot: NonNullable<typeof servicePointsQuery.data>) => {
    queryClient.setQueryData(['admin', 'service-points'], snapshot);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    setOperationError(null);
  };

  const createMutation = useMutation({
    mutationFn: createAdminServicePoint,
    onSuccess(snapshot) {
      applySnapshot(snapshot);
      setCreateCode('');
      setCreateName('');
      setCreateSlug('');
      setCreateSortOrder(snapshot.servicePoints.length);
      setShowCreate(false);
    },
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Không thể tạo sân.'),
  });
  const updateMutation = useMutation({
    mutationFn: ({
      servicePointId,
      values,
    }: {
      servicePointId: string;
      values: { code?: string; name?: string; sortOrder?: number; status?: 'ACTIVE' | 'INACTIVE' };
    }) => updateAdminServicePoint(servicePointId, values),
    onSuccess: applySnapshot,
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Không thể cập nhật sân.'),
  });

  if (sessionQuery.isPending || (sessionQuery.isSuccess && servicePointsQuery.isPending)) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface text-ink">
        <p className="font-bold text-muted">Đang tải danh sách sân…</p>
      </main>
    );
  }

  if (sessionQuery.isError || servicePointsQuery.isError || !servicePointsQuery.data) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface px-5 text-ink">
        <section className="max-w-md rounded-2xl border border-line bg-white p-6 text-center shadow-panel">
          <h1 className="text-xl font-black">Không thể tải quản lý sân</h1>
          <p className="mt-2 text-sm text-muted">Kiểm tra kết nối rồi thử lại.</p>
          <button
            type="button"
            onClick={() => void servicePointsQuery.refetch()}
            className="mt-5 rounded-xl bg-brand px-5 py-3 font-black text-white"
          >
            Thử lại
          </button>
        </section>
      </main>
    );
  }

  const snapshot = servicePointsQuery.data;
  const busy = createMutation.isPending || updateMutation.isPending;
  const normalizedCreateCode = createCode.trim().toUpperCase();
  const normalizedCreateName = createName.trim();
  const normalizedCreateSlug = createSlug.trim().toLowerCase();
  const canCreate =
    normalizedCreateCode.length >= 2 &&
    normalizedCreateName.length > 0 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedCreateSlug) &&
    Number.isInteger(createSortOrder) &&
    createSortOrder >= 0;

  return (
    <main className="min-h-screen bg-surface px-4 py-6 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-3xl border border-line bg-white p-5 shadow-panel sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Link to="/admin" className="text-sm font-black text-brand">
                ← Dashboard
              </Link>
              <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-brand">
                {snapshot.venue.name}
              </p>
              <h1 className="mt-1 text-3xl font-black">Quản lý sân và QR</h1>
              <p className="mt-2 text-sm text-muted">
                {snapshot.servicePoints.length} sân · Public origin: {snapshot.publicOrigin}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={getAdminServicePointQrPackUrl()}
                className="rounded-xl border border-brand px-4 py-3 font-black text-brand"
              >
                Tải toàn bộ QR
              </a>
              <button
                type="button"
                onClick={() => {
                  setCreateSortOrder(snapshot.servicePoints.length);
                  setShowCreate((value) => !value);
                }}
                className="rounded-xl bg-brand px-4 py-3 font-black text-white"
              >
                {showCreate ? 'Đóng form' : 'Thêm sân'}
              </button>
            </div>
          </div>
        </header>

        {operationError ? (
          <p className="mt-4 rounded-xl bg-danger-soft px-4 py-3 font-bold text-danger">
            {operationError}
          </p>
        ) : null}

        {showCreate ? (
          <section className="mt-5 rounded-2xl border border-brand/30 bg-white p-5 shadow-panel">
            <h2 className="text-xl font-black">Tạo sân mới</h2>
            <p className="mt-1 text-sm text-muted">
              Slug được khóa sau khi tạo để bảo vệ QR đã in.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <span className="text-sm font-bold">Mã sân</span>
                <input
                  value={createCode}
                  disabled={busy}
                  maxLength={40}
                  placeholder="S11"
                  onChange={(event) => setCreateCode(event.target.value.toUpperCase())}
                  className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
                />
              </label>
              <label className="block">
                <span className="text-sm font-bold">Tên sân</span>
                <input
                  value={createName}
                  disabled={busy}
                  maxLength={120}
                  placeholder="Sân 11"
                  onChange={(event) => setCreateName(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
                />
              </label>
              <label className="block">
                <span className="text-sm font-bold">Slug QR</span>
                <input
                  value={createSlug}
                  disabled={busy}
                  maxLength={120}
                  placeholder="san-11"
                  onChange={(event) => setCreateSlug(event.target.value.toLowerCase())}
                  className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
                />
              </label>
              <label className="block">
                <span className="text-sm font-bold">Thứ tự</span>
                <input
                  type="number"
                  min={0}
                  max={1_000_000}
                  value={createSortOrder}
                  disabled={busy}
                  onChange={(event) => setCreateSortOrder(Number(event.target.value))}
                  className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={busy || !canCreate}
              onClick={() =>
                createMutation.mutate({
                  code: normalizedCreateCode,
                  name: normalizedCreateName,
                  slug: normalizedCreateSlug,
                  status: 'ACTIVE',
                  sortOrder: createSortOrder,
                })
              }
              className="mt-4 rounded-xl bg-brand px-5 py-3 font-black text-white disabled:opacity-50"
            >
              {createMutation.isPending ? 'Đang tạo…' : 'Tạo sân'}
            </button>
          </section>
        ) : null}

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          {snapshot.servicePoints.map((servicePoint) => (
            <ServicePointCard
              key={`${servicePoint.id}:${servicePoint.updatedAt}`}
              servicePoint={servicePoint}
              busy={busy}
              onSave={(servicePointId, values) => updateMutation.mutate({ servicePointId, values })}
              onToggle={(current) =>
                updateMutation.mutate({
                  servicePointId: current.id,
                  values: { status: current.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
                })
              }
            />
          ))}
        </section>
      </div>
    </main>
  );
}
