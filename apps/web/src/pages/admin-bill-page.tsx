import type {
  AdminBillDetailResponse,
  AdminBillOrderLine,
  AdminCheckoutPreviewResponse,
  CreateAdminCustomChargeRequest,
  CreateAdminSettlementRequest,
  UpdateAdminCustomChargeRequest,
} from '@nhdp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { ActionDialog } from '../components/action-dialog';
import { useAdminAlertRuntime } from '../components/admin-alert-runtime';
import { AdminPageHeader } from '../components/admin-page-header';
import {
  AdminApiError,
  acknowledgeAdminBillOrderAlerts,
  addAdminBillItem,
  completeAdminBill,
  createAdminCourtRental,
  createAdminCustomCharge,
  createAdminPaymentBatch,
  createAdminSettlement,
  getAdminBill,
  getAdminCheckoutPreview,
  getAdminSession,
  logoutAdmin,
  reverseAdminSettlement,
  updateAdminCustomCharge,
  updateAdminOrderLine,
  updateAdminOrderStatus,
  voidAdminCustomCharge,
  voidAdminOrderLine,
} from '../lib/admin-api';
import { buildCloudinaryImageUrl } from '../lib/cloudinary-image';
import { fetchPublicServicePointContext } from '../lib/public-context-api';

const moneyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});
const timeFormatter = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
});

const orderStatusLabel = {
  PENDING: 'Chưa xác nhận',
  ACCEPTED: 'Đã xác nhận',
  SERVED: 'Đã phục vụ',
  CANCELLED: 'Đã hủy',
} as const;

const lineKindLabel = {
  CATALOG: 'Món menu',
  MANUAL_PRODUCT: 'Khoản custom',
  MANUAL_TIME: 'Thuê sân',
} as const;

type AddMode = 'CATALOG' | 'MANUAL_PRODUCT' | 'COURT_RENTAL';

interface CancelTarget {
  orderId: string;
  label: string;
}
interface QuantityTarget {
  lineId: string;
  itemName: string;
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

function Icon({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const ArrowLeft = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);
const Chevron = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
const Receipt = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
    <path d="M9 8h6M9 12h6" />
  </Icon>
);
const Search = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4" />
  </Icon>
);
const Plus = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
const Clock = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
const Check = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 2.5 2.5L16 9" />
  </Icon>
);
const External = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M14 3h7v7M10 14 21 3M21 14v7h-7M3 10V3h7M3 14v7h7" />
  </Icon>
);
const Package = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
    <path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12.1V21" />
  </Icon>
);

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
function lineImageUrl(cloudName: string | null, line: AdminBillOrderLine): string | null {
  if (!line.imagePublicId) return null;
  return buildCloudinaryImageUrl(
    cloudName,
    { publicId: line.imagePublicId, version: null, format: null },
    'f_auto,q_auto,c_fill,w_180,h_180',
  );
}

function LoadingState() {
  return (
    <main className="ab-page ab-state-page" aria-busy="true">
      <section className="ab-state-card">
        <span className="ab-spinner" />
        <h1>Đang tải bill</h1>
        <p>Đang đồng bộ dữ liệu vận hành và số tiền từ máy chủ.</p>
      </section>
    </main>
  );
}

export function AdminBillPage() {
  const { billId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [addMode, setAddMode] = useState<AddMode>('CATALOG');
  const [menuCollapsed, setMenuCollapsed] = useState(false);
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
  const logoutMutation = useMutation({
    mutationFn: logoutAdmin,
    onSettled() {
      queryClient.removeQueries({ queryKey: ['admin'] });
      void navigate('/admin/login', { replace: true });
    },
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

  if (sessionQuery.isPending || billQuery.isPending) return <LoadingState />;

  if (!billId || sessionQuery.isError || billQuery.isError || !billQuery.data) {
    return (
      <main className="ab-page ab-state-page">
        <section className="ab-state-card">
          <Receipt className="ab-state-icon" />
          <h1>Không thể tải bill</h1>
          <p>Bill không tồn tại hoặc kết nối đang gián đoạn.</p>
          <Link to="/admin">Về dashboard</Link>
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
  const orderedNewestFirst = [...detail.orders].reverse();
  const cloudName = menuQuery.data?.media.cloudName ?? null;
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

  const openSettlement = (line: AdminBillOrderLine) => {
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
  };

  return (
    <main className="ab-page">
      <div className="ab-shell">
        <AdminPageHeader
          activePage="dashboard"
          admin={sessionQuery.data.admin}
          realtimeStatus={realtimeStatus}
          logoutPending={logoutMutation.isPending}
          onLogout={() => logoutMutation.mutate()}
        />

        <section className="ab-header">
          <article className="ab-identity">
            <Link to="/admin" className="ab-back" aria-label="Về dashboard">
              <ArrowLeft />
            </Link>
            <div className="ab-identity-copy">
              <small>
                {detail.servicePoint.code} · {isOpen ? 'BILL MỞ' : 'ĐÃ ĐÓNG'}
              </small>
              <h1>{detail.servicePoint.name}</h1>
              <p>{detail.venue.name}</p>
            </div>
            <a
              className="ab-public-link"
              href={`/s/${detail.servicePoint.slug}/bill`}
              target="_blank"
              rel="noreferrer"
            >
              <External />
              Bill khách
            </a>
          </article>

          <div className="ab-summary">
            <article>
              <Receipt />
              <span>Tổng bill</span>
              <strong>{moneyFormatter.format(detail.summary.grossTotalVnd)}</strong>
            </article>
            <article className="is-paid">
              <Check />
              <span>Đã trả</span>
              <strong>{moneyFormatter.format(detail.summary.paidTotalVnd)}</strong>
            </article>
            <article className="is-waived">
              <i>÷</i>
              <span>Miễn</span>
              <strong>{moneyFormatter.format(detail.summary.waivedTotalVnd)}</strong>
            </article>
            <article className="is-outstanding">
              <Clock />
              <span>Còn lại</span>
              <strong>{moneyFormatter.format(outstandingTotalVnd)}</strong>
            </article>
          </div>

          <aside className="ab-checkout-tile">
            <span>{unresolvedOrderCount} order đang xử lý</span>
            <strong>{moneyFormatter.format(outstandingTotalVnd)}</strong>
            {isOpen ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setOperationError(null);
                  setCheckoutOpen(true);
                  acknowledgeCheckoutAlertsMutation.mutate();
                }}
              >
                <Receipt />
                Tạm tính
              </button>
            ) : (
              <div className="ab-completed">
                <Check />
                Đã hoàn tất
              </div>
            )}
          </aside>
        </section>

        {operationError ? (
          <div className="ab-error" role="alert">
            <strong>Không thể hoàn tất thao tác</strong>
            <span>{operationError}</span>
            <button type="button" onClick={() => setOperationError(null)}>
              Đóng
            </button>
          </div>
        ) : null}

        <section className={`ab-workspace ${menuCollapsed ? 'is-collapsed' : ''}`}>
          {isOpen ? (
            <aside className="ab-add-panel">
              <header>
                <div>
                  <small>Thao tác nhanh</small>
                  <h2>Thêm vào bill</h2>
                </div>
                <button
                  type="button"
                  className="ab-collapse"
                  aria-label={menuCollapsed ? 'Mở menu thêm món' : 'Thu gọn menu thêm món'}
                  onClick={() => setMenuCollapsed((current) => !current)}
                >
                  <ArrowLeft />
                </button>
              </header>

              {!menuCollapsed ? (
                <>
                  <div className="ab-mode-tabs">
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
                        className={addMode === mode ? 'is-active' : ''}
                        onClick={() => setAddMode(mode)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="ab-add-scroll">
                    {addMode === 'CATALOG' ? (
                      <section className="ab-catalog">
                        <label className="ab-search">
                          <Search />
                          <input
                            value={catalogSearch}
                            onChange={(event) => setCatalogSearch(event.target.value)}
                            placeholder="Tìm món..."
                          />
                        </label>

                        <div className="ab-categories" aria-label="Danh mục món">
                          <button
                            type="button"
                            className={catalogCategoryId === 'ALL' ? 'is-active' : ''}
                            onClick={() => setCatalogCategoryId('ALL')}
                          >
                            Tất cả
                          </button>
                          {(menuQuery.data?.categories ?? []).map((category) => (
                            <button
                              key={category.id}
                              type="button"
                              className={catalogCategoryId === category.id ? 'is-active' : ''}
                              onClick={() => setCatalogCategoryId(category.id)}
                            >
                              {category.name}
                            </button>
                          ))}
                        </div>

                        {menuQuery.isPending ? (
                          <div className="ab-inline-state">Đang tải menu…</div>
                        ) : visibleCategories.length === 0 ? (
                          <div className="ab-inline-state">Không tìm thấy món.</div>
                        ) : (
                          <div className="ab-menu-sections">
                            {visibleCategories.map((category) => (
                              <section key={category.id}>
                                <h3>{category.name}</h3>
                                <div className="ab-menu-grid">
                                  {category.items.map((item) => {
                                    const quantity = catalogQuantities[item.id] ?? 1;
                                    const imageUrl = buildCloudinaryImageUrl(
                                      cloudName,
                                      item.image,
                                      'f_auto,q_auto,c_fill,w_360,h_260',
                                    );

                                    return (
                                      <article key={item.id} className="ab-menu-card">
                                        <div className="ab-menu-image">
                                          {imageUrl ? <img src={imageUrl} alt="" /> : <Package />}
                                          <span>{quantity}</span>
                                        </div>
                                        <div className="ab-menu-copy">
                                          <h4>{item.name}</h4>
                                          <strong>{moneyFormatter.format(item.priceVnd)}</strong>
                                          <div className="ab-menu-actions">
                                            <div className="ab-stepper">
                                              <button
                                                type="button"
                                                aria-label={`Giảm số lượng ${item.name}`}
                                                disabled={quantity <= 1 || busy}
                                                onClick={() =>
                                                  setCatalogQuantities((current) => ({
                                                    ...current,
                                                    [item.id]: Math.max(1, quantity - 1),
                                                  }))
                                                }
                                              >
                                                −
                                              </button>
                                              <b>{quantity}</b>
                                              <button
                                                type="button"
                                                aria-label={`Tăng số lượng ${item.name}`}
                                                disabled={quantity >= 50 || busy}
                                                onClick={() =>
                                                  setCatalogQuantities((current) => ({
                                                    ...current,
                                                    [item.id]: Math.min(50, quantity + 1),
                                                  }))
                                                }
                                              >
                                                +
                                              </button>
                                            </div>
                                            <button
                                              type="button"
                                              className="ab-add-item"
                                              disabled={busy}
                                              onClick={() =>
                                                addCatalogItemMutation.mutate({
                                                  catalogItemId: item.id,
                                                  quantity,
                                                })
                                              }
                                            >
                                              Thêm
                                            </button>
                                          </div>
                                        </div>
                                      </article>
                                    );
                                  })}
                                </div>
                              </section>
                            ))}
                          </div>
                        )}
                      </section>
                    ) : null}

                    {addMode === 'MANUAL_PRODUCT' ? (
                      <section className="ab-form">
                        <label>
                          <span>Tên khoản</span>
                          <input
                            value={manualName}
                            maxLength={160}
                            placeholder="Ví dụ: Phí hư hỏng vợt"
                            onChange={(event) => setManualName(event.target.value)}
                          />
                        </label>
                        <div className="ab-form-row">
                          <label>
                            <span>Đơn vị</span>
                            <input
                              value={manualUnitName}
                              maxLength={40}
                              onChange={(event) => setManualUnitName(event.target.value)}
                            />
                          </label>
                          <label>
                            <span>Số lượng</span>
                            <input
                              type="number"
                              min={1}
                              max={999}
                              value={manualQuantity}
                              onChange={(event) => setManualQuantity(Number(event.target.value))}
                            />
                          </label>
                        </div>
                        <label>
                          <span>Đơn giá VND</span>
                          <input
                            type="number"
                            min={0}
                            max={2_147_483_647}
                            value={manualUnitPriceVnd}
                            onChange={(event) => setManualUnitPriceVnd(Number(event.target.value))}
                          />
                        </label>
                        <div className="ab-estimate">
                          <span>Dự kiến</span>
                          <strong>
                            {moneyFormatter.format(
                              Math.max(0, manualQuantity * manualUnitPriceVnd),
                            )}
                          </strong>
                          <i>₫</i>
                        </div>
                        <button
                          type="button"
                          className="ab-form-submit"
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
                        >
                          {createCustomChargeMutation.isPending
                            ? 'Đang thêm…'
                            : 'Thêm khoản custom'}
                        </button>
                      </section>
                    ) : null}

                    {addMode === 'COURT_RENTAL' ? (
                      <section className="ab-form">
                        <div className="ab-form-row">
                          <label>
                            <span>Bắt đầu</span>
                            <input
                              type="time"
                              step={1800}
                              value={courtStartTime}
                              onChange={(event) => setCourtStartTime(event.target.value)}
                            />
                          </label>
                          <label>
                            <span>Số giờ</span>
                            <input
                              type="number"
                              min={1}
                              max={24}
                              value={courtDurationHours}
                              onChange={(event) =>
                                setCourtDurationHours(Number(event.target.value))
                              }
                            />
                          </label>
                        </div>
                        <div className="ab-price-rule">
                          <Clock />
                          <div>
                            <strong>Giá theo block giờ</strong>
                            <p>
                              05:00–17:00: 100.000đ · 17:00–19:00: 140.000đ · sau 19:00: 120.000đ.
                            </p>
                            <p>Sân 03 tự cộng phụ thu 30.000đ mỗi giờ.</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="ab-form-submit"
                          disabled={
                            busy ||
                            !/^\d{2}:(00|30)$/u.test(courtStartTime) ||
                            !Number.isInteger(courtDurationHours) ||
                            courtDurationHours < 1 ||
                            courtDurationHours > 24
                          }
                          onClick={() => createCourtRentalMutation.mutate()}
                        >
                          {createCourtRentalMutation.isPending ? 'Đang tính…' : 'Thêm phí thuê sân'}
                        </button>
                      </section>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="ab-collapsed-mark">
                  <Plus />
                  <span>Thêm</span>
                </div>
              )}
            </aside>
          ) : null}

          <section className="ab-bill-panel">
            <header>
              <div>
                <small>Toàn bộ hoạt động</small>
                <h2>Chi tiết bill</h2>
              </div>
              <div className="ab-bill-chips">
                <span>{detail.orders.length} order</span>
                <strong>{moneyFormatter.format(outstandingTotalVnd)}</strong>
              </div>
            </header>

            <div className="ab-bill-scroll">
              {detail.summary.items.length > 0 ? (
                <details className="ab-overview">
                  <summary>
                    <div>
                      <small>Tổng hợp theo món</small>
                      <strong>{detail.summary.items.length} nhóm đang tính</strong>
                    </div>
                    <Chevron />
                  </summary>
                  <div>
                    {detail.summary.items.map((item) => (
                      <article key={`${item.lineKind}:${item.itemName}:${item.unitPriceVnd}`}>
                        <div>
                          <strong>{item.itemName}</strong>
                          <span>
                            {item.orderedQuantity} {item.unitName} · {lineKindLabel[item.lineKind]}
                          </span>
                        </div>
                        <b>{moneyFormatter.format(item.grossTotalVnd)}</b>
                      </article>
                    ))}
                  </div>
                </details>
              ) : null}

              {orderedNewestFirst.length === 0 ? (
                <div className="ab-empty-orders">
                  <Receipt />
                  <strong>Bill chưa có khoản nào</strong>
                  <span>Chọn món hoặc thêm khoản ở menu bên trái.</span>
                </div>
              ) : (
                <div className="ab-order-list">
                  {orderedNewestFirst.map((order, displayIndex) => {
                    const originalIndex = detail.orders.findIndex(
                      (candidate) => candidate.id === order.id,
                    );
                    const orderNumber = originalIndex + 1;

                    return (
                      <details
                        key={order.id}
                        className={`ab-order is-${order.status.toLowerCase()}`}
                        open={displayIndex === 0}
                      >
                        <summary>
                          <div className="ab-order-title">
                            <small>
                              #{orderNumber} · {timeFormatter.format(new Date(order.createdAt))} ·{' '}
                              {order.source === 'ADMIN' ? 'Nhân viên' : 'Khách gửi'}
                            </small>
                            <strong>
                              {moneyFormatter.format(order.totalVnd)} · {order.lines.length} khoản
                            </strong>
                          </div>
                          <span>{orderStatusLabel[order.status]}</span>
                          <Chevron />
                        </summary>

                        <div className="ab-order-body">
                          {order.note ? (
                            <p className="ab-order-note">
                              <strong>Ghi chú:</strong> {order.note}
                            </p>
                          ) : null}
                          {order.cancellationReason ? (
                            <p className="ab-order-note is-danger">
                              <strong>Lý do hủy:</strong> {order.cancellationReason}
                            </p>
                          ) : null}

                          <div className="ab-line-list">
                            {order.lines.map((line) => {
                              const isCustom = line.lineKind !== 'CATALOG';
                              const editableOrder =
                                order.status === 'PENDING' || order.status === 'ACCEPTED';
                              const editableLine =
                                isOpen &&
                                line.status === 'ACTIVE' &&
                                editableOrder &&
                                !hasActiveSettlements(line);
                              const imageUrl = lineImageUrl(cloudName, line);

                              return (
                                <article
                                  key={line.id}
                                  className={`ab-line ${line.status === 'VOIDED' ? 'is-voided' : ''}`}
                                >
                                  <div className="ab-line-main">
                                    <div className="ab-line-image">
                                      {imageUrl ? (
                                        <img src={imageUrl} alt="" />
                                      ) : line.lineKind === 'MANUAL_TIME' ? (
                                        <Clock />
                                      ) : (
                                        <Package />
                                      )}
                                    </div>
                                    <div className="ab-line-copy">
                                      <strong>{line.itemName}</strong>
                                      <span>
                                        {line.quantity} {line.unitName} ×{' '}
                                        {moneyFormatter.format(line.unitPriceVnd)}
                                      </span>
                                      {line.lineKind === 'MANUAL_TIME' ? (
                                        <small>
                                          {line.durationMinutes} phút · block{' '}
                                          {line.billingIntervalMinutes} phút
                                        </small>
                                      ) : null}
                                      {line.voidReason ? (
                                        <small className="is-danger">Void: {line.voidReason}</small>
                                      ) : null}
                                    </div>
                                    <b className="ab-line-total">
                                      {moneyFormatter.format(line.lineTotalVnd)}
                                    </b>
                                  </div>

                                  {line.status === 'ACTIVE' ? (
                                    <div className="ab-line-settlement">
                                      <span className="is-paid">Trả {line.paidQuantity}</span>
                                      <span className="is-waived">Miễn {line.waivedQuantity}</span>
                                      <span>Còn {line.outstandingQuantity}</span>
                                    </div>
                                  ) : null}

                                  {isOpen && line.status === 'ACTIVE' ? (
                                    <div className="ab-line-actions">
                                      {editableLine ? (
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
                                              });
                                              setQuantityValue(line.quantity);
                                            }
                                          }}
                                        >
                                          Sửa
                                        </button>
                                      ) : null}

                                      {line.outstandingQuantity > 0 &&
                                      order.status !== 'CANCELLED' ? (
                                        <button
                                          type="button"
                                          className="is-primary"
                                          disabled={busy}
                                          onClick={() => openSettlement(line)}
                                        >
                                          Thanh toán / miễn
                                        </button>
                                      ) : null}

                                      {order.status !== 'CANCELLED' &&
                                      !hasActiveSettlements(line) ? (
                                        <button
                                          type="button"
                                          className="is-danger"
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
                                        >
                                          Void
                                        </button>
                                      ) : null}
                                    </div>
                                  ) : null}

                                  {line.settlements.length > 0 ? (
                                    <details className="ab-history">
                                      <summary>
                                        Lịch sử thanh toán ({line.settlements.length})
                                      </summary>
                                      <div>
                                        {line.settlements.map((settlement) => (
                                          <article key={settlement.id}>
                                            <div>
                                              <strong>
                                                {settlement.type} · {settlement.quantity} ×{' '}
                                                {moneyFormatter.format(settlement.unitPriceVnd)}
                                              </strong>
                                              <span>
                                                {settlement.status === 'ACTIVE'
                                                  ? moneyFormatter.format(settlement.amountVnd)
                                                  : `Đã hoàn tác: ${settlement.reversalReason ?? ''}`}
                                              </span>
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
                                              >
                                                Hoàn tác
                                              </button>
                                            ) : null}
                                          </article>
                                        ))}
                                      </div>
                                    </details>
                                  ) : null}
                                </article>
                              );
                            })}
                          </div>

                          {isOpen ? (
                            <div className="ab-order-actions">
                              {order.status === 'PENDING' ? (
                                <button
                                  type="button"
                                  className="is-primary"
                                  disabled={busy}
                                  onClick={() =>
                                    statusMutation.mutate({
                                      orderId: order.id,
                                      status: 'ACCEPTED',
                                    })
                                  }
                                >
                                  Xác nhận đơn
                                </button>
                              ) : null}
                              {order.status === 'ACCEPTED' ? (
                                <button
                                  type="button"
                                  className="is-served"
                                  disabled={busy}
                                  onClick={() =>
                                    statusMutation.mutate({
                                      orderId: order.id,
                                      status: 'SERVED',
                                    })
                                  }
                                >
                                  Đã phục vụ
                                </button>
                              ) : null}
                              {order.status === 'PENDING' || order.status === 'ACCEPTED' ? (
                                <button
                                  type="button"
                                  className="is-danger"
                                  disabled={busy}
                                  onClick={() => {
                                    setOperationError(null);
                                    setCancelTarget({
                                      orderId: order.id,
                                      label: `Order #${orderNumber}`,
                                    });
                                    setCancelReason('');
                                  }}
                                >
                                  Hủy order
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </details>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </section>
      </div>

      <ActionDialog
        open={cancelTarget !== null}
        title={`Hủy ${cancelTarget?.label ?? 'order'}`}
        description="Order vẫn được giữ lại để đối chiếu và không bị xóa khỏi lịch sử."
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
        <label className="ab-dialog-field">
          <span>Lý do hủy</span>
          <textarea
            value={cancelReason}
            maxLength={300}
            rows={4}
            autoFocus
            onChange={(event) => setCancelReason(event.target.value)}
            placeholder="Ví dụ: Khách đổi món, nhân viên nhập nhầm…"
          />
          <small>{cancelReason.trim().length}/300</small>
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
          quantityMutation.mutate({
            lineId: quantityTarget.lineId,
            quantity: quantityValue,
          });
        }}
      >
        <label className="ab-dialog-field">
          <span>Số lượng mới (1–50)</span>
          <input
            type="number"
            min={1}
            max={50}
            value={quantityValue}
            autoFocus
            onChange={(event) => setQuantityValue(Number(event.target.value))}
          />
        </label>
      </ActionDialog>

      <ActionDialog
        open={voidTarget !== null}
        title={`Void · ${voidTarget?.itemName ?? ''}`}
        description="Dữ liệu không bị xóa. Khoản này chuyển sang VOIDED và không còn tính vào bill."
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
        <label className="ab-dialog-field">
          <span>Lý do void</span>
          <textarea
            value={voidReason}
            maxLength={300}
            rows={4}
            autoFocus
            onChange={(event) => setVoidReason(event.target.value)}
          />
        </label>
      </ActionDialog>

      <ActionDialog
        open={editTarget !== null}
        title={`Chỉnh khoản · ${editTarget?.itemName ?? ''}`}
        description="Chỉ khoản chưa phục vụ và chưa có settlement đang hoạt động mới được chỉnh."
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

          updateCustomChargeMutation.mutate({
            chargeId: editTarget.id,
            request,
          });
        }}
      >
        <div className="ab-dialog-grid">
          <label className="ab-dialog-field is-wide">
            <span>Tên</span>
            <input
              value={editName}
              maxLength={160}
              onChange={(event) => setEditName(event.target.value)}
            />
          </label>
          {editTarget?.lineKind === 'MANUAL_PRODUCT' ? (
            <>
              <label className="ab-dialog-field">
                <span>Đơn vị</span>
                <input
                  value={editUnitName}
                  maxLength={40}
                  onChange={(event) => setEditUnitName(event.target.value)}
                />
              </label>
              <label className="ab-dialog-field">
                <span>Số lượng</span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={editQuantity}
                  onChange={(event) => setEditQuantity(Number(event.target.value))}
                />
              </label>
            </>
          ) : (
            <>
              <label className="ab-dialog-field">
                <span>Thời lượng (phút)</span>
                <input
                  type="number"
                  min={1}
                  max={1_440}
                  value={editDurationMinutes}
                  onChange={(event) => setEditDurationMinutes(Number(event.target.value))}
                />
              </label>
              <label className="ab-dialog-field">
                <span>Chu kỳ (phút)</span>
                <input
                  type="number"
                  min={1}
                  max={1_440}
                  value={editBillingIntervalMinutes}
                  onChange={(event) => setEditBillingIntervalMinutes(Number(event.target.value))}
                />
              </label>
            </>
          )}
          <label className="ab-dialog-field is-wide">
            <span>
              {editTarget?.lineKind === 'MANUAL_TIME' ? 'Giá mỗi chu kỳ VND' : 'Đơn giá VND'}
            </span>
            <input
              type="number"
              min={0}
              max={2_147_483_647}
              value={editUnitPriceVnd}
              onChange={(event) => setEditUnitPriceVnd(Number(event.target.value))}
            />
          </label>
        </div>
      </ActionDialog>

      <ActionDialog
        open={settlementTarget !== null}
        title={`Xử lý tiền · ${settlementTarget?.itemName ?? ''}`}
        description={`Còn tối đa ${
          settlementTarget?.outstandingQuantity ?? 0
        } đơn vị. Server tính tiền chính thức.`}
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

          settlementMutation.mutate({
            lineId: settlementTarget.lineId,
            request,
          });
        }}
      >
        <div className="ab-settlement-switch">
          <button
            type="button"
            className={settlementType === 'PAID' ? 'is-active is-paid' : ''}
            onClick={() => setSettlementType('PAID')}
          >
            PAID
          </button>
          <button
            type="button"
            className={settlementType === 'WAIVED' ? 'is-active is-waived' : ''}
            onClick={() => setSettlementType('WAIVED')}
          >
            WAIVED
          </button>
        </div>
        <label className="ab-dialog-field ab-dialog-spacing">
          <span>Số lượng xử lý</span>
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
          />
          <strong>
            Dự kiến:{' '}
            {moneyFormatter.format(settlementQuantity * (settlementTarget?.unitPriceVnd ?? 0))}
          </strong>
        </label>
        {settlementType === 'WAIVED' ? (
          <label className="ab-dialog-field ab-dialog-spacing">
            <span>Lý do miễn thu</span>
            <textarea
              value={settlementReason}
              maxLength={300}
              rows={4}
              onChange={(event) => setSettlementReason(event.target.value)}
            />
          </label>
        ) : null}
      </ActionDialog>

      <ActionDialog
        open={reverseTarget !== null}
        title={`Hoàn tác ${reverseTarget?.type ?? 'settlement'}`}
        description={`${reverseTarget?.itemName ?? ''} · ${
          reverseTarget?.quantity ?? 0
        } đơn vị. Settlement cũ vẫn giữ trong audit.`}
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
        <label className="ab-dialog-field">
          <span>Lý do hoàn tác</span>
          <textarea
            value={reverseReason}
            maxLength={300}
            rows={4}
            autoFocus
            onChange={(event) => setReverseReason(event.target.value)}
          />
        </label>
      </ActionDialog>

      <ActionDialog
        open={checkoutOpen}
        title="Tạm tính toàn bộ bill"
        description="Mọi order chưa hủy đều được tính, kể cả order chưa xác nhận hoặc chưa đánh dấu phục vụ."
        confirmLabel="Hoàn thành bill"
        busy={completeMutation.isPending || payOutstandingMutation.isPending}
        confirmDisabled={!checkoutQuery.data || checkoutQuery.data.outstandingTotalVnd > 0}
        error={operationError}
        onClose={() => {
          if (!completeMutation.isPending && !payOutstandingMutation.isPending) {
            setCheckoutOpen(false);
          }
        }}
        onConfirm={() => {
          if (checkoutQuery.data) completeMutation.mutate(checkoutQuery.data);
        }}
      >
        {checkoutQuery.isPending ? (
          <div className="ab-checkout-loading">Đang lập bản tạm tính…</div>
        ) : checkoutQuery.data ? (
          <div className="ab-checkout">
            <div className="ab-checkout-main">
              {checkoutQuery.data.courtRentals.length > 0 ? (
                <section>
                  <h3>Phí thuê sân</h3>
                  {checkoutQuery.data.courtRentals.map((rental) => (
                    <article key={rental.id} className="ab-rental-preview">
                      <header>
                        <strong>
                          {rental.startTime} · {rental.durationHours} giờ
                        </strong>
                        <b>{moneyFormatter.format(rental.totalAmountVnd)}</b>
                      </header>
                      {rental.breakdown.map((block) => (
                        <div key={block.sequence}>
                          <span>
                            {block.startsAt}–{block.endsAt}
                          </span>
                          <strong>{moneyFormatter.format(block.totalVnd)}</strong>
                        </div>
                      ))}
                    </article>
                  ))}
                </section>
              ) : null}

              <section>
                <header className="ab-checkout-section-head">
                  <h3>Chưa thanh toán</h3>
                  <strong>{moneyFormatter.format(checkoutQuery.data.outstandingTotalVnd)}</strong>
                </header>
                {checkoutQuery.data.outstandingItems.length === 0 ? (
                  <p className="ab-paid-all">Không còn khoản chưa thanh toán.</p>
                ) : (
                  <>
                    <div className="ab-checkout-items">
                      {checkoutQuery.data.outstandingItems.map((item) => (
                        <article key={`${item.lineKind}:${item.itemName}:${item.unitPriceVnd}`}>
                          <div>
                            <strong>{item.itemName}</strong>
                            <span>
                              {item.quantity} × {moneyFormatter.format(item.unitPriceVnd)}
                            </span>
                          </div>
                          <b>{moneyFormatter.format(item.totalVnd)}</b>
                        </article>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="ab-pay-all"
                      disabled={payOutstandingMutation.isPending}
                      onClick={() => payOutstandingMutation.mutate()}
                    >
                      {payOutstandingMutation.isPending
                        ? 'Đang ghi nhận…'
                        : 'Thanh toán toàn bộ phần còn lại'}
                    </button>
                  </>
                )}
              </section>

              <section>
                <h3>Các lần đã thanh toán</h3>
                {checkoutQuery.data.paymentBatches.length === 0 ? (
                  <p className="ab-checkout-empty">Chưa có lần thanh toán nào.</p>
                ) : (
                  <div className="ab-payment-batches">
                    {checkoutQuery.data.paymentBatches.map((batch, index) => (
                      <details key={batch.id}>
                        <summary>
                          <span>Thanh toán lần {index + 1}</span>
                          <strong>{moneyFormatter.format(batch.totalVnd)}</strong>
                        </summary>
                        <div>
                          {batch.items.map((item) => (
                            <article key={`${item.itemName}:${item.unitPriceVnd}`}>
                              <span>
                                {item.itemName} × {item.quantity}
                              </span>
                              <strong>{moneyFormatter.format(item.totalVnd)}</strong>
                            </article>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <aside className="ab-checkout-total">
              <div>
                <span>Tổng phát sinh</span>
                <strong>{moneyFormatter.format(checkoutQuery.data.grossTotalVnd)}</strong>
              </div>
              <div>
                <span>Đã thanh toán</span>
                <strong>{moneyFormatter.format(checkoutQuery.data.paidTotalVnd)}</strong>
              </div>
              <div>
                <span>Miễn thu</span>
                <strong>{moneyFormatter.format(checkoutQuery.data.waivedTotalVnd)}</strong>
              </div>
              <div className="is-final">
                <span>Còn phải thu</span>
                <strong>{moneyFormatter.format(checkoutQuery.data.outstandingTotalVnd)}</strong>
              </div>
              <details>
                <summary>Tất cả món trong bill</summary>
                <div>
                  {checkoutQuery.data.allItems.map((item) => (
                    <article key={`${item.lineKind}:${item.itemName}:${item.unitPriceVnd}`}>
                      <span>
                        {item.itemName} × {item.quantity}
                      </span>
                      <strong>{moneyFormatter.format(item.totalVnd)}</strong>
                    </article>
                  ))}
                </div>
              </details>
              {checkoutQuery.data.unresolvedOrderCount > 0 ? (
                <p>
                  Có {checkoutQuery.data.unresolvedOrderCount} order chưa hoàn tất vận hành. Điều
                  này không chặn thanh toán.
                </p>
              ) : null}
            </aside>
          </div>
        ) : (
          <p className="ab-checkout-error">Không thể lập bản tạm tính.</p>
        )}
      </ActionDialog>
    </main>
  );
}
