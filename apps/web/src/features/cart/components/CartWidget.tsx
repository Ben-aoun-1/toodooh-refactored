import { ChevronDown, ShoppingCart } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { CART_WIDGET_Z_CLASS } from '@/features/cart/lib/cart-confirm';
import { htTtcLabel, htTtcOrDash } from '@/lib/money';
import { shouldAutoOpen } from '@/lib/popover-auto-open';

import { useCartRead } from '../hooks/useCart';

/**
 * CF-C1 → CF-HF4 — the PERMANENT panier sidebar: mounted ONCE in AdvertiserLayout and ALWAYS
 * rendered on every advertiser route (the cart page included — consistent away-pages behavior;
 * before CF-HF4 it vanished when empty and on /my-cart, which read as a broken cart during QA).
 * The campaign list is permanently visible — « Votre panier est vide » when empty — and the
 * header collapses the panel to a bubble without ever unmounting it. Sits at z-40 — BELOW
 * modals/drawers (z-50) and the bell (z-[90]). Shares the cart cache entry with the page.
 */
// GREEN2 item 9 — the panel auto-EXPANDS at most once per SPA session; it starts as the bubble
// (the CF-HF4 permanence stands: always MOUNTED, never unmounted — collapsed is a rendering
// state, and the bubble keeps the live count badge).
let autoExpandedThisSession = false;

export default function CartWidget() {
  const navigate = useNavigate();
  const location = useLocation();
  const cart = useCartRead();
  const [collapsed, setCollapsed] = useState(true);

  const count = cart.data?.count ?? 0;
  const totalHt = cart.data?.total_ht ?? 0;
  const preview = (cart.data?.items ?? []).slice(0, 3);
  const onCartPage = location.pathname === '/my-cart';

  useEffect(() => {
    // First non-empty cart of the session expands the panel once; manual after that.
    if (shouldAutoOpen(count > 0, autoExpandedThisSession)) {
      setCollapsed(false);
      autoExpandedThisSession = true;
    }
  }, [count]);

  if (collapsed) {
    return (
      <div className={`fixed bottom-6 right-6 ${CART_WIDGET_Z_CLASS}`}>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Mon panier"
          className="relative flex h-14 w-14 items-center justify-center rounded-full bg-brand-deep text-white shadow-lg transition-transform hover:scale-105"
        >
          <ShoppingCart className="h-6 w-6" />
          <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-brand-deep">
            {count}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={`fixed bottom-6 right-6 ${CART_WIDGET_Z_CLASS}`}>
      <div className="w-80 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-bold text-gray-900">
            <ShoppingCart className="h-4 w-4 text-brand-deep" />
            Mon panier ({count} campagne{count > 1 ? 's' : ''})
          </p>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
            aria-label="Réduire le panier"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
        {count === 0 ? (
          <p className="mb-3 text-sm text-gray-500">Votre panier est vide.</p>
        ) : (
          <>
            <ul className="mb-3 space-y-1.5">
              {preview.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-gray-700">{item.name}</span>
                  {/* CF-U4 — the mini-line montant rides the house formatter too. */}
                  <span className="flex-shrink-0 font-medium text-gray-900">
                    {htTtcOrDash(item.requested_budget)}
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
          </>
        )}
        {!onCartPage && (
          <button
            type="button"
            onClick={() => navigate('/my-cart')}
            className="w-full rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-deep transition-colors hover:bg-brand-primary/90"
          >
            Voir mon panier
          </button>
        )}
      </div>
    </div>
  );
}
