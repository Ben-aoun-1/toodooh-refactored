import { AlertCircle, ArrowRight, Calendar, Crosshair, Megaphone, Monitor } from 'lucide-react';
import { useState } from 'react';

import PillButton from '@/components/PillButton';
import StepSectionHeading from '@/features/campaigns/pages/new-campaign/StepSectionHeading';

interface StepBasicsProps {
  campaignName: string;
  setCampaignName: (value: string) => void;
  /** Wraps the create-early + advance; awaited so the button can show the pending state. */
  onNext: () => void | Promise<void>;
  /** True while the create-early POST is in flight (disables Suivant). */
  creating: boolean;
}

/**
 * « Nom et type » step (CF-W1, spec §1.2): campaign name + the Type de diffusion chips. The chips
 * are UI-ONLY — Réseau Toodooh is the active, LOCKED choice; Parc TV is grayed, non-clickable
 * (later phase). Nothing is persisted for them (campaign_type stays reserved for standard/event).
 * Dates moved to the dedicated Période step. Leaving this step still creates the draft
 * (POST /api/campaigns, date-less), so `onNext` is async and `creating` guards the button.
 */
export default function StepBasics({
  campaignName,
  setCampaignName,
  onNext,
  creating,
}: StepBasicsProps) {
  const [nameError, setNameError] = useState('');
  const [nameTouched, setNameTouched] = useState(false);

  const validateAndSurface = (): boolean => {
    const nErr = campaignName.trim() === '' ? 'Le nom de la campagne est obligatoire' : '';
    setNameTouched(true);
    setNameError(nErr);
    return !nErr;
  };

  const handleNext = () => {
    if (!validateAndSurface()) return;
    void onNext();
  };

  const nextDisabled = creating || !campaignName.trim();

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="p-6 border-b border-gray-200">
          <StepSectionHeading
            icon={Megaphone}
            title="Nom et type"
            subtitle="Nommez votre campagne et choisissez son type de diffusion"
          />
        </div>
        <div className="p-6 space-y-6">
          <div>
            <label
              htmlFor="basics-campaign-name"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Nom <span className="text-red-500">*</span>
            </label>
            <input
              id="basics-campaign-name"
              type="text"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              onBlur={() => setNameTouched(true)}
              className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-all ${
                nameTouched && nameError ? 'border-red-300 bg-red-50' : 'border-gray-300'
              }`}
              placeholder="Nom de la campagne"
            />
            {nameTouched && nameError && (
              <p className="mt-1 text-sm text-red-600 flex items-center">
                <AlertCircle className="h-4 w-4 mr-1" />
                {nameError}
              </p>
            )}
          </div>

          {/* CF-W1 — Type de diffusion, UI-only (the CampaignDrawer chip idiom): Réseau Toodooh
              locked ACTIVE, Parc TV grayed non-clickable. Nothing persisted (campaign_type stays
              reserved for standard/event). */}
          <div>
            <span className="block text-sm font-medium text-gray-700 mb-2">Type de diffusion</span>
            <div className="flex gap-3" role="radiogroup" aria-label="Type de diffusion">
              <div
                className="flex-1 flex items-center gap-3 p-3 rounded-xl bg-white border border-brand-primary"
                style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                role="radio"
                aria-checked="true"
                tabIndex={-1}
                id="basics-type-reseau"
              >
                <div className="w-10 h-10 rounded-lg bg-[#DCF0E9] flex items-center justify-center shrink-0">
                  <Crosshair className="h-5 w-5 text-[#142522]" />
                </div>
                <div>
                  <span className="block text-sm font-medium text-[#171717]">Réseau Toodooh</span>
                  <span className="block text-xs text-[#5C5C5C]">
                    Diffusion sur les écrans du réseau
                  </span>
                </div>
              </div>
              <div
                className="flex-1 flex items-center gap-3 p-3 rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] cursor-not-allowed"
                style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                role="radio"
                aria-checked="false"
                aria-disabled="true"
                tabIndex={-1}
                id="basics-type-parctv"
              >
                <div className="w-10 h-10 rounded-lg border border-[#EBEBEB] flex items-center justify-center shrink-0">
                  <Monitor className="h-5 w-5 text-[#D1D1D1]" />
                </div>
                <div>
                  <span className="block text-sm font-medium text-[#D1D1D1]">Parc TV</span>
                  <span className="block text-xs text-[#D1D1D1]">Bientôt disponible</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end items-center">
        <PillButton
          onClick={handleNext}
          disabled={nextDisabled}
          loading={creating}
          icon={<Calendar className="h-4 w-4" />}
          trailingIcon={<ArrowRight className="h-4 w-4" />}
        >
          {creating ? 'Création…' : 'Suivant'}
        </PillButton>
      </div>
    </div>
  );
}
