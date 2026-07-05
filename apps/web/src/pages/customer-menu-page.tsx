import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';

import { useCart } from '../cart/cart-context';
import { buildCloudinaryImageUrl } from '../lib/cloudinary-image';
import { CustomerCallStaff } from './customer-call-staff';
import { fetchPublicServicePointContext, PublicApiRequestError } from '../lib/public-context-api';

const priceFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

function MenuLoading() {
  return (
    <main className="min-h-screen bg-surface px-4 py-6 text-ink">
      <div className="mx-auto max-w-3xl animate-pulse">
        <div className="h-28 rounded-3xl bg-neutral-soft" />
        <div className="mt-6 h-10 w-2/3 rounded-xl bg-neutral-soft" />
        <div className="mt-4 grid gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-28 rounded-2xl bg-neutral-soft" />
          ))}
        </div>
      </div>
    </main>
  );
}

interface MenuErrorProps {
  error: Error;
  retry: () => void;
}

function MenuError({ error, retry }: MenuErrorProps) {
  const notFound = error instanceof PublicApiRequestError && error.status === 404;

  return (
    <main className="grid min-h-screen place-items-center bg-surface px-6 text-ink">
      <section className="w-full max-w-md rounded-3xl border border-line bg-white p-7 text-center shadow-panel">
        <div
          className="mx-auto grid size-14 place-items-center rounded-2xl bg-danger-soft text-2xl"
          aria-hidden="true"
        >
          {notFound ? '⌁' : '!'}
        </div>
        <h1 className="mt-5 text-2xl font-black">
          {notFound ? 'Không tìm thấy sân' : 'Chưa tải được menu'}
        </h1>
        <p className="mt-3 leading-7 text-muted">{error.message}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-6 rounded-xl bg-brand px-5 py-3 font-bold text-white transition hover:bg-brand-dark focus:outline-none focus:ring-4 focus:ring-brand/20"
        >
          Thử lại
        </button>
      </section>
    </main>
  );
}

export function CustomerMenuPage() {
  const { slug = '' } = useParams();
  const cart = useCart(slug);
  const contextQuery = useQuery({
    queryKey: ['public-service-point-context', slug],
    queryFn: ({ signal }) => fetchPublicServicePointContext(slug, signal),
    enabled: slug.length > 0,
    staleTime: 30_000,
    retry(failureCount, error) {
      if (error instanceof PublicApiRequestError && error.status === 404) {
        return false;
      }

      return failureCount < 1;
    },
  });

  if (contextQuery.isPending) {
    return <MenuLoading />;
  }

  if (contextQuery.isError) {
    return (
      <MenuError
        error={
          contextQuery.error instanceof Error
            ? contextQuery.error
            : new Error('Không thể tải menu.')
        }
        retry={() => {
          void contextQuery.refetch();
        }}
      />
    );
  }

  const context = contextQuery.data;
  const totalItems = context.categories.reduce(
    (total, category) => total + category.items.length,
    0,
  );

  return (
    <main className="min-h-screen bg-surface pb-32 text-ink">
      <header className="border-b border-line bg-white">
        <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6">
          <div className="flex items-center gap-3">
            <div
              className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand font-black text-white"
              aria-hidden="true"
            >
              NH
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold uppercase tracking-[0.12em] text-brand">
                {context.venue.name}
              </p>
              <h1 className="truncate text-xl font-black">{context.servicePoint.name}</h1>
            </div>
            <span className="ml-auto shrink-0 rounded-full bg-success-soft px-3 py-1 text-xs font-bold text-success">
              Đang phục vụ
            </span>
          </div>

          <div className="mt-5 rounded-2xl bg-neutral-soft px-4 py-3 text-sm leading-6 text-muted">
            Chọn món và gửi order ngay tại sân. Giá chính thức luôn được máy chủ đọc lại từ menu
            trước khi tạo order.
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link
              to={`/s/${slug}/bill`}
              className="rounded-xl border border-brand px-4 py-3 text-center text-sm font-black text-brand"
            >
              Xem bill hiện tại
            </Link>
            <Link
              to={`/s/${slug}/cart`}
              className="rounded-xl border border-line px-4 py-3 text-center text-sm font-black text-ink"
            >
              Mở giỏ hàng
            </Link>
          </div>

          <CustomerCallStaff slug={slug} />
        </div>
      </header>

      <div className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <nav
          className="mx-auto flex max-w-3xl gap-2 overflow-x-auto px-4 py-3 sm:px-6"
          aria-label="Danh mục menu"
        >
          {context.categories.map((category) => (
            <a
              key={category.id}
              href={`#category-${category.slug}`}
              className="shrink-0 rounded-full border border-line bg-white px-4 py-2 text-sm font-bold transition hover:border-brand hover:text-brand"
            >
              {category.name}
            </a>
          ))}
        </nav>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-7 sm:px-6">
        <div className="mb-7 flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-brand">Menu hôm nay</p>
            <h2 className="mt-1 text-3xl font-black tracking-[-0.03em]">Chọn món tại sân</h2>
          </div>
          <p className="shrink-0 text-sm font-semibold text-muted">{totalItems} món</p>
        </div>

        <div className="space-y-10">
          {context.categories.map((category) => (
            <section key={category.id} id={`category-${category.slug}`} className="scroll-mt-24">
              <div className="mb-4">
                <h3 className="text-xl font-black">{category.name}</h3>
                {category.description && (
                  <p className="mt-1 text-sm leading-6 text-muted">{category.description}</p>
                )}
              </div>

              {category.items.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line bg-white p-5 text-sm text-muted">
                  Danh mục này hiện chưa có món đang bán.
                </div>
              ) : (
                <div className="grid gap-3">
                  {category.items.map((item) => {
                    const imageUrl = buildCloudinaryImageUrl(
                      context.media.cloudName,
                      item.image,
                      'f_auto,q_auto,c_fill,w_240,h_240',
                    );

                    return (
                      <article
                        key={item.id}
                        className="flex gap-4 rounded-2xl border border-line bg-white p-4 shadow-[0_8px_30px_rgb(31_33_30/4%)]"
                      >
                        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-neutral-soft text-2xl font-black text-brand">
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
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h4 className="font-extrabold leading-6">{item.name}</h4>
                              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">
                                {item.unitName}
                              </p>
                            </div>
                            <span className="shrink-0 font-black text-brand">
                              {priceFormatter.format(item.priceVnd)}
                            </span>
                          </div>

                          {item.description && (
                            <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">
                              {item.description}
                            </p>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              cart.addItem(slug, {
                                catalogItemId: item.id,
                                name: item.name,
                                unitName: item.unitName,
                                priceVnd: item.priceVnd,
                              });
                            }}
                            className="mt-3 rounded-xl border border-brand px-4 py-2 text-sm font-black text-brand transition hover:bg-brand hover:text-white"
                          >
                            Thêm vào giỏ
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>

        <footer className="mt-12 border-t border-line pt-6 text-center text-xs leading-5 text-muted">
          Giá trên giỏ là tạm tính. Máy chủ xác nhận lại giá khi tạo order.
        </footer>
      </div>

      {cart.itemCount > 0 && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{cart.itemCount} món trong giỏ</p>
              <p className="truncate text-xs text-muted">
                Tạm tính {priceFormatter.format(cart.provisionalTotalVnd)}
              </p>
            </div>
            <Link
              to={`/s/${slug}/cart`}
              className="rounded-xl bg-brand px-5 py-3 font-black text-white transition hover:bg-brand-dark"
            >
              Xem giỏ
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
