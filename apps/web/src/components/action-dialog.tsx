import { useEffect, type ReactNode } from 'react';

interface ActionDialogProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  confirmDisabled?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function ActionDialog({
  open,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = 'Đóng',
  busy = false,
  danger = false,
  confirmDisabled = false,
  error = null,
  onClose,
  onConfirm,
}: ActionDialogProps) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [busy, onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-0 sm:place-items-center sm:p-5">
      <button
        type="button"
        aria-label="Đóng hộp thoại"
        className="absolute inset-0 cursor-default"
        disabled={busy}
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-dialog-title"
        className="relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-white p-5 shadow-panel sm:max-w-lg sm:rounded-3xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="action-dialog-title" className="text-2xl font-black text-ink">
              {title}
            </h2>
            {description ? (
              <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-full border border-line text-lg font-black text-muted transition hover:border-brand hover:text-brand disabled:opacity-50"
            aria-label="Đóng"
          >
            ×
          </button>
        </div>

        <div className="mt-5">{children}</div>

        {error ? (
          <p className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border border-line px-4 py-3 font-black text-ink transition hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
            className={`rounded-xl px-4 py-3 font-black text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
              danger ? 'bg-danger' : 'bg-brand hover:bg-brand-dark'
            }`}
          >
            {busy ? 'Đang xử lý…' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
