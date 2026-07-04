import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  createPublicServiceRequest,
  getPendingServiceRequest,
} from '../lib/public-service-request-api';

interface CustomerCallStaffProps {
  slug: string;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function CustomerCallStaff({ slug }: CustomerCallStaffProps) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const queryKey = ['public-service-request', slug] as const;
  const pendingQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => getPendingServiceRequest(slug, signal),
    enabled: slug.length > 0,
    retry: 1,
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
  const createMutation = useMutation({
    mutationFn: () =>
      createPublicServiceRequest(slug, {
        ...(message.trim().length > 0 ? { message: message.trim() } : {}),
      }),
    onSuccess(response) {
      queryClient.setQueryData(queryKey, { request: response.request });
      setMessage('');
    },
  });
  const pending = pendingQuery.data?.request ?? null;

  if (pending) {
    return (
      <section className="mt-4 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-4">
        <p className="font-black text-warning">Đã gọi nhân viên</p>
        <p className="mt-1 text-sm leading-6 text-muted">
          Yêu cầu được gửi lúc {formatTime(pending.createdAt)}. Vui lòng chờ nhân viên đến sân.
        </p>
        {pending.message ? (
          <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-sm font-semibold text-ink">
            {pending.message}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-2xl border border-line bg-white px-4 py-4">
      <div className="flex items-start gap-3">
        <div
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-warning-soft text-lg"
          aria-hidden="true"
        >
          🔔
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-black">Cần nhân viên hỗ trợ?</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Mỗi sân chỉ có một yêu cầu đang chờ để tránh gửi trùng.
          </p>
        </div>
      </div>

      <label className="mt-3 block text-sm font-bold" htmlFor="staff-request-message">
        Ghi chú tùy chọn
      </label>
      <input
        id="staff-request-message"
        value={message}
        maxLength={200}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Ví dụ: cần thêm khăn hoặc hỗ trợ tại sân"
        className="mt-2 w-full rounded-xl border border-line px-3 py-3 text-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
      />

      {pendingQuery.isError || createMutation.isError ? (
        <p className="mt-3 text-sm font-semibold text-danger">
          {createMutation.error instanceof Error
            ? createMutation.error.message
            : pendingQuery.error instanceof Error
              ? pendingQuery.error.message
              : 'Không thể gửi yêu cầu hỗ trợ.'}
        </p>
      ) : null}

      <button
        type="button"
        disabled={createMutation.isPending || pendingQuery.isPending}
        onClick={() => createMutation.mutate()}
        className="mt-3 w-full rounded-xl bg-warning px-4 py-3 font-black text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {createMutation.isPending ? 'Đang gửi…' : 'Gọi nhân viên'}
      </button>
    </section>
  );
}
