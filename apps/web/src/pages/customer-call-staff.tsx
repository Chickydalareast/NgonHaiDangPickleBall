import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

import { BellIcon, CloseIcon } from '../features/customer-order/customer-order-icons';
import { useCustomerModal } from '../features/customer-order/use-customer-modal';
import {
  createPublicServiceRequest,
  getPendingServiceRequest,
} from '../lib/public-service-request-api';

interface CustomerCallStaffProps {
  slug: string;
  servicePointName: string;
  onSubmitted?: () => void;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function CustomerCallStaff({ slug, servicePointName, onSubmitted }: CustomerCallStaffProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
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
    mutationFn: async () => {
      const trimmedMessage = message.trim();

      if (trimmedMessage.length > 0 && trimmedMessage.length < 3) {
        throw new Error('Lời nhắn cần ít nhất 3 ký tự hoặc để trống.');
      }

      return createPublicServiceRequest(slug, {
        ...(trimmedMessage.length > 0 ? { message: trimmedMessage } : {}),
      });
    },
    onSuccess(response) {
      queryClient.setQueryData(queryKey, { request: response.request });
      setMessage('');
      setValidationError(null);
      setOpen(false);
      onSubmitted?.();
    },
  });
  const closeDialog = useCallback(() => {
    if (createMutation.isPending) {
      return;
    }

    setOpen(false);
    setValidationError(null);
  }, [createMutation.isPending]);
  const dialogRef = useCustomerModal<HTMLElement>(open, closeDialog);
  const pending = pendingQuery.data?.request ?? null;
  const errorMessage =
    validationError ??
    (createMutation.isError
      ? createMutation.error instanceof Error
        ? createMutation.error.message
        : 'Không thể gửi yêu cầu gọi nhân viên.'
      : pendingQuery.isError
        ? pendingQuery.error instanceof Error
          ? pendingQuery.error.message
          : 'Không thể kiểm tra yêu cầu đang chờ.'
        : null);

  const openDialog = () => {
    createMutation.reset();
    setValidationError(null);
    setOpen(true);
  };

  const submitRequest = () => {
    const trimmedMessage = message.trim();

    if (trimmedMessage.length > 0 && trimmedMessage.length < 3) {
      setValidationError('Lời nhắn cần ít nhất 3 ký tự hoặc để trống.');
      return;
    }

    setValidationError(null);
    createMutation.mutate();
  };

  const dialog = open
    ? createPortal(
        <div
          className="customer-modal-backdrop is-visible"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDialog();
            }
          }}
        >
          <section
            ref={dialogRef}
            className="customer-staff-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-staff-dialog-title"
            tabIndex={-1}
          >
            <div className="customer-modal-header">
              <div className="customer-modal-title-group">
                <span className="customer-modal-icon">
                  <BellIcon />
                </span>
                <div>
                  <h2 id="customer-staff-dialog-title">Gọi nhân viên</h2>
                  <p>Hỗ trợ tại {servicePointName}</p>
                </div>
              </div>
              <button
                type="button"
                className="customer-icon-button"
                aria-label="Đóng cửa sổ gọi nhân viên"
                disabled={createMutation.isPending}
                onClick={closeDialog}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="customer-staff-dialog-body">
              {pending ? (
                <div className="customer-pending-request">
                  <strong>Yêu cầu đang chờ nhân viên xử lý</strong>
                  <p>Đã gửi lúc {formatTime(pending.createdAt)}. Vui lòng chờ nhân viên đến sân.</p>
                  {pending.message ? <blockquote>{pending.message}</blockquote> : null}
                </div>
              ) : pendingQuery.isPending ? (
                <div className="customer-dialog-loading">Đang kiểm tra yêu cầu tại sân…</div>
              ) : (
                <>
                  <p className="customer-modal-notice">
                    Xác nhận gửi yêu cầu để nhân viên đến hỗ trợ tại {servicePointName}.
                  </p>

                  <label className="customer-field-label" htmlFor="customer-staff-message">
                    Lời nhắn <span>(không bắt buộc)</span>
                  </label>
                  <textarea
                    id="customer-staff-message"
                    value={message}
                    maxLength={200}
                    rows={4}
                    disabled={createMutation.isPending}
                    placeholder="Ví dụ: cần thêm dụng cụ hoặc kiểm tra hóa đơn..."
                    onChange={(event) => {
                      setMessage(event.target.value);
                      setValidationError(null);
                    }}
                  />
                  <p className="customer-field-counter">{message.length}/200</p>
                </>
              )}

              {errorMessage ? (
                <div className="customer-inline-error" role="alert">
                  {errorMessage}
                </div>
              ) : null}
            </div>

            <div className="customer-modal-actions">
              <button
                type="button"
                className="customer-secondary-button"
                disabled={createMutation.isPending}
                onClick={closeDialog}
              >
                {pending ? 'Đóng' : 'Hủy'}
              </button>
              {!pending && !pendingQuery.isPending ? (
                <button
                  type="button"
                  className="customer-primary-button"
                  disabled={createMutation.isPending}
                  onClick={submitRequest}
                >
                  {createMutation.isPending ? 'Đang gửi…' : 'Xác nhận gọi'}
                </button>
              ) : null}
            </div>
          </section>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        type="button"
        className={`customer-hero-staff-button${pending ? ' has-pending' : ''}`}
        aria-label={pending ? 'Xem yêu cầu gọi nhân viên đang chờ' : 'Gọi nhân viên'}
        onClick={openDialog}
      >
        <BellIcon />
        <span>{pending ? 'Đã gọi nhân viên' : 'Gọi nhân viên'}</span>
      </button>

      {dialog}
    </>
  );
}
