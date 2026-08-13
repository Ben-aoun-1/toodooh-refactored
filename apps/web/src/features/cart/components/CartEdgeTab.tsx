import { ShoppingCart, X } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { CART_WIDGET_Z_CLASS } from '@/features/cart/lib/cart-confirm';
import { htTtcLabel, htTtcOrDash } from '@/lib/money';

import { useCartRead } from '../hooks/useCart';
import { cartBarVisible } from '../lib/cart-bar';

/**
 * CART-V1 — the below-lg fallback (< CART_BAR_BREAKPOINT_PX = 1024px): a slim FIXED tab on the
 * right edge that expands ON TAP into a dismissible panel — mobile cannot afford the permanent
 * column, and a user-invoked overlay is not the occlusion class the desktop rule forbids.
 * Empty cart → null, same ruled behaviour as the docked bar.
 */
export default function CartEdgeTab() {
  const navigate = useNavigate();
  const location = useLocation();
  const cart = useCartRead();
  const [open, setOpen] = useState(false);

  const count = cart.data?.count ?? 0;
  const totalHt = cart.data?.total_ht ?? 0;
  const items = cart.data?.items ?? [];
  const onCartPage = location.pathname === '/my-cart';

  if (!cartBarVisible(count)) return null;

  if (!open) {
    return (
      <div className={`lg:hidden fixed right-0 top-1/2 -translate-y-1/2 ${CART_WIDGET_Z_CLASS}`}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Mon panier (${count})`}
          className="flex flex-col items-center gap-1 rounded-l-xl bg-brand-deep px-2 py-3 text-white shadow-lg"
        >
          <ShoppingCart className="h-5 w-5" />
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-primary text-[11px] font-bold text-brand-deep">
            {count}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={`lg:hidden fixed inset-y-0 right-0 flex ${CART_WIDGET_Z_CLASS}`}>
      <div className="flex h-full w-72 flex-col border-l border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-bold text-gray-900">
            <ShoppingCart className="h-4 w-4 text-brand-deep" />
            Mon panier ({count})
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
            aria-label="Fermer le panier"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-gray-700">{item.name}</span>
              <span className="flex-shrink-0 font-medium text-gray-900">
                {htTtcOrDash(item.requested_budget)}
              </span>
            </li>
          ))}
        </ul>
        <div className="border-t border-gray-100 px-4 py-3">
          <p className="mb-3 text-sm text-gray-600">
            Total : <span className="font-bold text-gray-900">{htTtcLabel(totalHt)}</span>
          </p>
          {!onCartPage && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/my-cart');
              }}
              className="w-full rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-deep transition-colors hover:bg-brand-primary/90"
            >
              Voir mon panier
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
