import { AlertCircle, ArrowRight, Check, Info, Monitor } from 'lucide-react';
import { useState } from 'react';

import type { ParcTV } from '@/features/campaigns/hooks/new-campaign/wizard-types';

interface Step2Props {
  // Branch selector
  diffusionType: 'toodooh' | 'parc_tv';

  // Toodooh-mode props
  categoryChoices: string[];
  selectedCategories: string[];
  setSelectedCategories: (next: string[] | ((prev: string[]) => string[])) => void;
  shouldShowClientField: boolean;
  client: string;
  setClient: (value: string) => void;

  // Parc-TV-mode props
  availableParcs: ParcTV[];
  loadingParcs: boolean;
  selectedParcIds: string[];
  setSelectedParcIds: (next: string[] | ((prev: string[]) => string[])) => void;

  // Navigation
  onNext: () => boolean;
  onBack: () => void;
}

// Mirror of NewCampaign.tsx validateField('client', ...) — 2-char minimum.
function validateClientLocal(client: string): string {
  if (!client.trim()) return 'Le nom du client est obligatoire';
  if (client.trim().length < 2) return 'Le nom du client doit contenir au moins 2 caractères';
  return '';
}

/**
 * Step 2 of the standard advertiser campaign wizard: category selection
 * (toodooh diffusion) OR parc selection (parc_tv diffusion). Both modes
 * share the same outer card shell; only the title, subtitle, and body
 * differ. Renders its own Suivant + Back footer and owns local field-
 * error UX (errors / touched).
 *
 * Extracted from NewCampaign.tsx (formerly lines ~2005–2153).
 */
export default function Step2({
  diffusionType,
  categoryChoices,
  selectedCategories,
  setSelectedCategories,
  shouldShowClientField,
  client,
  setClient,
  availableParcs,
  loadingParcs,
  selectedParcIds,
  setSelectedParcIds,
  onNext,
  onBack,
}: Step2Props) {
  const [errors, setErrors] = useState<{
    categories?: string;
    client?: string;
    parcs?: string;
  }>({});
  const [touched, setTouched] = useState<{ categories?: boolean; client?: boolean }>({});

  const handleCategoriesToggle = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category],
    );
    setTouched((t) => ({ ...t, categories: true }));
  };

  const handleParcToggle = (ownerId: string) => {
    setSelectedParcIds((prev) =>
      prev.includes(ownerId) ? prev.filter((id) => id !== ownerId) : [...prev, ownerId],
    );
  };

  const validateAndSurface = (): boolean => {
    if (diffusionType === 'parc_tv') {
      const parcErr = selectedParcIds.length === 0 ? 'Sélectionnez au moins un parc' : '';
      setErrors({ parcs: parcErr });
      return !parcErr;
    }
    const catErr = selectedCategories.length === 0 ? 'Sélectionnez au moins une catégorie' : '';
    const clientErr = shouldShowClientField ? validateClientLocal(client) : '';
    setTouched({ categories: true, client: shouldShowClientField });
    setErrors({ categories: catErr, client: clientErr });
    return !catErr && !clientErr;
  };

  const handleNext = () => {
    if (!validateAndSurface()) return;
    onNext();
  };

  const title = diffusionType === 'parc_tv' ? 'Parcs disponibles' : 'Catégories';
  const subtitle = 'Définissez votre ciblage thématique';

  const nextDisabled =
    diffusionType === 'parc_tv'
      ? selectedParcIds.length === 0
      : selectedCategories.length === 0 || (shouldShowClientField && !client.trim());

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          <p className="text-gray-600 mt-1">{subtitle}</p>
        </div>
        <div className="p-6 space-y-6">
          {diffusionType === 'parc_tv' ? (
            <>
              {loadingParcs ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" />
                </div>
              ) : availableParcs.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Monitor className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p>Aucun parc disponible pour le moment</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {availableParcs.map((parc) => {
                    const isSelected = selectedParcIds.includes(parc.ownerId);
                    return (
                      <button
                        key={parc.ownerId}
                        type="button"
                        onClick={() => handleParcToggle(parc.ownerId)}
                        className={`relative flex items-center gap-3 w-full px-4 py-4 rounded-xl border-2 text-left transition-all ${
                          isSelected
                            ? 'border-[#76E6AB] bg-[#76E6AB]/5'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="w-12 h-12 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {parc.logo ? (
                            <img
                              src={parc.logo}
                              alt={parc.name}
                              className="w-10 h-10 object-contain"
                            />
                          ) : (
                            <Monitor className="h-6 w-6 text-gray-400" />
                          )}
                        </div>
                        <span className="text-sm font-medium text-gray-900">{parc.name}</span>
                        <div
                          className={`absolute top-3 right-3 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${
                            isSelected ? 'bg-[#76E6AB]' : 'border-2 border-gray-300 bg-white'
                          }`}
                        >
                          {isSelected && (
                            <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {errors.parcs && (
                <p className="text-sm text-red-600 flex items-center">
                  <AlertCircle className="h-4 w-4 mr-1" />
                  {errors.parcs}
                </p>
              )}
            </>
          ) : (
            <>
              <div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {categoryChoices.map((category) => {
                    const isSelected = selectedCategories.includes(category);
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => handleCategoriesToggle(category)}
                        className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg border-2 text-left transition-all ${
                          isSelected
                            ? 'border-brand-primary bg-brand-primary/5'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div
                          className={`flex-shrink-0 w-5 h-5 rounded flex items-center justify-center ${
                            isSelected ? 'bg-brand-primary' : 'border-2 border-gray-300 bg-white'
                          }`}
                        >
                          {isSelected && (
                            <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                          )}
                        </div>
                        <span className="text-sm font-medium text-gray-900">{category}</span>
                      </button>
                    );
                  })}
                </div>
                {touched.categories && errors.categories && (
                  <p className="mt-2 text-sm text-red-600 flex items-center">
                    <AlertCircle className="h-4 w-4 mr-1" />
                    {errors.categories}
                  </p>
                )}
                {selectedCategories.length > 0 && (
                  <div className="mt-4 flex items-center gap-3 px-4 py-3 bg-gray-100 rounded-lg">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-400 flex items-center justify-center">
                      <Info className="h-3.5 w-3.5 text-white" />
                    </div>
                    <p className="text-sm text-gray-600">
                      Vous avez sélectionné {selectedCategories.length} catégorie(s). Plus votre
                      ciblage est large, plus vous augmentez votre portée.
                    </p>
                  </div>
                )}
              </div>
              {shouldShowClientField && (
                <div>
                  <label
                    htmlFor="step2-client"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    Client <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="step2-client"
                    type="text"
                    value={client}
                    onChange={(e) => setClient(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, client: true }))}
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-all ${
                      touched.client && errors.client
                        ? 'border-red-300 bg-red-50'
                        : 'border-gray-300'
                    }`}
                    placeholder="Nom du client"
                  />
                  {touched.client && errors.client && (
                    <p className="mt-1 text-sm text-red-600 flex items-center">
                      <AlertCircle className="h-4 w-4 mr-1" />
                      {errors.client}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
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
