import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';

import { AdminApiError, getAdminDashboard, getAdminSession, logoutAdmin } from '../lib/admin-api';
import { useAdminRealtime } from '../lib/admin-realtime';

const moneyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

function isAuthenticationError(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 401;
}

export function AdminDashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ['admin', 'session'],
    queryFn: getAdminSession,
    retry: false,
    staleTime: 60_000,
  });
  const realtimeStatus = useAdminRealtime(sessionQuery.isSuccess);
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

  if (sessionQuery.isPending || (sessionQuery.isSuccess && dashboardQuery.isPending)) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface text-ink">
        <p className="font-bold text-muted">Đang tải dashboard…</p>
      </main>
    );
  }

  if (
    sessionQuery.isError ||
    dashboardQuery.isError ||
    !sessionQuery.data ||
    !dashboardQuery.data
  ) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface px-5 text-ink">
        <section className="max-w-md rounded-2xl border border-line bg-white p-6 text-center shadow-panel">
          <h1 className="text-xl font-black">Không thể tải dashboard</h1>
          <p className="mt-2 text-sm text-muted">Kiểm tra kết nối rồi tải lại trang.</p>
          <button
            type="button"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ['admin'] });
            }}
            className="mt-5 rounded-xl bg-brand px-5 py-3 font-bold text-white"
          >
            Thử lại
          </button>
        </section>
      </main>
    );
  }

  const { admin } = sessionQuery.data;
  const { servicePoints } = dashboardQuery.data;

  return (
    <main className="min-h-screen bg-surface px-4 py-6 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 rounded-3xl border border-line bg-white p-5 shadow-panel sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-brand">Quản trị sân</p>
            <h1 className="mt-2 text-3xl font-black">Tổng quan hiện tại</h1>
            <p className="mt-2 text-sm text-muted">
              Xin chào {admin.displayName} · @{admin.username}
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <p
              className={`rounded-full px-3 py-1 text-xs font-black ${
                realtimeStatus === 'connected'
                  ? 'bg-success-soft text-success'
                  : 'bg-neutral-soft text-muted'
              }`}
            >
              {realtimeStatus === 'connected'
                ? 'Realtime đang kết nối'
                : 'Polling dự phòng mỗi 15 giây'}
            </p>
            <button
              type="button"
              disabled={logoutMutation.isPending}
              onClick={() => logoutMutation.mutate()}
              className="rounded-xl border border-line px-4 py-3 font-bold transition hover:border-brand hover:text-brand disabled:opacity-60"
            >
              {logoutMutation.isPending ? 'Đang đăng xuất…' : 'Đăng xuất'}
            </button>
          </div>
        </header>

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {servicePoints.map((servicePoint) => {
            const courtState =
              servicePoint.status === 'INACTIVE'
                ? 'Đang tắt'
                : servicePoint.openBill
                  ? 'Đang có bill'
                  : 'Đang rảnh';

            return (
              <article
                key={servicePoint.id}
                className="rounded-2xl border border-line bg-white p-5 shadow-panel"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">
                      {servicePoint.code}
                    </p>
                    <h2 className="mt-1 text-2xl font-black">{servicePoint.name}</h2>
                    <p className="mt-1 text-sm text-muted">{servicePoint.venueName}</p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-black ${
                      servicePoint.status === 'INACTIVE'
                        ? 'bg-neutral-soft text-muted'
                        : servicePoint.openBill
                          ? 'bg-danger-soft text-danger'
                          : 'bg-success-soft text-success'
                    }`}
                  >
                    {courtState}
                  </span>
                </div>

                <dl className="mt-6 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-neutral-soft p-3">
                    <dt className="text-xs font-bold uppercase tracking-wide text-muted">
                      Bill tạm tính
                    </dt>
                    <dd className="mt-2 text-lg font-black">
                      {moneyFormatter.format(servicePoint.openBill?.totalVnd ?? 0)}
                    </dd>
                  </div>
                  <div className="rounded-xl bg-neutral-soft p-3">
                    <dt className="text-xs font-bold uppercase tracking-wide text-muted">
                      Order đang chờ
                    </dt>
                    <dd className="mt-2 text-lg font-black">{servicePoint.pendingOrderCount}</dd>
                  </div>
                </dl>

                {servicePoint.openBill ? (
                  <Link
                    to={`/admin/bills/${servicePoint.openBill.id}`}
                    className="mt-4 flex w-full justify-center rounded-xl bg-brand px-4 py-3 text-sm font-black text-white"
                  >
                    Mở bill và xử lý order
                  </Link>
                ) : null}

                {servicePoint.hasPendingServiceRequest ? (
                  <p className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm font-black text-danger">
                    Sân đang gọi nhân viên
                  </p>
                ) : (
                  <p className="mt-4 rounded-xl bg-success-soft px-4 py-3 text-sm font-bold text-success">
                    Không có yêu cầu hỗ trợ đang chờ
                  </p>
                )}
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
