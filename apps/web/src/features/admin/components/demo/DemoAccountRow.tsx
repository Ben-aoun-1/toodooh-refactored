import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { useCreditDemoAccount, useDeleteDemoAccount } from '@/features/admin/hooks/useAdminDemo';
import { type OnAirTone, onAirStatus, parseAmountTnd } from '@/features/admin/lib/demo';
import type { DemoAccount } from '@/features/admin/services/admin-demo.service';
import { getErrorMessage } from '@/lib/errors';
import { tndLabel } from '@/lib/money';

const TONE_CLASS: Record<OnAirTone, string> = {
  waiting: 'bg-amber-50 text-amber-700',
  live: 'bg-emerald-50 text-emerald-700',
  done: 'bg-gray-100 text-gray-600',
  stopped: 'bg-red-50 text-red-700',
};

/** One demo account: balance, campaigns with their on-air line, top-up and delete. */
export function DemoAccountRow({ account, now }: { account: DemoAccount; now: Date }) {
  const [amount, setAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  const credit = useCreditDemoAccount();
  const remove = useDeleteDemoAccount();

  const topUp = async () => {
    const parsed = parseAmountTnd(amount);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    try {
      await credit.mutateAsync({ id: account.id, amountTnd: parsed.value });
      toast.success('Solde crédité');
      setAmount('');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Crédit impossible');
    }
  };

  const destroy = async () => {
    try {
      const res = await remove.mutateAsync(account.id);
      toast.success(
        res.campaigns_stopped > 0
          ? `Compte supprimé — ${res.campaigns_stopped} campagne(s) arrêtée(s)`
          : 'Compte supprimé',
      );
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Suppression impossible');
      setConfirming(false);
    }
  };

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{account.business_name ?? account.contact_name}</p>
          <p className="text-sm text-gray-500">{account.email}</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold">{tndLabel(account.spendable_tnd)}</p>
          <p className="text-gray-500">disponible sur {tndLabel(account.balance_tnd)}</p>
        </div>
      </div>

      {account.campaigns.length > 0 && (
        <ul className="space-y-1 text-sm">
          {account.campaigns.map((c) => {
            const status = onAirStatus(c, now);
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${TONE_CLASS[status.tone]}`}>
                  {status.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          placeholder="Montant TND"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-36 rounded-lg border px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={() => void topUp()}
          disabled={credit.isPending}
          className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-60"
        >
          {credit.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Créditer
        </button>
        <div className="ml-auto flex items-center gap-2">
          {confirming ? (
            <>
              <span className="text-sm text-red-700">Arrêter ses campagnes et supprimer ?</span>
              <button
                type="button"
                onClick={() => void destroy()}
                disabled={remove.isPending}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
              >
                Confirmer
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-lg border px-3 py-1.5 text-sm"
              >
                Annuler
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              Supprimer
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
