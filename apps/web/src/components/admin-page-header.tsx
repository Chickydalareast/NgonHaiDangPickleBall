import type { AdminRealtimeStatus } from '../lib/admin-realtime';
import { Link } from 'react-router';

import { AdminInstallButton } from '../features/admin-install/admin-install-button';

export type AdminPageHeaderActivePage = 'dashboard' | 'catalog' | 'service-points';

interface AdminPageHeaderProps {
  activePage: AdminPageHeaderActivePage;
  admin: {
    displayName: string;
    username: string;
  };
  realtimeStatus: AdminRealtimeStatus;
  logoutPending: boolean;
  onLogout: () => void;
}

function DashboardIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </svg>
  );
}

function CatalogIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M4 5h16v14H4z" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

function QrIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <rect x="3" y="3" width="6" height="6" />
      <rect x="15" y="3" width="6" height="6" />
      <rect x="3" y="15" width="6" height="6" />
      <path d="M15 15h3v3h-3zM19 19h2v2h-2zM19 15h2M15 20v1" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    >
      <path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" />
    </svg>
  );
}

export function AdminPageHeader({
  activePage,
  admin,
  realtimeStatus,
  logoutPending,
  onLogout,
}: AdminPageHeaderProps) {
  const realtimeConnected = realtimeStatus === 'connected';

  return (
    <header className="admin-page-header">
      <Link className="admin-page-brand" to="/admin" aria-label="Về dashboard">
        <img src="/logo.png" alt="" aria-hidden="true" />
        <span>
          <strong>Ngọn Hải Đăng</strong>
          <small>Pickleball Operations</small>
        </span>
      </Link>

      <nav className="admin-page-nav" aria-label="Điều hướng quản trị">
        <Link
          className={activePage === 'dashboard' ? 'is-active' : ''}
          to="/admin"
          aria-current={activePage === 'dashboard' ? 'page' : false}
        >
          <DashboardIcon />
          Dashboard
        </Link>
        <Link
          className={activePage === 'catalog' ? 'is-active' : ''}
          to="/admin/catalog"
          aria-current={activePage === 'catalog' ? 'page' : false}
        >
          <CatalogIcon />
          Catalog
        </Link>
        <Link
          className={activePage === 'service-points' ? 'is-active' : ''}
          to="/admin/service-points"
          aria-current={activePage === 'service-points' ? 'page' : false}
        >
          <QrIcon />
          Sân &amp; QR
        </Link>
      </nav>

      <div className="admin-page-header-actions">
        <span
          className={`admin-page-realtime is-${realtimeStatus}`}
          title={
            realtimeConnected
              ? 'Dữ liệu đang được cập nhật bằng SSE'
              : 'Đang dùng polling dự phòng khi SSE chưa kết nối'
          }
        >
          <i />
          {realtimeConnected ? 'Realtime đang kết nối' : 'Polling dự phòng'}
        </span>

        <AdminInstallButton />

        <div className="admin-page-profile">
          <span>{admin.displayName.slice(0, 2).toUpperCase()}</span>
          <div>
            <strong>{admin.displayName}</strong>
            <small>@{admin.username}</small>
          </div>
        </div>

        <button
          type="button"
          className="admin-page-logout"
          aria-label="Đăng xuất"
          disabled={logoutPending}
          onClick={onLogout}
        >
          <LogoutIcon />
        </button>
      </div>
    </header>
  );
}
