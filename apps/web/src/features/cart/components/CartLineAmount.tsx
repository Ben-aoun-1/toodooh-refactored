import { cartLineFigures } from '@/features/cart/lib/cart-quote';
import type { CartItemView } from '@/features/cart/services/cart.api';
import { tndLabel, tndOrDash } from '@/lib/money';

const fr = new Intl.NumberFormat('fr-FR');

/**
 * DISP-TOURS — the amount of a classic cart line: the exact price recomputed at this opening
 * (lib/cart-quote.ts), the qualified impressions it buys, and the targeted budget when they differ.
 */
export function CartLineAmount({ item }: { item: CartItemView }) {
  const figures = cartLineFigures(item);
  return (
    <div className="text-right">
      <p className="text-base font-bold text-gray-900 tabular-nums">
        {tndOrDash(figures.amountTnd)}
      </p>
      {figures.impressions !== null && (
        <p className="text-xs text-gray-500 tabular-nums">
          {fr.format(Math.round(figures.impressions))} impressions
        </p>
      )}
      {figures.budgetViseTnd !== null && (
        <p className="text-xs text-gray-400 tabular-nums">
          Budget visé : {tndLabel(figures.budgetViseTnd)}
        </p>
      )}
    </div>
  );
}
