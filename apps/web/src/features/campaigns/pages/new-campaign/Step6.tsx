import { ArrowRight, Check, DollarSign, Info, Monitor, Target, TrendingUp } from 'lucide-react';

import type { ParcTV, WizardState } from '@/features/campaigns/hooks/new-campaign/wizard-types';
import { zonesAreaKm2 } from '@/features/campaigns/lib/wizard-zones';

import type { ApprovedVideo } from './Step5';

interface Step6Props {
  // Wizard state, read-only (Step 6 reads ~14 fields)
  wizardState: WizardState;
  // Slider setters (the only writes)
  setAdjustedBudget: (next: number | ((prev: number) => number)) => void;
  setCustomMinBudget: (next: number | null | ((prev: number | null) => number | null)) => void;
  setCustomMaxBudget: (next: number | null | ((prev: number | null) => number | null)) => void;
  // Server-derived / parent-owned context
  isEventCampaign: boolean;
  availableParcs: ParcTV[];
  selectedParcIds: string[];
  cpmTnd: number;
  maxImpressionsFromSelection: number;
  impressionsForCurrentBudget: number;
  doohEstimateLoading: boolean;
  doohEstimateError: string | null;
  selectedExistingVideo: ApprovedVideo | null;
  nbJours: number;
  // Save / AddToCart action plumbing (parent owns the handlers)
  onBack: () => void;
  onSaveDraft: () => Promise<void>;
  onAddToCart: () => Promise<void>;
  canFinalize: boolean;
  addingToCart: boolean;
}

const BUDGET_MIN = 0;

/**
 * Step 6 of the standard advertiser campaign wizard (also Step 3 in the
 * event-campaign flow): the Validation step. Two-column layout — left is
 * the Récapitulatif (read-only summary of every previous step's data),
 * right is "Ajuster votre impact" (budget slider + min/max number inputs
 * that drive adjustedBudget / customMinBudget / customMaxBudget in
 * WizardState). The footer hosts Retour + Enregistrer + Ajouter au panier.
 *
 * Departure from the narrow-prop pattern (Decision F revision): Step 6
 * reads ~14 fields from WizardState, so the entire `wizardState` object
 * is passed as a single read-only prop. Slider setters and action
 * handlers stay narrow.
 *
 * Save and AddToCart logic stays in the parent (NewCampaign.tsx) per
 * Path B (Issue #20). The 170-line inline AddToCart handler keeps its
 * production behavior (custom insufficient-balance toast, auto-nav to
 * /my-recharges, content_validation_status update, link_campaign_to_event
 * RPC, recommended-events preload, showPostCartStep trigger) untouched.
 *
 * Extracted from NewCampaign.tsx (formerly lines ~1464-1827 JSX block
 * plus the Save + AddToCart buttons from the parent footer at ~2010-2210).
 */
export default function Step6({
  wizardState,
  setAdjustedBudget,
  setCustomMinBudget,
  setCustomMaxBudget,
  isEventCampaign,
  availableParcs,
  selectedParcIds,
  cpmTnd,
  maxImpressionsFromSelection,
  impressionsForCurrentBudget,
  doohEstimateLoading,
  doohEstimateError,
  selectedExistingVideo,
  nbJours,
  onBack,
  onSaveDraft,
  onAddToCart,
  canFinalize,
  addingToCart,
}: Step6Props) {
  const {
    campaignName,
    diffusionType,
    categories,
    startDate: startDateIso,
    endDate: endDateIso,
    geographicZones,
    uploadedVideoUrl,
    adjustedBudget,
    customMinBudget,
    customMaxBudget,
  } = wizardState;

  const startDate = startDateIso ? new Date(startDateIso) : null;
  const endDate = endDateIso ? new Date(endDateIso) : null;
  const hasSelection = maxImpressionsFromSelection > 0;
  const defaultMaxAmount = hasSelection ? (maxImpressionsFromSelection / 1000) * cpmTnd : 0;
  const defaultMinAmount = hasSelection ? BUDGET_MIN : 0;
  const effectiveMin = customMinBudget !== null ? customMinBudget : defaultMinAmount;
  const effectiveMax = customMaxBudget !== null ? customMaxBudget : defaultMaxAmount;
  const safeMin = hasSelection ? Math.min(effectiveMin, effectiveMax - 1) : 0;
  const safeMax = hasSelection ? Math.max(effectiveMax, safeMin + 1) : 0;
  const rangeMin = safeMin;
  const rangeMax = safeMax;
  const currentAmount = hasSelection ? Math.max(rangeMin, Math.min(rangeMax, adjustedBudget)) : 0;
  const percentage =
    rangeMax > rangeMin ? ((currentAmount - rangeMin) / (rangeMax - rangeMin)) * 100 : 100;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Validation</h2>
          <p className="text-sm text-gray-500">Vérifiez et confirmez votre campagne</p>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* ── Left: Récapitulatif ── */}
            <div className="border border-gray-200 rounded-xl p-5 space-y-5">
              <h3 className="text-base font-bold text-gray-900">Récapitulatif</h3>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Nom de la campagne</p>
                <p className="text-sm font-semibold text-gray-900">{campaignName || '—'}</p>
              </div>

              {!isEventCampaign && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Type de la campagne</p>
                  <div className="flex gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${diffusionType === 'toodooh' ? 'border-[#76E6AB] bg-[#76E6AB]/5 text-gray-900' : 'border-gray-200 text-gray-400'}`}
                    >
                      <Target className="h-3.5 w-3.5" /> Réseau Toodooh
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${diffusionType === 'parc_tv' ? 'border-[#76E6AB] bg-[#76E6AB]/5 text-gray-900' : 'border-gray-200 text-gray-400'}`}
                    >
                      <Monitor className="h-3.5 w-3.5" /> Parc TV
                    </span>
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">
                  {diffusionType === 'parc_tv' ? 'Parc(s)' : 'Catégorie(s)'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {diffusionType === 'parc_tv' ? (
                    selectedParcIds.length > 0 ? (
                      availableParcs
                        .filter((p) => selectedParcIds.includes(p.ownerId))
                        .map((p) => (
                          <span
                            key={p.ownerId}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#76E6AB] bg-[#76E6AB]/5 text-xs font-medium text-gray-900"
                          >
                            {p.logo && (
                              <img src={p.logo} alt="" className="w-5 h-5 object-contain" />
                            )}
                            {p.name}
                            <Check className="h-3 w-3 text-[#76E6AB]" />
                          </span>
                        ))
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )
                  ) : categories.length > 0 ? (
                    categories.map((c) => (
                      <span
                        key={c}
                        className="px-3 py-1 rounded-lg border border-gray-200 text-xs font-medium text-gray-700"
                      >
                        {c}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Période</p>
                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-900">
                  <span>
                    Début: <strong>{startDate?.toLocaleDateString('fr-FR') || '—'}</strong>
                  </span>
                  <span>
                    Fin: <strong>{endDate?.toLocaleDateString('fr-FR') || '—'}</strong>
                  </span>
                  <span>
                    Durée:{' '}
                    <strong>
                      {nbJours > 0 ? `${nbJours} jour${nbJours > 1 ? 's' : ''}` : '—'}
                    </strong>
                  </span>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Zones géographiques</p>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-900">
                  <span>
                    Nombre de zones : <strong>{geographicZones.length}</strong>
                  </span>
                  <span>
                    Zone couverte : <strong>{zonesAreaKm2(geographicZones).toFixed(1)} km²</strong>
                  </span>
                  {maxImpressionsFromSelection > 0 && (
                    <span>
                      Plan max (impressions) :{' '}
                      <strong>{maxImpressionsFromSelection.toLocaleString('fr-FR')}</strong>
                    </span>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Spot</p>
                {uploadedVideoUrl || selectedExistingVideo ? (
                  <div className="rounded-xl overflow-hidden border border-gray-200 bg-black aspect-video relative">
                    <video
                      src={uploadedVideoUrl || selectedExistingVideo?.url || ''}
                      className="w-full h-full object-cover"
                      controls
                    >
                      {/* Empty caption track — satisfies jsx-a11y/media-has-caption
                          for advertiser-uploaded media that has no caption file. */}
                      <track kind="captions" />
                    </video>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 flex items-end justify-between pointer-events-none">
                      <span className="text-white text-xs font-medium">Spot publicitaire</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">Aucune vidéo sélectionnée</p>
                )}
              </div>
            </div>

            {/* ── Right: Ajuster votre impact ── */}
            <div className="space-y-5">
              <div>
                <h3 className="text-base font-bold text-gray-900">Ajuster votre impact</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Déplacez le curseur pour ajuster votre budget et vos impressions estimées
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div
                  className="border border-[#eef7f1] rounded-xl p-4"
                  style={{ backgroundColor: '#f5fcf7' }}
                >
                  <div className="mb-1">
                    <div className="w-8 h-8 rounded-full bg-white/80 flex items-center justify-center mb-2">
                      <DollarSign className="h-4 w-4 text-gray-400" />
                    </div>
                    <span className="block text-xs text-gray-500 font-medium">Montant estimé</span>
                  </div>
                  <p className="text-lg font-bold" style={{ color: '#355f43' }}>
                    {hasSelection
                      ? adjustedBudget.toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })
                      : '0,00'}{' '}
                    TND
                  </p>
                </div>
                <div
                  className="border border-[#e7e9fb] rounded-xl p-4"
                  style={{ backgroundColor: '#f0f1fd' }}
                >
                  <div className="mb-1">
                    <div className="w-8 h-8 rounded-full bg-white/80 flex items-center justify-center mb-2">
                      <TrendingUp className="h-4 w-4 text-gray-400" />
                    </div>
                    <span className="block text-xs text-gray-500 font-medium">
                      Plan final (impressions)
                    </span>
                  </div>
                  <p className="text-lg font-bold" style={{ color: '#3d438f' }}>
                    {hasSelection ? impressionsForCurrentBudget.toLocaleString('fr-FR') : '0'}
                  </p>
                </div>
              </div>

              {/* Budget slider */}
              <div className="border border-gray-200 rounded-xl p-5 space-y-4">
                {!hasSelection && (
                  <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    Aucune capacité estimée : ajoutez des zones avec des localités (ou des parcs TV)
                    et des dates de campagne. Le plafond suit le moteur DOOH horaire (affluence ×
                    répétitions autorisées par créneau, selon la configuration globale et la durée
                    du spot).
                  </p>
                )}
                {doohEstimateLoading && hasSelection && (
                  <p className="text-xs text-gray-500">Mise à jour de l&apos;estimation DOOH…</p>
                )}
                {doohEstimateError && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {doohEstimateError}
                  </p>
                )}
                <p className="text-center text-2xl font-bold text-gray-900">
                  {currentAmount.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  TND
                </p>

                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>
                    MIN: {rangeMin.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} TND
                  </span>
                  <span>
                    MAX: {rangeMax.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} TND
                  </span>
                </div>

                <input
                  type="range"
                  min={rangeMin}
                  max={rangeMax}
                  step="any"
                  value={currentAmount}
                  onChange={(e) => {
                    const v = Math.max(rangeMin, Math.min(rangeMax, Number(e.target.value)));
                    setAdjustedBudget(v);
                  }}
                  onInput={(e) => {
                    const v = Math.max(
                      rangeMin,
                      Math.min(rangeMax, Number((e.target as HTMLInputElement).value)),
                    );
                    setAdjustedBudget(v);
                  }}
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#76E6AB]"
                  style={{
                    background: `linear-gradient(to right, #76E6AB 0%, #76E6AB ${percentage}%, #e5e7eb ${percentage}%, #e5e7eb 100%)`,
                  }}
                />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="step6-min-budget" className="block text-xs text-gray-500 mb-1">
                      Montant minimum (TND)
                    </label>
                    <input
                      id="step6-min-budget"
                      type="number"
                      value={customMinBudget !== null ? customMinBudget : ''}
                      onChange={(e) => {
                        const val = e.target.value ? Number(e.target.value) : null;
                        setCustomMinBudget(val);
                        if (val !== null && adjustedBudget < val) setAdjustedBudget(val);
                      }}
                      placeholder={`Min: ${rangeMin.toFixed(2)} TND`}
                      min={0}
                      step={50}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#76E6AB]/40 focus:border-[#76E6AB]"
                    />
                  </div>
                  <div>
                    <label htmlFor="step6-max-budget" className="block text-xs text-gray-500 mb-1">
                      Montant maximum (TND)
                    </label>
                    <input
                      id="step6-max-budget"
                      type="number"
                      value={customMaxBudget !== null ? customMaxBudget : ''}
                      onChange={(e) => {
                        const val = e.target.value ? Number(e.target.value) : null;
                        setCustomMaxBudget(val);
                        if (val !== null && adjustedBudget > val) setAdjustedBudget(val);
                      }}
                      placeholder={`Max: ${rangeMax.toFixed(2)} TND`}
                      min={0}
                      step={50}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#76E6AB]/40 focus:border-[#76E6AB]"
                    />
                  </div>
                </div>
              </div>

              {/* Note */}
              <div className="flex gap-2.5 p-4 bg-gray-50 rounded-xl border border-gray-200">
                <Info className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-500 leading-relaxed">
                  <strong className="text-gray-600">Note:</strong> Le curseur ajuste le plan final
                  après le calcul du plan max. Le plan final (budget + impressions + répétitions
                  horaires) devient la référence officielle soumise aux propriétaires et injectée en
                  planification horaire.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer — Retour + Enregistrer + Ajouter au panier */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-all text-sm font-medium"
        >
          <ArrowRight className="h-4 w-4 rotate-180" />
          Retour
        </button>

        <div className="flex flex-col items-end gap-2">
          {!canFinalize && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              La campagne doit être supérieure à 0 dinar et à 0 impression pour pouvoir être
              validée.
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void onSaveDraft();
              }}
              className="px-5 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-all text-sm font-medium"
            >
              Enregistrer
            </button>
            <button
              type="button"
              disabled={addingToCart || !canFinalize}
              onClick={() => {
                void onAddToCart();
              }}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm text-white shadow-lg transition-all hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: '#76E6AB' }}
            >
              <span>{addingToCart ? 'Ajout en cours...' : 'Ajouter au panier'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
