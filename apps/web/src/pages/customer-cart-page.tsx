import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';

import { useCart } from '../cart/cart-context';
import { createPublicOrder, CreateOrderRequestError, saveLastOrder } from '../lib/public-order-api';

const priceFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

export function CustomerCartPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const cart = useCart(slug);
  const mutation = useMutation({
    mutationFn: ({ idempotencyKey }: { idempotencyKey: string }) =>
      createPublicOrder(slug, {
        idempotencyKey,
        note: cart.cart.note.trim() || null,
        items: cart.cart.lines.map((line) => ({
          catalogItemId: line.catalogItemId,
          quantity: line.quantity,
        })),
      }),
    retry: false,
    onSuccess(response) {
      saveLastOrder(slug, response);
      cart.clear(slug);
      void navigate(`/s/${slug}/order-success`, { replace: true });
    },
  });

  const errorMessage = mutation.isError
    ? mutation.error instanceof CreateOrderRequestError
      ? mutation.error.message
      : 'Không thể gửi order. Vui lòng kiểm tra mạng và thử lại.'
    : null;

  return (
    <main className="min-h-screen bg-surface pb-10 text-ink">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-5 sm:px-6">
          <Link
            to={`/s/${slug}`}
            className="rounded-xl border border-line px-3 py-2 text-sm font-bold"
          >
            ← Menu
          </Link>
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-brand">Giỏ hàng</p>
            <h1 className="text-2xl font-black">Kiểm tra order</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {cart.cart.lines.length === 0 ? (
          <section className="rounded-3xl border border-line bg-white p-8 text-center shadow-panel">
            <h2 className="text-2xl font-black">Giỏ đang trống</h2>
            <p className="mt-2 text-muted">Quay lại menu để chọn món.</p>
            <Link
              to={`/s/${slug}`}
              className="mt-6 inline-flex rounded-xl bg-brand px-5 py-3 font-black text-white"
            >
              Mở menu
            </Link>
          </section>
        ) : (
          <div className="grid gap-5">
            <section className="overflow-hidden rounded-3xl border border-line bg-white shadow-panel">
              {cart.cart.lines.map((line, index) => (
                <article
                  key={line.catalogItemId}
                  className={`p-4 ${index > 0 ? 'border-t border-line' : ''}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <h2 className="font-black">{line.name}</h2>
                      <p className="mt-1 text-sm text-muted">
                        {priceFormatter.format(line.priceVnd)} / {line.unitName}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => cart.removeItem(slug, line.catalogItemId)}
                      className="text-sm font-bold text-danger"
                    >
                      Xóa
                    </button>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-4">
                    <div className="flex items-center rounded-xl border border-line">
                      <button
                        type="button"
                        aria-label={`Giảm ${line.name}`}
                        onClick={() => {
                          if (line.quantity === 1) {
                            cart.removeItem(slug, line.catalogItemId);
                          } else {
                            cart.setQuantity(slug, line.catalogItemId, line.quantity - 1);
                          }
                        }}
                        className="px-4 py-2 text-lg font-black"
                      >
                        −
                      </button>
                      <span className="min-w-10 text-center font-black">{line.quantity}</span>
                      <button
                        type="button"
                        aria-label={`Tăng ${line.name}`}
                        onClick={() =>
                          cart.setQuantity(
                            slug,
                            line.catalogItemId,
                            Math.min(50, line.quantity + 1),
                          )
                        }
                        className="px-4 py-2 text-lg font-black"
                      >
                        +
                      </button>
                    </div>
                    <strong>{priceFormatter.format(line.priceVnd * line.quantity)}</strong>
                  </div>
                </article>
              ))}
            </section>

            <section className="rounded-3xl border border-line bg-white p-5 shadow-panel">
              <label htmlFor="order-note" className="font-black">
                Ghi chú cho order
              </label>
              <textarea
                id="order-note"
                value={cart.cart.note}
                onChange={(event) => cart.setNote(slug, event.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Ví dụ: ít đá, giao ở cuối sân..."
                className="mt-3 w-full resize-none rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
              />
              <p className="mt-2 text-right text-xs text-muted">{cart.cart.note.length}/500</p>
            </section>

            <section className="rounded-3xl bg-ink p-5 text-white shadow-panel">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-white/70">Tạm tính trên menu</p>
                  <p className="mt-1 text-2xl font-black">
                    {priceFormatter.format(cart.provisionalTotalVnd)}
                  </p>
                </div>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">
                  {cart.itemCount} món
                </span>
              </div>
              <p className="mt-3 text-xs leading-5 text-white/70">
                Giá chính thức được máy chủ đọc lại từ PostgreSQL. Nếu món đã hết, order sẽ không
                được tạo.
              </p>
            </section>

            {errorMessage && (
              <div
                role="alert"
                className="rounded-2xl border border-danger/20 bg-danger-soft p-4 text-sm font-semibold text-danger"
              >
                {errorMessage}
              </div>
            )}

            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => {
                const idempotencyKey = cart.ensureSubmissionKey(slug);
                mutation.mutate({ idempotencyKey });
              }}
              className="rounded-2xl bg-brand px-5 py-4 text-lg font-black text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {mutation.isPending ? 'Đang gửi order...' : 'Gửi order'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
