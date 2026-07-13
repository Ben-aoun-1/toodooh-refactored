import { ArrowRight, Target } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'react-hot-toast';

import {
  CampaignTargetingPanel,
  type CampaignTargetingPanelHandle,
} from '@/features/campaigns/targeting/components/CampaignTargetingPanel';

interface StepTargetingProps {
  /** The create-early draft id. The panel persists lines (replace-set PUT) against it. */
  draftCampaignId: string | null;
  onNext: () => void | Promise<void>;
  onBack: () => void;
}

/**
 * Targeting step of the de-Supabase wizard. Mounts CampaignTargetingPanel on the create-early draft
 * id (category × class lines, persisted independently by the panel). Targeting is optional — the
 * wizard footer always allows advancing, but Suivant FLUSHES dirty edits first (CF-Q1: they used
 * to be silently lost) and a save failure blocks the advance.
 */
export default function StepTargeting({ draftCampaignId, onNext, onBack }: StepTargetingProps) {
  const panelRef = useRef<CampaignTargetingPanelHandle>(null);

  const handleNext = async () => {
    const flushed = (await panelRef.current?.flush()) ?? true;
    if (!flushed) {
      toast.error("Échec de l'enregistrement du ciblage");
      return;
    }
    await onNext();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-gradient-to-r from-brand-primary to-brand-deep">
              <Target className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#00263A]">Ciblage</h2>
              <p className="text-gray-600">
                Choisissez les catégories et classes d’écrans à cibler
              </p>
            </div>
          </div>
        </div>
        <div className="p-6">
          <CampaignTargetingPanel ref={panelRef} campaignId={draftCampaignId} />
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
          onClick={() => void handleNext()}
          className="px-6 py-3 rounded-xl font-semibold transition-all flex items-center space-x-2 shadow-lg bg-gradient-to-r from-brand-primary to-brand-deep text-white hover:from-brand-primary/90 hover:to-brand-deep"
        >
          <span>Suivant</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
