import { Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useCartStore } from '@/features/campaigns/stores/cart.store';

interface CartSidebarProps {
  open: boolean;
}

export default function CartSidebar({ open }: CartSidebarProps) {
  const navigate = useNavigate();
  const items = useCartStore((s) => s.items);
  const removeItem = useCartStore((s) => s.removeItem);
  const subtotal = items.reduce((sum, i) => sum + (i.amount || 0), 0);

  return (
    <aside
      className={`hidden lg:flex flex-col flex-shrink-0 bg-gray-50/80 border-l border-[#E1E4EA] transition-[width] duration-200 ease-in-out overflow-hidden ${
        open ? 'w-[136px]' : 'w-0 border-l-0'
      }`}
    >
      {open && (
        <>
          <div className="flex-none p-4 flex flex-col gap-2 border-b border-[#E1E4EA]">
            <p className="text-xs text-gray-500">Sous-total</p>
            <p className="text-base font-bold text-gray-900">
              {subtotal.toLocaleString('fr-FR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              TND
            </p>
            <button
              type="button"
              onClick={() => navigate('/my-cart')}
              className="w-full py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-medium"
            >
              Mon panier
            </button>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-3">
            {items.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-4">Panier vide</p>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-lg border border-gray-200 p-2 shadow-sm flex flex-col"
                >
                  <div className="flex items-start justify-between gap-1 mb-2">
                    <p className="text-[11px] font-semibold text-gray-900 break-words leading-tight flex-1 min-w-0">
                      {item.name || 'Nom de la campagne'}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 flex-shrink-0"
                      title="Retirer du panier"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="w-full h-24 rounded-md bg-gray-200 mb-2" />
                  {(item.periodLabel || item.zonesLabel) && (
                    <p
                      className="text-[10px] text-gray-500 mb-1.5 leading-tight line-clamp-1"
                      title={[item.periodLabel, item.zonesLabel].filter(Boolean).join(' · ')}
                    >
                      {[item.periodLabel, item.zonesLabel].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <p className="text-sm font-bold text-gray-900">
                    {item.amount.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    TND
                  </p>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </aside>
  );
}
