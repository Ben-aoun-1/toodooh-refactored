import { ArrowRight, ListChecks } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';

import PillButton from '@/components/PillButton';
import StepSectionHeading from '@/features/campaigns/pages/new-campaign/StepSectionHeading';
import {
  CampaignTargetingPanel,
  type CampaignTargetingPanelHandle,
} from '@/features/campaigns/targeting/components/CampaignTargetingPanel';

interface StepTargetingProps {
  /** The create-early draft id. The panel persists lines (replace-set PUT) against it. */
  draftCampaignId: string | null;
  onNext: () => void | Promise<void>;
  onBack: () => void;
  /** CF-W1 §1.8 — hands the panel's flush() to the orchestrator while this step is mounted, so
   * the header Enregistrer persists dirty targeting too. Called with null on unmount. */
  registerFlush?: (flush: (() => Promise<boolean>) | null) => void;
}

/**
 * Targeting step of the de-Supabase wizard. Mounts CampaignTargetingPanel on the create-early draft
 * id (category × class lines, persisted independently by the panel). Targeting is optional — the
 * wizard footer always allows advancing, but Suivant FLUSHES dirty edits first (CF-Q1: they used
 * to be silently lost) and a save failure blocks the advance.
 */
export default function StepTargeting({
  draftCampaignId,
  onNext,
  onBack,
  registerFlush,
}: StepTargetingProps) {
  const panelRef = useRef<CampaignTargetingPanelHandle>(null);

  useEffect(() => {
    registerFlush?.(() => panelRef.current?.flush() ?? Promise.resolve(true));
    return () => registerFlush?.(null);
  }, [registerFlush]);

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
          <StepSectionHeading
            icon={ListChecks}
            title="Catégories"
            subtitle="Choisissez les catégories de lieux à cibler"
          />
        </div>
        <div className="p-6">
          <CampaignTargetingPanel ref={panelRef} campaignId={draftCampaignId} categoryOnly />
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
        <PillButton
          onClick={() => void handleNext()}
          trailingIcon={<ArrowRight className="h-4 w-4" />}
        >
          Suivant
        </PillButton>
      </div>
    </div>
  );
}
