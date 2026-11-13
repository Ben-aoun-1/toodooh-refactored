import { Banknote, Loader2, MapPin, ShoppingCart, Tags } from 'lucide-react';
import { useEffect, useState } from 'react';

import ImpressionsEstimateText from '@/features/campaigns/components/ImpressionsEstimateText';
import { useCampaignCmax } from '@/features/campaigns/hooks/useCampaignCmax';
import { useImpressionsEstimate } from '@/features/campaigns/hooks/useImpressionsEstimate';
import { approvedSpotNotice } from '@/features/cart/lib/confirm-outcome';
import { tndLabel } from '@/lib/money';

import { formatEventDate, formatEventHours } from '../lib/event-display';
import {
  clampEventMinutes,
  eventMinutesPrice,
  eventSeatExplainer,
  minutesLabel,
} from '../lib/event-minutes';
import { zonesSummary } from '../lib/positioning-display';
import type { EventItemView } from '../services/events.api';

import ImpactTiles from './positioning/ImpactTiles';
import MinutesClock from './positioning/MinutesClock';
import PitchRange from './positioning/PitchRange';
import PositioningCard from './positioning/PositioningCard';
import PositioningFooter from './positioning/PositioningFooter';

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
 * EV3 — the parcours' Récapitulatif (Mariem's 04/11 design): the diffusion window, the zones, the
 * categories-are-automatic reminder, and — EVT-MIN1 — the MINUTES slider bounded [one seat, the
 * minutes still free] (GET /:id/cmax forks to the event engine and sends the ordered seat prices:
 * N minutes cost the first N ÷ seat of them, so lowering the slider drops the last venue's latest
 * bloc first). Montants HT, no letters (HT-1), via lib/money; « Ajouter au panier » files the
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
  // Mariem 04/11 — the match's seat: the slider's minimum and step (2 minutes; 1 under EVT-MIN1).
  const seat = cmax.data?.seat_minutes ?? 1;
  const value = eventMinutes;
  const zeroInventory = maxMinutes !== undefined && maxMinutes < seat;
  const canAct = !adding && value != null && value >= seat && !zeroInventory;
  const priceTnd = value == null ? null : eventMinutesPrice(prices, value, seat);
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
    const next = clampEventMinutes(value, maxMinutes, seat);
    if (next !== value) {
      setEventMinutes(next);
      setPullbackNotice(true);
    }
  }, [maxMinutes, seat, value, setEventMinutes]);

  const approvedNotice = approvedSpotNotice(spotValidationStatus ?? undefined);

  return (
    <>
      <PositioningCard
        icon={Banknote}
        title="Récapitulatif"
        subtitle="Vérifiez votre positionnement et choisissez vos minutes"
      >
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* LEFT — the positioning recap */}
          <section className="min-w-0 rounded-xl border border-pitch-line bg-white p-5">
            {event && (
              <>
                <p className="text-sm text-pitch-grey">Fenêtre de diffusion</p>
                <p className="mt-1 text-base font-medium text-pitch-ink">
                  {formatEventDate(event.kickoff_at)} ·{' '}
                  {formatEventHours(event.fenetre.window_start, event.fenetre.window_end)}
                </p>
                <p className="mt-1 text-xs text-amber-700">
                  1 h avant le match, pendant, 1 h après : la fenêtre suit le coup d’envoi.
                </p>
                <hr className="my-4 border-pitch-line" />
              </>
            )}
            <p className="flex items-center gap-1.5 text-sm text-pitch-grey">
              <MapPin className="h-4 w-4" aria-hidden="true" /> Zones
            </p>
            <p className="mt-1 text-base font-medium text-pitch-ink">{zonesSummary(zoneNames)}</p>
            <div className="mt-4 flex gap-2 rounded-lg bg-pitch-wash/60 px-3 py-2.5">
              <Tags className="mt-0.5 h-4 w-4 shrink-0 text-pitch-leaf" aria-hidden="true" />
              <p className="text-sm text-pitch-ink">
                Les catégories d’établissements sont sélectionnées automatiquement pour un événement
                : tous les lieux éligibles diffusent pendant la fenêtre.
              </p>
            </div>
            {approvedNotice && (
              <p className="mt-4 rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-sm text-green-700">
                {approvedNotice}
              </p>
            )}
          </section>

          {/* RIGHT — the bounded minutes cursor (the StepCart idiom on the EVENT ceiling) */}
          <section className="min-w-0 rounded-xl border border-pitch-line bg-white p-5">
            <h3 className="text-base font-semibold text-pitch-ink">Ajuster votre impact</h3>
            <p className="mb-4 mt-1 text-sm text-pitch-grey">
              Déplacez le curseur pour ajuster vos minutes, votre montant et vos impressions prévues
            </p>
            <ImpactTiles
              amount={priceTnd == null ? '—' : tndLabel(priceTnd)}
              impressions={<ImpressionsEstimateText view={estimate} />}
            />

            <div className="mt-3 rounded-xl border border-pitch-line px-4 py-4">
              <div className="text-center">
                <MinutesClock
                  minutes={value}
                  unit={value != null && value > 1 ? 'minutes' : 'minute'}
                />
                {value == null && (
                  <p className="mt-2 text-sm text-pitch-grey">
                    Déplacez le curseur pour choisir vos minutes de diffusion.
                  </p>
                )}
              </div>
              <div className="mt-3">
                <PitchRange
                  id="event-minutes"
                  min={seat}
                  max={maxMinutes ?? seat}
                  step={seat}
                  value={value ?? seat}
                  onChange={(next) => {
                    setPullbackNotice(false);
                    setEventMinutes(next);
                  }}
                  disabled={maxMinutes === undefined || zeroInventory}
                  ariaLabel="Minutes de diffusion du positionnement"
                  ariaValueText={value == null ? 'Aucune minute choisie' : minutesLabel(value)}
                />
              </div>
              <div className="mt-1 flex justify-between gap-2 text-xs text-pitch-ink">
                <p className="text-pitch-ink">
                  <b className="font-semibold">MIN</b> : {minutesLabel(seat)}
                </p>
                <p className="text-right text-pitch-ink">
                  <b className="font-semibold">MAX</b> :{' '}
                  {maxMinutes === undefined ? '…' : minutesLabel(maxMinutes)}
                  {venuesCount !== undefined && venuesCount > 0
                    ? ` · ${venuesCount} établissement${venuesCount > 1 ? 's' : ''}`
                    : ''}
                </p>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-pitch-grey">
                {eventSeatExplainer(seat)}
              </p>

              {cmax.isLoading && (
                <p className="mt-2 inline-flex items-center gap-2 text-xs text-pitch-grey">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
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
                  Moins de minutes sont disponibles qu’au moment de votre choix : il a été ramené au
                  maximum disponible.
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
      </PositioningCard>
      <PositioningFooter
        onBack={onBack}
        onNext={() => void onAddToCart()}
        nextLabel="Ajouter au panier"
        nextIcon={<ShoppingCart className="h-4 w-4" aria-hidden="true" />}
        disabled={!canAct}
        loading={adding}
      />
    </>
  );
}
