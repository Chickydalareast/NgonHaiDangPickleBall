import type { CartLine } from '../../cart/cart-context';
import { CloseIcon, MinusIcon, PlusIcon } from './customer-order-icons';
import { useCustomerModal } from './use-customer-modal';

const priceFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

interface CustomerCheckoutSheetProps {
  open: boolean;
  lines: CartLine[];
  itemCount: number;
  provisionalTotalVnd: number;
  note: string;
  imageByItemId: ReadonlyMap<string, string | null>;
  isSubmitting: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onDecrease: (line: CartLine) => void;
  onIncrease: (line: CartLine) => void;
  onNoteChange: (value: string) => void;
  onSubmit: () => void;
}

export function CustomerCheckoutSheet({
  open,
  lines,
  itemCount,
  provisionalTotalVnd,
  note,
  imageByItemId,
  isSubmitting,
  errorMessage,
  onClose,
  onDecrease,
  onIncrease,
  onNoteChange,
  onSubmit,
}: CustomerCheckoutSheetProps) {
  const dialogRef = useCustomerModal<HTMLElement>(open, onClose);

  if (!open || lines.length === 0) {
    return null;
  }

  return (
    <div
      className="customer-dialog-backdrop is-visible"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="customer-checkout-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-checkout-title"
        tabIndex={-1}
      >
        <div className="customer-sheet-handle" aria-hidden="true" />
        <div className="customer-sheet-header">
          <div>
            <p>{itemCount} món đã chọn</p>
            <h2 id="customer-checkout-title">Thanh toán</h2>
          </div>
          <button
            type="button"
            className="customer-icon-button"
            aria-label="Đóng Thanh toán"
            disabled={isSubmitting}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="customer-checkout-lines">
          {lines.map((line) => {
            const imageUrl = imageByItemId.get(line.catalogItemId) ?? null;

            return (
              <article key={line.catalogItemId} className="customer-checkout-line">
                <div className="customer-checkout-line-image">
                  {imageUrl ? (
                    <img src={imageUrl} alt="" aria-hidden="true" />
                  ) : (
                    <span aria-hidden="true">{line.name.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>

                <div className="customer-checkout-line-copy">
                  <h3>{line.name}</h3>
                  <p>{priceFormatter.format(line.priceVnd)}</p>
                </div>

                <div className="customer-checkout-stepper" aria-label={`Số lượng ${line.name}`}>
                  <button
                    type="button"
                    aria-label={`Giảm ${line.name}`}
                    disabled={isSubmitting}
                    onClick={() => onDecrease(line)}
                  >
                    <MinusIcon />
                  </button>
                  <span>{line.quantity}</span>
                  <button
                    type="button"
                    aria-label={`Tăng ${line.name}`}
                    disabled={isSubmitting || line.quantity >= 50}
                    onClick={() => onIncrease(line)}
                  >
                    <PlusIcon />
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <label className="customer-field-label" htmlFor="customer-order-note">
          Ghi chú cho yêu cầu <span>(không bắt buộc)</span>
        </label>
        <textarea
          id="customer-order-note"
          value={note}
          maxLength={500}
          rows={3}
          disabled={isSubmitting}
          placeholder="Ví dụ: ít đá, không cay, giao ở cuối sân..."
          onChange={(event) => onNoteChange(event.target.value)}
        />
        <p className="customer-field-counter">{note.length}/500</p>

        {errorMessage ? (
          <div className="customer-inline-error" role="alert">
            {errorMessage}
          </div>
        ) : null}

        <div className="customer-checkout-total">
          <div>
            <span>Tổng tạm tính</span>
            <strong>{priceFormatter.format(provisionalTotalVnd)}</strong>
          </div>
          <span>{itemCount} món</span>
        </div>

        <button
          type="button"
          className="customer-submit-order"
          disabled={isSubmitting || lines.length === 0}
          onClick={onSubmit}
        >
          {isSubmitting ? 'Đang gửi yêu cầu…' : 'Gửi yêu cầu đặt món'}
        </button>
        <p className="customer-checkout-disclaimer">
          Giá trị chính thức sẽ được hệ thống xác nhận sau khi gửi yêu cầu.
        </p>
      </section>
    </div>
  );
}
