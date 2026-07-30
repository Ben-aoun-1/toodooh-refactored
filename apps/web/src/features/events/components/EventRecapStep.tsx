import { ArrowRight, Banknote, Loader2, MapPin, ShoppingCart, Tags } from 'lucide-react';
import { useEffect, useState } from 'react';

import PillButton from '@/components/PillButton';
import {
  CART_BUDGET_MIN_TND,
  CART_BUDGET_STEP_TND,
} from '@/features/campaigns/hooks/new-campaign/cart-budget';
import { useCampaignCmax } from '@/features/campaigns/hooks/useCampaignCmax';
import { usePricingConfig } from '@/features/campaigns/hooks/usePricingConfig';
import {
  CMAX_PULLBACK_NOTICE,
  clampBudgetToCmax,
  isInventoryInsufficient,
} from '@/features/campaigns/lib/cmax-budget';
import { estimateImpressions } from '@/features/campaigns/lib/impressions';
import StepSectionHeading from '@/features/campaigns/pages/new-campaign/StepSectionHeading';
import { approvedSpotNotice } from '@/features/cart/lib/confirm-outcome';
import { htTtcLabel, ttcParenthetical } from '@/lib/money';

import { formatEventDate, formatEventHours } from '../lib/event-display';
import type { EventItemView } from '../services/events.api';

const tnd = new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 });

interface EventRecapStepProps {
  campaignId: string;
  event: EventItemView | null;
  zoneNames: string[];
  requestedBudget: number | null;
  setRequestedBudget: (value: number | null) => void;
  /** The linked spot's validation status — 'approved' earns the SK1 immediate-launch line. */
  spotValidationStatus: string | null;
  onAddToCart: () => void | Promise<void>;
  adding: boolean;
  onBack: () => void;
}

/**
 * EV3 — the parcours' Récapitulatif: the diffusion-window line, the zone count, the
 * categories-are-automatic reminder, and the budget slider bounded [100, live C_max_evt]
 * (GET /:id/cmax forks to the EVENT engine server-side — same wire, event ceiling). Montants
 * HT (TTC) via lib/money; « Ajouter au panier » files the positioning under Événements.
 */
export default function EventRecapStep({
  campaignId,
  event,
  zoneNames,
  requestedBudget,
  setRequestedBudget,
  spotValidationStatus,
  onAddToCart,
  adding,
  onBack,
}: EventRecapStepProps) {
  const cmax = useCampaignCmax(campaignId);
  const pricing = usePricingConfig();
  const [pullbackNotice, setPullbackNotice] = useState(false);

  const value = requestedBudget;
  const cMaxTnd = cmax.data?.c_max_tnd;
  const zeroInventory = cMaxTnd !== undefined && isInventoryInsufficient(cMaxTnd);
  const canAct = !adding && value != null && value >= CART_BUDGET_MIN_TND && !zeroInventory;

  // Pull-back (the E5 idiom): a budget above a freshly-fetched ceiling clamps down VISIBLY.
  useEffect(() => {
    if (cMaxTnd === undefined) return;
    const { next, clamped } = clampBudgetToCmax(value, cMaxTnd);
    if (clamped) {
      setRequestedBudget(next);
      setPullbackNotice(true);
    }
  }, [cMaxTnd, value, setRequestedBudget]);

  // The event estimate prices at CPM_evt (the event engine's CPM — never the standard one).
  const impressions =
    value == null ? null : estimateImpressions(value, pricing.data?.event_cpm_tnd ?? null);

  const approvedNotice = approvedSpotNotice(spotValidationStatus ?? undefined);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
        <StepSectionHeading
          icon={Banknote}
          title="Récapitulatif"
          subtitle="Vérifiez votre positionnement et fixez votre budget"
        />

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* LEFT — the positioning recap */}
          <section className="min-w-0 space-y-4 rounded-2xl border border-gray-200 p-5 sm:p-6">
            {event && (
              <div>
                <p className="text-sm font-medium text-gray-500">Fenêtre de diffusion</p>
                <p className="mt-1 font-medium text-gray-900">
                  {formatEventDate(event.kickoff_at)} ·{' '}
                  {formatEventHours(event.fenetre.window_start, event.fenetre.window_end)}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  1 h avant le match, pendant, 1 h après — la fenêtre suit le coup d’envoi.
                </p>
              </div>
            )}

            <hr className="border-gray-100" />

            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
                <MapPin className="h-4 w-4" /> Zones
              </p>
              <p className="mt-1 font-medium text-gray-900">
                {zoneNames.length === 0
                  ? 'Tout le réseau'
                  : `${zoneNames.length} zone${zoneNames.length > 1 ? 's' : ''} — ${zoneNames.join(', ')}`}
              </p>
            </div>

            <hr className="border-gray-100" />

            <div className="flex gap-2 rounded-xl bg-slate-50/80 p-3">
              <Tags className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <p className="text-sm text-gray-600">
                Les catégories d’établissements sont sélectionnées automatiquement pour un événement
                : tous les lieux éligibles diffusent pendant la fenêtre.
              </p>
            </div>

            {approvedNotice && (
              <p className="rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-sm text-green-700">
                {approvedNotice}
              </p>
            )}
          </section>

          {/* RIGHT — the bounded budget cursor (the StepCart idiom on the EVENT ceiling) */}
          <section className="min-w-0 rounded-2xl border border-gray-200 p-5 sm:p-6">
            <h3 className="text-lg font-bold text-gray-900">Ajuster votre impact</h3>
            <p className="mt-1 text-sm text-gray-600">
              Déplacez le curseur pour ajuster votre budget et vos impressions estimées
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-brand-primary/10 p-4">
                <p className="text-sm text-gray-600">Montant estimé</p>
                <p className="mt-0.5 text-lg font-bold text-brand-deep">
                  {value == null ? '—' : htTtcLabel(value)}
                </p>
              </div>
              <div className="rounded-2xl bg-brand-accent/10 p-4">
                <p className="text-sm text-gray-600">Impressions potentielles</p>
                <p className="mt-0.5 text-lg font-bold text-brand-accent">
                  {impressions == null ? '—' : int.format(impressions)}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-200 p-5">
              <div className="mb-4 text-center">
                <span className="text-3xl font-bold text-gray-900">
                  {value == null ? '—' : tnd.format(value)}
                </span>
                <span className="ml-1 text-base font-medium text-gray-400">
                  {value == null ? '' : 'TND HT'}
                </span>
                {value != null && (
                  <p className="mt-1 text-sm font-medium text-gray-500">
                    {ttcParenthetical(value)}
                  </p>
                )}
                {value == null && (
                  <p className="mt-1 text-sm text-gray-500">
                    Déplacez le curseur pour renseigner votre budget.
                  </p>
                )}
              </div>

              <input
                id="event-budget"
                type="range"
                min={CART_BUDGET_MIN_TND}
                max={cMaxTnd ?? CART_BUDGET_MIN_TND}
                step={CART_BUDGET_STEP_TND}
                value={value ?? CART_BUDGET_MIN_TND}
                onChange={(e) => {
                  setPullbackNotice(false);
                  setRequestedBudget(Number(e.target.value));
                }}
                disabled={cMaxTnd === undefined || zeroInventory}
                aria-label="Budget du positionnement (TND)"
                aria-valuetext={
                  value == null ? 'Aucun budget renseigné' : `${tnd.format(value)} TND`
                }
                className="w-full cursor-pointer accent-brand-primary disabled:cursor-not-allowed disabled:opacity-40"
              />
              <div className="mt-1 flex justify-between text-xs font-medium text-gray-400">
                <span>MIN: {tnd.format(CART_BUDGET_MIN_TND)} TND</span>
                <span>MAX: {cMaxTnd === undefined ? '…' : `${tnd.format(cMaxTnd)} TND`}</span>
              </div>

              {cmax.isLoading && (
                <p className="mt-2 inline-flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Calcul du budget maximum disponible…
                </p>
              )}
              {cmax.isError && (
                <p className="mt-2 text-xs text-red-600">
                  Impossible de calculer le budget maximum — revenez sur cette étape pour réessayer.
                </p>
              )}
              {pullbackNotice && (
                <p className="mt-2 text-xs font-medium text-amber-700">{CMAX_PULLBACK_NOTICE}</p>
              )}
              {zeroInventory && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Aucun inventaire disponible sur la fenêtre de cet événement pour le moment.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 rounded-xl border border-gray-300 px-5 py-3 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
        >
          <ArrowRight className="h-4 w-4 rotate-180" />
          Retour
        </button>
        <PillButton
          onClick={() => void onAddToCart()}
          disabled={!canAct}
          trailingIcon={
            adding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShoppingCart className="h-4 w-4" />
            )
          }
        >
          Ajouter au panier
        </PillButton>
      </div>
    </div>
  );
}
