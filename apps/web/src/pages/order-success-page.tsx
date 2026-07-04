import { Link, useParams } from 'react-router';

import { readLastOrder } from '../lib/public-order-api';

const priceFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

export function OrderSuccessPage() {
  const { slug = '' } = useParams();
  const order = readLastOrder(slug);

  if (!order) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface px-6 text-ink">
        <section className="w-full max-w-md rounded-3xl border border-line bg-white p-8 text-center shadow-panel">
          <h1 className="text-2xl font-black">Chưa có order gần đây</h1>
          <p className="mt-3 text-muted">Mở menu để chọn món và gửi order.</p>
          <Link
            to={`/s/${slug}`}
            className="mt-6 inline-flex rounded-xl bg-brand px-5 py-3 font-black text-white"
          >
            Mở menu
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-surface px-4 py-8 text-ink sm:px-6">
      <section className="mx-auto max-w-lg rounded-3xl border border-line bg-white p-7 shadow-panel">
        <div
          className="mx-auto grid size-16 place-items-center rounded-full bg-success-soft text-3xl text-success"
          aria-hidden="true"
        >
          ✓
        </div>
        <p className="mt-5 text-center text-sm font-bold uppercase tracking-[0.14em] text-success">
          Order đã gửi
        </p>
        <h1 className="mt-2 text-center text-3xl font-black">Nhân viên đã nhận thông tin</h1>
        <p className="mt-3 text-center leading-7 text-muted">
          Mã order: <span className="font-mono text-xs">{order.order.id}</span>
        </p>

        <div className="mt-6 divide-y divide-line rounded-2xl border border-line">
          {order.lines.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="font-bold">{line.itemName}</p>
                <p className="text-sm text-muted">
                  {line.quantity} × {priceFormatter.format(line.unitPriceVnd)}
                </p>
              </div>
              <strong>{priceFormatter.format(line.lineTotalVnd)}</strong>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between rounded-2xl bg-neutral-soft p-4">
          <span className="font-bold">Tổng order</span>
          <strong className="text-xl text-brand">
            {priceFormatter.format(order.order.totalVnd)}
          </strong>
        </div>

        <Link
          to={`/s/${slug}`}
          className="mt-6 flex justify-center rounded-2xl bg-brand px-5 py-4 font-black text-white"
        >
          Tiếp tục xem menu
        </Link>
      </section>
    </main>
  );
}
