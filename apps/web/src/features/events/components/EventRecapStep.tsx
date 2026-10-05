import { ArrowRight, Banknote, Loader2, MapPin, ShoppingCart, Tags } from 'lucide-react';
import { useEffect, useState } from 'react';

import PillButton from '@/components/PillButton';
import ImpressionsEstimateText from '@/features/campaigns/components/ImpressionsEstimateText';
import { useCampaignCmax } from '@/features/campaigns/hooks/useCampaignCmax';
import { useImpressionsEstimate } from '@/features/campaigns/hooks/useImpressionsEstimate';
import StepSectionHeading from '@/features/campaigns/pages/new-campaign/StepSectionHeading';
import { approvedSpotNotice } from '@/features/cart/lib/confirm-outcome';
import { tndLabel } from '@/lib/money';

import { formatEventDate, formatEventHours } from '../lib/event-display';
import {
  EVENT_MIN_MINUTES,
  clampEventMinutes,
  eventMinutesPrice,
  minutesLabel,
} from '../lib/event-minutes';
import type { EventItemView } from '../services/events.api';

const integer = new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 });

interface EventRecapStepProps {
  campaignId: string;
  event: EventItemView | null;
  zoneNames: string[];
  /** EVT-MIN1 — the positioning's minutes (null = not chosen yet). */
  eventMinutes: number | null;
  setEventMinutes: (value: number | null) => void;
  /** The linked spot's validation status — 'approved' earns the SK1 immediate-launch line. */
  spotValidationStatus: string | null;
  onAddToCart: () => void | Promise<void>;
  adding: boolean;
  onBack: () => void;
}

/**
 * EV3 — the parcours' Récapitulatif: the diffusion-window line, the zone count, the
 * categories-are-automatic reminder, and — EVT-MIN1 — the MINUTES slider bounded [1, the minutes
 * still free] (GET /:id/cmax forks to the event engine and sends the ordered minute prices: N
 * minutes cost the sum of the first N, so lowering the slider drops the last venue's latest bloc
 * first). Montants HT, no letters (HT-1), via lib/money; « Ajouter au panier » files the
 * positioning under Événements.
 */
export default function EventRecapStep({
  campaignId,
  event,
  zoneNames,
  eventMinutes,
  setEventMinutes,
  spotValidationStatus,
  onAddToCart,
  adding,
  onBack,
}: EventRecapStepProps) {
  const cmax = useCampaignCmax(campaignId);
  const [pullbackNotice, setPullbackNotice] = useState(false);

  const maxMinutes = cmax.data?.max_minutes;
  const prices = cmax.data?.minute_prices_tnd ?? [];
  const value = eventMinutes;
  const zeroInventory = maxMinutes !== undefined && maxMinutes < EVENT_MIN_MINUTES;
  const canAct = !adding && value != null && value >= EVENT_MIN_MINUTES && !zeroInventory;
  const priceTnd = value == null ? null : eventMinutesPrice(prices, value);
  // IMP-EST1 — « Impressions prévues » stays the SERVER's dry-run of the event dispatch, sized by
  // the minutes cursor (debounced): the first N minutes the dispatch would take now.
  const estimate = useImpressionsEstimate(campaignId, {
    minutes: value,
    inputs: { zones: zoneNames, extra: event?.id ?? null },
  });
  const venuesCount = cmax.data?.eligible_count;

  // Pull-back (the E5 idiom): minutes above a freshly-fetched max clamp down VISIBLY.
  useEffect(() => {
    if (maxMinutes === undefined || value === null) return;
    const next = clampEventMinutes(value, maxMinutes);
    if (next !== value) {
      setEventMinutes(next);
      setPullbackNotice(true);
    }
  }, [maxMinutes, value, setEventMinutes]);

  const approvedNotice = approvedSpotNotice(spotValidationStatus ?? undefined);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
        <StepSectionHeading
          icon={Banknote}
          title="Récapitulatif"
          subtitle="Vérifiez votre positionnement et choisissez vos minutes"
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
              Déplacez le curseur pour ajuster vos minutes, votre montant et vos impressions prévues
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-brand-primary/10 p-4">
                <p className="text-sm text-gray-600">Montant estimé</p>
                <p className="mt-0.5 text-lg font-bold text-brand-deep">
                  {priceTnd == null ? '—' : tndLabel(priceTnd)}
                </p>
              </div>
              <div className="rounded-2xl bg-brand-accent/10 p-4">
                <p className="text-sm text-gray-600">Impressions prévues</p>
                <p className="mt-0.5 text-lg font-bold text-brand-accent">
                  <ImpressionsEstimateText view={estimate} />
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-200 p-5">
              <div className="mb-4 text-center">
                <span className="text-3xl font-bold text-gray-900">
                  {value == null ? '—' : integer.format(value)}
                </span>
                <span className="ml-1 text-base font-medium text-gray-400">
                  {value == null ? '' : value > 1 ? 'minutes' : 'minute'}
                </span>
                {value == null && (
                  <p className="mt-1 text-sm text-gray-500">
                    Déplacez le curseur pour choisir vos minutes de diffusion.
                  </p>
                )}
              </div>

              <input
                id="event-minutes"
                type="range"
                min={EVENT_MIN_MINUTES}
                max={maxMinutes ?? EVENT_MIN_MINUTES}
                step={1}
                value={value ?? EVENT_MIN_MINUTES}
                onChange={(e) => {
                  setPullbackNotice(false);
                  setEventMinutes(Number(e.target.value));
                }}
                disabled={maxMinutes === undefined || zeroInventory}
                aria-label="Minutes de diffusion du positionnement"
                aria-valuetext={value == null ? 'Aucune minute choisie' : minutesLabel(value)}
                className="w-full cursor-pointer accent-brand-primary disabled:cursor-not-allowed disabled:opacity-40"
              />
              <div className="mt-1 flex justify-between text-xs font-medium text-gray-400">
                <span>MIN : {minutesLabel(EVENT_MIN_MINUTES)}</span>
                <span>
                  MAX : {maxMinutes === undefined ? '…' : minutesLabel(maxMinutes)}
                  {venuesCount !== undefined && venuesCount > 0
                    ? ` · ${venuesCount} établissement${venuesCount > 1 ? 's' : ''}`
                    : ''}
                </span>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                Une minute = votre spot dans la page publicitaire de 5 minutes d’un bloc, chez un
                établissement. Les 3 blocs avant le match ouvrent par la publicité, les 3 blocs
                après la terminent. En réduisant le curseur, vous retirez d’abord les minutes du
                dernier établissement de la liste.
              </p>

              {cmax.isLoading && (
                <p className="mt-2 inline-flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Calcul des minutes disponibles…
                </p>
              )}
              {cmax.isError && (
                <p className="mt-2 text-xs text-red-600">
                  Impossible de calculer les minutes disponibles — revenez sur cette étape pour
                  réessayer.
                </p>
              )}
              {pullbackNotice && (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  Des minutes ont été vendues entre-temps : votre choix a été ramené au maximum
                  disponible.
                </p>
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
