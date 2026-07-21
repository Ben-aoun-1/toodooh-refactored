import { ArrowRight, Loader2, Pencil, Rocket, ShoppingCart, Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { useDeleteCampaign } from '@/features/campaigns/hooks/useCampaignApi';
import { useMyCampaigns } from '@/features/campaigns/hooks/useMyCampaigns';
import { formatUiDate } from '@/features/campaigns/lib/campaign-summary';
import { zonesRecapLabel } from '@/features/campaigns/lib/zones-selection';
import RemoveCartItemDialog from '@/features/cart/components/RemoveCartItemDialog';
import { useCartMutations, useCartRead } from '@/features/cart/hooks/useCart';
import { cartReasonFr, parseCartConfirmFailure } from '@/features/cart/lib/cart-confirm';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { htTtcOrDash, formatTnd, ttcFromHt } from '@/lib/money';

const log = logger.child({ module: 'MyCart' });

/**
 * CF-C1 (spec §1.10–1.14) — the panier page: every finished campaign queued for launch, ONE
 * « Confirmer et lancer » against the solde. Display detail (chips/zones/dates) composes from
 * the /mine cache (one projection home); the cart read carries membership + totals. NO money
 * moves at confirm — the api flips drafts → pending only.
 */
export default function MyCart() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const cart = useCartRead();
  const { campaigns } = useMyCampaigns(user?.id);
  const { removeFromCart, confirmCart } = useCartMutations(user?.id);
  const deleteCampaign = useDeleteCampaign(user?.id);

  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [busyRemove, setBusyRemove] = useState(false);
  const [itemReasons, setItemReasons] = useState<Map<string, string>>(new Map());
  const [solde, setSolde] = useState<{ balance: number; required: number } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const items = cart.data?.items ?? [];
  const totalHt = cart.data?.total_ht ?? 0;
  const tva = Math.round((ttcFromHt(totalHt) - totalHt) * 100) / 100;
  const ttc = ttcFromHt(totalHt);

  // Compose: the /mine row carries the chips/zones the card idiom already renders.
  const rowFor = (id: string) => campaigns.find((c) => c.id === id);

  const handleKeepDraft = async () => {
    if (!removeTarget) return;
    setBusyRemove(true);
    try {
      await removeFromCart.mutateAsync(removeTarget.id);
      toast.success('Campagne conservée en brouillon.');
      setRemoveTarget(null);
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Erreur lors du retrait du panier');
      log.error({ error }, 'cart remove failed');
    } finally {
      setBusyRemove(false);
    }
  };

  const handleDeleteForever = async () => {
    if (!removeTarget) return;
    setBusyRemove(true);
    try {
      await removeFromCart.mutateAsync(removeTarget.id);
      await deleteCampaign.mutateAsync(removeTarget.id);
      toast.success('Campagne supprimée définitivement.');
      setRemoveTarget(null);
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Erreur lors de la suppression');
      log.error({ error }, 'cart delete-forever failed');
    } finally {
      setBusyRemove(false);
    }
  };

  const handleConfirm = async () => {
    setConfirming(true);
    setItemReasons(new Map());
    setSolde(null);
    try {
      const result = await confirmCart.mutateAsync();
      toast.success(
        `${result.confirmed.length} campagne${result.confirmed.length > 1 ? 's' : ''} lancée${result.confirmed.length > 1 ? 's' : ''} — en attente de validation.`,
        { duration: 6000 },
      );
      navigate('/my-campaigns?status=pending');
    } catch (error) {
      const failure = parseCartConfirmFailure(error);
      if (failure) {
        setItemReasons(failure.itemReasons);
        setSolde(failure.solde);
        toast.error(
          failure.solde
            ? 'Solde insuffisant pour lancer le panier.'
            : 'Certaines campagnes ne sont plus lançables — voir le détail.',
          { duration: 6000 },
        );
      } else {
        toast.error(getErrorMessage(error) || 'Erreur lors de la confirmation du panier');
        log.error({ error }, 'cart confirm failed');
      }
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 border border-gray-200">
        <PageHeader title="Mon panier" subtitle="Vérifiez et lancez vos campagnes prêtes" />
      </div>

      {cart.isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white py-16 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Chargement du panier…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center">
          <ShoppingCart className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="mb-1 text-lg font-semibold text-gray-900">Votre panier est vide</p>
          <p className="mb-6 text-sm text-gray-500">
            Finalisez une campagne dans l’éditeur puis ajoutez-la au panier pour la lancer.
          </p>
          <button
            type="button"
            onClick={() => navigate('/my-campaigns')}
            className="rounded-xl bg-brand-primary px-6 py-3 text-sm font-semibold text-brand-deep"
          >
            Voir mes campagnes
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* ── the lines ── */}
          <div className="space-y-4 lg:col-span-2">
            {items.map((item) => {
              const row = rowFor(item.id);
              const reason = itemReasons.get(item.id);
              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border bg-white p-5 ${reason ? 'border-red-300' : 'border-gray-200'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900">{item.name}</p>
                      <p className="mt-1 text-sm text-gray-500">
                        {formatUiDate(item.start_date)} – {formatUiDate(item.end_date)}
                        <span className="mx-2 text-gray-300">|</span>
                        Zones : {zonesRecapLabel((row?.zones ?? []).map((z) => z.name))}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(row?.selected_categories?.length
                          ? row.selected_categories
                          : ['Toutes catégories']
                        ).map((cat) => (
                          <span
                            key={cat}
                            className="inline-flex rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                          >
                            {cat}
                          </span>
                        ))}
                      </div>
                    </div>
                    <p className="text-base font-bold text-gray-900 tabular-nums">
                      {htTtcOrDash(item.requested_budget)}
                    </p>
                  </div>
                  {reason && (
                    <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                      {cartReasonFr(reason)}
                    </p>
                  )}
                  <div className="mt-4 flex gap-2 border-t border-gray-100 pt-4">
                    <button
                      type="button"
                      onClick={() =>
                        navigate('/new-campaign', {
                          state: { editMode: true, campaign: row ?? item },
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoveTarget({ id: item.id, name: item.name })}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Retirer
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Prêt à diffuser ── */}
          <div className="h-fit rounded-2xl border border-gray-200 bg-white p-6">
            <h3 className="mb-4 text-lg font-bold text-gray-900">Prêt à diffuser</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Coût réel (HT)</dt>
                <dd className="font-medium text-gray-900 tabular-nums">{formatTnd(totalHt)} TND</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">TVA (19 %)</dt>
                <dd className="font-medium text-gray-900 tabular-nums">{formatTnd(tva)} TND</dd>
              </div>
              <div className="flex justify-between border-t border-gray-100 pt-2">
                <dt className="font-semibold text-gray-900">Total TTC</dt>
                <dd className="font-bold text-brand-deep tabular-nums">{formatTnd(ttc)} TND</dd>
              </div>
            </dl>

            {/* Spec §1.13 — the shortfall, said plainly, with the recharge path one click away. */}
            {solde && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-semibold">Solde insuffisant</p>
                <p className="mt-1">
                  Solde : {formatTnd(solde.balance)} TND HT — requis : {formatTnd(solde.required)}{' '}
                  TND HT (manque {formatTnd(Math.max(0, solde.required - solde.balance))} TND).
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/my-recharges')}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-brand-deep"
                >
                  <Wallet className="h-4 w-4" />
                  Recharger mon compte
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={confirming || items.length === 0}
              onClick={() => void handleConfirm()}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-3 text-sm font-semibold text-brand-deep transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              {confirming ? 'Lancement…' : 'Confirmer et lancer'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/my-campaigns')}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50"
            >
              Continuer mes campagnes
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {removeTarget && (
        <RemoveCartItemDialog
          campaignName={removeTarget.name}
          busy={busyRemove}
          onCancel={() => setRemoveTarget(null)}
          onKeepDraft={() => void handleKeepDraft()}
          onDeleteForever={() => void handleDeleteForever()}
        />
      )}
    </div>
  );
}
