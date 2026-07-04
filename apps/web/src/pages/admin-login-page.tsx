import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router';

import { AdminApiError, getAdminSession, loginAdmin } from '../lib/admin-api';

interface LoginFormValues {
  username: string;
  password: string;
}

export function AdminLoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ['admin', 'session'],
    queryFn: getAdminSession,
    retry: false,
    staleTime: 60_000,
  });
  const form = useForm<LoginFormValues>({
    defaultValues: {
      username: '',
      password: '',
    },
  });
  const loginMutation = useMutation({
    mutationFn: loginAdmin,
    onSuccess(session) {
      queryClient.setQueryData(['admin', 'session'], session);
      void navigate('/admin', { replace: true });
    },
  });

  if (sessionQuery.isSuccess) {
    return <Navigate to="/admin" replace />;
  }

  const errorMessage =
    loginMutation.error instanceof AdminApiError
      ? loginMutation.error.message
      : loginMutation.isError
        ? 'Không thể đăng nhập. Vui lòng thử lại.'
        : null;

  return (
    <main className="grid min-h-screen place-items-center bg-surface px-5 py-10 text-ink">
      <section className="w-full max-w-md rounded-3xl border border-line bg-white p-6 shadow-panel sm:p-8">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-brand">
          Ngon Hải Đăng Pickleball
        </p>
        <h1 className="mt-3 text-3xl font-black">Đăng nhập quản trị</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Dùng tài khoản nội bộ để theo dõi sân, order đang chờ và bill tạm tính.
        </p>

        <form
          className="mt-8 space-y-5"
          onSubmit={form.handleSubmit((values) => {
            loginMutation.mutate({
              username: values.username.trim().toLowerCase(),
              password: values.password,
            });
          })}
        >
          <label className="block">
            <span className="text-sm font-bold">Tên tài khoản</span>
            <input
              autoComplete="username"
              className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
              {...form.register('username', {
                required: 'Nhập tên tài khoản.',
                minLength: {
                  value: 3,
                  message: 'Tên tài khoản phải có ít nhất 3 ký tự.',
                },
                maxLength: {
                  value: 50,
                  message: 'Tên tài khoản tối đa 50 ký tự.',
                },
                pattern: {
                  value: /^[a-zA-Z0-9._-]+$/,
                  message: 'Tên tài khoản chỉ dùng chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.',
                },
              })}
            />
            {form.formState.errors.username ? (
              <span className="mt-2 block text-sm font-semibold text-danger">
                {form.formState.errors.username.message}
              </span>
            ) : null}
          </label>

          <label className="block">
            <span className="text-sm font-bold">Mật khẩu</span>
            <input
              autoComplete="current-password"
              type="password"
              className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
              {...form.register('password', {
                required: 'Nhập mật khẩu.',
                maxLength: {
                  value: 200,
                  message: 'Mật khẩu không hợp lệ.',
                },
              })}
            />
            {form.formState.errors.password ? (
              <span className="mt-2 block text-sm font-semibold text-danger">
                {form.formState.errors.password.message}
              </span>
            ) : null}
          </label>

          {errorMessage ? (
            <div className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
              {errorMessage}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full rounded-xl bg-brand px-5 py-3.5 font-black text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loginMutation.isPending ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>
      </section>
    </main>
  );
}
