import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export interface CartLine {
  catalogItemId: string;
  name: string;
  unitName: string;
  priceVnd: number;
  quantity: number;
}

interface CourtCart {
  lines: CartLine[];
  note: string;
  submissionKey: string | null;
}

interface CartStore {
  carts: Record<string, CourtCart>;
}

interface AddCartItemInput {
  catalogItemId: string;
  name: string;
  unitName: string;
  priceVnd: number;
}

interface CartContextValue {
  addItem(slug: string, item: AddCartItemInput): void;
  clear(slug: string): void;
  ensureSubmissionKey(slug: string): string;
  getCart(slug: string): CourtCart;
  removeItem(slug: string, catalogItemId: string): void;
  setNote(slug: string, note: string): void;
  setQuantity(slug: string, catalogItemId: string, quantity: number): void;
}

const storageKey = 'nhdp:cart:v1';
const emptyCart: CourtCart = {
  lines: [],
  note: '',
  submissionKey: null,
};

function isCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const line = value as Record<string, unknown>;

  return (
    typeof line.catalogItemId === 'string' &&
    typeof line.name === 'string' &&
    typeof line.unitName === 'string' &&
    typeof line.priceVnd === 'number' &&
    Number.isInteger(line.priceVnd) &&
    line.priceVnd >= 0 &&
    typeof line.quantity === 'number' &&
    Number.isInteger(line.quantity) &&
    line.quantity > 0 &&
    line.quantity <= 50
  );
}

function readInitialStore(): CartStore {
  try {
    const raw = window.localStorage.getItem(storageKey);

    if (!raw) {
      return { carts: {} };
    }

    const parsed: unknown = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object') {
      return { carts: {} };
    }

    const cartsValue = (parsed as Record<string, unknown>).carts;

    if (!cartsValue || typeof cartsValue !== 'object') {
      return { carts: {} };
    }

    const carts: Record<string, CourtCart> = {};

    for (const [slug, value] of Object.entries(cartsValue as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') {
        continue;
      }

      const cart = value as Record<string, unknown>;
      const lines = Array.isArray(cart.lines) ? cart.lines.filter(isCartLine) : [];

      carts[slug] = {
        lines,
        note: typeof cart.note === 'string' ? cart.note.slice(0, 500) : '',
        submissionKey: typeof cart.submissionKey === 'string' ? cart.submissionKey : null,
      };
    }

    return { carts };
  } catch {
    return { carts: {} };
  }
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<CartStore>(readInitialStore);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(store));
  }, [store]);

  const updateCart = useCallback((slug: string, updater: (cart: CourtCart) => CourtCart) => {
    setStore((current) => ({
      carts: {
        ...current.carts,
        [slug]: updater(current.carts[slug] ?? emptyCart),
      },
    }));
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      addItem(slug, item) {
        updateCart(slug, (cart) => {
          const existing = cart.lines.find((line) => line.catalogItemId === item.catalogItemId);
          const lines = existing
            ? cart.lines.map((line) =>
                line.catalogItemId === item.catalogItemId
                  ? {
                      ...line,
                      quantity: Math.min(50, line.quantity + 1),
                    }
                  : line,
              )
            : [...cart.lines, { ...item, quantity: 1 }];

          return { ...cart, lines, submissionKey: null };
        });
      },
      clear(slug) {
        updateCart(slug, () => emptyCart);
      },
      ensureSubmissionKey(slug) {
        const existing = store.carts[slug]?.submissionKey;

        if (existing) {
          return existing;
        }

        const key = crypto.randomUUID();
        updateCart(slug, (cart) => ({ ...cart, submissionKey: key }));
        return key;
      },
      getCart(slug) {
        return store.carts[slug] ?? emptyCart;
      },
      removeItem(slug, catalogItemId) {
        updateCart(slug, (cart) => ({
          ...cart,
          lines: cart.lines.filter((line) => line.catalogItemId !== catalogItemId),
          submissionKey: null,
        }));
      },
      setNote(slug, note) {
        updateCart(slug, (cart) => ({
          ...cart,
          note: note.slice(0, 500),
          submissionKey: null,
        }));
      },
      setQuantity(slug, catalogItemId, quantity) {
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
          return;
        }

        updateCart(slug, (cart) => ({
          ...cart,
          lines: cart.lines.map((line) =>
            line.catalogItemId === catalogItemId ? { ...line, quantity } : line,
          ),
          submissionKey: null,
        }));
      },
    }),
    [store.carts, updateCart],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// Provider v? hook ???c gi? chung trong module cart nh? c?a V1.
// eslint-disable-next-line react-refresh/only-export-components
export function useCart(slug: string) {
  const context = useContext(CartContext);

  if (!context) {
    throw new Error('useCart must be used inside CartProvider.');
  }

  const cart = context.getCart(slug);
  const itemCount = cart.lines.reduce((total, line) => total + line.quantity, 0);
  const provisionalTotalVnd = cart.lines.reduce(
    (total, line) => total + line.priceVnd * line.quantity,
    0,
  );

  return {
    ...context,
    cart,
    itemCount,
    provisionalTotalVnd,
  };
}
