import { ShoppingCart } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { htTtcLabel, htTtcOrDash } from '@/lib/money';

import { useCartRead } from '../hooks/useCart';
import { cartBarVisible } from '../lib/cart-bar';

/**
 * CART-V1 — the desktop docked bar (≥ lg only; CartEdgeTab covers below). IN-FLOW BY DESIGN:
 * this component renders a plain flex column as the layout row's LAST child, so the content
 * area yields width automatically — occlusion is impossible by construction. NOTHING in this
 * file may use `fixed`/overlay positioning (pinned: the cf-hf4 pin file asserts the absence).
 * Empty cart → null (the ruled empty behaviour lives in cartBarVisible's doc).
 */
export default function CartDockBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const cart = useCartRead();

  const count = cart.data?.count ?? 0;
  const totalHt = cart.data?.total_ht ?? 0;
  const items = cart.data?.items ?? [];
  const onCartPage = location.pathname === '/my-cart';

  if (!cartBarVisible(count)) return null;

  return (
    <aside
      aria-label="Mon panier"
      className="hidden lg:flex h-full w-44 flex-shrink-0 flex-col border-l border-gray-200 bg-white"
    >
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-3">
        <ShoppingCart className="h-4 w-4 flex-shrink-0 text-brand-deep" />
        <p className="text-sm font-bold text-gray-900">Panier ({count})</p>
      </div>
      <ul className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border border-gray-100 bg-gray-50/60 px-2 py-2">
            <p className="truncate text-xs font-medium text-gray-800" title={item.name}>
              {item.name}
            </p>
            {/* CF-U4 — every montant rides the house formatter. */}
            <p className="mt-0.5 text-xs text-gray-500">{htTtcOrDash(item.requested_budget)}</p>
          </li>
        ))}
      </ul>
      <div className="border-t border-gray-100 px-3 py-3">
        <p className="mb-2 text-xs text-gray-600">
          Total{' '}
          <span className="block truncate font-bold text-gray-900" title={htTtcLabel(totalHt)}>
            {htTtcLabel(totalHt)}
          </span>
        </p>
        {!onCartPage && (
          <button
            type="button"
            onClick={() => navigate('/my-cart')}
            className="w-full rounded-xl bg-brand-primary px-2 py-2 text-xs font-semibold text-brand-deep transition-colors hover:bg-brand-primary/90"
          >
            Voir mon panier
          </button>
        )}
      </div>
    </aside>
  );
}
