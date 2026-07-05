import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';

import { fetchPublicCurrentBill } from '../lib/public-current-bill-api';

const moneyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

const statusLabel = {
  PENDING: 'Đã gửi',
  ACCEPTED: 'Đã xác nhận',
  SERVED: 'Đã phục vụ',
  CANCELLED: 'Đã hủy',
} as const;

const orderTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
});

const kindLabel = {
  CATALOG: 'Món trong menu',
  MANUAL_PRODUCT: 'Mặt hàng phát sinh',
  MANUAL_TIME: 'Phí thời gian',
} as const;

export function CustomerCurrentBillPage() {
  const { slug = '' } = useParams();
  const billQuery = useQuery({
    queryKey: ['public', 'current-bill', slug],
    queryFn: ({ signal }) => fetchPublicCurrentBill(slug, signal),
    enabled: slug.length > 0,
    retry: false,
    refetchInterval: 15_000,
  });

  if (billQuery.isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface px-5 text-ink">
        <p className="font-bold text-muted">Đang tải bill hiện tại…</p>
      </main>
    );
  }

  if (billQuery.isError || !billQuery.data) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface px-5 text-ink">
        <section className="w-full max-w-md rounded-3xl border border-line bg-white p-7 text-center shadow-panel">
          <h1 className="text-2xl font-black">Không thể tải bill</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            {billQuery.error instanceof Error
              ? billQuery.error.message
              : 'Kết nối đang gián đoạn. Vui lòng thử lại.'}
          </p>
          <div className="mt-6 grid gap-3">
            <button
              type="button"
              onClick={() => void billQuery.refetch()}
              className="rounded-xl bg-brand px-5 py-3 font-black text-white"
            >
              Thử lại
            </button>
            <Link to={`/s/${slug}`} className="rounded-xl border border-line px-5 py-3 font-black">
              Về menu
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const detail = billQuery.data;

  return (
    <main className="min-h-screen bg-surface px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="rounded-3xl border border-line bg-white p-5 shadow-panel sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Link to={`/s/${slug}`} className="text-sm font-black text-brand">
                ← Về menu
              </Link>
              <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-brand">
                {detail.venue.name}
              </p>
              <h1 className="mt-1 text-3xl font-black">
                Tạm tính chung · {detail.servicePoint.name}
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted">
                Đây là bill đang mở của toàn sân. Mọi người quét cùng mã QR sẽ thấy chung các lượt
                order và số tiền hiện tại. Tự động cập nhật mỗi 15 giây.
              </p>
            </div>
            <button
              type="button"
              disabled={billQuery.isFetching}
              onClick={() => void billQuery.refetch()}
              className="rounded-xl border border-brand px-4 py-3 font-black text-brand disabled:opacity-50"
            >
              {billQuery.isFetching ? 'Đang cập nhật…' : 'Cập nhật ngay'}
            </button>
          </div>
        </header>

        {!detail.bill ? (
          <section className="mt-5 rounded-3xl border border-line bg-white p-8 text-center shadow-panel">
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-success-soft text-2xl text-success">
              ✓
            </div>
            <h2 className="mt-4 text-2xl font-black">Sân chưa có bill đang mở</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Bill sẽ được tạo tự động khi order đầu tiên được gửi.
            </p>
            <Link
              to={`/s/${slug}`}
              className="mt-6 inline-flex rounded-xl bg-brand px-5 py-3 font-black text-white"
            >
              Chọn món
            </Link>
          </section>
        ) : (
          <>
            <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-2xl border border-line bg-white p-4 shadow-panel">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  Tổng phát sinh
                </p>
                <p className="mt-2 text-xl font-black">
                  {moneyFormatter.format(detail.summary.grossTotalVnd)}
                </p>
              </div>
              <div className="rounded-2xl border border-line bg-white p-4 shadow-panel">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  Đã thanh toán
                </p>
                <p className="mt-2 text-xl font-black text-success">
                  {moneyFormatter.format(detail.summary.paidTotalVnd)}
                </p>
              </div>
              <div className="rounded-2xl border border-line bg-white p-4 shadow-panel">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Được miễn</p>
                <p className="mt-2 text-xl font-black text-warning">
                  {moneyFormatter.format(detail.summary.waivedTotalVnd)}
                </p>
              </div>
              <div className="rounded-2xl border border-brand bg-white p-4 shadow-panel">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Còn lại</p>
                <p className="mt-2 text-xl font-black text-brand">
                  {moneyFormatter.format(detail.summary.outstandingTotalVnd)}
                </p>
              </div>
            </section>

            <section className="mt-5 rounded-3xl border border-line bg-white p-5 shadow-panel sm:p-6">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand">
                    Tóm tắt theo món
                  </p>
                  <h2 className="mt-1 text-2xl font-black">Các khoản trong bill</h2>
                </div>
                <span className="text-sm font-bold text-muted">
                  {detail.summary.items.length} khoản
                </span>
              </div>

              <div className="mt-5 divide-y divide-line rounded-2xl border border-line">
                {detail.summary.items.map((item) => (
                  <article
                    key={`${item.lineKind}:${item.catalogItemId ?? item.itemName}:${item.unitPriceVnd}`}
                    className="p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-black">{item.itemName}</p>
                        <p className="mt-1 text-xs font-bold uppercase tracking-wide text-muted">
                          {kindLabel[item.lineKind]} · {item.unitName}
                        </p>
                      </div>
                      <strong className="shrink-0">
                        {moneyFormatter.format(item.grossTotalVnd)}
                      </strong>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-bold">
                      <span className="rounded-lg bg-success-soft px-2 py-2 text-success">
                        Đã trả {item.paidQuantity}/{item.orderedQuantity}
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
              <div className="rounded-3xl border border-line bg-white p-5 shadow-panel sm:p-6">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand">
                  Lịch sử bill đang mở
                </p>
                <h2 className="mt-1 text-2xl font-black">Tất cả lượt order của sân</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Các lượt bị hủy vẫn được giữ trong lịch sử để cả nhóm dễ đối chiếu nhưng không
                  được cộng vào tổng tiền.
                </p>
              </div>

              {detail.orders.map((order, index) => (
                <article
                  key={order.id}
                  className="rounded-2xl border border-line bg-white p-5 shadow-panel"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">
                        Lượt #{index + 1} · {orderTimeFormatter.format(new Date(order.createdAt))}
                        {' · '}
                        {order.source === 'ADMIN' ? 'Nhân viên thêm' : 'Khách gửi'}
                      </p>
                      <h3 className="mt-1 text-xl font-black">
                        {moneyFormatter.format(order.totalVnd)}
                      </h3>
                    </div>
                    <span className="rounded-full bg-neutral-soft px-3 py-1 text-xs font-black">
                      {statusLabel[order.status]}
                    </span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {order.lines.map((line) => (
                      <div
                        key={line.id}
                        className={`rounded-xl border border-line p-4 ${
                          line.status === 'VOIDED' ? 'bg-neutral-soft opacity-65' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-black">{line.itemName}</p>
                            <p className="mt-1 text-sm text-muted">
                              {line.quantity} {line.unitName} ×{' '}
                              {moneyFormatter.format(line.unitPriceVnd)}
                            </p>
                          </div>
                          <strong>{moneyFormatter.format(line.lineTotalVnd)}</strong>
                        </div>
                        {line.status === 'ACTIVE' ? (
                          <p className="mt-3 text-xs font-bold text-muted">
                            Đã trả {line.paidQuantity} · Miễn {line.waivedQuantity} · Còn{' '}
                            {line.outstandingQuantity}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
