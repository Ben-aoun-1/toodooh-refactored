import { AlertCircle, ArrowRight, CheckCircle, Target } from 'lucide-react';
import { useState } from 'react';

interface Step1NameTypeProps {
  campaignName: string;
  diffusionType: 'toodooh' | 'parc_tv';
  setCampaignName: (value: string) => void;
  setDiffusionType: (value: 'toodooh' | 'parc_tv') => void;
  /** Wraps wiz.nextStep(); returns the boolean it returned. */
  onNext: () => boolean;
  /** True when no prior step exists (Back button suppressed). */
  isFirst: boolean;
}

/**
 * Step 1 of the standard advertiser campaign wizard: campaign name +
 * diffusion type. Owns its own field-error UX (errors/touched local state)
 * so that on a failed `onNext` it can surface field-level feedback without
 * relying on parent error state.
 *
 * Extracted from NewCampaign.tsx (formerly lines ~1875–1953).
 */
export default function Step1NameType({
  campaignName,
  diffusionType,
  setCampaignName,
  setDiffusionType,
  onNext,
  isFirst: _isFirst,
}: Step1NameTypeProps) {
  const [errors, setErrors] = useState<{ campaignName?: string }>({});
  const [touched, setTouched] = useState<{ campaignName?: boolean }>({});

  const validateAndSurface = (): boolean => {
    const err = campaignName.trim() === '' ? 'Le nom de la campagne est obligatoire' : '';
    setTouched({ campaignName: true });
    setErrors({ campaignName: err });
    return !err && Boolean(diffusionType);
  };

  const handleNext = () => {
    if (!validateAndSurface()) return;
    onNext();
  };

  const nextDisabled = !campaignName.trim() || !diffusionType;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-[#00263A]">Informations de base</h2>
          <p className="text-gray-600 mt-1">Définissez les détails de votre campagne</p>
        </div>
        <div className="p-6 space-y-6">
          <div>
            <label
              htmlFor="step1-campaign-name"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Nom <span className="text-red-500">*</span>
            </label>
            <input
              id="step1-campaign-name"
              type="text"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              onBlur={() => setTouched({ campaignName: true })}
              className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-all ${
                touched.campaignName && errors.campaignName
                  ? 'border-red-300 bg-red-50'
                  : 'border-gray-300'
              }`}
              placeholder="Nom"
            />
            {touched.campaignName && errors.campaignName && (
              <p className="mt-1 text-sm text-red-600 flex items-center">
                <AlertCircle className="h-4 w-4 mr-1" />
                {errors.campaignName}
              </p>
            )}
          </div>

          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Type de diffusion</h3>
            <p className="text-sm text-gray-600 mb-4">
              Choisissez le réseau sur lequel votre spot publicitaire sera diffusé
            </p>
            <div className="grid grid-cols-1 gap-4">
              <button
                type="button"
                onClick={() => setDiffusionType('toodooh')}
                className={`relative text-left p-5 rounded-xl border-2 transition-all ${
                  diffusionType === 'toodooh'
                    ? 'border-brand-primary bg-brand-primary/5'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                {diffusionType === 'toodooh' ? (
                  <div className="absolute top-4 right-4 w-6 h-6 rounded-full bg-brand-primary flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 text-white" />
                  </div>
                ) : (
                  <div className="absolute top-4 right-4 w-6 h-6 rounded-full border-2 border-gray-300" />
                )}
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <Target className="h-6 w-6 text-gray-700" />
                  </div>
                  <div>
                    <span className="font-semibold text-gray-900">Réseau Toodooh</span>
                    <p className="text-sm text-gray-600 mt-0.5">
                      Écrans digitaux en extérieur (DOOH)
                    </p>
                  </div>
                </div>
                <div className="border-t border-gray-200 my-3" />
                <p className="text-xs font-medium text-gray-600 mb-1">Avantages:</p>
                <ul className="text-sm text-gray-600 space-y-0.5 list-disc list-inside">
                  <li>Large couverture urbaine</li>
                  <li>Flexibilité des créneaux</li>
                  <li>Ciblage géographique précis</li>
                </ul>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end items-center">
        <button
          type="button"
          onClick={handleNext}
          disabled={nextDisabled}
          className={`px-6 py-3 rounded-xl font-semibold transition-all flex items-center space-x-2 shadow-lg ${
            nextDisabled
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-brand-primary to-[#00D4C4] text-white hover:from-[#00A396] hover:to-[#00C4B4]'
          }`}
        >
          <span>Suivant</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
