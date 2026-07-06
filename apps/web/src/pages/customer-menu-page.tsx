import type { PublicCatalogCategory, PublicCatalogItem } from '@nhdp/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { useCart } from '../cart/cart-context';
import { CustomerCheckoutSheet } from '../features/customer-order/customer-checkout-sheet';
import {
  CategoryIcon,
  CheckIcon,
  ChevronDownIcon,
  GridIcon,
  MenuIcon,
  ReceiptIcon,
  SearchIcon,
} from '../features/customer-order/customer-order-icons';
import { CustomerProductCard } from '../features/customer-order/customer-product-card';
import { buildCloudinaryImageUrl } from '../lib/cloudinary-image';
import { fetchPublicServicePointContext, PublicApiRequestError } from '../lib/public-context-api';
import { createPublicOrder, CreateOrderRequestError, saveLastOrder } from '../lib/public-order-api';
import { CustomerCallStaff } from './customer-call-staff';

const allCategoryId = '__all__';
const priceFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

interface IndexedItem {
  category: PublicCatalogCategory;
  item: PublicCatalogItem;
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .trim();
}

function CustomerMenuLoading() {
  return (
    <main className="customer-order-page" aria-busy="true">
      <div className="customer-order-shell customer-loading-shell">
        <div className="customer-loading-header" />
        <div className="customer-loading-hero" />
        <div className="customer-loading-categories">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} />
          ))}
        </div>
        <div className="customer-loading-grid">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} />
          ))}
        </div>
      </div>
    </main>
  );
}

interface CustomerMenuErrorProps {
  error: Error;
  retry: () => void;
}

function CustomerMenuError({ error, retry }: CustomerMenuErrorProps) {
  const notFound = error instanceof PublicApiRequestError && error.status === 404;

  return (
    <main className="customer-order-page customer-center-page">
      <section className="customer-state-card">
        <span aria-hidden="true">{notFound ? '⌁' : '!'}</span>
        <h1>{notFound ? 'Không tìm thấy sân' : 'Chưa tải được thực đơn'}</h1>
        <p>{error.message}</p>
        <button type="button" onClick={retry}>
          Thử lại
        </button>
      </section>
    </main>
  );
}

interface CustomerHeroProps {
  slug: string;
  servicePointName: string;
  onSubmitted: () => void;
}

function CustomerHero({ slug, servicePointName, onSubmitted }: CustomerHeroProps) {
  return (
    <section className="customer-order-hero">
      <div className="customer-order-hero-copy">
        <h1>Gọi nhân viên hỗ trợ ngay</h1>
        <p>Cần dụng cụ, kiểm tra hóa đơn hoặc hỗ trợ tại sân?</p>
        <CustomerCallStaff
          slug={slug}
          servicePointName={servicePointName}
          onSubmitted={onSubmitted}
        />
      </div>

      <svg className="customer-order-hero-art" viewBox="0 0 220 220" aria-hidden="true">
        <circle cx="142" cy="106" r="92" fill="#D8F5F1" />
        <ellipse cx="142" cy="197" rx="68" ry="13" fill="#C7ECE7" />
        <path
          d="M142 42c19 0 30 13 30 30 0 8-3 17-11 22l-36-2c-7-8-10-15-10-24 0-15 11-26 27-26Z"
          fill="#263E4A"
        />
        <circle cx="140" cy="68" r="22" fill="#F3B58D" />
        <path d="M116 55c5-15 17-23 31-21 12 2 21 9 25 19l-56 2Z" fill="#337CB9" />
        <path d="M118 54h65c-2 7-8 10-17 10h-48Z" fill="#245D91" />
        <rect x="132" y="83" width="18" height="22" rx="8" fill="#EAA47E" />
        <path d="M105 107c7-13 20-20 36-20 19 0 34 8 43 23l-14 73H105l-8-51 8-25Z" fill="#438CC4" />
        <path
          d="M120 93c7 9 14 14 22 14 9 0 17-5 24-14l7 14c-8 10-19 15-31 15-13 0-24-5-31-15l9-14Z"
          fill="#F5F8FA"
        />
        <path d="M170 113c10 3 16 9 20 19l-7 44-16-4 2-38-20 9-6-15 27-15Z" fill="#F0AD86" />
        <path d="M108 113c-11 4-17 12-19 23l9 33 15-5-4-28 16 6 6-15-23-14Z" fill="#F0AD86" />
        <path d="M103 130h66l8 70H96l7-70Z" fill="#DCA55A" />
        <path
          d="M115 131c0-14 8-23 21-23 14 0 23 9 23 23"
          fill="none"
          stroke="#B77F3D"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <rect x="105" y="146" width="61" height="7" rx="3.5" fill="#F3C475" />
        <rect x="116" y="113" width="13" height="33" rx="5" fill="#62C8BE" />
        <rect x="119" y="106" width="7" height="10" rx="2" fill="#338D84" />
      </svg>
    </section>
  );
}

export function CustomerMenuPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const cart = useCart(slug);
  const checkoutRequested = searchParams.get('thanh-toan') === '1';
  const [activeCategoryId, setActiveCategoryId] = useState(allCategoryId);
  const [search, setSearch] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(() => checkoutRequested && cart.itemCount > 0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
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
  const orderMutation = useMutation({
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

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }

    setToastMessage(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 1_700);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!contextQuery.data) {
      return;
    }

    document.title = `${contextQuery.data.servicePoint.name} · Ngọn Hải Đăng Pickleball`;
  }, [contextQuery.data]);

  useEffect(() => {
    if (checkoutRequested) {
      void navigate(`/s/${slug}`, { replace: true });
    }
  }, [checkoutRequested, navigate, slug]);

  const closeCheckout = useCallback(() => {
    if (!orderMutation.isPending) {
      setCheckoutOpen(false);
    }
  }, [orderMutation.isPending]);

  if (contextQuery.isPending) {
    return <CustomerMenuLoading />;
  }

  if (contextQuery.isError) {
    return (
      <CustomerMenuError
        error={
          contextQuery.error instanceof Error
            ? contextQuery.error
            : new Error('Không thể tải thực đơn.')
        }
        retry={() => {
          void contextQuery.refetch();
        }}
      />
    );
  }

  const context = contextQuery.data;
  const indexedItems: IndexedItem[] = context.categories.flatMap((category) =>
    category.items.map((item) => ({ category, item })),
  );
  const normalizedSearch = normalizeSearch(search);
  const visibleItems = indexedItems.filter(({ category, item }) => {
    const matchesCategory = activeCategoryId === allCategoryId || category.id === activeCategoryId;
    const matchesSearch =
      normalizedSearch.length === 0 ||
      normalizeSearch(`${item.name} ${item.description ?? ''} ${category.name}`).includes(
        normalizedSearch,
      );

    return matchesCategory && matchesSearch;
  });
  const cartQuantityByItemId = new Map(
    cart.cart.lines.map((line) => [line.catalogItemId, line.quantity] as const),
  );
  const imageByItemId = new Map<string, string | null>(
    indexedItems.map(({ item }) => [
      item.id,
      buildCloudinaryImageUrl(
        context.media.cloudName,
        item.image,
        'f_auto,q_auto,c_fill,w_360,h_260',
      ),
    ]),
  );
  const orderErrorMessage = orderMutation.isError
    ? orderMutation.error instanceof CreateOrderRequestError
      ? orderMutation.error.message
      : 'Không thể gửi yêu cầu đặt món. Vui lòng kiểm tra mạng và thử lại.'
    : null;

  const addItem = (item: PublicCatalogItem) => {
    const currentQuantity = cartQuantityByItemId.get(item.id) ?? 0;

    if (currentQuantity >= 50) {
      showToast('Mỗi món được chọn tối đa 50 phần.');
      return;
    }

    cart.addItem(slug, {
      catalogItemId: item.id,
      name: item.name,
      unitName: item.unitName,
      priceVnd: item.priceVnd,
    });
    showToast(`Đã thêm ${item.name}`);
  };

  const decreaseItem = (item: PublicCatalogItem) => {
    const currentQuantity = cartQuantityByItemId.get(item.id) ?? 0;

    if (currentQuantity <= 1) {
      cart.removeItem(slug, item.id);
      return;
    }

    cart.setQuantity(slug, item.id, currentQuantity - 1);
  };

  return (
    <main className="customer-order-page">
      <div className="customer-order-shell">
        <header className="customer-order-header">
          <section className="customer-order-header-card" aria-label="Thông tin sân và tìm kiếm">
            <svg className="customer-header-pattern" viewBox="0 0 200 200" aria-hidden="true">
              <circle cx="100" cy="100" r="28" />
              <circle cx="100" cy="100" r="52" />
              <circle cx="100" cy="100" r="76" />
              <circle cx="100" cy="100" r="98" />
            </svg>

            <div className="customer-header-context-row">
              <div className="customer-header-context">
                <span>Sân hiện tại</span>
                <div className="customer-header-name">
                  <img src="/logo.png" alt="" aria-hidden="true" />
                  <strong>
                    {context.venue.name} · {context.servicePoint.name}
                  </strong>
                  <ChevronDownIcon />
                </div>
              </div>

              <Link
                to={`/s/${slug}/bill`}
                className="customer-header-bill"
                aria-label="Xem hóa đơn sân"
                title="Hóa đơn sân"
              >
                <ReceiptIcon />
              </Link>
            </div>

            <div className="customer-header-search-row">
              <div className="customer-search-field">
                <SearchIcon />
                <input
                  value={search}
                  type="search"
                  autoComplete="off"
                  placeholder="Tìm món ăn, nước uống..."
                  aria-label="Tìm món ăn, nước uống"
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search ? (
                  <button
                    type="button"
                    aria-label="Xóa nội dung tìm kiếm"
                    onClick={() => setSearch('')}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        </header>

        <div className="customer-order-content">
          <CustomerHero
            slug={slug}
            servicePointName={context.servicePoint.name}
            onSubmitted={() => showToast('Đã gửi yêu cầu gọi nhân viên')}
          />

          <section aria-labelledby="customer-category-title">
            <div className="customer-section-heading">
              <div>
                <GridIcon />
                <h2 id="customer-category-title">Danh mục</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveCategoryId(allCategoryId);
                  setSearch('');
                }}
              >
                Xem tất cả
              </button>
            </div>

            <div className="customer-category-list" aria-label="Danh mục thực đơn">
              <button
                type="button"
                className={activeCategoryId === allCategoryId ? 'is-active' : undefined}
                aria-pressed={activeCategoryId === allCategoryId}
                onClick={() => setActiveCategoryId(allCategoryId)}
              >
                <span className="customer-category-icon category-tone-0">
                  <CategoryIcon variant={0} />
                </span>
                <span>Tất cả</span>
              </button>

              {context.categories.map((category, index) => (
                <button
                  key={category.id}
                  type="button"
                  className={activeCategoryId === category.id ? 'is-active' : undefined}
                  aria-pressed={activeCategoryId === category.id}
                  onClick={() => setActiveCategoryId(category.id)}
                >
                  <span className={`customer-category-icon category-tone-${(index + 1) % 4}`}>
                    <CategoryIcon variant={index + 1} />
                  </span>
                  <span>{category.name}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="customer-section-divider" />

          <section id="customer-menu-products" className="customer-products-section">
            <div className="customer-section-heading">
              <div>
                <MenuIcon />
                <h2>Gợi ý cho bạn</h2>
              </div>
              <span>{visibleItems.length} món</span>
            </div>

            {visibleItems.length === 0 ? (
              <div className="customer-empty-products">
                <SearchIcon />
                <h3>Không tìm thấy món phù hợp</h3>
                <p>Thử đổi từ khóa hoặc chọn một danh mục khác.</p>
              </div>
            ) : (
              <div className="customer-product-grid">
                {visibleItems.map(({ item }) => (
                  <CustomerProductCard
                    key={item.id}
                    item={item}
                    imageUrl={imageByItemId.get(item.id) ?? null}
                    quantity={cartQuantityByItemId.get(item.id) ?? 0}
                    onAdd={() => addItem(item)}
                    onDecrease={() => decreaseItem(item)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {cart.itemCount > 0 ? (
          <div className="customer-checkout-bar-wrap">
            <div className="customer-checkout-bar" aria-live="polite">
              <div>
                <span>{cart.itemCount} món đã chọn</span>
                <strong>{priceFormatter.format(cart.provisionalTotalVnd)}</strong>
              </div>
              <button
                type="button"
                onClick={() => {
                  orderMutation.reset();
                  setCheckoutOpen(true);
                }}
              >
                Thanh toán
              </button>
            </div>
          </div>
        ) : null}

        <CustomerCheckoutSheet
          open={checkoutOpen}
          lines={cart.cart.lines}
          itemCount={cart.itemCount}
          provisionalTotalVnd={cart.provisionalTotalVnd}
          note={cart.cart.note}
          imageByItemId={imageByItemId}
          isSubmitting={orderMutation.isPending}
          errorMessage={orderErrorMessage}
          onClose={closeCheckout}
          onDecrease={(line) => {
            if (line.quantity <= 1) {
              cart.removeItem(slug, line.catalogItemId);
              if (cart.itemCount === 1) {
                setCheckoutOpen(false);
              }
            } else {
              cart.setQuantity(slug, line.catalogItemId, line.quantity - 1);
            }
          }}
          onIncrease={(line) => {
            if (line.quantity < 50) {
              cart.setQuantity(slug, line.catalogItemId, line.quantity + 1);
            }
          }}
          onNoteChange={(value) => cart.setNote(slug, value)}
          onSubmit={() => {
            const idempotencyKey = cart.ensureSubmissionKey(slug);
            orderMutation.mutate({ idempotencyKey });
          }}
        />

        <div
          className={`customer-order-toast${toastMessage ? ' is-visible' : ''}`}
          aria-live="polite"
          aria-atomic="true"
        >
          <span>
            <CheckIcon />
          </span>
          {toastMessage}
        </div>
      </div>
    </main>
  );
}
