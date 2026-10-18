import { QrCode } from 'lucide-react';

import { useCampaignCta } from '@/features/campaigns/hooks/useCampaignCta';
import { ctaScansLabel } from '@/features/campaigns/lib/spot-cta';

/** QR-CTA1 — the campaign's QR link and its scan count (nothing when the spot has no QR). */
export default function CampaignCtaScans({ campaignId }: { campaignId: string }) {
  const cta = useCampaignCta(campaignId);
  if (!cta.data?.url) return null;
  return (
    <div className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm">
      <QrCode className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-deep" />
      <div className="min-w-0">
        <p className="font-semibold text-gray-900">{ctaScansLabel(cta.data.scans)}</p>
        <p className="truncate text-gray-600">{cta.data.url}</p>
      </div>
    </div>
  );
}
