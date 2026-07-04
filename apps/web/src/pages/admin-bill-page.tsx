import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import {
  AdminApiError,
  addAdminBillItem,
  getAdminBill,
  getAdminSession,
  updateAdminOrderLine,
  updateAdminOrderStatus,
  voidAdminOrderLine,
} from '../lib/admin-api';
import { useAdminRealtime } from '../lib/admin-realtime';
import { fetchPublicServicePointContext } from '../lib/public-context-api';

const moneyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

function isAuthenticationError(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 401;
}

export function AdminBillPage() {
  const { billId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedItemId, setSelectedItemId] = useState('');
  const [manualQuantity, setManualQuantity] = useState(1);
  const [operationError, setOperationError] = useState<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: ['admin', 'session'],
    queryFn: getAdminSession,
    retry: false,
    staleTime: 60_000,
  });
  const realtimeStatus = useAdminRealtime(sessionQuery.isSuccess);
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

  const availableItems = useMemo(
    () => menuQuery.data?.categories.flatMap((category) => category.items) ?? [],
    [menuQuery.data],
  );

  const effectiveSelectedItemId =
    selectedItemId.length > 0 ? selectedItemId : (availableItems[0]?.id ?? '');

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

  const applyBillSnapshot = (snapshot: NonNullable<typeof billQuery.data>) => {
    queryClient.setQueryData(['admin', 'bill', snapshot.bill.id], snapshot);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
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
    onSuccess: applyBillSnapshot,
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Không thể đổi trạng thái order.'),
  });
  const addItemMutation = useMutation({
    mutationFn: () =>
      addAdminBillItem(billId ?? '', {
        catalogItemId: effectiveSelectedItemId,
        quantity: manualQuantity,
      }),
    onSuccess: applyBillSnapshot,
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Không thể thêm món.'),
  });
  const quantityMutation = useMutation({
    mutationFn: ({ lineId, quantity }: { lineId: string; quantity: number }) =>
      updateAdminOrderLine(lineId, { quantity }),
    onSuccess: applyBillSnapshot,
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Không thể đổi số lượng.'),
  });
  const voidMutation = useMutation({
    mutationFn: ({ lineId, reason }: { lineId: string; reason: string }) =>
      voidAdminOrderLine(lineId, { reason }),
    onSuccess: applyBillSnapshot,
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Không thể void món.'),
  });

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
  const busy =
    statusMutation.isPending ||
    addItemMutation.isPending ||
    quantityMutation.isPending ||
    voidMutation.isPending;

  return (
    <main className="min-h-screen bg-surface px-4 py-6 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-3xl border border-line bg-white p-5 shadow-panel sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Link to="/admin" className="text-sm font-bold text-brand">
                ← Dashboard
              </Link>
              <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-muted">
                {detail.servicePoint.code}
              </p>
              <h1 className="mt-1 text-3xl font-black">{detail.servicePoint.name}</h1>
              <p className="mt-2 text-sm text-muted">{detail.venue.name}</p>
            </div>
            <div className="rounded-2xl bg-neutral-soft p-4 sm:text-right">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Bill tạm tính</p>
              <p className="mt-1 text-3xl font-black">
                {moneyFormatter.format(detail.bill.totalVnd)}
              </p>
              <p className="mt-2 text-xs font-bold text-muted">
                {realtimeStatus === 'connected'
                  ? 'Realtime đang kết nối'
                  : 'Polling dự phòng 15 giây'}
              </p>
            </div>
          </div>
        </header>

        {operationError ? (
          <p className="mt-4 rounded-xl bg-danger-soft px-4 py-3 font-bold text-danger">
            {operationError}
          </p>
        ) : null}

        {isOpen ? (
          <section className="mt-5 rounded-2xl border border-line bg-white p-5 shadow-panel">
            <h2 className="text-xl font-black">Thêm món thủ công</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px_auto]">
              <select
                value={effectiveSelectedItemId}
                onChange={(event) => setSelectedItemId(event.target.value)}
                className="rounded-xl border border-line bg-white px-4 py-3"
                disabled={busy || availableItems.length === 0}
              >
                {availableItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {moneyFormatter.format(item.priceVnd)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={50}
                value={manualQuantity}
                onChange={(event) => setManualQuantity(Number(event.target.value))}
                className="rounded-xl border border-line px-4 py-3"
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => addItemMutation.mutate()}
                disabled={
                  busy || !effectiveSelectedItemId || manualQuantity < 1 || manualQuantity > 50
                }
                className="rounded-xl bg-brand px-5 py-3 font-bold text-white disabled:opacity-50"
              >
                Thêm món
              </button>
            </div>
          </section>
        ) : null}

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
                  {order.status}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {order.lines.map((line) => (
                  <div
                    key={line.id}
                    className={`rounded-xl border p-4 ${line.status === 'VOIDED' ? 'border-line bg-neutral-soft opacity-70' : 'border-line'}`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-black">{line.itemName}</p>
                        <p className="mt-1 text-sm text-muted">
                          {line.quantity} {line.unitName} ×{' '}
                          {moneyFormatter.format(line.unitPriceVnd)} ={' '}
                          {moneyFormatter.format(line.lineTotalVnd)}
                        </p>
                        {line.voidReason ? (
                          <p className="mt-1 text-sm font-bold text-danger">
                            Đã void: {line.voidReason}
                          </p>
                        ) : null}
                      </div>
                      {isOpen && line.status === 'ACTIVE' ? (
                        <div className="flex flex-wrap gap-2">
                          {order.status === 'PENDING' || order.status === 'ACCEPTED' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                const raw = window.prompt(
                                  'Số lượng mới (1–50):',
                                  String(line.quantity),
                                );
                                if (raw === null) return;
                                const quantity = Number(raw);
                                if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 50)
                                  quantityMutation.mutate({ lineId: line.id, quantity });
                                else setOperationError('Số lượng phải là số nguyên từ 1 đến 50.');
                              }}
                              className="rounded-lg border border-line px-3 py-2 text-sm font-bold"
                            >
                              Đổi SL
                            </button>
                          ) : null}
                          {order.status !== 'CANCELLED' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                const reason = window.prompt('Lý do void món:');
                                if (reason?.trim())
                                  voidMutation.mutate({ lineId: line.id, reason: reason.trim() });
                              }}
                              className="rounded-lg border border-danger px-3 py-2 text-sm font-bold text-danger"
                            >
                              Void
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
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
                      className="rounded-xl bg-brand px-4 py-2 font-bold text-white"
                    >
                      Chấp nhận
                    </button>
                  ) : null}
                  {order.status === 'ACCEPTED' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => statusMutation.mutate({ orderId: order.id, status: 'SERVED' })}
                      className="rounded-xl bg-success px-4 py-2 font-bold text-white"
                    >
                      Đã phục vụ
                    </button>
                  ) : null}
                  {order.status === 'PENDING' || order.status === 'ACCEPTED' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt('Lý do hủy order:');
                        if (reason?.trim())
                          statusMutation.mutate({
                            orderId: order.id,
                            status: 'CANCELLED',
                            reason: reason.trim(),
                          });
                      }}
                      className="rounded-xl border border-danger px-4 py-2 font-bold text-danger"
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
    </main>
  );
}
