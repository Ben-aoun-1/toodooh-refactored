import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Info,
  Loader2,
  Network,
  ShoppingCart,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import PillButton from '@/components/PillButton';
import ImpressionsEstimateText from '@/features/campaigns/components/ImpressionsEstimateText';
import {
  CART_BUDGET_MIN_TND,
  CART_BUDGET_STEP_TND,
} from '@/features/campaigns/hooks/new-campaign/cart-budget';
import { useCampaignCmax } from '@/features/campaigns/hooks/useCampaignCmax';
import { useCreativePreviewUrl, useMyCreatives } from '@/features/campaigns/hooks/useCreativeApi';
import { useImpressionsEstimate } from '@/features/campaigns/hooks/useImpressionsEstimate';
import { formatUiDate, inclusiveDayCount } from '@/features/campaigns/lib/campaign-summary';
import {
  CAMPAIGN_BUDGET_FLOOR_TND,
  CMAX_PULLBACK_NOTICE,
  cmaxZeroStateMessage,
  clampBudgetToCmax,
  cmaxHelperLine,
  isInventoryInsufficient,
} from '@/features/campaigns/lib/cmax-budget';
import { toChipLabel } from '@/features/campaigns/lib/targeting-chip-label';
import { zonesRecapLabel } from '@/features/campaigns/lib/zones-selection';
import StepSectionHeading from '@/features/campaigns/pages/new-campaign/StepSectionHeading';
import { useCampaignTargeting } from '@/features/campaigns/targeting/hooks/useCampaignTargeting';
import { approvedSpotNotice } from '@/features/cart/lib/confirm-outcome';
import { htTtcLabel, ttcParenthetical } from '@/lib/money';

import CreativePreviewTile from './CreativePreviewTile';

interface StepCartProps {
  /** CF-Z1 — the selected zone NAMES for the couverture recap ([] = « Tout le réseau »). */
  zoneNames: string[];
  requestedBudget: number | null;
  setRequestedBudget: (value: number | null) => void;
  campaignName: string;
  /** Date-only wizard strings ('YYYY-MM-DD'). */
  startDate: string | null;
  endDate: string | null;
  draftCampaignId: string | null;
  userId: string | undefined;
  creativeId: string | null;
  onBack: () => void;
  /** Enregistrer: PATCH requested_budget only, toast + exit to /my-campaigns (no submit). */
  onSaveDraft: () => void | Promise<void>;
  onSubmit: () => void | Promise<void>;
  submitting: boolean;
  saving: boolean;
}

// fr-TN money — space thousands, comma decimals (max 2, no forced trailing zeros: the interim slider
// is integer-stepped so amounts read "5 000 TND"; L-price's fractional bounds would render decimals).
const tnd = new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 2 });

/**
 * Validation step of the de-Supabase wizard (interim manual cart). LEFT: a read-only recap of the
 * campaign (name, diffusion type, targeting chips, période, coverage, spot preview). RIGHT: the
 * budget cursor with the live « Impressions estimées » (IMP-EST1 — the dispatch dry-run). On
 * submit the orchestrator PATCHes requested_budget then POSTs /:id/submit (draft → pending);
 * Enregistrer PATCHes the budget and exits without submitting. Diffusion-type chips are STATIC (V1 is
 * Réseau-only). The estimate + bounds are interim — L-price replaces the numbers, not this layout.
 */
export default function StepCart({
  zoneNames,
  requestedBudget,
  setRequestedBudget,
  campaignName,
  startDate,
  endDate,
  draftCampaignId,
  userId,
  creativeId,
  onBack,
  onSaveDraft,
  onSubmit,
  submitting,
  saving,
}: StepCartProps) {
  const targeting = useCampaignTargeting(draftCampaignId);
  const { data: creatives = [] } = useMyCreatives(userId);
  const previewUrl = useCreativePreviewUrl(creativeId);
  // E5 (VF US-1.3) — the live ceiling bounding the cursor (assemblePool's occupancy truth;
  // short staleTime + focus-refetch in the hook keep it live-ish without hammering).
  const cmax = useCampaignCmax(draftCampaignId);
  const [pullbackNotice, setPullbackNotice] = useState(false);

  // CF-U1 (Mejri item 6) — the budget-null contract: an UNTOUCHED budget is null and DISPLAYS as
  // « — » (no phantom default); the first drag of the cursor sets a real value. Enregistrer /
  // Soumettre stay locked until a positive amount is explicitly chosen.
  const value = requestedBudget;
  const busy = submitting || saving;
  const cMaxTnd = cmax.data?.c_max_tnd;
  // CF-U3 — a ceiling below the 100 TND floor is as unsellable as zero: the same honest
  // empty-state blocks the step ("told-at-selection" instead of a doomed refusal later);
  // an unknown ceiling (loading/error) leaves the server gate as the authority.
  const zeroInventory = cMaxTnd !== undefined && isInventoryInsufficient(cMaxTnd);
  const canAct = !busy && value != null && value >= CAMPAIGN_BUDGET_FLOOR_TND && !zeroInventory;

  // Pull-back (US-1.4): a budget above a freshly-fetched ceiling is clamped down with a VISIBLE
  // notice — never silently. A zero ceiling clears the budget (the zero-state owns the step).
  useEffect(() => {
    if (cMaxTnd === undefined) return;
    const { next, clamped } = clampBudgetToCmax(value, cMaxTnd);
    if (clamped) {
      setRequestedBudget(next);
      setPullbackNotice(true);
    }
  }, [cMaxTnd, value, setRequestedBudget]);

  const chips = targeting.rows.length ? targeting.rows.map(toChipLabel) : ['Toutes catégories'];

  const durationDays = inclusiveDayCount(startDate, endDate);
  const linkedCreative = creativeId ? creatives.find((c) => c.id === creativeId) : undefined;
  // CF-SK1 (ruling #9) — an already-approved spot skips admin review entirely: say so here, so
  // the advertiser knows the confirm launches immediately. Only 'approved' earns the line.
  const approvedNotice = approvedSpotNotice(linkedCreative?.validation_status);
  // IMP-EST1 — the dispatch dry-run for THIS cursor (debounced) over the draft's saved inputs.
  const estimate = useImpressionsEstimate(draftCampaignId, {
    budgetTnd: value,
    inputs: {
      startDate,
      endDate,
      targeting: targeting.rows.map((r) => `${r.category_id ?? '*'}:${r.class ?? '*'}`),
      zones: zoneNames,
      creativeId,
      creativeDurationSeconds: linkedCreative?.duration_seconds ?? null,
    },
  });

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
        <StepSectionHeading
          icon={Banknote}
          title="Validation"
          subtitle="Vérifiez et confirmez votre campagne"
        />

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* LEFT — Récapitulatif */}
          <section className="min-w-0 rounded-2xl border border-gray-200 p-5 sm:p-6">
            <h3 className="mb-5 text-lg font-bold text-gray-900">Récapitulatif</h3>

            <div>
              <p className="text-sm font-medium text-gray-500">Nom de la campagne</p>
              <p className="mt-1 font-medium text-gray-900">{campaignName || '—'}</p>
            </div>

            <hr className="my-4 border-gray-100" />

            <div>
              <p className="mb-2 text-sm font-medium text-gray-500">Type de la campagne</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 rounded-xl border-2 border-brand-primary bg-brand-primary/5 px-3 py-3">
                  <Target className="h-4 w-4 flex-shrink-0 text-brand-deep" />
                  <span className="truncate text-sm font-medium text-gray-900">Réseau Toodooh</span>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 opacity-60">
                  <Network className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  <span className="truncate text-sm font-medium text-gray-400">Parc TV</span>
                </div>
              </div>
            </div>

            <hr className="my-4 border-gray-100" />

            <div>
              <p className="mb-2 text-sm font-medium text-gray-500">Catégorie(s)</p>
              {targeting.isLoading ? (
                <div className="h-7 w-40 animate-pulse rounded-lg bg-gray-100" />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {chips.map((label, i) => (
                    <span
                      key={`${label}-${i}`}
                      className="rounded-lg border border-brand-primary px-3 py-1.5 text-sm font-medium text-brand-deep"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <hr className="my-4 border-gray-100" />

            <div>
              <p className="mb-2 text-sm font-medium text-gray-500">Période</p>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="min-w-0">
                  <p className="text-gray-500">Début</p>
                  <p className="mt-0.5 font-medium text-gray-900">{formatUiDate(startDate)}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-gray-500">Fin</p>
                  <p className="mt-0.5 font-medium text-gray-900">{formatUiDate(endDate)}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-gray-500">Durée</p>
                  <p className="mt-0.5 font-medium text-gray-900">
                    {durationDays == null ? '—' : `${durationDays} jours`}
                  </p>
                </div>
              </div>
            </div>

            <hr className="my-4 border-gray-100" />

            <div>
              <p className="mb-2 text-sm font-medium text-gray-500">Couverture</p>
              {/* CF-Z1 — the selected zones (or « Tout le réseau » when none). */}
              <p className="text-sm text-gray-900">
                <span className="text-gray-500">Zones : </span>
                <span className="font-medium">{zonesRecapLabel(zoneNames)}</span>
              </p>
            </div>

            <hr className="my-4 border-gray-100" />

            <div>
              <p className="mb-2 text-sm font-medium text-gray-500">Spot</p>
              <CreativePreviewTile
                creativeType={linkedCreative?.creative_type}
                title={linkedCreative?.title ?? null}
                durationSeconds={linkedCreative?.duration_seconds ?? null}
                url={previewUrl.data?.url}
                isLoading={previewUrl.isLoading}
              />
            </div>
          </section>

          {/* RIGHT — Ajuster votre impact */}
          <section className="min-w-0 rounded-2xl border border-gray-200 p-5 sm:p-6">
            <h3 className="text-lg font-bold text-gray-900">Ajuster votre impact</h3>
            <p className="mt-1 text-sm text-gray-600">
              Déplacez le curseur pour ajuster votre budget et vos impressions estimées
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-brand-primary/10 p-4">
                <span className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white">
                  <Banknote className="h-4 w-4 text-brand-deep" />
                </span>
                <p className="text-sm text-gray-600">Montant estimé</p>
                {/* CF-U1 — every displayed montant carries its TTC (Mejri item 6). */}
                <p className="mt-0.5 text-lg font-bold text-brand-deep">
                  {value == null ? '—' : htTtcLabel(value)}
                </p>
              </div>
              <div className="rounded-2xl bg-brand-accent/10 p-4">
                <span className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white">
                  <TrendingUp className="h-4 w-4 text-brand-accent" />
                </span>
                <p className="text-sm text-gray-600">Impressions potentielles</p>
                <p className="mt-0.5 text-lg font-bold text-brand-accent">
                  <ImpressionsEstimateText view={estimate} />
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

              {/* E5 — the slider max IS the live C_max (the interim flat 5 000 retired). While the
                  ceiling loads (or errored) the cursor is held; zero inventory disables it with the
                  honest empty-state below. */}
              <input
                id="cart-budget"
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
                aria-label="Budget indicatif (TND)"
                aria-valuetext={
                  value == null ? 'Aucun budget renseigné' : `${tnd.format(value)} TND`
                }
                className="w-full cursor-pointer accent-brand-primary disabled:cursor-not-allowed disabled:opacity-40"
              />
              <div className="mt-1 flex justify-between text-xs font-medium text-gray-400">
                <span>MIN: {tnd.format(CART_BUDGET_MIN_TND)} TND</span>
                <span>MAX: {cMaxTnd === undefined ? '…' : `${tnd.format(cMaxTnd)} TND`}</span>
              </div>

              {/* E5 — the ceiling, said out loud (US-1.3): computed on the REAL inventory. */}
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
              {cmax.data !== undefined && !zeroInventory && (
                <p className="mt-2 text-xs text-gray-500">
                  {cmaxHelperLine(cmax.data.c_max_tnd, cmax.data.eligible_count)}
                </p>
              )}

              {zeroInventory && (
                <div className="mt-3 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600" />
                  <p className="text-sm text-amber-800">
                    {cmaxZeroStateMessage(cmax.data?.targeted_count)}
                  </p>
                </div>
              )}
              {pullbackNotice && !zeroInventory && (
                <div className="mt-3 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600" />
                  <p className="text-sm text-amber-800">{CMAX_PULLBACK_NOTICE}</p>
                </div>
              )}

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label
                    htmlFor="cart-budget-min"
                    className="mb-1 block text-xs font-medium text-gray-500"
                  >
                    Montant minimum (TND)
                  </label>
                  <input
                    id="cart-budget-min"
                    type="text"
                    readOnly
                    aria-readonly="true"
                    tabIndex={-1}
                    value={`Min: ${tnd.format(CART_BUDGET_MIN_TND)} TND`}
                    className="w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-400"
                  />
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="cart-budget-max"
                    className="mb-1 block text-xs font-medium text-gray-500"
                  >
                    Montant maximum (TND)
                  </label>
                  <input
                    id="cart-budget-max"
                    type="text"
                    readOnly
                    aria-readonly="true"
                    tabIndex={-1}
                    value={`Max: ${cMaxTnd === undefined ? '…' : `${tnd.format(cMaxTnd)} TND`}`}
                    className="w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-400"
                  />
                </div>
              </div>
            </div>

            {approvedNotice && (
              <div className="mt-4 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <BadgeCheck className="h-5 w-5 flex-shrink-0 text-emerald-600" />
                <p className="text-sm text-emerald-800">{approvedNotice}</p>
              </div>
            )}

            <div className="mt-4 flex gap-3 rounded-xl border border-slate-100 bg-slate-50/80 p-4">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-200">
                <Info className="h-3.5 w-3.5 text-slate-600" />
              </div>
              <p className="text-sm text-gray-600">
                <strong>Note :</strong> Les impressions sont estimées sur la semaine type des
                établissements éligibles, comme si la campagne était diffusée maintenant ; elles
                évoluent avec l’inventaire disponible et les éventuelles indisponibilités.
              </p>
            </div>
          </section>
        </div>
      </div>

      <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-5 py-3 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
        >
          <ArrowRight className="h-4 w-4 rotate-180" />
          Retour
        </button>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => void onSaveDraft()}
            disabled={!canAct}
            className="flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 transition-all hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{saving ? 'Enregistrement…' : 'Enregistrer'}</span>
          </button>
          {/* CF-C1 — the wizard's final action: queue in the panier; the launch lives on the
              cart page (« Confirmer et lancer »). */}
          <PillButton
            onClick={() => void onSubmit()}
            disabled={!canAct}
            loading={submitting}
            icon={<ShoppingCart className="h-4 w-4" />}
          >
            {submitting ? 'Ajout…' : 'Ajouter au panier'}
          </PillButton>
        </div>
      </div>
    </div>
  );
}
