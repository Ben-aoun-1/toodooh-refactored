import { ShoppingCart, X } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { CART_WIDGET_Z_CLASS } from '@/features/cart/lib/cart-confirm';
import { htTtcLabel } from '@/lib/money';

import { useCartRead } from '../hooks/useCart';

/**
 * CF-C1 — the floating panier widget: mounted ONCE in AdvertiserLayout (every advertiser
 * route), visible only when the cart holds items, hidden on the cart page itself (the page IS
 * the widget there). Sits at z-40 — BELOW modals/drawers (z-50) and the bell (z-[90]), the
 * map-layering convention. Shares the cart cache entry with the page (cartKeys.read).
 */
export default function CartWidget() {
  const navigate = useNavigate();
  const location = useLocation();
  const cart = useCartRead();
  const [open, setOpen] = useState(false);

  const count = cart.data?.count ?? 0;
  if (count === 0 || location.pathname === '/my-cart') return null;

  const totalHt = cart.data?.total_ht ?? 0;
  const preview = (cart.data?.items ?? []).slice(0, 3);

  return (
    <div className={`fixed bottom-6 right-6 ${CART_WIDGET_Z_CLASS}`}>
      {open && (
        <div className="mb-3 w-80 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-bold text-gray-900">
              Mon panier ({count} campagne{count > 1 ? 's' : ''})
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
          <ul className="mb-3 space-y-1.5">
            {preview.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-gray-700">{item.name}</span>
                <span className="flex-shrink-0 font-medium text-gray-900">
                  {item.requested_budget == null ? '—' : `${item.requested_budget} TND`}
                </span>
              </li>
            ))}
            {count > 3 && (
              <li className="text-xs text-gray-400">
                + {count - 3} autre{count - 3 > 1 ? 's' : ''}…
              </li>
            )}
          </ul>
          <p className="mb-3 text-sm text-gray-600">
            Total : <span className="font-bold text-gray-900">{htTtcLabel(totalHt)}</span>
          </p>
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
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Mon panier"
        className="relative ml-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-deep text-white shadow-lg transition-transform hover:scale-105"
      >
        <ShoppingCart className="h-6 w-6" />
        <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-brand-deep">
          {count}
        </span>
      </button>
    </div>
  );
}
