import type { AdminDashboardServicePoint } from '@nhdp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { useAdminAlertRuntime } from '../components/admin-alert-runtime';
import { AdminPageHeader } from '../components/admin-page-header';
import {
  AdminApiError,
  getAdminDashboard,
  getAdminSession,
  logoutAdmin,
  openAdminBillForServicePoint,
} from '../lib/admin-api';

const moneyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

const EMPTY_SERVICE_POINTS: AdminDashboardServicePoint[] = [];

type DashboardFilter = 'ALL' | 'ACTIVE' | 'PENDING' | 'ALERT' | 'INACTIVE';

function isAuthenticationError(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 401;
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function isCenterCourt(servicePoint: AdminDashboardServicePoint): boolean {
  if (servicePoint.slug === 'san-03') {
    return true;
  }

  const numericCode = Number.parseInt(servicePoint.code.replace(/\D/g, ''), 10);
  return numericCode === 3;
}

function courtState(servicePoint: AdminDashboardServicePoint): {
  label: string;
  className: string;
  operationallyActive: boolean;
} {
  if (servicePoint.status === 'INACTIVE') {
    return {
      label: 'Đang tắt',
      className: 'is-inactive',
      operationallyActive: false,
    };
  }

  if (servicePoint.billLifecycleState === 'OPEN_ACTIVE') {
    return {
      label: 'Đang hoạt động',
      className: 'is-active',
      operationallyActive: true,
    };
  }

  return {
    label: 'Đang rảnh',
    className: 'is-idle',
    operationallyActive: false,
  };
}

function CourtCard({
  servicePoint,
  openingBill,
  onOpenBill,
}: {
  servicePoint: AdminDashboardServicePoint;
  openingBill: boolean;
  onOpenBill: (servicePointId: string) => void;
}) {
  const state = courtState(servicePoint);
  const hasAlert = servicePoint.hasPendingServiceRequest;
  const billStateLabel = servicePoint.openBill
    ? servicePoint.billLifecycleState === 'OPEN_EMPTY'
      ? 'Bill trống'
      : 'Đang mở'
    : 'Chưa mở';

  return (
    <article className={`admin-court-card ${state.className}${hasAlert ? ' has-alert' : ''}`}>
      <div className="admin-court-card-body">
        <div className="admin-court-card-top">
          <span className="admin-court-code">{servicePoint.code}</span>
          <span className="admin-court-status">{state.label}</span>
        </div>

        <h2>{servicePoint.name}</h2>

        {isCenterCourt(servicePoint) || hasAlert ? (
          <div className="admin-court-badges">
            {isCenterCourt(servicePoint) ? (
              <span className="admin-court-premium">Trung tâm · +30.000 ₫/giờ</span>
            ) : null}

            {hasAlert ? <span className="admin-court-alert-chip">Gọi nhân viên</span> : null}
          </div>
        ) : null}

        <dl className="admin-court-metrics">
          <div>
            <dt>Tạm tính</dt>
            <dd>{moneyFormatter.format(servicePoint.openBill?.totalVnd ?? 0)}</dd>
          </div>
          <div>
            <dt>Order chờ</dt>
            <dd>{servicePoint.pendingOrderCount}</dd>
          </div>
        </dl>
      </div>

      <div className="admin-court-card-footer">
        <span>{billStateLabel}</span>

        {servicePoint.openBill ? (
          <Link to={`/admin/bills/${servicePoint.openBill.id}`} className="admin-court-card-action">
            {state.operationallyActive ? 'Xử lý bill' : 'Thêm phí / món'}
            <ArrowIcon />
          </Link>
        ) : servicePoint.status === 'ACTIVE' ? (
          <button
            type="button"
            className="admin-court-card-action"
            disabled={openingBill}
            onClick={() => onOpenBill(servicePoint.id)}
          >
            {openingBill ? 'Đang mở…' : 'Mở bill'}
            <ArrowIcon />
          </button>
        ) : (
          <span className="admin-court-card-disabled">Đang tắt</span>
        )}
      </div>
    </article>
  );
}

function DashboardLoading() {
  return (
    <main className="admin-dashboard-page" aria-busy="true">
      <div className="admin-dashboard-shell">
        <div className="admin-dashboard-loading-header">
          <span />
          <span />
          <span />
        </div>
        <div className="admin-dashboard-loading-grid">
          {Array.from({ length: 10 }).map((_, index) => (
            <div className="admin-dashboard-loading-card" key={index}>
              <span />
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

export function AdminDashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<DashboardFilter>('ALL');
  const [search, setSearch] = useState('');

  const sessionQuery = useQuery({
    queryKey: ['admin', 'session'],
    queryFn: getAdminSession,
    retry: false,
    staleTime: 60_000,
  });

  const { realtimeStatus } = useAdminAlertRuntime();

  const dashboardQuery = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: getAdminDashboard,
    enabled: sessionQuery.isSuccess,
    retry: false,
    staleTime: 10_000,
    refetchInterval: realtimeStatus === 'connected' ? false : 15_000,
  });

  const logoutMutation = useMutation({
    mutationFn: logoutAdmin,
    onSettled() {
      queryClient.removeQueries({ queryKey: ['admin'] });
      void navigate('/admin/login', { replace: true });
    },
  });

  const openBillMutation = useMutation({
    mutationFn: openAdminBillForServicePoint,
    async onSuccess(detail) {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
      void navigate(`/admin/bills/${detail.bill.id}`);
    },
  });

  useEffect(() => {
    if (
      (sessionQuery.isError && isAuthenticationError(sessionQuery.error)) ||
      (dashboardQuery.isError && isAuthenticationError(dashboardQuery.error))
    ) {
      queryClient.removeQueries({ queryKey: ['admin'] });
      void navigate('/admin/login', { replace: true });
    }
  }, [
    dashboardQuery.error,
    dashboardQuery.isError,
    navigate,
    queryClient,
    sessionQuery.error,
    sessionQuery.isError,
  ]);

  const servicePoints = dashboardQuery.data?.servicePoints ?? EMPTY_SERVICE_POINTS;

  const summary = useMemo(
    () => ({
      activeCount: servicePoints.filter(
        (servicePoint) => servicePoint.billLifecycleState === 'OPEN_ACTIVE',
      ).length,
      pendingOrderCount: servicePoints.reduce(
        (total, servicePoint) => total + servicePoint.pendingOrderCount,
        0,
      ),
      provisionalTotalVnd: servicePoints.reduce(
        (total, servicePoint) => total + (servicePoint.openBill?.totalVnd ?? 0),
        0,
      ),
    }),
    [servicePoints],
  );

  const visibleServicePoints = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi-VN');

    return servicePoints.filter((servicePoint) => {
      const state = courtState(servicePoint);
      const matchesFilter =
        filter === 'ALL' ||
        (filter === 'ACTIVE' && state.operationallyActive) ||
        (filter === 'PENDING' && servicePoint.pendingOrderCount > 0) ||
        (filter === 'ALERT' && servicePoint.hasPendingServiceRequest) ||
        (filter === 'INACTIVE' && servicePoint.status === 'INACTIVE');

      const matchesSearch =
        query.length === 0 ||
        [servicePoint.code, servicePoint.name, state.label]
          .join(' ')
          .toLocaleLowerCase('vi-VN')
          .includes(query);

      return matchesFilter && matchesSearch;
    });
  }, [filter, search, servicePoints]);

  if (sessionQuery.isPending || (sessionQuery.isSuccess && dashboardQuery.isPending)) {
    return <DashboardLoading />;
  }

  if (
    sessionQuery.isError ||
    dashboardQuery.isError ||
    !sessionQuery.data ||
    !dashboardQuery.data
  ) {
    return (
      <main className="admin-dashboard-page">
        <section className="admin-dashboard-state-card">
          <span>Không thể tải dashboard</span>
          <h1>Đường truyền đang gián đoạn</h1>
          <p>Kiểm tra kết nối rồi thử tải lại dữ liệu vận hành.</p>
          <button
            type="button"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ['admin'] });
            }}
          >
            Thử lại
          </button>
        </section>
      </main>
    );
  }

  const { admin } = sessionQuery.data;

  return (
    <main className="admin-dashboard-page">
      <div className="admin-dashboard-shell">
        <AdminPageHeader
          activePage="dashboard"
          admin={admin}
          realtimeStatus={realtimeStatus}
          logoutPending={logoutMutation.isPending}
          onLogout={() => logoutMutation.mutate()}
        />

        <section className="admin-dashboard-content">
          <div className="admin-dashboard-title-row">
            <div>
              <h1>Quản lý cụm sân</h1>
              <p>Bill, order và hỗ trợ realtime.</p>
            </div>

            <dl className="admin-dashboard-kpis">
              <div>
                <dt>Sân hoạt động</dt>
                <dd>
                  {summary.activeCount}/{servicePoints.length}
                </dd>
              </div>
              <div>
                <dt>Order chờ</dt>
                <dd>{summary.pendingOrderCount}</dd>
              </div>
              <div>
                <dt>Tạm tính</dt>
                <dd>{moneyFormatter.format(summary.provisionalTotalVnd)}</dd>
              </div>
            </dl>
          </div>

          <div className="admin-dashboard-toolbar">
            <div className="admin-dashboard-filters" role="group" aria-label="Lọc sân">
              {[
                ['ALL', 'Tất cả'],
                ['ACTIVE', 'Hoạt động'],
                ['PENDING', 'Order chờ'],
                ['ALERT', 'Gọi NV'],
                ['INACTIVE', 'Đang tắt'],
              ].map(([value, label]) => (
                <button
                  type="button"
                  className={filter === value ? 'is-active' : ''}
                  aria-pressed={filter === value}
                  key={value}
                  onClick={() => setFilter(value as DashboardFilter)}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="admin-dashboard-search">
              <SearchIcon />
              <span className="sr-only">Tìm sân</span>
              <input
                type="search"
                value={search}
                placeholder="Tìm sân…"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          {openBillMutation.isError ? (
            <p className="admin-dashboard-inline-error" role="alert">
              {openBillMutation.error instanceof Error
                ? openBillMutation.error.message
                : 'Không thể mở bill cho sân.'}
            </p>
          ) : null}

          {visibleServicePoints.length > 0 ? (
            <section className="admin-court-grid" aria-label="Danh sách sân">
              {visibleServicePoints.map((servicePoint) => (
                <CourtCard
                  key={servicePoint.id}
                  servicePoint={servicePoint}
                  openingBill={
                    openBillMutation.isPending && openBillMutation.variables === servicePoint.id
                  }
                  onOpenBill={(servicePointId) => openBillMutation.mutate(servicePointId)}
                />
              ))}
            </section>
          ) : (
            <section className="admin-dashboard-empty">
              <strong>Không tìm thấy sân phù hợp</strong>
              <p>Đổi bộ lọc hoặc xóa nội dung tìm kiếm để xem lại toàn bộ sân.</p>
              <button
                type="button"
                onClick={() => {
                  setFilter('ALL');
                  setSearch('');
                }}
              >
                Hiển thị tất cả
              </button>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
