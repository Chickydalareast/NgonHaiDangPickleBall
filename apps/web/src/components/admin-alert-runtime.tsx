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
import { type AdminRealtimeStatus, useAdminRealtime } from '../lib/admin-realtime';

const AUDIO_OWNER_KEY = 'nhdp-admin-alert-audio-owner';
const AUDIO_OWNER_TTL_MS = 6_000;
const AUDIO_OWNER_RENEW_MS = 2_000;
const EMPTY_ALERTS: AdminAlert[] = [];

interface AudioOwnerLease {
  tabId: string;
  expiresAt: number;
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

function playTone(
  context: AudioContext,
  frequency: number,
  startAt: number,
  durationSeconds: number,
  gainValue: number,
  type: OscillatorType,
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSeconds);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + durationSeconds + 0.03);
}

function playRingBurst(
  context: AudioContext,
  startAt: number,
  durationSeconds: number,
  gainValue: number,
): void {
  playTone(context, 760, startAt, durationSeconds, gainValue, 'triangle');
  playTone(context, 1_140, startAt, durationSeconds, gainValue * 0.52, 'square');
}

function alertEscalationLevel(createdAt: string): 0 | 1 | 2 {
  const waitingMs = Math.max(0, Date.now() - Date.parse(createdAt));

  if (waitingMs >= 30_000) {
    return 2;
  }

  return waitingMs >= 15_000 ? 1 : 0;
}

const serviceRequestRepeatDelays = [3_000, 2_500, 2_100] as const;
const orderRepeatDelays = [4_200, 3_500, 2_900] as const;
const serviceRequestGains = [0.25, 0.29, 0.33] as const;
const orderPrimaryGains = [0.22, 0.25, 0.28] as const;
const orderAccentGains = [0.13, 0.15, 0.17] as const;

function alertRepeatDelay(kind: AdminAlert['kind'], level: 0 | 1 | 2): number {
  return kind === 'SERVICE_REQUEST' ? serviceRequestRepeatDelays[level] : orderRepeatDelays[level];
}

function playAlertPattern(
  context: AudioContext,
  kind: AdminAlert['kind'],
  level: 0 | 1 | 2 = 0,
): void {
  const now = context.currentTime + 0.02;

  if (kind === 'SERVICE_REQUEST') {
    const gain = serviceRequestGains[level];
    playRingBurst(context, now, 0.28, gain);
    playRingBurst(context, now + 0.36, 0.28, gain);
    playRingBurst(context, now + 0.94, 0.28, gain);
    playRingBurst(context, now + 1.3, 0.34, gain);

    if (level === 2) {
      playTone(context, 520, now + 1.72, 0.32, 0.24, 'sawtooth');
    }

    return;
  }

  const primaryGain = orderPrimaryGains[level];
  const accentGain = orderAccentGains[level];
  playTone(context, 740, now, 0.17, primaryGain, 'triangle');
  playTone(context, 980, now + 0.23, 0.17, accentGain, 'square');
  playTone(context, 740, now + 0.48, 0.2, primaryGain, 'triangle');

  if (level >= 1) {
    playTone(context, 980, now + 0.75, 0.2, accentGain, 'square');
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
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [isAudioOwner, setIsAudioOwner] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof Notification === 'undefined' ? 'denied' : Notification.permission,
  );
  const audioContextRef = useRef<AudioContext | null>(null);
  const tabIdRef = useRef(createTabId());
  const originalTitleRef = useRef(document.title);
  const previousUnacknowledgedCountRef = useRef(0);
  const knownAlertIdsRef = useRef<Set<string> | null>(null);

  const alerts = alertsQuery.data?.alerts ?? EMPTY_ALERTS;
  const unacknowledgedAlerts = useMemo(
    () => alerts.filter((alert) => alert.acknowledgedAt === null),
    [alerts],
  );
  const unacknowledgedCount = unacknowledgedAlerts.length;
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
  const audioActive = runtimeActive && alertsEnabled;
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

  const enableAlerts = useCallback(async () => {
    setEnableError(null);

    try {
      const AudioContextConstructor = window.AudioContext;
      const context = audioContextRef.current ?? new AudioContextConstructor();
      audioContextRef.current = context;
      await context.resume();
      playAlertPattern(context, 'ORDER');
      setAlertsEnabled(true);

      if (typeof Notification !== 'undefined') {
        const permission =
          Notification.permission === 'default'
            ? await Notification.requestPermission()
            : Notification.permission;
        setNotificationPermission(permission);
      }
    } catch (error) {
      setAlertsEnabled(false);
      setEnableError(
        error instanceof Error
          ? error.message
          : 'Không thể bật âm thanh cảnh báo trên trình duyệt này.',
      );
    }
  }, []);

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
    if (!audioActive) {
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
  }, [audioActive]);

  useEffect(() => {
    if (!audioActive || !isAudioOwner || !highestPriorityKind || !oldestPriorityAlertCreatedAt) {
      return;
    }

    const context = audioContextRef.current;

    if (!context) {
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

      if (ownsCurrentLease && context.state === 'running') {
        playAlertPattern(context, highestPriorityKind, level);
      }

      timer = window.setTimeout(ring, alertRepeatDelay(highestPriorityKind, level));
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
      audioActive &&
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
    audioActive,
    enabledForRoute,
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
      void audioContextRef.current?.close();
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
        <div className="fixed bottom-5 right-5 z-[80] flex max-w-[calc(100vw-2.5rem)] flex-col items-end gap-3">
          {!alertsEnabled ? (
            <button
              type="button"
              onClick={() => {
                void enableAlerts();
              }}
              className="rounded-xl bg-warning px-4 py-3 text-sm font-black text-white shadow-panel"
            >
              Bật âm thanh cảnh báo
            </button>
          ) : null}

          {enableError ? (
            <p
              role="alert"
              className="max-w-sm rounded-xl bg-danger-soft px-4 py-3 text-sm font-bold text-danger shadow-panel"
            >
              Không bật được âm thanh: {enableError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => setPanelOpen((current) => !current)}
            className={`rounded-full px-5 py-3 text-sm font-black text-white shadow-panel ${
              unacknowledgedCount > 0 ? 'bg-danger' : 'bg-brand'
            }`}
            aria-expanded={panelOpen}
          >
            Cảnh báo ({unacknowledgedCount})
          </button>
        </div>
      ) : null}

      {enabledForRoute && sessionQuery.isSuccess && panelOpen ? (
        <aside
          role="dialog"
          aria-label="Cảnh báo vận hành"
          className="fixed bottom-24 right-5 top-5 z-[70] flex w-[430px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-panel"
        >
          <header className="flex items-start justify-between gap-4 border-b border-line p-4">
            <div>
              <h2 className="text-xl font-black">Cảnh báo vận hành</h2>
              <p className="mt-1 text-xs font-semibold text-muted">
                {realtimeStatus === 'connected'
                  ? 'Realtime đang kết nối'
                  : 'Đang dùng polling dự phòng'}
                {' · '}
                {alertsEnabled
                  ? ownsAudio
                    ? 'Tab này đang phát chuông'
                    : 'Tab admin khác đang phát chuông'
                  : 'Âm thanh chưa bật'}
              </p>
              {notificationPermission === 'denied' ? (
                <p className="mt-1 text-xs font-bold text-warning">
                  Trình duyệt đang chặn thông báo hệ điều hành.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="rounded-lg border border-line px-3 py-2 text-sm font-black"
            >
              Đóng
            </button>
          </header>

          {mutationError instanceof Error ? (
            <p className="m-4 rounded-xl bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {mutationError.message}
            </p>
          ) : null}

          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {alertsQuery.isPending ? (
              <p className="rounded-xl bg-neutral-soft px-4 py-3 text-sm font-bold text-muted">
                Đang tải cảnh báo…
              </p>
            ) : alertsQuery.isError ? (
              <button
                type="button"
                onClick={() => void alertsQuery.refetch()}
                className="w-full rounded-xl bg-danger-soft px-4 py-3 text-sm font-black text-danger"
              >
                Không tải được cảnh báo — thử lại
              </button>
            ) : alerts.length === 0 ? (
              <p className="rounded-xl bg-success-soft px-4 py-3 text-sm font-bold text-success">
                Không có yêu cầu nào đang chờ.
              </p>
            ) : (
              alerts.map((alert) => {
                const acknowledged = alert.acknowledgedAt !== null;
                const id = alertId(alert);

                return (
                  <article
                    key={id}
                    className={`rounded-xl border p-4 ${
                      alert.kind === 'SERVICE_REQUEST'
                        ? 'border-danger/30 bg-danger-soft'
                        : 'border-warning/30 bg-warning-soft'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-wide text-muted">
                          {alert.kind === 'SERVICE_REQUEST' ? 'Gọi nhân viên' : 'Order mới'}
                        </p>
                        <h3 className="mt-1 text-lg font-black">{alert.servicePoint.name}</h3>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-black">
                        {alert.kind === 'ORDER'
                          ? acknowledged
                            ? 'Đã xem · chưa xác nhận'
                            : 'Chưa xác nhận'
                          : acknowledged
                            ? 'Đã xem'
                            : 'Chưa xem'}
                      </span>
                    </div>

                    <p className="mt-2 text-xs font-semibold text-muted">
                      Gửi lúc {timeFormatter.format(new Date(alert.createdAt))}
                    </p>

                    {alert.kind === 'SERVICE_REQUEST' ? (
                      alert.message ? (
                        <p className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-sm font-semibold">
                          {alert.message}
                        </p>
                      ) : null
                    ) : (
                      <p className="mt-3 text-sm font-bold">
                        {alert.totalQuantity} món · {moneyFormatter.format(alert.totalVnd)}
                        {alert.note ? ` · ${alert.note}` : ''}
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
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
                          className="rounded-lg bg-ink px-3 py-2 text-sm font-black text-white disabled:opacity-50"
                        >
                          Xác nhận đơn
                        </button>
                      ) : !acknowledged ? (
                        <button
                          type="button"
                          disabled={
                            acknowledgeServiceRequestMutation.isPending &&
                            acknowledgeServiceRequestMutation.variables === alert.serviceRequestId
                          }
                          onClick={() =>
                            acknowledgeServiceRequestMutation.mutate(alert.serviceRequestId)
                          }
                          className="rounded-lg bg-ink px-3 py-2 text-sm font-black text-white disabled:opacity-50"
                        >
                          Đã xem
                        </button>
                      ) : null}

                      {alert.billId ? (
                        <Link
                          to={`/admin/bills/${alert.billId}`}
                          onClick={() => setPanelOpen(false)}
                          className="rounded-lg border border-ink px-3 py-2 text-sm font-black text-ink"
                        >
                          Mở bill
                        </Link>
                      ) : null}

                      {alert.kind === 'SERVICE_REQUEST' && acknowledged ? (
                        <button
                          type="button"
                          disabled={
                            resolveServiceRequestMutation.isPending &&
                            resolveServiceRequestMutation.variables === alert.serviceRequestId
                          }
                          onClick={() =>
                            resolveServiceRequestMutation.mutate(alert.serviceRequestId)
                          }
                          className="rounded-lg bg-danger px-3 py-2 text-sm font-black text-white disabled:opacity-50"
                        >
                          Đã đến hỗ trợ
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </aside>
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
