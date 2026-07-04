import { useEffect, useState } from 'react';

interface ApiHealth {
  status: 'ok';
  service: '@nhdp/api';
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

type HealthState =
  | { status: 'loading' }
  | { status: 'online'; data: ApiHealth }
  | { status: 'offline'; message: string };

const infrastructureItems = [
  {
    name: 'Caddy',
    detail: 'Static web + reverse proxy /api',
  },
  {
    name: 'Fastify',
    detail: 'REST API với graceful shutdown',
  },
  {
    name: 'PostgreSQL 18',
    detail: 'Named volume giữ dữ liệu qua restart',
  },
] as const;

export function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    async function loadHealth(): Promise<void> {
      try {
        const response = await fetch('/api/health', {
          headers: {
            Accept: 'application/json',
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`API returned HTTP ${response.status}`);
        }

        const data = (await response.json()) as ApiHealth;

        setHealth({
          status: 'online',
          data,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setHealth({
          status: 'offline',
          message: error instanceof Error ? error.message : 'Không thể kết nối API.',
        });
      }
    }

    void loadHealth();

    return () => {
      controller.abort();
    };
  }, []);

  const apiOnline = health.status === 'online';

  return (
    <main className="min-h-screen bg-surface text-ink">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-6 py-14 lg:px-10">
        <div className="mb-10 flex items-center gap-3">
          <div
            className="grid size-11 place-items-center rounded-xl bg-brand text-lg font-black text-white"
            aria-hidden="true"
          >
            NH
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide text-muted">NGON HẢI ĐĂNG</p>
            <p className="font-bold">Pickleball</p>
          </div>
        </div>

        <div className="grid items-end gap-10 lg:grid-cols-[1.35fr_0.65fr]">
          <div>
            <p className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-brand">
              Step 1 · Local infrastructure
            </p>
            <h1 className="max-w-3xl text-4xl font-black leading-tight tracking-[-0.04em] sm:text-6xl">
              Nền tảng local đã sẵn sàng để xây đúng nghiệp vụ.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-muted sm:text-lg">
              Đây mới là web shell kỹ thuật. Order, bill, auth, catalog và realtime chưa được triển
              khai ở Step 1.
            </p>
          </div>

          <div
            className="rounded-2xl border border-line bg-white p-5 shadow-panel"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-4">
              <span className="font-bold">API health</span>
              <span
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold ${
                  apiOnline
                    ? 'bg-success-soft text-success'
                    : health.status === 'loading'
                      ? 'bg-neutral-soft text-muted'
                      : 'bg-danger-soft text-danger'
                }`}
              >
                <span
                  className={`size-2 rounded-full ${
                    apiOnline
                      ? 'bg-success'
                      : health.status === 'loading'
                        ? 'bg-muted'
                        : 'bg-danger'
                  }`}
                />
                {apiOnline ? 'Online' : health.status === 'loading' ? 'Checking' : 'Offline'}
              </span>
            </div>

            <div className="mt-4 border-t border-line pt-4 text-sm leading-6 text-muted">
              {health.status === 'online' && (
                <>
                  <p>Service: {health.data.service}</p>
                  <p>Version: {health.data.version}</p>
                  <p>Uptime: {health.data.uptimeSeconds}s</p>
                </>
              )}

              {health.status === 'loading' && <p>Đang gọi /api/health…</p>}

              {health.status === 'offline' && <p>{health.message}</p>}
            </div>
          </div>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {infrastructureItems.map((item) => (
            <article key={item.name} className="rounded-2xl border border-line bg-white p-5">
              <p className="font-extrabold">{item.name}</p>
              <p className="mt-2 text-sm leading-6 text-muted">{item.detail}</p>
            </article>
          ))}
        </div>

        <p className="mt-10 text-sm text-muted">
          Local entrypoint:{' '}
          <code className="rounded bg-neutral-soft px-2 py-1 font-semibold text-ink">
            http://localhost:8080
          </code>
        </p>
      </section>
    </main>
  );
}
