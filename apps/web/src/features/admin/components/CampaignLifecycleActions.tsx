import CampaignDeleteButton from '@/features/admin/components/CampaignDeleteButton';
import CampaignStopButton from '@/features/admin/components/CampaignStopButton';

/**
 * The superadmin's end-of-life actions in the campaign review: « Arrêter » (STOP-1, a match
 * positioning too since Mariem 05/11), then « Supprimer » once stopped. Each button decides for
 * itself whether it shows (lib/campaign-stop).
 */
export default function CampaignLifecycleActions({
  campaign,
  onDone,
}: {
  campaign: {
    id: string;
    name: string;
    status: string;
    campaign_type: string;
    event_id: string | null;
    stopped_at?: string | null;
  };
  onDone: () => void;
}) {
  return (
    <>
      <CampaignStopButton campaign={campaign} onStopped={onDone} />
      <CampaignDeleteButton campaign={campaign} onDeleted={onDone} />
    </>
  );
}
