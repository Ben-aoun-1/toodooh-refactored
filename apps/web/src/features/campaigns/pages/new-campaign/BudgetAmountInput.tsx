import { useEffect, useState } from 'react';

import { budgetInputText, parseBudgetInput } from '@/features/campaigns/lib/budget-input';

/**
 * 20/11 (operator) — under the cursor, ONE box where the screencaster types exactly what they want
 * to spend (it replaced the two read-only « Min » / « Max » boxes). Typing moves the cursor; the
 * cursor rewrites the box while it is not being edited.
 */
export default function BudgetAmountInput({
  value,
  maxTnd,
  disabled,
  onChange,
}: {
  value: number | null;
  maxTnd: number | undefined;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(budgetInputText(value));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setText(budgetInputText(value));
      setError(null);
    }
  }, [value, editing]);

  return (
    <div className="mt-4">
      <label htmlFor="cart-budget-amount" className="mb-1 block text-xs font-medium text-gray-500">
        Montant à dépenser (TND)
      </label>
      <input
        id="cart-budget-amount"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="Saisissez votre montant"
        value={text}
        disabled={disabled}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseBudgetInput(e.target.value, maxTnd);
          if (parsed.ok) {
            setError(null);
            onChange(parsed.value);
          } else {
            setError(parsed.error);
          }
        }}
        aria-invalid={error !== null}
        aria-describedby="cart-budget-amount-help"
        className={`w-full rounded-xl border px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-primary disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${
          error ? 'border-red-300' : 'border-gray-200'
        }`}
      />
      <p
        id="cart-budget-amount-help"
        className={`mt-1 text-xs ${error ? 'text-red-600' : 'text-gray-400'}`}
      >
        {error ??
          (maxTnd === undefined
            ? 'Calcul du maximum disponible…'
            : `Jusqu’à ${maxTnd.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} TND sur ces lieux et ces dates.`)}
      </p>
    </div>
  );
}
