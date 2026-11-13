import { useQueries } from '@tanstack/react-query';
import { Banknote, Loader2, ShoppingCart } from 'lucide-react';

import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';
import { campaignsApi } from '@/features/campaigns/services/campaigns.api';
import { tndLabel } from '@/lib/money';

import {
  distributeEventMinutes,
  eventMinutesImpressions,
  eventMinutesPrice,
  groupMinutesBounds,
  minutesLabel,
} from '../lib/event-minutes';

import ImpactTiles from './positioning/ImpactTiles';
import MinutesClock from './positioning/MinutesClock';
import PitchRange from './positioning/PitchRange';
import PositioningCard from './positioning/PositioningCard';
import PositioningFooter from './positioning/PositioningFooter';

const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export interface GroupMatchLine {
  campaignId: string;
  title: string;
  subtitle: string;
}

interface EventGroupRecapStepProps {
  lines: GroupMatchLine[];
  /** Minutes per campaign (null = not chosen yet). */
  minutes: Record<string, number | null>;
  setMinutes: (next: Record<string, number | null>) => void;
  onAddToCart: () => void | Promise<void>;
  adding: boolean;
  onBack: () => void;
}

/**
 * EVT-CAT2 — the multi-match Récapitulatif (operator ruling): ONE big minutes slider for all the
 * selected matches, then one small slider per match. The big one spreads its total in proportion
 * to each match's free minutes (ruling A1, lib/event-minutes distributeEventMinutes); moving a
 * small one changes only its match, and the big one shows their sum. Each match prices its
 * minutes on its own ordered list (GET /:id/cmax), exactly as the single parcours does. Drawn
 * like the single parcours since Mariem's 04/11 design.
 */
export default function EventGroupRecapStep({
  lines,
  minutes,
  setMinutes,
  onAddToCart,
  adding,
  onBack,
}: EventGroupRecapStepProps) {
  const cmaxes = useQueries({
    queries: lines.map((l) => ({
      queryKey: campaignsKeys.cmax(l.campaignId),
      queryFn: () => campaignsApi.cmax(l.campaignId),
    })),
  });
  const loaded = cmaxes.every((q) => q.data !== undefined);
  const maxes = cmaxes.map((q) => q.data?.max_minutes ?? 0);
  // Mariem 04/11 — each match's seat (2 minutes; 1 under EVT-MIN1); the big slider moves by the
  // largest of them, so every share stays on whole seats.
  const seats = cmaxes.map((q) => q.data?.seat_minutes ?? 1);
  const groupSeat = Math.max(1, ...seats);
  const bounds = groupMinutesBounds(maxes, groupSeat);
  const values = lines.map((l) => minutes[l.campaignId] ?? null);
  const chosen = values.every((v) => v !== null);
  const total = values.reduce<number>((s, v) => s + (v ?? 0), 0);
  const price = lines.reduce(
    (s, _l, i) =>
      s +
      eventMinutesPrice(cmaxes[i]?.data?.minute_prices_tnd ?? [], values[i] ?? 0, seats[i] ?? 1),
    0,
  );
  const impressions = lines.reduce(
    (s, _l, i) =>
      s +
      eventMinutesImpressions(
        cmaxes[i]?.data?.minute_impressions ?? [],
        values[i] ?? 0,
        seats[i] ?? 1,
      ),
    0,
  );
  const full = lines.filter((_l, i) => loaded && (maxes[i] ?? 0) < (seats[i] ?? 1));
  const canAct = !adding && loaded && chosen && full.length === 0 && bounds.max > 0;
  const bigMin = Math.max(bounds.min, groupSeat);

  const setTotal = (next: number) => {
    const parts = distributeEventMinutes(next, maxes, groupSeat);
    setMinutes(Object.fromEntries(lines.map((l, i) => [l.campaignId, parts[i] ?? 0])));
  };
  const setOne = (campaignId: string, next: number) =>
    setMinutes({ ...minutes, [campaignId]: next });

  return (
    <>
      <PositioningCard
        icon={Banknote}
        title="Récapitulatif"
        subtitle={`Choisissez vos minutes sur les ${lines.length} matchs sélectionnés`}
      >
        <ImpactTiles
          amount={chosen ? tndLabel(price) : '—'}
          impressions={chosen ? integer.format(impressions) : '—'}
        />

        {/* THE big slider — every match at once (A1). */}
        <div className="mt-4 rounded-xl border border-pitch-line px-4 py-4">
          <div className="text-center">
            <MinutesClock
              minutes={chosen ? total : null}
              unit={total > 1 ? 'minutes au total' : 'minute au total'}
            />
          </div>
          <div className="mt-3">
            <PitchRange
              id="event-group-minutes"
              min={bigMin}
              max={Math.max(bounds.max, groupSeat)}
              step={groupSeat}
              value={chosen ? total : bigMin}
              onChange={setTotal}
              disabled={!loaded || bounds.max === 0}
              ariaLabel="Minutes de diffusion, tous les matchs"
              ariaValueText={chosen ? minutesLabel(total) : 'Aucune minute choisie'}
            />
          </div>
          <div className="mt-1 flex justify-between gap-2 text-xs">
            <p className="text-pitch-ink">
              <b className="font-semibold">MIN</b> : {minutesLabel(bigMin)}
            </p>
            <p className="text-pitch-ink">
              <b className="font-semibold">MAX</b> : {loaded ? minutesLabel(bounds.max) : '…'}
            </p>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-pitch-grey">
            Le curseur principal répartit vos minutes entre les matchs, en proportion des minutes
            encore disponibles sur chacun. Ajustez ensuite match par match.
          </p>
          {!loaded && (
            <p className="mt-2 inline-flex items-center gap-2 text-xs text-pitch-grey">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Calcul des minutes disponibles…
            </p>
          )}
        </div>

        {/* One small slider per match. */}
        <ul className="mt-4 space-y-3">
          {lines.map((l, i) => {
            const max = maxes[i] ?? 0;
            const value = values[i];
            const data = cmaxes[i]?.data;
            const seat = seats[i] ?? 1;
            return (
              <li key={l.campaignId} className="rounded-xl border border-pitch-line px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-pitch-ink">{l.title}</p>
                    <p className="text-xs text-pitch-grey">{l.subtitle}</p>
                  </div>
                  <p className="text-sm text-pitch-ink">
                    {value == null ? '—' : minutesLabel(value)}
                    {value != null && data && (
                      <span className="ml-2 text-pitch-mist">
                        {tndLabel(eventMinutesPrice(data.minute_prices_tnd ?? [], value, seat))}
                      </span>
                    )}
                  </p>
                </div>
                {loaded && max < seat ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Plus aucune minute disponible sur ce match — retirez-le de votre sélection.
                  </p>
                ) : (
                  <div className="mt-2">
                    <PitchRange
                      min={seat}
                      max={Math.max(max, seat)}
                      step={seat}
                      value={value ?? seat}
                      onChange={(next) => setOne(l.campaignId, next)}
                      disabled={!loaded}
                      ariaLabel={`Minutes de diffusion — ${l.title}`}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </PositioningCard>
      <PositioningFooter
        onBack={onBack}
        onNext={() => void onAddToCart()}
        nextLabel={`Ajouter les ${lines.length} matchs au panier`}
        nextIcon={<ShoppingCart className="h-4 w-4" aria-hidden="true" />}
        disabled={!canAct}
        loading={adding}
      />
    </>
  );
}
