import { Crosshair, Monitor } from 'lucide-react';

import { sectorDisplayName } from '@/features/advertiser/constants/sector-display-name';
import AllocationSpotViewer from '@/features/screenhost/components/AllocationSpotViewer';
import DecisionSection, {
  DecisionChip,
} from '@/features/screenhost/components/decision/DecisionSection';
import { campaignDurationDays } from '@/features/screenhost/lib/decision-notifications';
import { fmtDate } from '@/features/screenhost/lib/owner-campaigns.lib';
import type { OwnerCampaign } from '@/features/screenhost/services/screenhost-campaigns.service';

/** Figma frame 588 — the campaign body: type, catégories, période, zones, spot. */
export default function CampaignDecisionDetails({ campaign }: { campaign: OwnerCampaign }) {
  const days = campaignDurationDays(campaign.start_date, campaign.end_date);
  // The spot is per campaign; the presign route is per allocation — any of the owner's rows works.
  const spotAllocation = campaign.allocations[0];

  return (
    <>
      <DecisionSection label="Type de la campagne">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-brand-primary bg-white p-1.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#DCF0E9]">
              <Crosshair className="h-5 w-5 text-[#142522]" />
            </div>
            <span className="text-xs text-[#171717]">Réseau Toodooh</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#EBEBEB] bg-[#F7F7F7] p-1.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#EBEBEB]">
              <Monitor className="h-5 w-5 text-[#D1D1D1]" />
            </div>
            <span className="text-xs text-[#D1D1D1]">Parc TV</span>
          </div>
        </div>
      </DecisionSection>

      <DecisionSection label="Catégorie(s)">
        <div className="flex flex-wrap gap-2">
          {campaign.categories.length === 0 ? (
            <DecisionChip>Toutes les catégories</DecisionChip>
          ) : (
            campaign.categories.map((name) => (
              <DecisionChip key={name}>{sectorDisplayName(name)}</DecisionChip>
            ))
          )}
        </div>
      </DecisionSection>

      <DecisionSection label="Période">
        <div className="flex flex-wrap justify-between gap-3 text-xs text-[#171717]">
          <span>
            <strong className="font-medium">Début:</strong> {fmtDate(campaign.start_date)}
          </span>
          <span>
            <strong className="font-medium">Fin:</strong> {fmtDate(campaign.end_date)}
          </span>
          <span>
            <strong className="font-medium">Durée:</strong> {days === null ? '—' : `${days} jours`}
          </span>
        </div>
      </DecisionSection>

      <DecisionSection label="Zones géographiques">
        <p className="text-xs text-[#171717]">
          <strong className="font-medium">Nombre de zones:</strong>{' '}
          {campaign.zones.length === 0 ? 'Tout le réseau' : campaign.zones.length}
        </p>
        {campaign.zones.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {campaign.zones.map((zone) => (
              <DecisionChip key={zone}>{zone}</DecisionChip>
            ))}
          </div>
        )}
      </DecisionSection>

      <DecisionSection label="Spot">
        {campaign.creative && spotAllocation ? (
          <AllocationSpotViewer
            allocation={{
              id: spotAllocation.id,
              campaign_name: campaign.name,
              creative: campaign.creative,
            }}
          />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-xl border border-[#EBEBEB] text-sm text-[#A3A3A3]">
            Aucun spot
          </div>
        )}
      </DecisionSection>
    </>
  );
}
