import { ArrowRight, Info, Loader2, Send } from 'lucide-react';

interface StepCartProps {
  requestedBudget: number | null;
  setRequestedBudget: (value: number | null) => void;
  onBack: () => void;
  onSubmit: () => void | Promise<void>;
  submitting: boolean;
}

/**
 * Cart step of the de-Supabase wizard (interim manual cart). Collects a single advertiser-facing
 * INDICATIVE budget (TND) — NOT the engine inputs (i_cible/cpm/s/t, which the admin derives at
 * activation). On submit the orchestrator PATCHes requested_budget onto the draft and POSTs
 * /:id/submit (draft → pending). L-price later replaces this field with the real cursor.
 */
export default function StepCart({
  requestedBudget,
  setRequestedBudget,
  onBack,
  onSubmit,
  submitting,
}: StepCartProps) {
  const handleChange = (raw: string) => {
    if (raw.trim() === '') {
      setRequestedBudget(null);
      return;
    }
    const value = Number(raw);
    setRequestedBudget(Number.isFinite(value) ? value : null);
  };

  const canSubmit = !submitting && requestedBudget != null && requestedBudget > 0;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-[#00263A]">Budget & validation</h2>
          <p className="text-gray-600 mt-1">Indiquez le budget souhaité pour votre campagne</p>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label htmlFor="cart-budget" className="block text-sm font-medium text-gray-700 mb-2">
              Budget indicatif (TND) <span className="text-red-500">*</span>
            </label>
            <div className="relative max-w-xs">
              <input
                id="cart-budget"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={requestedBudget ?? ''}
                onChange={(e) => handleChange(e.target.value)}
                className="w-full px-4 py-3 pr-16 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-all"
                placeholder="0.00"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400">
                TND
              </span>
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
