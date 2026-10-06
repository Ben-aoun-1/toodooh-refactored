import { useQueries } from '@tanstack/react-query';
import { ArrowRight, Banknote, Loader2, ShoppingCart } from 'lucide-react';

import PillButton from '@/components/PillButton';
import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';
import StepSectionHeading from '@/features/campaigns/pages/new-campaign/StepSectionHeading';
import { campaignsApi } from '@/features/campaigns/services/campaigns.api';
import { tndLabel } from '@/lib/money';

import {
  EVENT_MIN_MINUTES,
  distributeEventMinutes,
  eventMinutesImpressions,
  eventMinutesPrice,
  groupMinutesBounds,
  minutesLabel,
} from '../lib/event-minutes';

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
 * minutes on its own ordered list (GET /:id/cmax), exactly as the single parcours does.
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
  const bounds = groupMinutesBounds(maxes);
  const values = lines.map((l) => minutes[l.campaignId] ?? null);
  const chosen = values.every((v) => v !== null);
  const total = values.reduce<number>((s, v) => s + (v ?? 0), 0);
  const price = lines.reduce(
    (s, _l, i) => s + eventMinutesPrice(cmaxes[i]?.data?.minute_prices_tnd ?? [], values[i] ?? 0),
    0,
  );
  const impressions = lines.reduce(
    (s, _l, i) =>
      s + eventMinutesImpressions(cmaxes[i]?.data?.minute_impressions ?? [], values[i] ?? 0),
    0,
  );
  const full = lines.filter((_l, i) => loaded && (maxes[i] ?? 0) < EVENT_MIN_MINUTES);
  const canAct = !adding && loaded && chosen && full.length === 0 && bounds.max > 0;

  const setTotal = (next: number) => {
    const parts = distributeEventMinutes(next, maxes);
    setMinutes(Object.fromEntries(lines.map((l, i) => [l.campaignId, parts[i] ?? 0])));
  };
  const setOne = (campaignId: string, next: number) =>
    setMinutes({ ...minutes, [campaignId]: next });

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
        <StepSectionHeading
          icon={Banknote}
          title="Récapitulatif"
          subtitle={`Choisissez vos minutes sur les ${lines.length} matchs sélectionnés`}
        />

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-brand-primary/10 p-4">
            <p className="text-sm text-gray-600">Montant estimé</p>
            <p className="mt-0.5 text-lg font-bold text-brand-deep">
              {chosen ? tndLabel(price) : '—'}
            </p>
          </div>
          <div className="rounded-2xl bg-brand-accent/10 p-4">
            <p className="text-sm text-gray-600">Impressions prévues</p>
            <p className="mt-0.5 text-lg font-bold text-brand-accent">
              {chosen ? integer.format(impressions) : '—'}
            </p>
          </div>
        </div>

        {/* THE big slider — every match at once (A1). */}
        <div className="mt-4 rounded-2xl border border-gray-200 p-5">
          <div className="mb-3 text-center">
            <span className="text-3xl font-bold text-gray-900">
              {chosen ? integer.format(total) : '—'}
            </span>
            <span className="ml-1 text-base font-medium text-gray-400">
              {chosen ? (total > 1 ? 'minutes au total' : 'minute au total') : ''}
            </span>
          </div>
          <input
            id="event-group-minutes"
            type="range"
            min={Math.max(bounds.min, EVENT_MIN_MINUTES)}
            max={Math.max(bounds.max, EVENT_MIN_MINUTES)}
            step={1}
            value={chosen ? total : Math.max(bounds.min, EVENT_MIN_MINUTES)}
            onChange={(e) => setTotal(Number(e.target.value))}
            disabled={!loaded || bounds.max === 0}
            aria-label="Minutes de diffusion, tous les matchs"
            aria-valuetext={chosen ? minutesLabel(total) : 'Aucune minute choisie'}
            className="w-full cursor-pointer accent-brand-primary disabled:cursor-not-allowed disabled:opacity-40"
          />
          <div className="mt-1 flex justify-between text-xs font-medium text-gray-400">
            <span>MIN : {minutesLabel(Math.max(bounds.min, EVENT_MIN_MINUTES))}</span>
            <span>MAX : {loaded ? minutesLabel(bounds.max) : '…'}</span>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Le curseur principal répartit vos minutes entre les matchs, en proportion des minutes
            encore disponibles sur chacun. Ajustez ensuite match par match.
          </p>
          {!loaded && (
            <p className="mt-2 inline-flex items-center gap-2 text-xs text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calcul des minutes disponibles…
            </p>
          )}
        </div>

        {/* One small slider per match. */}
        <ul className="mt-4 space-y-3">
          {lines.map((l, i) => {
            const max = maxes[i] ?? 0;
            const value = values[i];
            const data = cmaxes[i]?.data;
            return (
              <li key={l.campaignId} className="rounded-xl border border-gray-200 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{l.title}</p>
                    <p className="text-xs text-gray-500">{l.subtitle}</p>
                  </div>
                  <p className="text-sm text-gray-700">
                    {value == null ? '—' : minutesLabel(value)}
                    {value != null && data && (
                      <span className="ml-2 text-gray-400">
                        {tndLabel(eventMinutesPrice(data.minute_prices_tnd ?? [], value))}
                      </span>
                    )}
                  </p>
                </div>
                {loaded && max < EVENT_MIN_MINUTES ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Plus aucune minute disponible sur ce match — retirez-le de votre sélection.
                  </p>
                ) : (
                  <input
                    type="range"
                    min={EVENT_MIN_MINUTES}
                    max={Math.max(max, EVENT_MIN_MINUTES)}
                    step={1}
                    value={value ?? EVENT_MIN_MINUTES}
                    onChange={(e) => setOne(l.campaignId, Number(e.target.value))}
                    disabled={!loaded}
                    aria-label={`Minutes de diffusion — ${l.title}`}
                    className="mt-2 w-full cursor-pointer accent-brand-primary disabled:opacity-40"
                  />
                )}
              </li>
            );
          })}
        </ul>
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
          Ajouter les {lines.length} matchs au panier
        </PillButton>
      </div>
    </div>
  );
}
