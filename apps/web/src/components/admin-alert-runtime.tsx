import type { AdminAlert } from '@nhdp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import {
  acknowledgeAdminServiceRequestAlert,
  getAdminAlerts,
  getAdminSession,
  resolveAdminServiceRequest,
  updateAdminOrderStatus,
} from '../lib/admin-api';
import {
  adminAlertRepeatDelay,
  type AdminAlertAudioEngine,
  type AdminAlertEscalationLevel,
  createAdminAlertAudioEngine,
} from '../features/admin-alert/admin-alert-audio';
import { type AdminRealtimeStatus, useAdminRealtime } from '../lib/admin-realtime';

const AUDIO_OWNER_KEY = 'nhdp-admin-alert-audio-owner';
const AUDIO_PREFERENCE_KEY = 'nhdp-admin-alert-audio-preference-v1';
const AUDIO_OWNER_TTL_MS = 6_000;
const AUDIO_OWNER_RENEW_MS = 2_000;
const EMPTY_ALERTS: AdminAlert[] = [];

type AdminAlertAudioStatus =
  'initializing' | 'ready' | 'needs-interaction' | 'muted' | 'unsupported' | 'error';

interface AudioPreference {
  desired: boolean;
  lastSuccessfulAt?: string;
}

interface AudioOwnerLease {
  tabId: string;
  expiresAt: number;
}

function readAudioPreference(): AudioPreference {
  try {
    const value = localStorage.getItem(AUDIO_PREFERENCE_KEY);

    if (!value) {
      return { desired: true };
    }

    const parsed = JSON.parse(value) as Partial<AudioPreference>;

    return {
      desired: parsed.desired !== false,
      ...(typeof parsed.lastSuccessfulAt === 'string'
        ? { lastSuccessfulAt: parsed.lastSuccessfulAt }
        : {}),
    };
  } catch {
    return { desired: true };
  }
}

function writeAudioPreference(preference: AudioPreference): void {
  try {
    localStorage.setItem(AUDIO_PREFERENCE_KEY, JSON.stringify(preference));
  } catch {
    // Audio still works for the current session when storage is unavailable.
  }
}

interface AdminAlertRuntimeValue {
  realtimeStatus: AdminRealtimeStatus;
}

const AdminAlertRuntimeContext = createContext<AdminAlertRuntimeValue | null>(null);

const moneyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

const timeFormatter = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
});

function alertId(alert: AdminAlert): string {
  return alert.kind === 'ORDER' ? `order:${alert.orderId}` : `service:${alert.serviceRequestId}`;
}

function readAudioOwner(): AudioOwnerLease | null {
  try {
    const value = localStorage.getItem(AUDIO_OWNER_KEY);

    if (!value) {
      return null;
    }

    const parsed = JSON.parse(value) as Partial<AudioOwnerLease>;

    if (typeof parsed.tabId !== 'string' || typeof parsed.expiresAt !== 'number') {
      return null;
    }

    return { tabId: parsed.tabId, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function writeAudioOwner(lease: AudioOwnerLease): void {
  try {
    localStorage.setItem(AUDIO_OWNER_KEY, JSON.stringify(lease));
  } catch {
    // Multiple tabs may ring only when browser storage is unavailable.
  }
}

function removeAudioOwner(): void {
  try {
    localStorage.removeItem(AUDIO_OWNER_KEY);
  } catch {
    // The alert remains functional in this tab when browser storage is unavailable.
  }
}

function createTabId(): string {
  return crypto.randomUUID();
}

function alertEscalationLevel(createdAt: string): AdminAlertEscalationLevel {
  const waitingMs = Math.max(0, Date.now() - Date.parse(createdAt));

  if (waitingMs >= 30_000) {
    return 2;
  }

  return waitingMs >= 15_000 ? 1 : 0;
}

function audioStatusLabel(status: AdminAlertAudioStatus): string {
  switch (status) {
    case 'ready':
      return 'Âm thanh sẵn sàng';
    case 'muted':
      return 'Âm thanh đã tắt · Bật lại';
    case 'unsupported':
      return 'Trình duyệt không hỗ trợ âm thanh';
    case 'error':
      return 'Thử bật lại âm thanh';
    case 'initializing':
      return 'Đang chuẩn bị âm thanh…';
    case 'needs-interaction':
      return 'Nhấn để kích hoạt âm thanh';
  }
}

function audioStatusDescription(status: AdminAlertAudioStatus): string {
  switch (status) {
    case 'ready':
      return 'Order C và chuông Dual ring đã sẵn sàng phát.';
    case 'muted':
      return 'Âm thanh đã được tắt có chủ ý trên máy này.';
    case 'unsupported':
      return 'Trình duyệt hiện tại không cung cấp Web Audio.';
    case 'error':
      return 'Không thể khởi động thiết bị âm thanh.';
    case 'initializing':
      return 'Ứng dụng đang thử khôi phục âm thanh tự động.';
    case 'needs-interaction':
      return 'Click hoặc nhấn phím bất kỳ trong ứng dụng để mở khóa âm thanh.';
  }
}

function notificationBody(alert: AdminAlert): string {
  if (alert.kind === 'SERVICE_REQUEST') {
    return alert.message
      ? `${alert.servicePoint.name}: ${alert.message}`
      : `${alert.servicePoint.name} đang gọi nhân viên.`;
  }

  return `${alert.servicePoint.name}: ${alert.totalQuantity} món · ${moneyFormatter.format(alert.totalVnd)}`;
}

function alertPriorityRank(alert: AdminAlert): number {
  if (alert.acknowledgedAt === null && alert.kind === 'SERVICE_REQUEST') {
    return 0;
  }

  if (alert.acknowledgedAt === null && alert.kind === 'ORDER') {
    return 1;
  }

  if (alert.kind === 'SERVICE_REQUEST') {
    return 2;
  }

  return 3;
}

function alertHeading(alert: AdminAlert): string {
  return alert.kind === 'SERVICE_REQUEST'
    ? `${alert.servicePoint.name} đang gọi nhân viên`
    : `Có order mới tại ${alert.servicePoint.name}`;
}

function AlertBellIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

function AlertCloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

function AlertReceiptIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

function isAdminRuntimePath(pathname: string): boolean {
  return pathname.startsWith('/admin') && pathname !== '/admin/login';
}

export function AdminAlertProvider({ children }: PropsWithChildren) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const enabledForRoute = isAdminRuntimePath(location.pathname);
  const sessionQuery = useQuery({
    queryKey: ['admin', 'session'],
    queryFn: getAdminSession,
    enabled: enabledForRoute,
    retry: false,
    staleTime: 60_000,
  });
  const realtimeStatus = useAdminRealtime(enabledForRoute && sessionQuery.isSuccess);
  const alertsQuery = useQuery({
    queryKey: ['admin', 'alerts'],
    queryFn: getAdminAlerts,
    enabled: enabledForRoute && sessionQuery.isSuccess,
    retry: false,
    staleTime: 0,
    refetchInterval: realtimeStatus === 'connected' ? false : 15_000,
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [audioDesired, setAudioDesired] = useState<boolean>(() => readAudioPreference().desired);
  const [audioStatus, setAudioStatus] = useState<AdminAlertAudioStatus>(() =>
    readAudioPreference().desired ? 'initializing' : 'muted',
  );
  const [isAudioOwner, setIsAudioOwner] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof Notification === 'undefined' ? 'denied' : Notification.permission,
  );
  const audioEngineRef = useRef<AdminAlertAudioEngine | null>(null);
  const audioDesiredRef = useRef(audioDesired);
  const audioStateListenerCleanupRef = useRef<(() => void) | null>(null);
  const tabIdRef = useRef(createTabId());
  const originalTitleRef = useRef(document.title);
  const previousUnacknowledgedCountRef = useRef(0);
  const knownAlertIdsRef = useRef<Set<string> | null>(null);
  const alertDialogRef = useRef<HTMLElement | null>(null);

  const alerts = alertsQuery.data?.alerts ?? EMPTY_ALERTS;
  const unacknowledgedAlerts = useMemo(
    () => alerts.filter((alert) => alert.acknowledgedAt === null),
    [alerts],
  );
  const unacknowledgedCount = unacknowledgedAlerts.length;
  const prioritizedAlerts = useMemo(
    () =>
      [...alerts].sort((left, right) => {
        const rankDifference = alertPriorityRank(left) - alertPriorityRank(right);

        if (rankDifference !== 0) {
          return rankDifference;
        }

        return Date.parse(left.createdAt) - Date.parse(right.createdAt);
      }),
    [alerts],
  );
  const primaryAlert = prioritizedAlerts[0] ?? null;
  const highestPriorityKind: AdminAlert['kind'] | null = unacknowledgedAlerts.some(
    (alert) => alert.kind === 'SERVICE_REQUEST',
  )
    ? 'SERVICE_REQUEST'
    : unacknowledgedAlerts.length > 0
      ? 'ORDER'
      : null;
  const oldestPriorityAlertCreatedAt = useMemo(() => {
    if (!highestPriorityKind) {
      return null;
    }

    return unacknowledgedAlerts
      .filter((alert) => alert.kind === highestPriorityKind)
      .reduce<string | null>((oldest, alert) => {
        if (!oldest || Date.parse(alert.createdAt) < Date.parse(oldest)) {
          return alert.createdAt;
        }

        return oldest;
      }, null);
  }, [highestPriorityKind, unacknowledgedAlerts]);
  const runtimeActive = enabledForRoute && sessionQuery.isSuccess;
  const audioActive = runtimeActive && audioDesired && audioStatus === 'ready';
  const ownershipActive = runtimeActive && (audioDesired || notificationPermission === 'granted');
  const ownsAudio = audioActive && isAudioOwner;

  const confirmOrderMutation = useMutation({
    mutationFn: ({ orderId }: { orderId: string }) =>
      updateAdminOrderStatus(orderId, { status: 'ACCEPTED' }),
    async onSuccess(snapshot) {
      queryClient.setQueryData(['admin', 'bill', snapshot.bill.id], snapshot);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'alerts'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] }),
        queryClient.invalidateQueries({
          queryKey: ['public', 'current-bill', snapshot.servicePoint.slug],
        }),
      ]);
    },
  });
  const acknowledgeServiceRequestMutation = useMutation({
    mutationFn: acknowledgeAdminServiceRequestAlert,
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'alerts'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });
  const resolveServiceRequestMutation = useMutation({
    mutationFn: resolveAdminServiceRequest,
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'alerts'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });

  const syncAudioStatus = useCallback((engine: AdminAlertAudioEngine): void => {
    if (!audioDesiredRef.current) {
      setAudioStatus('muted');
      return;
    }

    if (engine.context.state === 'running') {
      setAudioStatus('ready');
      setAudioError(null);
      writeAudioPreference({
        desired: true,
        lastSuccessfulAt: new Date().toISOString(),
      });
      return;
    }

    if (engine.context.state === 'closed') {
      setAudioStatus('error');
      setAudioError('Thiết bị âm thanh đã đóng.');
      return;
    }

    setAudioStatus('needs-interaction');
  }, []);

  const ensureAudioEngine = useCallback((): AdminAlertAudioEngine | null => {
    const existing = audioEngineRef.current;

    if (existing && existing.context.state !== 'closed') {
      return existing;
    }

    const audioWindow = window as typeof window & {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextConstructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;

    if (!AudioContextConstructor) {
      setAudioStatus('unsupported');
      setAudioError('Trình duyệt không hỗ trợ Web Audio.');
      return null;
    }

    audioStateListenerCleanupRef.current?.();

    const engine = createAdminAlertAudioEngine(new AudioContextConstructor());
    const handleStateChange = (): void => syncAudioStatus(engine);

    engine.context.addEventListener('statechange', handleStateChange);
    audioStateListenerCleanupRef.current = () => {
      engine.context.removeEventListener('statechange', handleStateChange);
    };
    audioEngineRef.current = engine;
    syncAudioStatus(engine);

    return engine;
  }, [syncAudioStatus]);

  const activateAudio = useCallback(async (): Promise<void> => {
    audioDesiredRef.current = true;
    setAudioDesired(true);
    setAudioError(null);
    writeAudioPreference({ desired: true });

    const engine = ensureAudioEngine();

    if (!engine) {
      return;
    }

    setAudioStatus(engine.context.state === 'running' ? 'ready' : 'initializing');

    try {
      await engine.context.resume();
      syncAudioStatus(engine);
    } catch (error) {
      setAudioStatus('needs-interaction');
      setAudioError(
        error instanceof Error ? error.message : 'Trình duyệt chưa cho phép phát âm thanh tự động.',
      );
    }
  }, [ensureAudioEngine, syncAudioStatus]);

  const muteAudio = useCallback(async (): Promise<void> => {
    audioDesiredRef.current = false;
    setAudioDesired(false);
    setAudioStatus('muted');
    setAudioError(null);
    setIsAudioOwner(false);
    writeAudioPreference({ desired: false });

    const engine = audioEngineRef.current;

    if (engine?.context.state === 'running') {
      try {
        await engine.context.suspend();
      } catch {
        // The desired state remains muted even if the browser refuses to suspend.
      }
    }
  }, []);

  const testAudio = useCallback(async (): Promise<void> => {
    await activateAudio();

    const engine = audioEngineRef.current;

    if (engine?.context.state === 'running') {
      engine.play(highestPriorityKind ?? 'ORDER', 0);
    }
  }, [activateAudio, highestPriorityKind]);

  const requestNotificationPermission = useCallback(async (): Promise<void> => {
    if (typeof Notification === 'undefined') {
      setNotificationPermission('denied');
      return;
    }

    const permission =
      Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
    setNotificationPermission(permission);
  }, []);

  useEffect(() => {
    audioDesiredRef.current = audioDesired;
  }, [audioDesired]);

  useEffect(() => {
    const adminPath = location.pathname.startsWith('/admin');

    if (!adminPath || !audioDesired) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      void activateAudio();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activateAudio, audioDesired, location.pathname]);

  useEffect(() => {
    const adminPath = location.pathname.startsWith('/admin');

    if (!adminPath || !audioDesired || audioStatus === 'ready' || audioStatus === 'unsupported') {
      return;
    }

    const unlockAudio = (): void => {
      void activateAudio();
    };

    window.addEventListener('pointerdown', unlockAudio, {
      capture: true,
      once: true,
    });
    window.addEventListener('keydown', unlockAudio, {
      capture: true,
      once: true,
    });

    return () => {
      window.removeEventListener('pointerdown', unlockAudio, true);
      window.removeEventListener('keydown', unlockAudio, true);
    };
  }, [activateAudio, audioDesired, audioStatus, location.pathname]);

  useEffect(() => {
    const adminPath = location.pathname.startsWith('/admin');

    if (!adminPath || !audioDesired) {
      return;
    }

    const recoverAudio = (): void => {
      if (typeof Notification !== 'undefined') {
        setNotificationPermission(Notification.permission);
      }

      if (document.visibilityState === 'visible') {
        void activateAudio();
      }
    };

    window.addEventListener('focus', recoverAudio);
    document.addEventListener('visibilitychange', recoverAudio);

    return () => {
      window.removeEventListener('focus', recoverAudio);
      document.removeEventListener('visibilitychange', recoverAudio);
    };
  }, [activateAudio, audioDesired, location.pathname]);

  useEffect(() => {
    if (!enabledForRoute) {
      previousUnacknowledgedCountRef.current = 0;
      return;
    }

    const shouldOpenPanel = unacknowledgedCount > previousUnacknowledgedCountRef.current;
    previousUnacknowledgedCountRef.current = unacknowledgedCount;

    if (!shouldOpenPanel) {
      return;
    }

    const frame = window.requestAnimationFrame(() => setPanelOpen(true));

    return () => window.cancelAnimationFrame(frame);
  }, [enabledForRoute, unacknowledgedCount]);

  useEffect(() => {
    if (!panelOpen || !enabledForRoute) {
      return;
    }

    const dialog = alertDialogRef.current;
    const previousOverflow = document.body.style.overflow;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    document.body.style.overflow = 'hidden';

    const frame = window.requestAnimationFrame(() => {
      dialog
        ?.querySelector<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        )
        ?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPanelOpen(false);
        return;
      }

      if (event.key !== 'Tab' || !dialog) {
        return;
      }

      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );

      const first = controls[0];
      const last = controls.at(-1);

      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [enabledForRoute, panelOpen]);

  useEffect(() => {
    if (!ownershipActive) {
      return;
    }

    const tabId = tabIdRef.current;

    const refreshOwnership = (): void => {
      const now = Date.now();
      const current = readAudioOwner();

      if (!current || current.expiresAt <= now || current.tabId === tabId) {
        writeAudioOwner({ tabId, expiresAt: now + AUDIO_OWNER_TTL_MS });
        setIsAudioOwner(true);
        return;
      }

      setIsAudioOwner(false);
    };

    const handleStorage = (event: StorageEvent): void => {
      if (event.key === AUDIO_OWNER_KEY) {
        refreshOwnership();
      }
    };

    refreshOwnership();
    const timer = window.setInterval(refreshOwnership, AUDIO_OWNER_RENEW_MS);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('storage', handleStorage);
      const current = readAudioOwner();

      if (current?.tabId === tabId) {
        removeAudioOwner();
      }
    };
  }, [ownershipActive]);

  useEffect(() => {
    if (!audioActive || !isAudioOwner || !highestPriorityKind || !oldestPriorityAlertCreatedAt) {
      return;
    }

    const engine = audioEngineRef.current;

    if (!engine) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const ring = (): void => {
      if (cancelled) {
        return;
      }

      const lease = readAudioOwner();
      const ownsCurrentLease =
        lease !== null && lease.tabId === tabIdRef.current && lease.expiresAt > Date.now();
      const level = alertEscalationLevel(oldestPriorityAlertCreatedAt);

      if (ownsCurrentLease && engine.context.state === 'running') {
        engine.play(highestPriorityKind, level);
      }

      timer = window.setTimeout(ring, adminAlertRepeatDelay(highestPriorityKind, level));
    };

    ring();

    return () => {
      cancelled = true;

      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [audioActive, highestPriorityKind, isAudioOwner, oldestPriorityAlertCreatedAt]);

  useEffect(() => {
    if (!enabledForRoute || !alertsQuery.data) {
      knownAlertIdsRef.current = null;
      return;
    }

    const currentIds = new Set(unacknowledgedAlerts.map(alertId));
    const previousIds = knownAlertIdsRef.current;

    if (!previousIds) {
      knownAlertIdsRef.current = currentIds;
      return;
    }

    const lease = readAudioOwner();
    const ownsCurrentLease =
      lease !== null && lease.tabId === tabIdRef.current && lease.expiresAt > Date.now();

    if (
      document.hidden &&
      runtimeActive &&
      ownsCurrentLease &&
      notificationPermission === 'granted' &&
      typeof Notification !== 'undefined'
    ) {
      for (const alert of unacknowledgedAlerts) {
        const id = alertId(alert);

        if (!previousIds.has(id)) {
          try {
            const notification = new Notification(
              alert.kind === 'SERVICE_REQUEST' ? 'Khách đang gọi nhân viên' : 'Có order mới',
              {
                body: notificationBody(alert),
                tag: id,
                requireInteraction: true,
              },
            );
            notification.onclick = () => {
              window.focus();

              if (alert.billId) {
                void navigate(`/admin/bills/${alert.billId}`);
              }

              setPanelOpen(true);
              notification.close();
            };
          } catch {
            // The in-page alert surface and repeating audio remain active.
          }
        }
      }
    }

    knownAlertIdsRef.current = currentIds;
  }, [
    alertsQuery.data,
    enabledForRoute,
    runtimeActive,
    navigate,
    notificationPermission,
    unacknowledgedAlerts,
  ]);

  useEffect(() => {
    const originalTitle = originalTitleRef.current;

    if (!enabledForRoute || unacknowledgedCount === 0) {
      document.title = originalTitle;
      return;
    }

    let highlighted = true;
    const updateTitle = (): void => {
      document.title = highlighted ? `🔔 ${unacknowledgedCount} yêu cầu mới` : originalTitle;
      highlighted = !highlighted;
    };

    updateTitle();
    const timer = window.setInterval(updateTitle, 1_000);

    return () => {
      window.clearInterval(timer);
      document.title = originalTitle;
    };
  }, [enabledForRoute, unacknowledgedCount]);

  useEffect(() => {
    const originalTitle = originalTitleRef.current;

    return () => {
      audioStateListenerCleanupRef.current?.();
      audioStateListenerCleanupRef.current = null;

      const engine = audioEngineRef.current;
      audioEngineRef.current = null;

      if (engine && engine.context.state !== 'closed') {
        void engine.context.close();
      }

      document.title = originalTitle;
    };
  }, []);

  const mutationError =
    confirmOrderMutation.error ??
    acknowledgeServiceRequestMutation.error ??
    resolveServiceRequestMutation.error;

  const contextValue = useMemo<AdminAlertRuntimeValue>(
    () => ({ realtimeStatus }),
    [realtimeStatus],
  );

  return (
    <AdminAlertRuntimeContext.Provider value={contextValue}>
      {children}

      {enabledForRoute && sessionQuery.isSuccess ? (
        <div className="admin-alert-launcher">
          {audioStatus === 'ready' ? (
            <span
              className="admin-alert-audio-status is-ready"
              title="Order C và chuông Dual ring đã sẵn sàng"
            >
              <i />
              Âm thanh sẵn sàng
            </span>
          ) : (
            <button
              type="button"
              className={`admin-alert-audio-status is-${audioStatus}`}
              onClick={() => {
                void activateAudio();
              }}
            >
              <i />
              {audioStatusLabel(audioStatus)}
            </button>
          )}

          {audioError ? (
            <p className="admin-alert-enable-error" role="alert">
              {audioError}
            </p>
          ) : null}

          <button
            type="button"
            className={`admin-alert-bell${unacknowledgedCount > 0 ? ' has-alerts' : ''}`}
            aria-label={`Mở cảnh báo vận hành, ${alerts.length} cảnh báo đang hoạt động, ${unacknowledgedCount} chưa xác nhận`}
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen(true)}
          >
            <AlertBellIcon />
            {alerts.length > 0 ? <span>{alerts.length > 99 ? '99+' : alerts.length}</span> : null}
          </button>
        </div>
      ) : null}

      {enabledForRoute && sessionQuery.isSuccess && panelOpen ? (
        <div className="admin-alert-modal-backdrop">
          <section
            ref={alertDialogRef}
            className={`admin-alert-modal${
              primaryAlert?.kind === 'SERVICE_REQUEST'
                ? ' is-service-priority'
                : ' is-order-priority'
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-alert-modal-title"
            tabIndex={-1}
          >
            <header className="admin-alert-modal-header">
              <div className="admin-alert-modal-icon">
                {primaryAlert?.kind === 'ORDER' ? <AlertReceiptIcon /> : <AlertBellIcon />}
              </div>

              <div className="admin-alert-modal-title">
                <span>
                  {primaryAlert?.kind === 'SERVICE_REQUEST'
                    ? 'Yêu cầu ưu tiên cao'
                    : primaryAlert?.kind === 'ORDER'
                      ? 'Order cần xử lý'
                      : 'Trung tâm cảnh báo'}
                </span>
                <h2 id="admin-alert-modal-title">
                  {primaryAlert ? alertHeading(primaryAlert) : 'Cảnh báo vận hành'}
                </h2>
                <p>
                  {realtimeStatus === 'connected'
                    ? 'Realtime đang kết nối'
                    : 'Đang dùng polling dự phòng mỗi 15 giây'}
                  {' · '}
                  {audioStatus === 'ready'
                    ? ownsAudio
                      ? 'Tab này đang phát chuông'
                      : 'Âm thanh sẵn sàng · tab khác có thể đang giữ chuông'
                    : audioStatusLabel(audioStatus)}
                </p>
              </div>

              <button
                type="button"
                className="admin-alert-modal-close"
                aria-label="Đóng trung tâm cảnh báo"
                onClick={() => setPanelOpen(false)}
              >
                <AlertCloseIcon />
              </button>
            </header>

            <div className="admin-alert-modal-body">
              <div className="admin-alert-modal-summary">
                <div>
                  <span>Chưa xác nhận</span>
                  <strong>{unacknowledgedCount}</strong>
                </div>
                <div>
                  <span>Tổng cảnh báo</span>
                  <strong>{alerts.length}</strong>
                </div>
                <div>
                  <span>Ưu tiên hiện tại</span>
                  <strong>
                    {highestPriorityKind === 'SERVICE_REQUEST'
                      ? 'Gọi nhân viên'
                      : highestPriorityKind === 'ORDER'
                        ? 'Order mới'
                        : 'Không có'}
                  </strong>
                </div>
              </div>

              <div className={`admin-alert-audio-controls is-${audioStatus}`}>
                <div>
                  <strong>Âm thanh cảnh báo</strong>
                  <span>{audioStatusDescription(audioStatus)}</span>
                </div>

                <div>
                  {audioStatus === 'ready' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          void testAudio();
                        }}
                      >
                        Thử chuông
                      </button>
                      <button
                        type="button"
                        className="is-secondary"
                        onClick={() => {
                          void muteAudio();
                        }}
                      >
                        Tắt âm thanh
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        void activateAudio();
                      }}
                    >
                      Bật âm thanh
                    </button>
                  )}

                  {notificationPermission === 'default' ? (
                    <button
                      type="button"
                      className="is-secondary"
                      onClick={() => {
                        void requestNotificationPermission();
                      }}
                    >
                      Bật thông báo hệ điều hành
                    </button>
                  ) : null}
                </div>
              </div>

              {notificationPermission === 'denied' ? (
                <p className="admin-alert-permission-warning">
                  Trình duyệt đang chặn thông báo hệ điều hành. Modal và chuông trong trang vẫn hoạt
                  động.
                </p>
              ) : null}

              {mutationError instanceof Error ? (
                <p className="admin-alert-mutation-error" role="alert">
                  {mutationError.message}
                </p>
              ) : null}

              <div className="admin-alert-list" aria-live="polite">
                {alertsQuery.isPending ? (
                  <p className="admin-alert-list-state">Đang tải cảnh báo…</p>
                ) : alertsQuery.isError ? (
                  <button
                    type="button"
                    className="admin-alert-list-retry"
                    onClick={() => void alertsQuery.refetch()}
                  >
                    Không tải được cảnh báo — thử lại
                  </button>
                ) : prioritizedAlerts.length === 0 ? (
                  <p className="admin-alert-list-empty">Không có yêu cầu nào đang chờ.</p>
                ) : (
                  prioritizedAlerts.map((alert, index) => {
                    const acknowledged = alert.acknowledgedAt !== null;
                    const id = alertId(alert);

                    return (
                      <article
                        key={id}
                        className={`admin-alert-card is-${alert.kind.toLowerCase()}${
                          index === 0 ? ' is-primary' : ''
                        }${acknowledged ? ' is-acknowledged' : ''}`}
                      >
                        <div className="admin-alert-card-head">
                          <div>
                            <span>
                              {alert.kind === 'SERVICE_REQUEST' ? 'Gọi nhân viên' : 'Order mới'}
                            </span>
                            <h3>{alert.servicePoint.name}</h3>
                          </div>
                          <strong>
                            {alert.kind === 'ORDER'
                              ? acknowledged
                                ? 'Đã xem · chưa xác nhận'
                                : 'Chưa xác nhận'
                              : acknowledged
                                ? 'Đã xem'
                                : 'Chưa xem'}
                          </strong>
                        </div>

                        <p className="admin-alert-card-time">
                          Gửi lúc {timeFormatter.format(new Date(alert.createdAt))}
                        </p>

                        {alert.kind === 'SERVICE_REQUEST' ? (
                          <p className="admin-alert-card-message">
                            {alert.message ?? `${alert.servicePoint.name} đang gọi nhân viên.`}
                          </p>
                        ) : (
                          <p className="admin-alert-card-order-summary">
                            {alert.totalQuantity} món · {moneyFormatter.format(alert.totalVnd)}
                            {alert.note ? ` · ${alert.note}` : ''}
                          </p>
                        )}

                        <div className="admin-alert-card-actions">
                          {alert.kind === 'ORDER' ? (
                            <button
                              type="button"
                              disabled={
                                confirmOrderMutation.isPending &&
                                confirmOrderMutation.variables?.orderId === alert.orderId
                              }
                              onClick={() =>
                                confirmOrderMutation.mutate({
                                  orderId: alert.orderId,
                                })
                              }
                            >
                              {confirmOrderMutation.isPending &&
                              confirmOrderMutation.variables?.orderId === alert.orderId
                                ? 'Đang xác nhận…'
                                : 'Xác nhận đơn'}
                            </button>
                          ) : !acknowledged ? (
                            <button
                              type="button"
                              disabled={
                                acknowledgeServiceRequestMutation.isPending &&
                                acknowledgeServiceRequestMutation.variables ===
                                  alert.serviceRequestId
                              }
                              onClick={() =>
                                acknowledgeServiceRequestMutation.mutate(alert.serviceRequestId)
                              }
                            >
                              {acknowledgeServiceRequestMutation.isPending &&
                              acknowledgeServiceRequestMutation.variables === alert.serviceRequestId
                                ? 'Đang ghi nhận…'
                                : 'Đã xem'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="is-danger"
                              disabled={
                                resolveServiceRequestMutation.isPending &&
                                resolveServiceRequestMutation.variables === alert.serviceRequestId
                              }
                              onClick={() =>
                                resolveServiceRequestMutation.mutate(alert.serviceRequestId)
                              }
                            >
                              {resolveServiceRequestMutation.isPending &&
                              resolveServiceRequestMutation.variables === alert.serviceRequestId
                                ? 'Đang xác nhận…'
                                : 'Đã đến hỗ trợ'}
                            </button>
                          )}

                          {alert.billId ? (
                            <Link
                              to={`/admin/bills/${alert.billId}`}
                              onClick={() => setPanelOpen(false)}
                            >
                              Mở bill
                            </Link>
                          ) : null}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              <p className="admin-alert-modal-note">
                Đóng modal không xác nhận cảnh báo. Chuông chỉ dừng khi alert được xử lý theo đúng
                workflow.
              </p>
            </div>
          </section>
        </div>
      ) : null}
    </AdminAlertRuntimeContext.Provider>
  );
}

// The provider and its hook intentionally share one module until the final UI refactor.
// eslint-disable-next-line react-refresh/only-export-components
export function useAdminAlertRuntime(): AdminAlertRuntimeValue {
  const value = useContext(AdminAlertRuntimeContext);

  if (!value) {
    throw new Error('useAdminAlertRuntime must be used inside AdminAlertProvider.');
  }

  return value;
}
