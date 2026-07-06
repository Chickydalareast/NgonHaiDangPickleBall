import type { PublicCatalogItem } from '@nhdp/contracts';
import type { KeyboardEvent, MouseEvent } from 'react';

import { MinusIcon, PlusIcon } from './customer-order-icons';

const priceFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

interface CustomerProductCardProps {
  imageUrl: string | null;
  item: PublicCatalogItem;
  quantity: number;
  onAdd: () => void;
  onDecrease: () => void;
}

export function CustomerProductCard({
  imageUrl,
  item,
  quantity,
  onAdd,
  onDecrease,
}: CustomerProductCardProps) {
  const selected = quantity > 0;

  const addFromCard = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }

    onAdd();
  };

  const addFromKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
      return;
    }

    event.preventDefault();
    onAdd();
  };

  return (
    <article
      className={`customer-product-card${selected ? ' is-selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Thêm ${item.name}, giá ${priceFormatter.format(item.priceVnd)}`}
      onClick={addFromCard}
      onKeyDown={addFromKeyboard}
    >
      <div className="customer-product-image-wrap">
        {imageUrl ? (
          <img
            className="customer-product-image"
            src={imageUrl}
            alt={item.image?.alt ?? item.name}
            loading="lazy"
          />
        ) : (
          <span className="customer-product-image-fallback" aria-hidden="true">
            {item.name.slice(0, 1).toUpperCase()}
          </span>
        )}

        <span
          className={`customer-product-quantity-badge${selected ? ' is-visible' : ''}`}
          aria-label={selected ? `Đã chọn ${quantity}` : undefined}
        >
          {quantity}
        </span>
      </div>

      <div className="customer-product-body">
        <h3>{item.name}</h3>
        <div className="customer-product-footer">
          <span className="customer-product-price">{priceFormatter.format(item.priceVnd)}</span>

          {selected ? (
            <div className="customer-product-stepper" aria-label={`Số lượng ${item.name}`}>
              <button
                type="button"
                aria-label={`Giảm ${item.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onDecrease();
                }}
              >
                <MinusIcon />
              </button>
              <span aria-live="polite">{quantity}</span>
              <button
                type="button"
                aria-label={`Tăng ${item.name}`}
                disabled={quantity >= 50}
                onClick={(event) => {
                  event.stopPropagation();
                  onAdd();
                }}
              >
                <PlusIcon />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="customer-product-add"
              aria-label={`Thêm ${item.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onAdd();
              }}
            >
              <PlusIcon />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
