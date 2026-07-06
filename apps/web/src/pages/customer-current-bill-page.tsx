import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { fetchPublicCurrentBill } from '../lib/public-current-bill-api';

const moneyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

const orderTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
});

const updatedTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
});

const statusLabel = {
  PENDING: 'Đã gửi',
  ACCEPTED: 'Đã xác nhận',
  SERVED: 'Đã phục vụ',
  CANCELLED: 'Đã hủy',
} as const;

function ArrowLeftIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M20 11a8 8 0 1 0 2 5" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </svg>
  );
}

function WaiveIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    >
      <path d="M4 4l16 16" />
      <path d="M7 17 17 7" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="customer-bill-chevron"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ProductKindIcon({ kind }: { kind: 'CATALOG' | 'MANUAL_PRODUCT' | 'MANUAL_TIME' }) {
  if (kind === 'MANUAL_TIME') {
    return <ClockIcon />;
  }

  if (kind === 'MANUAL_PRODUCT') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <path d="M5 9h14l-2 11H7L5 9Z" />
        <path d="M8 9a4 4 0 0 1 8 0" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M8 3h8l-1 18H9L8 3Z" />
      <path d="M9 8h6" />
    </svg>
  );
}

function CustomerBillLoading() {
  return (
    <main className="customer-bill-app" aria-busy="true">
      <header className="customer-bill-shell-header">
        <section className="customer-bill-header customer-bill-header-skeleton">
          <div className="customer-bill-skeleton customer-bill-skeleton-nav" />
          <div className="customer-bill-skeleton customer-bill-skeleton-total" />
          <div className="customer-bill-skeleton customer-bill-skeleton-meta" />
        </section>
      </header>

      <div className="customer-bill-content">
        <div className="customer-bill-summary-grid">
          {Array.from({ length: 3 }).map((_, index) => (
            <div className="customer-bill-summary-card" key={index}>
              <div className="customer-bill-skeleton customer-bill-skeleton-icon" />
              <div className="customer-bill-skeleton customer-bill-skeleton-line" />
              <div className="customer-bill-skeleton customer-bill-skeleton-value" />
            </div>
          ))}
        </div>

        <div className="customer-bill-loading-list">
          {Array.from({ length: 4 }).map((_, index) => (
            <div className="customer-bill-loading-row" key={index}>
              <div className="customer-bill-skeleton customer-bill-skeleton-row-icon" />
              <div className="customer-bill-loading-copy">
                <div className="customer-bill-skeleton customer-bill-skeleton-line" />
                <div className="customer-bill-skeleton customer-bill-skeleton-short-line" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function CustomerBillError({
  message,
  slug,
  retry,
}: {
  message: string;
  slug: string;
  retry: () => void;
}) {
  return (
    <main className="customer-bill-app">
      <div className="customer-bill-state-page">
        <div className="customer-bill-state-icon customer-bill-state-icon-error">
          <ReceiptIcon />
        </div>
        <p className="customer-bill-state-kicker">Không tải được hóa đơn</p>
        <h1>Đường truyền đang gián đoạn</h1>
        <p>{message}</p>

        <div className="customer-bill-state-actions">
          <button type="button" className="customer-bill-primary-button" onClick={retry}>
            Thử lại
          </button>
          <Link className="customer-bill-secondary-button" to={`/s/${slug}`}>
            Về menu
          </Link>
        </div>
      </div>
    </main>
  );
}

export function CustomerCurrentBillPage() {
  const { slug = '' } = useParams();
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  const billQuery = useQuery({
    queryKey: ['public', 'current-bill', slug],
    queryFn: ({ signal }) => fetchPublicCurrentBill(slug, signal),
    enabled: slug.length > 0,
    retry: false,
    refetchInterval: 15_000,
  });

  const displayOrders = useMemo(
    () =>
      (billQuery.data?.orders ?? [])
        .map((order, index) => ({
          order,
          sequence: index + 1,
        }))
        .reverse(),
    [billQuery.data?.orders],
  );

  if (billQuery.isPending) {
    return <CustomerBillLoading />;
  }

  if (billQuery.isError || !billQuery.data) {
    return (
      <CustomerBillError
        message={
          billQuery.error instanceof Error
            ? billQuery.error.message
            : 'Kết nối đang gián đoạn. Vui lòng thử lại.'
        }
        retry={() => {
          void billQuery.refetch();
        }}
        slug={slug}
      />
    );
  }

  const detail = billQuery.data;
  const menuPath = `/s/${slug}`;
  const updatedAt = detail.bill?.updatedAt ?? detail.generatedAt;

  return (
    <main className="customer-bill-app">
      <header className="customer-bill-shell-header">
        <section className="customer-bill-header">
          <svg className="customer-bill-header-rings" viewBox="0 0 260 260" aria-hidden="true">
            <circle cx="130" cy="130" r="35" fill="none" stroke="white" strokeWidth="1.2" />
            <circle cx="130" cy="130" r="67" fill="none" stroke="white" strokeWidth="1.2" />
            <circle cx="130" cy="130" r="99" fill="none" stroke="white" strokeWidth="1.2" />
            <circle cx="130" cy="130" r="131" fill="none" stroke="white" strokeWidth="1.2" />
          </svg>

          <div className="customer-bill-header-nav">
            <Link className="customer-bill-icon-button" to={menuPath} aria-label="Quay lại menu">
              <ArrowLeftIcon />
            </Link>

            <div className="customer-bill-header-title">
              <strong>Hóa đơn tạm tính</strong>
              <span>
                {detail.venue.name} · {detail.servicePoint.name}
              </span>
            </div>

            <button
              type="button"
              className={`customer-bill-icon-button customer-bill-refresh-button ${
                billQuery.isFetching ? 'is-loading' : ''
              }`}
              onClick={() => {
                void billQuery.refetch();
              }}
              disabled={billQuery.isFetching}
              aria-label="Cập nhật hóa đơn"
            >
              <RefreshIcon />
            </button>
          </div>

          {detail.bill ? (
            <>
              <div className="customer-bill-hero">
                <div>
                  <p className="customer-bill-hero-label">Còn lại cần thanh toán</p>
                  <p className="customer-bill-total">
                    {moneyFormatter.format(detail.summary.outstandingTotalVnd)}
                  </p>
                </div>
                <span className="customer-bill-open-state">Bill đang mở</span>
              </div>

              <div className="customer-bill-updated-row">
                <span>
                  <ClockIcon />
                  Tự động cập nhật
                </span>
                <span>
                  {billQuery.isFetching
                    ? 'Đang cập nhật…'
                    : `Cập nhật lúc ${updatedTimeFormatter.format(new Date(updatedAt))}`}
                </span>
              </div>
            </>
          ) : (
            <div className="customer-bill-empty-header">
              <p>Hóa đơn chung của sân</p>
              <strong>Chưa có bill đang mở</strong>
            </div>
          )}
        </section>
      </header>

      {!detail.bill ? (
        <div className="customer-bill-content">
          <section className="customer-bill-empty-card">
            <div className="customer-bill-state-icon">
              <ReceiptIcon />
            </div>
            <span className="customer-bill-section-kicker">Sân đang rảnh</span>
            <h1>Chưa có hóa đơn tạm tính</h1>
            <p>
              Bill sẽ được tạo tự động khi lượt gọi món đầu tiên được gửi. Hóa đơn cũ không hiển thị
              sau khi đã hoàn tất.
            </p>
            <Link className="customer-bill-primary-button" to={menuPath}>
              Chọn món
            </Link>
          </section>
        </div>
      ) : (
        <>
          <div className="customer-bill-content">
            <section className="customer-bill-summary-grid" aria-label="Tổng quan hóa đơn">
              <article className="customer-bill-summary-card gross">
                <span className="customer-bill-summary-icon">
                  <ReceiptIcon />
                </span>
                <span className="customer-bill-summary-label">Tổng phát sinh</span>
                <strong className="customer-bill-summary-value">
                  {moneyFormatter.format(detail.summary.grossTotalVnd)}
                </strong>
              </article>

              <article className="customer-bill-summary-card paid">
                <span className="customer-bill-summary-icon">
                  <CheckIcon />
                </span>
                <span className="customer-bill-summary-label">Đã thanh toán</span>
                <strong className="customer-bill-summary-value">
                  {moneyFormatter.format(detail.summary.paidTotalVnd)}
                </strong>
              </article>

              <article className="customer-bill-summary-card waived">
                <span className="customer-bill-summary-icon">
                  <WaiveIcon />
                </span>
                <span className="customer-bill-summary-label">Được miễn</span>
                <strong className="customer-bill-summary-value">
                  {moneyFormatter.format(detail.summary.waivedTotalVnd)}
                </strong>
              </article>
            </section>

            <div className="customer-bill-note">
              <InfoIcon />
              <span>
                Đây là số tiền tạm tính chung của toàn sân. Nhân viên sẽ xác nhận số tiền chính thức
                khi hoàn tất hóa đơn.
              </span>
            </div>

            <section className="customer-bill-section">
              <div className="customer-bill-section-head">
                <div>
                  <span className="customer-bill-section-kicker">Tóm tắt theo món</span>
                  <h2>Các khoản trong hóa đơn</h2>
                </div>
                <span className="customer-bill-section-count">
                  {detail.summary.items.length} khoản
                </span>
              </div>

              {detail.summary.items.length > 0 ? (
                <div className="customer-bill-items">
                  {detail.summary.items.map((item) => (
                    <article
                      className="customer-bill-item"
                      key={`${item.lineKind}:${item.catalogItemId ?? item.itemName}:${item.unitPriceVnd}`}
                    >
                      <span className={`customer-bill-item-icon ${item.lineKind.toLowerCase()}`}>
                        <ProductKindIcon kind={item.lineKind} />
                      </span>

                      <div className="customer-bill-item-main">
                        <p className="customer-bill-item-name">{item.itemName}</p>
                        <p className="customer-bill-item-meta">
                          {item.orderedQuantity} {item.unitName} ×{' '}
                          {moneyFormatter.format(item.unitPriceVnd)}
                        </p>
                      </div>

                      <div className="customer-bill-item-side">
                        <strong className="customer-bill-item-price">
                          {moneyFormatter.format(item.grossTotalVnd)}
                        </strong>
                        <span className="customer-bill-item-outstanding">
                          Còn {moneyFormatter.format(item.outstandingTotalVnd)}
                        </span>
                      </div>

                      <div className="customer-bill-item-progress">
                        {item.paidQuantity > 0 ? (
                          <span className="customer-bill-mini-chip paid">
                            Đã trả {item.paidQuantity}/{item.orderedQuantity}
                          </span>
                        ) : null}
                        {item.waivedQuantity > 0 ? (
                          <span className="customer-bill-mini-chip waived">
                            Miễn {item.waivedQuantity}
                          </span>
                        ) : null}
                        {item.outstandingQuantity > 0 ? (
                          <span className="customer-bill-mini-chip remaining">
                            Còn {item.outstandingQuantity}
                          </span>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="customer-bill-inline-empty">Chưa có khoản nào trong hóa đơn.</div>
              )}
            </section>

            <section className="customer-bill-section">
              <div className="customer-bill-section-head">
                <div>
                  <span className="customer-bill-section-kicker">Lịch sử bill đang mở</span>
                  <h2>Các lượt gọi món</h2>
                </div>
                <span className="customer-bill-section-count">{detail.orders.length} lượt</span>
              </div>

              <p className="customer-bill-history-note">
                Các lượt bị hủy vẫn được giữ để đối chiếu nhưng không được cộng vào tổng tiền.
              </p>

              {displayOrders.length > 0 ? (
                <div className="customer-bill-order-list">
                  {displayOrders.map(({ order, sequence }) => {
                    const isOpen = expandedOrderId === order.id;
                    const activeLineCount = order.lines.filter(
                      (line) => line.status === 'ACTIVE',
                    ).length;

                    return (
                      <article
                        className={`customer-bill-order-card ${
                          order.status === 'CANCELLED' ? 'cancelled' : ''
                        } ${isOpen ? 'open' : ''}`}
                        key={order.id}
                      >
                        <button
                          type="button"
                          className="customer-bill-order-toggle"
                          onClick={() => {
                            setExpandedOrderId((current) =>
                              current === order.id ? null : order.id,
                            );
                          }}
                          aria-expanded={isOpen}
                        >
                          <div>
                            <span className="customer-bill-order-kicker">
                              Lượt #{sequence} ·{' '}
                              {orderTimeFormatter.format(new Date(order.createdAt))} ·{' '}
                              {order.source === 'ADMIN' ? 'Nhân viên thêm' : 'Khách gửi'}
                            </span>
                            <div className="customer-bill-order-title">
                              <strong>{moneyFormatter.format(order.totalVnd)}</strong>
                              <span
                                className={`customer-bill-status-chip ${order.status.toLowerCase()}`}
                              >
                                {statusLabel[order.status]}
                              </span>
                            </div>
                          </div>

                          <div className="customer-bill-order-side">
                            <span>{activeLineCount} khoản</span>
                            <ChevronIcon />
                          </div>
                        </button>

                        <div className="customer-bill-order-details" hidden={!isOpen}>
                          <div className="customer-bill-order-lines">
                            {order.lines.map((line) => (
                              <div
                                className={`customer-bill-order-line ${
                                  line.status === 'VOIDED' ? 'voided' : ''
                                }`}
                                key={line.id}
                              >
                                <div>
                                  <strong>{line.itemName}</strong>
                                  <span>
                                    {line.quantity} {line.unitName} ×{' '}
                                    {moneyFormatter.format(line.unitPriceVnd)}
                                  </span>
                                  {line.status === 'ACTIVE' ? (
                                    <small>
                                      Đã trả {line.paidQuantity} · Miễn {line.waivedQuantity} · Còn{' '}
                                      {line.outstandingQuantity}
                                    </small>
                                  ) : (
                                    <small>Khoản này đã được hủy</small>
                                  )}
                                </div>
                                <span className="customer-bill-order-line-price">
                                  {moneyFormatter.format(line.lineTotalVnd)}
                                </span>
                              </div>
                            ))}
                          </div>

                          {order.status === 'CANCELLED' ? (
                            <div className="customer-bill-cancelled-note">
                              <InfoIcon />
                              Lượt đã hủy được giữ để đối chiếu và không được cộng vào tổng tiền.
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="customer-bill-inline-empty">Chưa có lượt gọi món nào.</div>
              )}
            </section>
          </div>

          <div className="customer-bill-bottom-wrap">
            <div className="customer-bill-bottom-bar">
              <div>
                <small>Còn lại của toàn sân</small>
                <strong>{moneyFormatter.format(detail.summary.outstandingTotalVnd)}</strong>
              </div>
              <Link className="customer-bill-bottom-action" to={menuPath}>
                <PlusIcon />
                Gọi thêm món
              </Link>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
