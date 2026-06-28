import { ArrowRight, Info, Loader2, Send } from 'lucide-react';

import {
  CART_BUDGET_DEFAULT_TND,
  CART_BUDGET_MAX_TND,
  CART_BUDGET_MIN_TND,
  CART_BUDGET_STEP_TND,
} from '@/features/campaigns/hooks/new-campaign/cart-budget';

interface StepCartProps {
  requestedBudget: number | null;
  setRequestedBudget: (value: number | null) => void;
  onBack: () => void;
  onSubmit: () => void | Promise<void>;
  submitting: boolean;
}

const tnd = new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 });

/**
 * Cart step of the de-Supabase wizard (interim manual cart). Collects a single advertiser-facing
 * INDICATIVE budget (TND) via a 0–5000 SLIDER defaulting to its MAX — NOT the engine inputs
 * (i_cible/cpm/s/t, which the admin derives at activation). On submit the orchestrator PATCHes
 * requested_budget onto the draft and POSTs /:id/submit (draft → pending). L-price later replaces
 * this slider with the real cursor (computed min/max + impressions preview).
 */
export default function StepCart({
  requestedBudget,
  setRequestedBudget,
  onBack,
  onSubmit,
  submitting,
}: StepCartProps) {
  // Controlled slider. A null budget (an old draft loaded without one) renders at the default MAX
  // position; the wizard seeds the state to MAX so submit works without the advertiser touching it.
  const value = requestedBudget ?? CART_BUDGET_DEFAULT_TND;
  const canSubmit = !submitting && value > 0;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-[#00263A]">Budget &amp; validation</h2>
          <p className="text-gray-600 mt-1">Ajustez le budget souhaité pour votre campagne</p>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label htmlFor="cart-budget" className="block text-sm font-medium text-gray-700 mb-3">
              Budget indicatif (TND) <span className="text-red-500">*</span>
            </label>

            <div className="text-center mb-4">
              <span className="text-3xl font-bold text-brand-deep">{tnd.format(value)}</span>
              <span className="ml-1 text-base font-medium text-gray-400">TND</span>
            </div>

            <input
              id="cart-budget"
              type="range"
              min={CART_BUDGET_MIN_TND}
              max={CART_BUDGET_MAX_TND}
              step={CART_BUDGET_STEP_TND}
              value={value}
              onChange={(e) => setRequestedBudget(Number(e.target.value))}
              aria-valuetext={`${tnd.format(value)} TND`}
              className="w-full accent-brand-primary cursor-pointer"
            />
            <div className="mt-1 flex justify-between text-xs text-gray-400">
              <span>{tnd.format(CART_BUDGET_MIN_TND)} TND</span>
              <span>{tnd.format(CART_BUDGET_MAX_TND)} TND</span>
            </div>
          </div>

          <div className="flex gap-3 p-4 rounded-xl bg-slate-50/80 border border-slate-100">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center">
              <Info className="w-3.5 h-3.5 text-slate-600" />
            </div>
            <p className="text-sm text-gray-600">
              Ce montant est <strong>indicatif</strong> ; la tarification finale est confirmée lors
              de la revue de votre campagne par notre équipe.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-all text-sm font-medium"
        >
          <ArrowRight className="h-4 w-4 rotate-180" />
          Retour
        </button>
        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={!canSubmit}
          className={`px-6 py-3 rounded-xl font-semibold transition-all flex items-center space-x-2 shadow-lg ${
            !canSubmit
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-brand-primary to-brand-deep text-white hover:from-brand-primary/90 hover:to-brand-deep'
          }`}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          <span>{submitting ? 'Envoi…' : 'Soumettre la campagne'}</span>
        </button>
      </div>
    </div>
  );
}
