import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Loader2, Lock, Rocket, Wallet, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { CART_BUDGET_STEP_TND } from '@/features/campaigns/hooks/new-campaign/cart-budget';
import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';
import { useZones } from '@/features/campaigns/hooks/useZones';
import { CAMPAIGN_BUDGET_FLOOR_TND } from '@/features/campaigns/lib/cmax-budget';
import type { CampaignView } from '@/features/campaigns/services/campaigns.api';
import { eventBoostApi } from '@/features/events/services/event-boost.api';
import { getErrorMessage } from '@/lib/errors';
import { htTtcLabel } from '@/lib/money';

import { useEventsCatalogue, useSuggestedEvents } from '../hooks/useEvents';
import { formatEventDate, formatEventHours } from '../lib/event-display';

// EV6 (flow §7) — the POSITIONING booster: ONE axis, ZONES ONLY. The spot, the categories and the
// diffusion window belong to the match, so they are shown FROZEN (padlocked, read-only) instead of
// being offered as controls — the difference from CF-B1's three-axis campaign modal, which stays
// untouched beside this one.

export const BOOST_POSITIONING_TITLE = 'Booster le positionnement';
export const BOOST_POSITIONING_SUCCESS =
  'Positionnement boosté — les nouveaux établissements attendent leur accord.';
export const FROZEN_AXES_NOTE =
  'Le spot, les catégories et la fenêtre de diffusion sont fixés par le match : seules les zones peuvent être étendues.';

/** The French refusal copy, keyed on the api's machine reason. */
export const eventBoostReasonFr = (error: unknown): string | null => {
  const code = (error as { body?: { error?: string } } | undefined)?.body?.error;
  switch (code) {
    case 'NO_ADDITION':
      return 'Ajoutez au moins une nouvelle zone pour booster ce positionnement.';
    case 'ZONE_ALREADY_TARGETED':
      return 'Cette zone est déjà couverte par le positionnement.';
    case 'ZONE_NOT_FOUND':
      return 'Une des zones sélectionnées n’est pas active.';
    case 'BUDGET_BELOW_MINIMUM':
      return `Le budget complémentaire doit être d’au moins ${CAMPAIGN_BUDGET_FLOOR_TND} TND.`;
    case 'BUDGET_EXCEEDS_CMAX':
      return 'Le budget complémentaire dépasse l’inventaire encore disponible.';
    case 'INSUFFICIENT_BALANCE':
      return 'Solde insuffisant pour ce boost.';
    case 'NO_ELIGIBLE':
      return 'Aucun établissement éligible dans les zones ajoutées sur cette fenêtre.';
    case 'EVENT_NMAX_EXCEEDED':
      return 'Le budget complémentaire dépasse la limite de concentration.';
    case 'NOT_BOOSTABLE':
      return 'Seul un positionnement à venir ou actif peut être boosté.';
    case 'EVENT_ANNULE':
      return 'Cet événement est annulé — le positionnement ne peut plus être boosté.';
    default:
      return null;
  }
};

interface BoostPositioningModalProps {
  campaign: CampaignView;
  onClose: () => void;
}

export default function BoostPositioningModal({ campaign, onClose }: BoostPositioningModalProps) {
  const queryClient = useQueryClient();
  const zones = useZones();
  const { data: catalogue } = useEventsCatalogue();
  const { data: suggested } = useSuggestedEvents(true);
  const event =
    (catalogue ?? []).find((e) => e.id === campaign.event_id) ??
    (suggested ?? []).find((e) => e.id === campaign.event_id) ??
    null;

  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [amount, setAmount] = useState<number | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  // The picker EXCLUDES what the positioning already covers — only additions exist here.
  const existingZoneIds = (campaign.zones ?? []).map((z) => z.zone_id);
  const zoneOptions = (zones.data ?? []).filter((z) => !existingZoneIds.includes(z.id));

  const previewQuery = useQuery({
    queryKey: [...campaignsKeys.all, 'eventBoostPreview', campaign.id, [...zoneIds].sort()],
    queryFn: () => eventBoostApi.preview(campaign.id, zoneIds),
    enabled: zoneIds.length > 0,
  });
  const ceiling = previewQuery.data?.c_max_evt_tnd;
  const eligibleCount = previewQuery.data?.eligible_count ?? 0;

  const apply = useMutation({
    mutationFn: () => eventBoostApi.apply(campaign.id, zoneIds, amount ?? 0),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: campaignsKeys.all });
      toast.success(
        `${BOOST_POSITIONING_SUCCESS} (${result.placed_venues} établissement${result.placed_venues > 1 ? 's' : ''})`,
        { duration: 7000 },
      );
      onClose();
    },
    onError: (err) => {
      setRefusal(eventBoostReasonFr(err) ?? getErrorMessage(err) ?? 'Le boost a été refusé.');
    },
  });

  const canApply =
    zoneIds.length > 0 &&
    amount !== null &&
    amount >= CAMPAIGN_BUDGET_FLOOR_TND &&
    ceiling !== undefined &&
    amount <= ceiling &&
    !apply.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <Rocket className="h-5 w-5 text-brand-deep" />
            {BOOST_POSITIONING_TITLE}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* READ-ONLY recap: the match and everything the match owns. */}
        <section className="mt-4 space-y-2 rounded-xl border border-gray-200 p-4">
          <p className="font-semibold text-gray-900">{event?.name ?? campaign.name}</p>
          {event && (
            <p className="flex items-center gap-1.5 text-sm text-[#5C5C5C]">
              <CalendarClock className="h-4 w-4 shrink-0" />
              {formatEventDate(event.kickoff_at)} ·{' '}
              {formatEventHours(event.fenetre.window_start, event.fenetre.window_end)}
            </p>
          )}
          <div className="flex gap-2 rounded-lg bg-slate-50 p-3">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <p className="text-xs text-gray-600">{FROZEN_AXES_NOTE}</p>
          </div>
        </section>

        {/* THE ONLY axis: zones. */}
        <section className="mt-4">
          <h3 className="text-sm font-bold text-gray-900">Zones à ajouter</h3>
          {zoneOptions.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">
              Toutes les zones actives sont déjà couvertes par ce positionnement.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {zoneOptions.map((zone) => {
                const selected = zoneIds.includes(zone.id);
                return (
                  <button
                    key={zone.id}
                    type="button"
                    onClick={() =>
                      setZoneIds((prev) =>
                        prev.includes(zone.id)
                          ? prev.filter((id) => id !== zone.id)
                          : [...prev, zone.id],
                      )
                    }
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                      selected
                        ? 'border-brand-primary bg-brand-primary/10 text-brand-deep'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {zone.name}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* The complementary budget, bounded by the LIVE ceiling. */}
        <section className="mt-4 rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-bold text-gray-900">Budget complémentaire</h3>
          {zoneIds.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">
              Sélectionnez au moins une zone pour connaître le budget disponible.
            </p>
          ) : previewQuery.isLoading ? (
            <p className="mt-2 inline-flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Calcul du budget disponible…
            </p>
          ) : ceiling === undefined ? (
            <p className="mt-2 text-sm text-red-600">
              Impossible de calculer le budget disponible — réessayez.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-[#7A7A7A]">
                {eligibleCount} établissement{eligibleCount > 1 ? 's' : ''} éligible
                {eligibleCount > 1 ? 's' : ''} dans les zones ajoutées.
              </p>
              <p className="mt-3 text-center text-2xl font-bold text-gray-900">
                {amount === null ? '—' : htTtcLabel(amount)}
              </p>
              <input
                id="event-boost-budget"
                type="range"
                min={CAMPAIGN_BUDGET_FLOOR_TND}
                max={Math.max(CAMPAIGN_BUDGET_FLOOR_TND, ceiling)}
                step={CART_BUDGET_STEP_TND}
                value={amount ?? CAMPAIGN_BUDGET_FLOOR_TND}
                onChange={(e) => {
                  setRefusal(null);
                  setAmount(Number(e.target.value));
                }}
                disabled={ceiling < CAMPAIGN_BUDGET_FLOOR_TND}
                aria-label="Budget complémentaire (TND)"
                className="mt-2 w-full cursor-pointer accent-brand-primary disabled:opacity-40"
              />
              <div className="mt-1 flex justify-between text-xs font-medium text-gray-400">
                <span>MIN: {CAMPAIGN_BUDGET_FLOOR_TND} TND</span>
                <span>MAX: {ceiling} TND</span>
              </div>
              {ceiling < CAMPAIGN_BUDGET_FLOOR_TND && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  L’inventaire encore disponible sur cette fenêtre est inférieur au minimum de{' '}
                  {CAMPAIGN_BUDGET_FLOOR_TND} TND.
                </p>
              )}
            </>
          )}
        </section>

        {refusal && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{refusal}</p>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="inline-flex items-center gap-1.5 text-xs text-[#7A7A7A]">
            <Wallet className="h-3.5 w-3.5" />
            Le montant est engagé immédiatement sur votre solde.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={!canApply}
              onClick={() => apply.mutate()}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-deep disabled:cursor-not-allowed disabled:opacity-50"
            >
              {apply.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              {BOOST_POSITIONING_TITLE}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
