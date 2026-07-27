import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, Loader2, Rocket, Wallet, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { useOwnerBusinessSectors } from '@/features/auth/hooks/useOwnerBusinessSectors';
import { CART_BUDGET_STEP_TND } from '@/features/campaigns/hooks/new-campaign/cart-budget';
import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';
import { useZones } from '@/features/campaigns/hooks/useZones';
import {
  BOOST_SUCCESS_TOAST,
  WHOLE_NETWORK_AXIS_NOTE,
  boostReasonFr,
  canBoostCampaign,
  hasBoostAddition,
  newOptions,
} from '@/features/campaigns/lib/boost-rules';
import { formatUiDate } from '@/features/campaigns/lib/campaign-summary';
import { CAMPAIGN_BUDGET_FLOOR_TND } from '@/features/campaigns/lib/cmax-budget';
import { zonesRecapLabel } from '@/features/campaigns/lib/zones-selection';
import { type BoostAdditionsWire, boostApi } from '@/features/campaigns/services/boost.api';
import type { CampaignView } from '@/features/campaigns/services/campaigns.api';
import { ApiError } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/errors';
import { htTtcLabel, htTtcOrDash } from '@/lib/money';

interface BoostCampaignModalProps {
  campaign: CampaignView;
  userId: string | undefined;
  onClose: () => void;
}

/**
 * CF-B1 (spec §3.3) — the DEDICATED Booster surface (ruled deviation #2: not the wizard in
 * extension mode). Read-only recap of the original; three ADDITIVE controls (end ≥ current end,
 * categories/zones EXCLUDING what the campaign already targets — an empty axis is whole-network
 * per E5.1 and closes its picker); the budget slider rides the live boost ceiling (the E5
 * preview) and the apply is direct (ruled deviation #1: not via the panier). z-50 — the modal
 * layer of the app ladder.
 */
export default function BoostCampaignModal({ campaign, userId, onClose }: BoostCampaignModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sectors = useOwnerBusinessSectors();
  const zones = useZones();

  const [newEndDate, setNewEndDate] = useState('');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [amount, setAmount] = useState<number | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const existingCategoryIds = (campaign.targeting ?? []).map((l) => l.category_id);
  const existingZoneIds = (campaign.zones ?? []).map((z) => z.zone_id);
  // E5.1 — an EMPTY axis already targets the whole network: nothing to add there.
  const categoriesOpen = existingCategoryIds.length > 0;
  const zonesOpen = existingZoneIds.length > 0;
  const categoryOptions = newOptions(sectors.data ?? [], existingCategoryIds);
  const zoneOptions = newOptions(zones.data ?? [], existingZoneIds);

  const additions: BoostAdditionsWire = useMemo(
    () => ({
      ...(newEndDate && campaign.end_date && newEndDate > campaign.end_date
        ? { new_end_date: newEndDate }
        : {}),
      ...(zoneIds.length > 0 ? { added_zone_ids: zoneIds } : {}),
      ...(categoryIds.length > 0 ? { added_category_ids: categoryIds } : {}),
    }),
    [newEndDate, campaign.end_date, zoneIds, categoryIds],
  );
  const hasAddition = hasBoostAddition(additions, campaign.end_date);

  // The live boost ceiling over the hypothetical merged state (the api persists nothing).
  const preview = useQuery({
    queryKey: ['boost-preview', campaign.id, additions],
    queryFn: () => boostApi.preview(campaign.id, additions),
    enabled: hasAddition,
    staleTime: 15_000,
  });
  const cMax = preview.data?.c_max_boost_tnd;
  const sliderMax = cMax ?? CAMPAIGN_BUDGET_FLOOR_TND;
  const zeroInventory = cMax !== undefined && cMax < CAMPAIGN_BUDGET_FLOOR_TND;

  const applyBoost = useMutation({
    mutationFn: () => boostApi.apply(campaign.id, additions, amount ?? 0),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: campaignsKeys.list(userId ?? '') });
      toast.success(BOOST_SUCCESS_TOAST, { duration: 7000 });
      onClose();
    },
    onError: (error: unknown) => {
      const code = error instanceof ApiError ? error.code : null;
      setRefusal(code);
      toast.error(code ? boostReasonFr(code) : getErrorMessage(error) || 'Le boost a échoué.');
    },
  });

  const canSubmit =
    hasAddition &&
    !zeroInventory &&
    amount !== null &&
    amount >= CAMPAIGN_BUDGET_FLOOR_TND &&
    (cMax === undefined || amount <= cMax) &&
    !applyBoost.isPending;

  const toggle = (list: string[], id: string, set: (next: string[]) => void) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  if (!canBoostCampaign(campaign.status)) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Booster la campagne"
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Booster la campagne</h2>
            <p className="text-sm text-gray-500">{campaign.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── The original, read-only (strictly additive — nothing here is editable) ── */}
        <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50/60 p-4 text-sm">
          <p className="mb-2 font-semibold text-gray-700">Campagne d’origine</p>
          <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <div className="flex justify-between sm:block">
              <dt className="text-gray-500">Période</dt>
              <dd className="font-medium text-gray-900">
                {formatUiDate(campaign.start_date)} – {formatUiDate(campaign.end_date)}
              </dd>
            </div>
            <div className="flex justify-between sm:block">
              <dt className="text-gray-500">Budget</dt>
              <dd className="font-medium text-gray-900">
                {htTtcOrDash(campaign.requested_budget)}
              </dd>
            </div>
            <div className="flex justify-between sm:block">
              <dt className="text-gray-500">Catégories</dt>
              <dd className="font-medium text-gray-900">
                {existingCategoryIds.length > 0
                  ? (campaign.targeting ?? [])
                      .map((l) => l.category_name)
                      .filter(Boolean)
                      .join(', ')
                  : 'Toutes catégories'}
              </dd>
            </div>
            <div className="flex justify-between sm:block">
              <dt className="text-gray-500">Zones</dt>
              <dd className="font-medium text-gray-900">
                {zonesRecapLabel((campaign.zones ?? []).map((z) => z.name))}
              </dd>
            </div>
          </dl>
        </div>

        {/* ── The three additive controls ── */}
        <div className="space-y-4">
          <div>
            <label htmlFor="boost-end" className="mb-1 block text-sm font-medium text-gray-700">
              <Calendar className="mr-1 inline h-4 w-4 align-text-bottom" />
              Prolonger jusqu’au <span className="text-gray-400">(optionnel)</span>
            </label>
            <input
              id="boost-end"
              type="date"
              min={campaign.end_date ?? undefined}
              value={newEndDate}
              onChange={(e) => setNewEndDate(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            />
            <p className="mt-1 text-xs text-gray-400">
              Jamais en deçà de la fin actuelle — le début reste figé.
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-gray-700">Ajouter des catégories</p>
            {categoriesOpen ? (
              <div className="flex flex-wrap gap-2">
                {categoryOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={categoryIds.includes(option.id)}
                    onClick={() => toggle(categoryIds, option.id, setCategoryIds)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      categoryIds.includes(option.id)
                        ? 'border-brand-primary bg-brand-primary/10 font-semibold text-brand-deep'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {option.name}
                  </button>
                ))}
                {categoryOptions.length === 0 && (
                  <p className="text-sm text-gray-400">Toutes les catégories sont déjà ciblées.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">{WHOLE_NETWORK_AXIS_NOTE}</p>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-gray-700">Ajouter des zones</p>
            {zonesOpen ? (
              <div className="flex flex-wrap gap-2">
                {zoneOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={zoneIds.includes(option.id)}
                    onClick={() => toggle(zoneIds, option.id, setZoneIds)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      zoneIds.includes(option.id)
                        ? 'border-brand-primary bg-brand-primary/10 font-semibold text-brand-deep'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {option.name}
                  </button>
                ))}
                {zoneOptions.length === 0 && (
                  <p className="text-sm text-gray-400">Toutes les zones sont déjà ciblées.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">{WHOLE_NETWORK_AXIS_NOTE}</p>
            )}
          </div>

          {/* ── The complementary budget (the E5 bounded-slider idiom) ── */}
          <div className="rounded-xl border border-gray-200 p-4">
            <p className="mb-2 text-sm font-medium text-gray-700">Budget complémentaire</p>
            {!hasAddition ? (
              <p className="text-sm text-gray-400">
                Ajoutez au moins un élément (fin, zone ou catégorie) pour débloquer le budget.
              </p>
            ) : preview.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Calcul du plafond…
              </p>
            ) : zeroInventory ? (
              <p className="text-sm text-amber-700">
                Aucun inventaire disponible sur le périmètre ajouté — élargissez vos ajouts.
              </p>
            ) : (
              <>
                <input
                  id="boost-budget"
                  type="range"
                  min={CAMPAIGN_BUDGET_FLOOR_TND}
                  max={sliderMax}
                  step={CART_BUDGET_STEP_TND}
                  value={amount ?? CAMPAIGN_BUDGET_FLOOR_TND}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="w-full accent-brand-primary"
                />
                <div className="mt-1 flex justify-between text-xs text-gray-500">
                  <span>MIN : {CAMPAIGN_BUDGET_FLOOR_TND} TND</span>
                  <span>MAX : {sliderMax} TND</span>
                </div>
                <p className="mt-2 text-center text-lg font-bold text-gray-900 tabular-nums">
                  {amount === null ? '—' : htTtcLabel(amount)}
                </p>
              </>
            )}
          </div>

          {refusal === 'INSUFFICIENT_BALANCE' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-semibold">Solde insuffisant</p>
              <button
                type="button"
                onClick={() => navigate('/my-recharges')}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-brand-deep"
              >
                <Wallet className="h-4 w-4" />
                Recharger mon compte
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              setRefusal(null);
              applyBoost.mutate();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-3 text-sm font-semibold text-brand-deep transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applyBoost.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            {applyBoost.isPending ? 'Boost en cours…' : 'Booster la campagne'}
          </button>
        </div>
      </div>
    </div>
  );
}
