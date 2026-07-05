import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type {
  AdminBillDetailResponse,
  AdminBillOrderLine,
  AdminCheckoutPreviewResponse,
  CreateAdminCustomChargeRequest,
  CreateAdminSettlementRequest,
  UpdateAdminCustomChargeRequest,
} from '@nhdp/contracts';

import { ActionDialog } from '../components/action-dialog';
import {
  AdminApiError,
  acknowledgeAdminBillOrderAlerts,
  addAdminBillItem,
  createAdminCourtRental,
  createAdminPaymentBatch,
  completeAdminBill,
  createAdminCustomCharge,
  createAdminSettlement,
  getAdminBill,
  getAdminCheckoutPreview,
  getAdminSession,
  reverseAdminSettlement,
  updateAdminCustomCharge,
  updateAdminOrderLine,
  updateAdminOrderStatus,
  voidAdminCustomCharge,
  voidAdminOrderLine,
} from '../lib/admin-api';
import { useAdminAlertRuntime } from '../components/admin-alert-runtime';
import { buildCloudinaryImageUrl } from '../lib/cloudinary-image';
import { fetchPublicServicePointContext } from '../lib/public-context-api';

const moneyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

const orderStatusLabel = {
  PENDING: 'Chưa xác nhận',
  ACCEPTED: 'Đã xác nhận',
  SERVED: 'Đã phục vụ',
  CANCELLED: 'Đã hủy',
} as const;

const lineKindLabel = {
  CATALOG: 'Món trong menu',
  MANUAL_PRODUCT: 'Mặt hàng custom',
  MANUAL_TIME: 'Phí thuê sân',
} as const;

type AddMode = 'CATALOG' | 'MANUAL_PRODUCT' | 'COURT_RENTAL';

interface CancelTarget {
  orderId: string;
  label: string;
}

interface QuantityTarget {
  lineId: string;
  itemName: string;
  quantity: number;
}

interface VoidTarget {
  lineId: string;
  itemName: string;
  custom: boolean;
}

interface SettlementTarget {
  lineId: string;
  itemName: string;
  outstandingQuantity: number;
  unitPriceVnd: number;
}

interface ReverseTarget {
  settlementId: string;
  itemName: string;
  type: 'PAID' | 'WAIVED';
  quantity: number;
}

function isAuthenticationError(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 401;
}

function hasActiveSettlements(line: AdminBillOrderLine): boolean {
  return line.settlements.some((settlement) => settlement.status === 'ACTIVE');
}

function clampQuantity(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.trunc(value), 1), maximum);
}

export function AdminBillPage() {
  const { billId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [addMode, setAddMode] = useState<AddMode>('CATALOG');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategoryId, setCatalogCategoryId] = useState('ALL');
  const [catalogQuantities, setCatalogQuantities] = useState<Record<string, number>>({});

  const [manualName, setManualName] = useState('');
  const [manualUnitName, setManualUnitName] = useState('phần');
  const [manualQuantity, setManualQuantity] = useState(1);
  const [manualUnitPriceVnd, setManualUnitPriceVnd] = useState(0);

  const [courtStartTime, setCourtStartTime] = useState('16:30');
  const [courtDurationHours, setCourtDurationHours] = useState(1);

  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [quantityTarget, setQuantityTarget] = useState<QuantityTarget | null>(null);
  const [quantityValue, setQuantityValue] = useState(1);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [editTarget, setEditTarget] = useState<AdminBillOrderLine | null>(null);
  const [editName, setEditName] = useState('');
  const [editUnitName, setEditUnitName] = useState('');
  const [editQuantity, setEditQuantity] = useState(1);
  const [editUnitPriceVnd, setEditUnitPriceVnd] = useState(0);
  const [editDurationMinutes, setEditDurationMinutes] = useState(60);
  const [editBillingIntervalMinutes, setEditBillingIntervalMinutes] = useState(30);
  const [settlementTarget, setSettlementTarget] = useState<SettlementTarget | null>(null);
  const [settlementType, setSettlementType] = useState<'PAID' | 'WAIVED'>('PAID');
  const [settlementQuantity, setSettlementQuantity] = useState(1);
  const [settlementReason, setSettlementReason] = useState('');
  const [reverseTarget, setReverseTarget] = useState<ReverseTarget | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: ['admin', 'session'],
    queryFn: getAdminSession,
    retry: false,
    staleTime: 60_000,
  });
  const { realtimeStatus } = useAdminAlertRuntime();
  const billQuery = useQuery({
    queryKey: ['admin', 'bill', billId],
    queryFn: () => getAdminBill(billId ?? ''),
    enabled: sessionQuery.isSuccess && Boolean(billId),
    retry: false,
    refetchInterval: realtimeStatus === 'connected' ? false : 15_000,
  });
  const menuQuery = useQuery({
    queryKey: ['public', 'context', billQuery.data?.servicePoint.slug],
    queryFn: ({ signal }) =>
      fetchPublicServicePointContext(billQuery.data?.servicePoint.slug ?? '', signal),
    enabled: Boolean(billQuery.data?.servicePoint.slug),
    staleTime: 30_000,
  });
  const checkoutQuery = useQuery({
    queryKey: ['admin', 'bill', billId, 'checkout-preview'],
    queryFn: () => getAdminCheckoutPreview(billId ?? ''),
    enabled: sessionQuery.isSuccess && Boolean(billId) && checkoutOpen,
    retry: false,
  });

  useEffect(() => {
    if (
      (sessionQuery.isError && isAuthenticationError(sessionQuery.error)) ||
      (billQuery.isError && isAuthenticationError(billQuery.error))
    ) {
      queryClient.removeQueries({ queryKey: ['admin'] });
      void navigate('/admin/login', { replace: true });
    }
  }, [
    billQuery.error,
    billQuery.isError,
    navigate,
    queryClient,
    sessionQuery.error,
    sessionQuery.isError,
  ]);

  const applyBillSnapshot = (snapshot: AdminBillDetailResponse) => {
    queryClient.setQueryData(['admin', 'bill', snapshot.bill.id], snapshot);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    void queryClient.invalidateQueries({
      queryKey: ['public', 'current-bill', snapshot.servicePoint.slug],
    });
    setOperationError(null);
  };

  const statusMutation = useMutation({
    mutationFn: ({
      orderId,
      status,
      reason,
    }: {
      orderId: string;
      status: 'ACCEPTED' | 'SERVED' | 'CANCELLED';
      reason?: string;
    }) =>
      updateAdminOrderStatus(
        orderId,
        status === 'CANCELLED' ? { status, reason: reason ?? '' } : { status },
      ),
    onSuccess(snapshot) {
      applyBillSnapshot(snapshot);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'alerts'] });
      setCancelTarget(null);
      setCancelReason('');
    },
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Không thể đổi trạng thái order.'),
  });

  const addCatalogItemMutation = useMutation({
    mutationFn: ({ catalogItemId, quantity }: { catalogItemId: string; quantity: number }) =>
      addAdminBillItem(billId ?? '', { catalogItemId, quantity }),
    onSuccess(snapshot, variables) {
      applyBillSnapshot(snapshot);
      setCatalogQuantities((current) => ({ ...current, [variables.catalogItemId]: 1 }));
    },
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Không thể thêm món vào bill.'),
  });

  const createCustomChargeMutation = useMutation({
    mutationFn: (request: CreateAdminCustomChargeRequest) =>
      createAdminCustomCharge(billId ?? '', request),
    onSuccess(snapshot, request) {
      applyBillSnapshot(snapshot);
      if (request.kind === 'MANUAL_PRODUCT') {
        setManualName('');
        setManualUnitName('phần');
        setManualQuantity(1);
        setManualUnitPriceVnd(0);
      }
    },
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Không thể thêm khoản phát sinh.'),
  });

  const createCourtRentalMutation = useMutation({
    mutationFn: () =>
      createAdminCourtRental(billId ?? '', {
        idempotencyKey: crypto.randomUUID(),
        startTime: courtStartTime,
        durationHours: courtDurationHours,
      }),
    onSuccess(response) {
      applyBillSnapshot(response.bill);
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'bill', billId, 'checkout-preview'],
      });
    },
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Không thể thêm phí thuê sân.'),
  });

  const quantityMutation = useMutation({
    mutationFn: ({ lineId, quantity }: { lineId: string; quantity: number }) =>
      updateAdminOrderLine(lineId, { quantity }),
    onSuccess(snapshot) {
      applyBillSnapshot(snapshot);
      setQuantityTarget(null);
    },
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Không thể đổi số lượng.'),
  });

  const updateCustomChargeMutation = useMutation({
    mutationFn: ({
      chargeId,
      request,
    }: {
      chargeId: string;
      request: UpdateAdminCustomChargeRequest;
    }) => updateAdminCustomCharge(chargeId, request),
    onSuccess(snapshot) {
      applyBillSnapshot(snapshot);
      setEditTarget(null);
    },
    onError: (error) =>
      setOperationError(
        error instanceof Error ? error.message : 'Không thể cập nhật khoản phát sinh.',
      ),
  });

  const voidMutation = useMutation({
    mutationFn: ({ lineId, reason, custom }: VoidTarget & { reason: string }) =>
      custom ? voidAdminCustomCharge(lineId, { reason }) : voidAdminOrderLine(lineId, { reason }),
    onSuccess(snapshot) {
      applyBillSnapshot(snapshot);
      setVoidTarget(null);
      setVoidReason('');
    },
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Không thể void khoản này.'),
  });

  const settlementMutation = useMutation({
    mutationFn: async ({
      lineId,
      request,
    }: {
      lineId: string;
      request: CreateAdminSettlementRequest;
    }) => {
      if (request.type === 'PAID') {
        const response = await createAdminPaymentBatch(billId ?? '', {
          idempotencyKey: request.idempotencyKey,
          allocations: [{ lineId, quantity: request.quantity }],
        });
        return response.bill;
      }
      return createAdminSettlement(lineId, request);
    },
    onSuccess(snapshot) {
      applyBillSnapshot(snapshot);
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'bill', billId, 'checkout-preview'],
      });
      setSettlementTarget(null);
      setSettlementReason('');
    },
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Không thể ghi nhận thanh toán.'),
  });

  const reverseSettlementMutation = useMutation({
    mutationFn: ({ settlementId, reason }: { settlementId: string; reason: string }) =>
      reverseAdminSettlement(settlementId, {
        idempotencyKey: crypto.randomUUID(),
        reason,
      }),
    onSuccess(snapshot) {
      applyBillSnapshot(snapshot);
      setReverseTarget(null);
      setReverseReason('');
    },
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Không thể hoàn tác settlement.'),
  });

  const acknowledgeCheckoutAlertsMutation = useMutation({
    mutationFn: () => acknowledgeAdminBillOrderAlerts(billId ?? ''),
    retry: 1,
    async onSettled() {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'alerts'] });
    },
    onError: (error) =>
      setOperationError(
        `Tạm tính vẫn được mở nhưng chưa dừng được toàn bộ cảnh báo order: ${
          error instanceof Error ? error.message : 'Lỗi không xác định.'
        }`,
      ),
  });

  const payOutstandingMutation = useMutation({
    mutationFn: async () => {
      const allocations = (billQuery.data?.orders ?? []).flatMap((order) =>
        order.lines
          .filter((line) => line.status === 'ACTIVE' && line.outstandingQuantity > 0)
          .map((line) => ({ lineId: line.id, quantity: line.outstandingQuantity })),
      );
      return createAdminPaymentBatch(billId ?? '', {
        idempotencyKey: crypto.randomUUID(),
        allocations,
      });
    },
    onSuccess(response) {
      applyBillSnapshot(response.bill);
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'bill', billId, 'checkout-preview'],
      });
    },
    onError: (error) =>
      setOperationError(
        error instanceof Error ? error.message : 'Không thể thanh toán phần còn lại.',
      ),
  });

  const completeMutation = useMutation({
    mutationFn: (preview: AdminCheckoutPreviewResponse) =>
      completeAdminBill(billId ?? '', { revision: preview.revision }),
    async onSuccess() {
      setOperationError(null);
      setCheckoutOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'bill', billId] }),
      ]);
    },
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Không thể hoàn tất bill.'),
  });

  const visibleCategories = useMemo(() => {
    const normalizedSearch = catalogSearch.trim().toLocaleLowerCase('vi-VN');
    return (menuQuery.data?.categories ?? [])
      .filter((category) => catalogCategoryId === 'ALL' || category.id === catalogCategoryId)
      .map((category) => ({
        ...category,
        items: category.items.filter((item) => {
          if (!normalizedSearch) return true;
          return `${item.name} ${item.description ?? ''} ${item.unitName}`
            .toLocaleLowerCase('vi-VN')
            .includes(normalizedSearch);
        }),
      }))
      .filter((category) => category.items.length > 0);
  }, [catalogCategoryId, catalogSearch, menuQuery.data]);

  if (sessionQuery.isPending || billQuery.isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface font-bold text-muted">
        Đang tải bill…
      </main>
    );
  }

  if (!billId || sessionQuery.isError || billQuery.isError || !billQuery.data) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface px-5 text-ink">
        <section className="max-w-md rounded-2xl border border-line bg-white p-6 text-center shadow-panel">
          <h1 className="text-xl font-black">Không thể tải bill</h1>
          <p className="mt-2 text-sm text-muted">Bill không tồn tại hoặc kết nối đang gián đoạn.</p>
          <Link
            className="mt-5 inline-flex rounded-xl bg-brand px-5 py-3 font-bold text-white"
            to="/admin"
          >
            Về dashboard
          </Link>
        </section>
      </main>
    );
  }

  const detail = billQuery.data;
  const isOpen = detail.bill.status === 'OPEN';
  const unresolvedOrderCount = detail.orders.filter(
    (order) => order.status === 'PENDING' || order.status === 'ACCEPTED',
  ).length;
  const outstandingTotalVnd = detail.summary.outstandingTotalVnd;
  const busy =
    statusMutation.isPending ||
    addCatalogItemMutation.isPending ||
    createCustomChargeMutation.isPending ||
    createCourtRentalMutation.isPending ||
    quantityMutation.isPending ||
    updateCustomChargeMutation.isPending ||
    voidMutation.isPending ||
    settlementMutation.isPending ||
    reverseSettlementMutation.isPending ||
    payOutstandingMutation.isPending ||
    completeMutation.isPending;

  const openEditCustomCharge = (line: AdminBillOrderLine) => {
    setOperationError(null);
    setEditTarget(line);
    setEditName(line.itemName);
    setEditUnitName(line.unitName);
    setEditQuantity(line.quantity);
    setEditUnitPriceVnd(line.unitPriceVnd);
    setEditDurationMinutes(line.durationMinutes ?? 60);
    setEditBillingIntervalMinutes(line.billingIntervalMinutes ?? 30);
  };

  return (
    <main className="min-h-screen bg-surface px-4 py-6 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl border border-line bg-white p-5 shadow-panel sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <Link to="/admin" className="text-sm font-black text-brand">
                ← Dashboard
              </Link>
              <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-muted">
                {detail.servicePoint.code}
              </p>
              <h1 className="mt-1 text-3xl font-black">{detail.servicePoint.name}</h1>
              <p className="mt-2 text-sm text-muted">{detail.venue.name}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                <span className="rounded-full bg-neutral-soft px-3 py-1 text-muted">
                  {realtimeStatus === 'connected'
                    ? 'Realtime đã kết nối'
                    : 'Polling dự phòng 15 giây'}
                </span>
                <a
                  href={`/s/${detail.servicePoint.slug}/bill`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-neutral-soft px-3 py-1 text-brand"
                >
                  Mở bill phía khách ↗
                </a>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:min-w-[520px] lg:grid-cols-4">
              <div className="rounded-2xl bg-neutral-soft p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Tổng bill</p>
                <p className="mt-1 text-xl font-black">
                  {moneyFormatter.format(detail.summary.grossTotalVnd)}
                </p>
              </div>
              <div className="rounded-2xl bg-success-soft p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-success">Đã trả</p>
                <p className="mt-1 text-xl font-black text-success">
                  {moneyFormatter.format(detail.summary.paidTotalVnd)}
                </p>
              </div>
              <div className="rounded-2xl bg-warning-soft p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-warning">Được miễn</p>
                <p className="mt-1 text-xl font-black text-warning">
                  {moneyFormatter.format(detail.summary.waivedTotalVnd)}
                </p>
              </div>
              <div className="rounded-2xl border border-brand bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-brand">Còn lại</p>
                <p className="mt-1 text-xl font-black text-brand">
                  {moneyFormatter.format(outstandingTotalVnd)}
                </p>
              </div>
              {isOpen ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setOperationError(null);
                    setCheckoutOpen(true);
                    acknowledgeCheckoutAlertsMutation.mutate();
                  }}
                  className="col-span-2 rounded-xl bg-success px-4 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-50 lg:col-span-4"
                >
                  Tạm tính
                </button>
              ) : (
                <p className="col-span-2 rounded-xl bg-success-soft px-4 py-3 text-center font-black text-success lg:col-span-4">
                  Bill đã hoàn tất
                </p>
              )}
            </div>
          </div>
        </header>

        {operationError ? (
          <p className="mt-4 rounded-xl bg-danger-soft px-4 py-3 font-bold text-danger">
            {operationError}
          </p>
        ) : null}

        {isOpen && (unresolvedOrderCount > 0 || outstandingTotalVnd > 0) ? (
          <section className="mt-4 grid gap-3 md:grid-cols-2">
            {unresolvedOrderCount > 0 ? (
              <p className="rounded-xl bg-neutral-soft px-4 py-3 font-bold text-muted">
                Có {unresolvedOrderCount} order chưa xác nhận hoặc chưa đánh dấu phục vụ. Các order
                này vẫn được tính tiền và không chặn tạm tính.
              </p>
            ) : null}
            {outstandingTotalVnd > 0 ? (
              <p className="rounded-xl bg-warning-soft px-4 py-3 font-bold text-warning">
                Còn {moneyFormatter.format(outstandingTotalVnd)} chưa PAID hoặc WAIVED.
              </p>
            ) : null}
          </section>
        ) : null}

        {isOpen ? (
          <section className="mt-5 rounded-3xl border border-line bg-white p-5 shadow-panel sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand">
                  Thao tác nhanh
                </p>
                <h2 className="mt-1 text-2xl font-black">Thêm khoản vào bill</h2>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-2xl bg-neutral-soft p-1.5">
                {(
                  [
                    ['CATALOG', 'Menu'],
                    ['MANUAL_PRODUCT', 'Custom'],
                    ['COURT_RENTAL', 'Thuê sân'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAddMode(mode)}
                    className={`rounded-xl px-3 py-2.5 text-sm font-black transition ${
                      addMode === mode ? 'bg-white text-brand shadow-sm' : 'text-muted'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {addMode === 'CATALOG' ? (
              <div className="mt-5">
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <input
                    value={catalogSearch}
                    onChange={(event) => setCatalogSearch(event.target.value)}
                    placeholder="Tìm theo tên món, mô tả hoặc đơn vị…"
                    className="rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
                  />
                  <div className="flex gap-2 overflow-x-auto">
                    <button
                      type="button"
                      onClick={() => setCatalogCategoryId('ALL')}
                      className={`shrink-0 rounded-full border px-4 py-2 text-sm font-black ${
                        catalogCategoryId === 'ALL'
                          ? 'border-brand bg-brand text-white'
                          : 'border-line'
                      }`}
                    >
                      Tất cả
                    </button>
                    {(menuQuery.data?.categories ?? []).map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setCatalogCategoryId(category.id)}
                        className={`shrink-0 rounded-full border px-4 py-2 text-sm font-black ${
                          catalogCategoryId === category.id
                            ? 'border-brand bg-brand text-white'
                            : 'border-line'
                        }`}
                      >
                        {category.name}
                      </button>
                    ))}
                  </div>
                </div>

                {menuQuery.isPending ? (
                  <p className="mt-5 rounded-xl bg-neutral-soft p-4 font-bold text-muted">
                    Đang tải menu…
                  </p>
                ) : visibleCategories.length === 0 ? (
                  <p className="mt-5 rounded-xl border border-dashed border-line p-5 text-center font-bold text-muted">
                    Không tìm thấy món phù hợp.
                  </p>
                ) : (
                  <div className="mt-5 space-y-6">
                    {visibleCategories.map((category) => (
                      <div key={category.id}>
                        <h3 className="font-black">{category.name}</h3>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {category.items.map((item) => {
                            const quantity = catalogQuantities[item.id] ?? 1;
                            const imageUrl = buildCloudinaryImageUrl(
                              menuQuery.data?.media.cloudName ?? null,
                              item.image,
                              'f_auto,q_auto,c_fill,w_160,h_160',
                            );
                            return (
                              <article
                                key={item.id}
                                className="flex gap-3 rounded-2xl border border-line p-3"
                              >
                                <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-neutral-soft text-xl font-black text-brand">
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
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-black">{item.name}</p>
                                  <p className="mt-1 text-sm font-bold text-brand">
                                    {moneyFormatter.format(item.priceVnd)} / {item.unitName}
                                  </p>
                                  <div className="mt-3 flex items-center gap-2">
                                    <button
                                      type="button"
                                      disabled={busy || quantity <= 1}
                                      onClick={() =>
                                        setCatalogQuantities((current) => ({
                                          ...current,
                                          [item.id]: Math.max(1, quantity - 1),
                                        }))
                                      }
                                      className="grid size-9 place-items-center rounded-lg border border-line font-black disabled:opacity-40"
                                    >
                                      −
                                    </button>
                                    <span className="min-w-7 text-center font-black">
                                      {quantity}
                                    </span>
                                    <button
                                      type="button"
                                      disabled={busy || quantity >= 50}
                                      onClick={() =>
                                        setCatalogQuantities((current) => ({
                                          ...current,
                                          [item.id]: Math.min(50, quantity + 1),
                                        }))
                                      }
                                      className="grid size-9 place-items-center rounded-lg border border-line font-black disabled:opacity-40"
                                    >
                                      +
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        addCatalogItemMutation.mutate({
                                          catalogItemId: item.id,
                                          quantity,
                                        })
                                      }
                                      className="ml-auto rounded-lg bg-brand px-3 py-2 text-sm font-black text-white disabled:opacity-50"
                                    >
                                      Thêm
                                    </button>
                                  </div>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {addMode === 'MANUAL_PRODUCT' ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className="block md:col-span-2">
                  <span className="text-sm font-bold">Tên mặt hàng</span>
                  <input
                    value={manualName}
                    maxLength={160}
                    disabled={busy}
                    onChange={(event) => setManualName(event.target.value)}
                    placeholder="Ví dụ: Khăn lạnh, phí hư hỏng…"
                    className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-bold">Đơn vị</span>
                  <input
                    value={manualUnitName}
                    maxLength={40}
                    disabled={busy}
                    onChange={(event) => setManualUnitName(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-bold">Số lượng</span>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={manualQuantity}
                    disabled={busy}
                    onChange={(event) => setManualQuantity(Number(event.target.value))}
                    className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
                  />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-sm font-bold">Đơn giá VND</span>
                  <input
                    type="number"
                    min={0}
                    max={2_147_483_647}
                    value={manualUnitPriceVnd}
                    disabled={busy}
                    onChange={(event) => setManualUnitPriceVnd(Number(event.target.value))}
                    className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
                  />
                </label>
                <div className="rounded-xl bg-neutral-soft p-4 md:col-span-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Dự kiến</p>
                  <p className="mt-1 text-xl font-black">
                    {moneyFormatter.format(Math.max(0, manualQuantity * manualUnitPriceVnd))}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Server sẽ tính và lưu giá trị chính thức.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={
                    busy ||
                    manualName.trim().length === 0 ||
                    manualUnitName.trim().length === 0 ||
                    !Number.isInteger(manualQuantity) ||
                    manualQuantity < 1 ||
                    manualQuantity > 999 ||
                    !Number.isInteger(manualUnitPriceVnd) ||
                    manualUnitPriceVnd < 0
                  }
                  onClick={() =>
                    createCustomChargeMutation.mutate({
                      idempotencyKey: crypto.randomUUID(),
                      kind: 'MANUAL_PRODUCT',
                      name: manualName.trim(),
                      unitName: manualUnitName.trim(),
                      quantity: manualQuantity,
                      unitPriceVnd: manualUnitPriceVnd,
                    })
                  }
                  className="rounded-xl bg-brand px-5 py-3 font-black text-white disabled:opacity-50 md:col-span-2 xl:col-span-4"
                >
                  {createCustomChargeMutation.isPending ? 'Đang thêm…' : 'Thêm mặt hàng custom'}
                </button>
              </div>
            ) : null}

            {addMode === 'COURT_RENTAL' ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className="block">
                  <span className="text-sm font-bold">Giờ bắt đầu</span>
                  <input
                    type="time"
                    step={1_800}
                    value={courtStartTime}
                    disabled={busy}
                    onChange={(event) => setCourtStartTime(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
                  />
                  <span className="mt-2 block text-xs text-muted">
                    Chỉ nhận mốc 00 hoặc 30 phút.
                  </span>
                </label>
                <label className="block">
                  <span className="text-sm font-bold">Số giờ thuê</span>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={courtDurationHours}
                    disabled={busy}
                    onChange={(event) => setCourtDurationHours(Number(event.target.value))}
                    className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
                  />
                </label>
                <div className="rounded-xl bg-neutral-soft p-4 md:col-span-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">
                    Quy tắc giá
                  </p>
                  <p className="mt-1 text-sm font-bold">
                    05:00–17:00 · 100.000đ/giờ · 17:00–19:00 · 140.000đ/giờ · từ 19:00 ·
                    120.000đ/giờ
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    Mỗi giờ lấy giá theo thời điểm bắt đầu của block. Sân 03 tự cộng phụ thu
                    30.000đ/giờ.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={
                    busy ||
                    !/^([01]\d|2[0-3]):(00|30)$/.test(courtStartTime) ||
                    !Number.isInteger(courtDurationHours) ||
                    courtDurationHours < 1 ||
                    courtDurationHours > 24
                  }
                  onClick={() => createCourtRentalMutation.mutate()}
                  className="rounded-xl bg-brand px-5 py-3 font-black text-white disabled:opacity-50 md:col-span-2 xl:col-span-4"
                >
                  {createCourtRentalMutation.isPending
                    ? 'Đang tính và thêm…'
                    : 'Tính và thêm phí thuê sân'}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="mt-5 rounded-3xl border border-line bg-white p-5 shadow-panel sm:p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand">
                Tổng hợp bill
              </p>
              <h2 className="mt-1 text-2xl font-black">Các khoản đang tính</h2>
            </div>
            <span className="text-sm font-bold text-muted">{detail.summary.items.length} nhóm</span>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {detail.summary.items.map((item) => (
              <article
                key={`${item.lineKind}:${item.catalogItemId ?? item.itemName}:${item.unitPriceVnd}`}
                className="rounded-2xl border border-line p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-black">{item.itemName}</p>
                    <p className="mt-1 text-xs font-bold uppercase tracking-wide text-muted">
                      {lineKindLabel[item.lineKind]} · {item.unitName}
                    </p>
                  </div>
                  <strong>{moneyFormatter.format(item.grossTotalVnd)}</strong>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-bold">
                  <span className="rounded-lg bg-success-soft px-2 py-2 text-success">
                    Trả {item.paidQuantity}
                  </span>
                  <span className="rounded-lg bg-warning-soft px-2 py-2 text-warning">
                    Miễn {item.waivedQuantity}
                  </span>
                  <span className="rounded-lg bg-neutral-soft px-2 py-2 text-muted">
                    Còn {item.outstandingQuantity}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-5 space-y-4">
          {detail.orders.map((order, index) => (
            <article
              key={order.id}
              className="rounded-2xl border border-line bg-white p-5 shadow-panel"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">
                    Order #{index + 1} · {order.source === 'ADMIN' ? 'Nhân viên thêm' : 'Khách gửi'}
                  </p>
                  <h2 className="mt-1 text-xl font-black">
                    {moneyFormatter.format(order.totalVnd)}
                  </h2>
                  {order.note ? (
                    <p className="mt-2 text-sm text-muted">Ghi chú: {order.note}</p>
                  ) : null}
                  {order.cancellationReason ? (
                    <p className="mt-2 text-sm font-bold text-danger">
                      Lý do hủy: {order.cancellationReason}
                    </p>
                  ) : null}
                </div>
                <span className="rounded-full bg-neutral-soft px-3 py-1 text-xs font-black">
                  {orderStatusLabel[order.status]}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {order.lines.map((line) => {
                  const isCustom = line.lineKind !== 'CATALOG';
                  const editableOrder = order.status === 'PENDING' || order.status === 'ACCEPTED';
                  const editableLine =
                    isOpen &&
                    line.status === 'ACTIVE' &&
                    editableOrder &&
                    !hasActiveSettlements(line);

                  return (
                    <div
                      key={line.id}
                      className={`rounded-2xl border p-4 ${
                        line.status === 'VOIDED'
                          ? 'border-line bg-neutral-soft opacity-70'
                          : 'border-line'
                      }`}
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-black">{line.itemName}</p>
                            <span className="rounded-full bg-neutral-soft px-2 py-1 text-[11px] font-black text-muted">
                              {lineKindLabel[line.lineKind]}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-muted">
                            {line.quantity} {line.unitName} ×{' '}
                            {moneyFormatter.format(line.unitPriceVnd)} ={' '}
                            <strong className="text-ink">
                              {moneyFormatter.format(line.lineTotalVnd)}
                            </strong>
                          </p>
                          {line.lineKind === 'MANUAL_TIME' ? (
                            <p className="mt-1 text-xs font-bold text-muted">
                              Thời lượng {line.durationMinutes} phút · Chu kỳ{' '}
                              {line.billingIntervalMinutes} phút
                            </p>
                          ) : null}
                          {line.voidReason ? (
                            <p className="mt-2 text-sm font-bold text-danger">
                              Đã void: {line.voidReason}
                            </p>
                          ) : null}
                        </div>

                        {line.status === 'ACTIVE' ? (
                          <div className="grid min-w-full grid-cols-3 gap-2 text-center text-xs font-black lg:min-w-[300px]">
                            <div className="rounded-xl bg-success-soft px-2 py-3 text-success">
                              <span className="block">PAID</span>
                              <span className="mt-1 block text-sm">{line.paidQuantity}</span>
                            </div>
                            <div className="rounded-xl bg-warning-soft px-2 py-3 text-warning">
                              <span className="block">WAIVED</span>
                              <span className="mt-1 block text-sm">{line.waivedQuantity}</span>
                            </div>
                            <div className="rounded-xl bg-neutral-soft px-2 py-3 text-muted">
                              <span className="block">CÒN</span>
                              <span className="mt-1 block text-sm">{line.outstandingQuantity}</span>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {isOpen && line.status === 'ACTIVE' ? (
                        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                          {editableLine && line.lineKind !== 'MANUAL_TIME' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setOperationError(null);
                                if (isCustom) {
                                  openEditCustomCharge(line);
                                } else {
                                  setQuantityTarget({
                                    lineId: line.id,
                                    itemName: line.itemName,
                                    quantity: line.quantity,
                                  });
                                  setQuantityValue(line.quantity);
                                }
                              }}
                              className="rounded-lg border border-line px-3 py-2 text-sm font-black"
                            >
                              Chỉnh sửa
                            </button>
                          ) : null}
                          {line.outstandingQuantity > 0 && order.status !== 'CANCELLED' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setOperationError(null);
                                setSettlementTarget({
                                  lineId: line.id,
                                  itemName: line.itemName,
                                  outstandingQuantity: line.outstandingQuantity,
                                  unitPriceVnd: line.unitPriceVnd,
                                });
                                setSettlementType('PAID');
                                setSettlementQuantity(line.outstandingQuantity);
                                setSettlementReason('');
                              }}
                              className="rounded-lg bg-success px-3 py-2 text-sm font-black text-white"
                            >
                              Ghi nhận thanh toán/miễn
                            </button>
                          ) : null}
                          {order.status !== 'CANCELLED' && !hasActiveSettlements(line) ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setOperationError(null);
                                setVoidTarget({
                                  lineId: line.id,
                                  itemName: line.itemName,
                                  custom: isCustom,
                                });
                                setVoidReason('');
                              }}
                              className="rounded-lg border border-danger px-3 py-2 text-sm font-black text-danger"
                            >
                              Void
                            </button>
                          ) : null}
                        </div>
                      ) : null}

                      {line.settlements.length > 0 ? (
                        <div className="mt-4 space-y-2 border-t border-line pt-4">
                          <p className="text-xs font-bold uppercase tracking-wide text-muted">
                            Lịch sử settlement
                          </p>
                          {line.settlements.map((settlement) => (
                            <div
                              key={settlement.id}
                              className={`flex flex-col gap-2 rounded-xl px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
                                settlement.status === 'ACTIVE'
                                  ? 'bg-neutral-soft'
                                  : 'bg-neutral-soft/60 opacity-65'
                              }`}
                            >
                              <div>
                                <p className="font-black">
                                  {settlement.type} · {settlement.quantity} ×{' '}
                                  {moneyFormatter.format(settlement.unitPriceVnd)} ={' '}
                                  {moneyFormatter.format(settlement.amountVnd)}
                                </p>
                                {settlement.reason ? (
                                  <p className="mt-1 text-xs text-muted">
                                    Lý do: {settlement.reason}
                                  </p>
                                ) : null}
                                {settlement.reversalReason ? (
                                  <p className="mt-1 text-xs font-bold text-danger">
                                    Đã hoàn tác: {settlement.reversalReason}
                                  </p>
                                ) : null}
                              </div>
                              {isOpen && settlement.status === 'ACTIVE' ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => {
                                    setOperationError(null);
                                    setReverseTarget({
                                      settlementId: settlement.id,
                                      itemName: line.itemName,
                                      type: settlement.type,
                                      quantity: settlement.quantity,
                                    });
                                    setReverseReason('');
                                  }}
                                  className="rounded-lg border border-danger px-3 py-2 text-xs font-black text-danger"
                                >
                                  Hoàn tác
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {isOpen ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {order.status === 'PENDING' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        statusMutation.mutate({ orderId: order.id, status: 'ACCEPTED' })
                      }
                      className="rounded-xl bg-brand px-4 py-2 font-black text-white"
                    >
                      Xác nhận đơn
                    </button>
                  ) : null}
                  {order.status === 'ACCEPTED' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => statusMutation.mutate({ orderId: order.id, status: 'SERVED' })}
                      className="rounded-xl border border-success px-4 py-2 font-black text-success"
                    >
                      Đánh dấu đã phục vụ (tùy chọn)
                    </button>
                  ) : null}
                  {order.status === 'PENDING' || order.status === 'ACCEPTED' ? (
                    <button
                      type="button"
                      disabled={busy || order.lines.some(hasActiveSettlements)}
                      onClick={() => {
                        setOperationError(null);
                        setCancelTarget({ orderId: order.id, label: `Order #${index + 1}` });
                        setCancelReason('');
                      }}
                      className="rounded-xl border border-danger px-4 py-2 font-black text-danger disabled:opacity-50"
                    >
                      Hủy order
                    </button>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </section>
      </div>

      <ActionDialog
        open={cancelTarget !== null}
        title={`Hủy ${cancelTarget?.label ?? 'order'}`}
        description="Order bị hủy vẫn được giữ lại trong lịch sử. Nhập lý do rõ ràng để phục vụ audit."
        confirmLabel="Xác nhận hủy"
        danger
        busy={statusMutation.isPending}
        confirmDisabled={cancelReason.trim().length < 3 || cancelReason.trim().length > 300}
        error={operationError}
        onClose={() => {
          if (!statusMutation.isPending) setCancelTarget(null);
        }}
        onConfirm={() => {
          if (!cancelTarget) return;
          statusMutation.mutate({
            orderId: cancelTarget.orderId,
            status: 'CANCELLED',
            reason: cancelReason.trim(),
          });
        }}
      >
        <label className="block">
          <span className="text-sm font-bold">Lý do hủy</span>
          <textarea
            value={cancelReason}
            maxLength={300}
            rows={4}
            autoFocus
            onChange={(event) => setCancelReason(event.target.value)}
            placeholder="Ví dụ: Khách đổi món, nhân viên nhập nhầm…"
            className="mt-2 w-full resize-none rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
          />
          <span className="mt-1 block text-right text-xs text-muted">
            {cancelReason.trim().length}/300
          </span>
        </label>
      </ActionDialog>

      <ActionDialog
        open={quantityTarget !== null}
        title={`Đổi số lượng · ${quantityTarget?.itemName ?? ''}`}
        confirmLabel="Lưu số lượng"
        busy={quantityMutation.isPending}
        confirmDisabled={
          !Number.isInteger(quantityValue) || quantityValue < 1 || quantityValue > 50
        }
        error={operationError}
        onClose={() => {
          if (!quantityMutation.isPending) setQuantityTarget(null);
        }}
        onConfirm={() => {
          if (!quantityTarget) return;
          quantityMutation.mutate({ lineId: quantityTarget.lineId, quantity: quantityValue });
        }}
      >
        <label className="block">
          <span className="text-sm font-bold">Số lượng mới (1–50)</span>
          <input
            type="number"
            min={1}
            max={50}
            value={quantityValue}
            autoFocus
            onChange={(event) => setQuantityValue(Number(event.target.value))}
            className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
          />
        </label>
      </ActionDialog>

      <ActionDialog
        open={voidTarget !== null}
        title={`Void · ${voidTarget?.itemName ?? ''}`}
        description="Dữ liệu không bị xóa. Khoản này sẽ chuyển sang trạng thái VOIDED và không còn tính vào bill."
        confirmLabel="Xác nhận void"
        danger
        busy={voidMutation.isPending}
        confirmDisabled={voidReason.trim().length < 3 || voidReason.trim().length > 300}
        error={operationError}
        onClose={() => {
          if (!voidMutation.isPending) setVoidTarget(null);
        }}
        onConfirm={() => {
          if (!voidTarget) return;
          voidMutation.mutate({ ...voidTarget, reason: voidReason.trim() });
        }}
      >
        <label className="block">
          <span className="text-sm font-bold">Lý do void</span>
          <textarea
            value={voidReason}
            maxLength={300}
            rows={4}
            autoFocus
            onChange={(event) => setVoidReason(event.target.value)}
            className="mt-2 w-full resize-none rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
          />
        </label>
      </ActionDialog>

      <ActionDialog
        open={editTarget !== null}
        title={`Chỉnh khoản phát sinh · ${editTarget?.itemName ?? ''}`}
        description="Chỉ khoản chưa phục vụ và chưa có settlement đang hoạt động mới được chỉnh sửa."
        confirmLabel="Lưu thay đổi"
        busy={updateCustomChargeMutation.isPending}
        confirmDisabled={
          editName.trim().length === 0 ||
          (editTarget?.lineKind === 'MANUAL_PRODUCT'
            ? editUnitName.trim().length === 0 ||
              !Number.isInteger(editQuantity) ||
              editQuantity < 1 ||
              editQuantity > 999 ||
              !Number.isInteger(editUnitPriceVnd) ||
              editUnitPriceVnd < 0
            : !Number.isInteger(editDurationMinutes) ||
              editDurationMinutes < 1 ||
              editDurationMinutes > 1_440 ||
              !Number.isInteger(editBillingIntervalMinutes) ||
              editBillingIntervalMinutes < 1 ||
              editBillingIntervalMinutes > 1_440 ||
              !Number.isInteger(editUnitPriceVnd) ||
              editUnitPriceVnd < 0)
        }
        error={operationError}
        onClose={() => {
          if (!updateCustomChargeMutation.isPending) setEditTarget(null);
        }}
        onConfirm={() => {
          if (!editTarget || editTarget.lineKind === 'CATALOG') return;
          const request: UpdateAdminCustomChargeRequest =
            editTarget.lineKind === 'MANUAL_PRODUCT'
              ? {
                  kind: 'MANUAL_PRODUCT',
                  name: editName.trim(),
                  unitName: editUnitName.trim(),
                  quantity: editQuantity,
                  unitPriceVnd: editUnitPriceVnd,
                }
              : {
                  kind: 'MANUAL_TIME',
                  name: editName.trim(),
                  durationMinutes: editDurationMinutes,
                  billingIntervalMinutes: editBillingIntervalMinutes,
                  pricePerIntervalVnd: editUnitPriceVnd,
                };
          updateCustomChargeMutation.mutate({ chargeId: editTarget.id, request });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-sm font-bold">Tên</span>
            <input
              value={editName}
              maxLength={160}
              onChange={(event) => setEditName(event.target.value)}
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
            />
          </label>
          {editTarget?.lineKind === 'MANUAL_PRODUCT' ? (
            <>
              <label className="block">
                <span className="text-sm font-bold">Đơn vị</span>
                <input
                  value={editUnitName}
                  maxLength={40}
                  onChange={(event) => setEditUnitName(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
                />
              </label>
              <label className="block">
                <span className="text-sm font-bold">Số lượng</span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={editQuantity}
                  onChange={(event) => setEditQuantity(Number(event.target.value))}
                  className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
                />
              </label>
            </>
          ) : (
            <>
              <label className="block">
                <span className="text-sm font-bold">Thời lượng (phút)</span>
                <input
                  type="number"
                  min={1}
                  max={1_440}
                  value={editDurationMinutes}
                  onChange={(event) => setEditDurationMinutes(Number(event.target.value))}
                  className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
                />
              </label>
              <label className="block">
                <span className="text-sm font-bold">Chu kỳ (phút)</span>
                <input
                  type="number"
                  min={1}
                  max={1_440}
                  value={editBillingIntervalMinutes}
                  onChange={(event) => setEditBillingIntervalMinutes(Number(event.target.value))}
                  className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
                />
              </label>
            </>
          )}
          <label className="block sm:col-span-2">
            <span className="text-sm font-bold">
              {editTarget?.lineKind === 'MANUAL_TIME' ? 'Giá mỗi chu kỳ VND' : 'Đơn giá VND'}
            </span>
            <input
              type="number"
              min={0}
              max={2_147_483_647}
              value={editUnitPriceVnd}
              onChange={(event) => setEditUnitPriceVnd(Number(event.target.value))}
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
            />
          </label>
        </div>
      </ActionDialog>

      <ActionDialog
        open={settlementTarget !== null}
        title={`Xử lý tiền · ${settlementTarget?.itemName ?? ''}`}
        description={`Còn tối đa ${settlementTarget?.outstandingQuantity ?? 0} đơn vị chưa xử lý. Server tính số tiền chính thức theo snapshot giá.`}
        confirmLabel={settlementType === 'PAID' ? 'Ghi nhận PAID' : 'Ghi nhận WAIVED'}
        busy={settlementMutation.isPending}
        confirmDisabled={
          !settlementTarget ||
          !Number.isInteger(settlementQuantity) ||
          settlementQuantity < 1 ||
          settlementQuantity > settlementTarget.outstandingQuantity ||
          (settlementType === 'WAIVED' &&
            (settlementReason.trim().length < 3 || settlementReason.trim().length > 300))
        }
        error={operationError}
        onClose={() => {
          if (!settlementMutation.isPending) setSettlementTarget(null);
        }}
        onConfirm={() => {
          if (!settlementTarget) return;
          const request: CreateAdminSettlementRequest =
            settlementType === 'PAID'
              ? {
                  idempotencyKey: crypto.randomUUID(),
                  type: 'PAID',
                  quantity: settlementQuantity,
                }
              : {
                  idempotencyKey: crypto.randomUUID(),
                  type: 'WAIVED',
                  quantity: settlementQuantity,
                  reason: settlementReason.trim(),
                };
          settlementMutation.mutate({ lineId: settlementTarget.lineId, request });
        }}
      >
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-neutral-soft p-1.5">
          <button
            type="button"
            onClick={() => setSettlementType('PAID')}
            className={`rounded-xl px-3 py-3 font-black ${
              settlementType === 'PAID' ? 'bg-success text-white' : 'text-muted'
            }`}
          >
            PAID
          </button>
          <button
            type="button"
            onClick={() => setSettlementType('WAIVED')}
            className={`rounded-xl px-3 py-3 font-black ${
              settlementType === 'WAIVED' ? 'bg-warning text-white' : 'text-muted'
            }`}
          >
            WAIVED
          </button>
        </div>
        <label className="mt-4 block">
          <span className="text-sm font-bold">Số lượng xử lý</span>
          <input
            type="number"
            min={1}
            max={settlementTarget?.outstandingQuantity ?? 1}
            value={settlementQuantity}
            onChange={(event) =>
              setSettlementQuantity(
                clampQuantity(
                  Number(event.target.value),
                  settlementTarget?.outstandingQuantity ?? 1,
                ),
              )
            }
            className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
          />
          <span className="mt-2 block text-sm font-bold text-brand">
            Dự kiến{' '}
            {moneyFormatter.format(settlementQuantity * (settlementTarget?.unitPriceVnd ?? 0))}
          </span>
        </label>
        {settlementType === 'WAIVED' ? (
          <label className="mt-4 block">
            <span className="text-sm font-bold">Lý do miễn thu</span>
            <textarea
              value={settlementReason}
              maxLength={300}
              rows={4}
              onChange={(event) => setSettlementReason(event.target.value)}
              className="mt-2 w-full resize-none rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
            />
          </label>
        ) : null}
      </ActionDialog>

      <ActionDialog
        open={reverseTarget !== null}
        title={`Hoàn tác ${reverseTarget?.type ?? 'settlement'}`}
        description={`${reverseTarget?.itemName ?? ''} · ${reverseTarget?.quantity ?? 0} đơn vị. Settlement cũ vẫn được giữ trong audit.`}
        confirmLabel="Xác nhận hoàn tác"
        danger
        busy={reverseSettlementMutation.isPending}
        confirmDisabled={reverseReason.trim().length < 3 || reverseReason.trim().length > 300}
        error={operationError}
        onClose={() => {
          if (!reverseSettlementMutation.isPending) setReverseTarget(null);
        }}
        onConfirm={() => {
          if (!reverseTarget) return;
          reverseSettlementMutation.mutate({
            settlementId: reverseTarget.settlementId,
            reason: reverseReason.trim(),
          });
        }}
      >
        <label className="block">
          <span className="text-sm font-bold">Lý do hoàn tác</span>
          <textarea
            value={reverseReason}
            maxLength={300}
            rows={4}
            autoFocus
            onChange={(event) => setReverseReason(event.target.value)}
            className="mt-2 w-full resize-none rounded-xl border border-line px-4 py-3 outline-none focus:border-brand"
          />
        </label>
      </ActionDialog>

      <ActionDialog
        open={checkoutOpen}
        title="Tạm tính và kiểm tra toàn bộ bill"
        description="Tất cả order chưa hủy đều được tính, kể cả order chưa xác nhận hoặc chưa đánh dấu phục vụ. Các lần đã thanh toán vẫn giữ riêng để đối soát."
        confirmLabel="Hoàn thành bill"
        busy={completeMutation.isPending || payOutstandingMutation.isPending}
        confirmDisabled={!checkoutQuery.data || checkoutQuery.data.outstandingTotalVnd > 0}
        error={operationError}
        onClose={() => {
          if (!completeMutation.isPending && !payOutstandingMutation.isPending)
            setCheckoutOpen(false);
        }}
        onConfirm={() => {
          if (checkoutQuery.data) completeMutation.mutate(checkoutQuery.data);
        }}
      >
        {checkoutQuery.isPending ? (
          <p className="rounded-2xl bg-neutral-soft p-5 text-center font-bold text-muted">
            Đang lập bản tạm tính…
          </p>
        ) : checkoutQuery.data ? (
          <div className="space-y-5">
            {checkoutQuery.data.courtRentals.length > 0 ? (
              <section className="rounded-2xl border border-line p-4">
                <h3 className="font-black">Phí thuê sân</h3>
                {checkoutQuery.data.courtRentals.map((rental) => (
                  <div key={rental.id} className="mt-3">
                    <p className="text-sm font-bold">
                      {rental.startTime} · {rental.durationHours} giờ ·{' '}
                      {moneyFormatter.format(rental.totalAmountVnd)}
                    </p>
                    <div className="mt-2 space-y-1 text-sm text-muted">
                      {rental.breakdown.map((block) => (
                        <div key={block.sequence} className="flex justify-between gap-4">
                          <span>
                            {block.startsAt}–{block.endsAt}
                          </span>
                          <span>{moneyFormatter.format(block.totalVnd)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            <section>
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-black">Chưa thanh toán</h3>
                <strong className="text-brand">
                  {moneyFormatter.format(checkoutQuery.data.outstandingTotalVnd)}
                </strong>
              </div>
              {checkoutQuery.data.outstandingItems.length === 0 ? (
                <p className="mt-3 rounded-xl bg-success-soft p-4 font-bold text-success">
                  Không còn khoản chưa thanh toán.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {checkoutQuery.data.outstandingItems.map((item) => (
                    <div
                      key={`${item.lineKind}:${item.itemName}:${item.unitPriceVnd}`}
                      className="flex items-center justify-between gap-4 rounded-xl bg-neutral-soft p-3"
                    >
                      <div>
                        <p className="font-bold">{item.itemName}</p>
                        <p className="text-xs text-muted">
                          {item.quantity} × {moneyFormatter.format(item.unitPriceVnd)}
                        </p>
                      </div>
                      <strong>{moneyFormatter.format(item.totalVnd)}</strong>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={payOutstandingMutation.isPending}
                    onClick={() => payOutstandingMutation.mutate()}
                    className="w-full rounded-xl bg-brand px-4 py-3 font-black text-white disabled:opacity-50"
                  >
                    {payOutstandingMutation.isPending
                      ? 'Đang ghi nhận…'
                      : 'Thanh toán toàn bộ phần còn lại'}
                  </button>
                </div>
              )}
            </section>

            <section>
              <h3 className="font-black">Các lần đã thanh toán</h3>
              {checkoutQuery.data.paymentBatches.length === 0 ? (
                <p className="mt-3 text-sm text-muted">Chưa có lần thanh toán nào.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {checkoutQuery.data.paymentBatches.map((batch, index) => (
                    <details key={batch.id} className="rounded-xl border border-line p-3">
                      <summary className="cursor-pointer font-black">
                        Thanh toán lần {index + 1} · {moneyFormatter.format(batch.totalVnd)}
                      </summary>
                      <div className="mt-3 space-y-2">
                        {batch.items.map((item) => (
                          <div
                            key={`${item.itemName}:${item.unitPriceVnd}`}
                            className="flex justify-between gap-4 text-sm"
                          >
                            <span>
                              {item.itemName} × {item.quantity}
                            </span>
                            <strong>{moneyFormatter.format(item.totalVnd)}</strong>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </section>

            <details className="rounded-2xl border border-line p-4">
              <summary className="cursor-pointer font-black">
                Tổng hợp toàn bộ món trong bill
              </summary>
              <div className="mt-3 space-y-2">
                {checkoutQuery.data.allItems.map((item) => (
                  <div
                    key={`${item.lineKind}:${item.itemName}:${item.unitPriceVnd}`}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <span>
                      {item.itemName} × {item.quantity}
                    </span>
                    <strong>{moneyFormatter.format(item.totalVnd)}</strong>
                  </div>
                ))}
              </div>
            </details>

            <section className="rounded-2xl bg-neutral-soft p-4">
              <div className="flex justify-between gap-4">
                <span>Tổng phát sinh</span>
                <strong>{moneyFormatter.format(checkoutQuery.data.grossTotalVnd)}</strong>
              </div>
              <div className="mt-2 flex justify-between gap-4">
                <span>Đã thanh toán</span>
                <strong className="text-success">
                  {moneyFormatter.format(checkoutQuery.data.paidTotalVnd)}
                </strong>
              </div>
              <div className="mt-2 flex justify-between gap-4">
                <span>Miễn thu</span>
                <strong className="text-warning">
                  {moneyFormatter.format(checkoutQuery.data.waivedTotalVnd)}
                </strong>
              </div>
              <div className="mt-3 flex justify-between gap-4 border-t border-line pt-3">
                <span className="font-black">Còn phải thu</span>
                <strong className="text-brand">
                  {moneyFormatter.format(checkoutQuery.data.outstandingTotalVnd)}
                </strong>
              </div>
              {checkoutQuery.data.unresolvedOrderCount > 0 ? (
                <p className="mt-3 rounded-xl bg-neutral-soft p-3 text-sm font-bold text-muted">
                  Có {checkoutQuery.data.unresolvedOrderCount} order chưa xác nhận hoặc chưa đánh
                  dấu phục vụ. Hệ thống vẫn tính toàn bộ các order chưa hủy; trạng thái phục vụ chỉ
                  dùng để theo dõi vận hành.
                </p>
              ) : null}
            </section>
          </div>
        ) : (
          <p className="rounded-xl bg-danger-soft p-4 font-bold text-danger">
            Không thể lập bản tạm tính.
          </p>
        )}
      </ActionDialog>
    </main>
  );
}
