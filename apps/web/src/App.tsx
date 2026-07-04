import { Navigate, Route, Routes } from 'react-router';

import { CartProvider } from './cart/cart-context';
import { CustomerCartPage } from './pages/customer-cart-page';
import { CustomerMenuPage } from './pages/customer-menu-page';
import { OrderSuccessPage } from './pages/order-success-page';

function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-surface px-6 text-ink">
      <section className="text-center">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-brand">404</p>
        <h1 className="mt-2 text-3xl font-black">Trang không tồn tại</h1>
        <a
          href="/s/san-01"
          className="mt-6 inline-flex rounded-xl bg-brand px-5 py-3 font-bold text-white"
        >
          Mở menu Sân 01
        </a>
      </section>
    </main>
  );
}

export function App() {
  return (
    <CartProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/s/san-01" replace />} />
        <Route path="/s/:slug" element={<CustomerMenuPage />} />
        <Route path="/s/:slug/cart" element={<CustomerCartPage />} />
        <Route path="/s/:slug/order-success" element={<OrderSuccessPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </CartProvider>
  );
}
