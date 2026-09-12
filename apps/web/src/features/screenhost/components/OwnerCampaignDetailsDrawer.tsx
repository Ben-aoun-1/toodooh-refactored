import { Play, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import Drawer from '@/components/Drawer';
import AllocationSpotViewer from '@/features/screenhost/components/AllocationSpotViewer';
import {
  allocationStatutLabel,
  decisionUi,
  fmtDate,
  statusUi,
} from '@/features/screenhost/lib/owner-campaigns.lib';
import {
  campaignTypeLabel,
  categoriesLabel,
  revenueLabel,
  zonesLabel,
} from '@/features/screenhost/services/screenhost-allocations.service';
import type { OwnerCampaign } from '@/features/screenhost/services/screenhost-campaigns.service';

/**
 * CAMP-E1 — the owner's campaign details drawer, on the api row: the proposal (advertiser, type,
 * période, catégories, zones, spot) plus the owner's per-venue allocation rows with their statut
 * and the totals. Read-only — the footer is a consumer slot (the page mounts « Décider », which
 * navigates to /owner-allocations, or « Fermer »). Replaces the `CampaignDrawer` owner variant,
 * whose shape (owner-share maths, a Supabase video url) no longer exists.
 */
export default function OwnerCampaignDetailsDrawer({
  open,
  onClose,
  campaign,
  footerSlot,
}: {
  open: boolean;
  onClose: () => void;
  campaign: OwnerCampaign | null;
  footerSlot?: ReactNode;
}) {
  const [spotOpen, setSpotOpen] = useState(false);

  if (!campaign) return <Drawer open={open} onClose={onClose} width={440} children={null} />;

  const status = statusUi(campaign.status);
  const decision = decisionUi(campaign.owner_decision);
  // The spot is per campaign; the presign route is per allocation — any of the owner's rows works.
  const spotAllocation = campaign.allocations[0];

  return (
    <Drawer open={open} onClose={onClose} width={440}>
      <div className="flex-none flex flex-row items-start p-4 gap-3 border-b border-[#EBEBEB]">
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <h3 className="text-[20px] leading-6 font-semibold text-[#171717] truncate">
            {campaign.name}
          </h3>
          <p className="text-sm text-[#5C5C5C] truncate">{campaign.advertiser_name}</p>
          <div className="flex flex-wrap gap-1.5">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status.badge}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${status.dot}`} />
              {status.label}
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${decision.className}`}
            >
              {decision.label}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 text-[#5C5C5C] hover:bg-gray-100 rounded-lg transition-colors shrink-0"
          aria-label="Fermer"
        >
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <Section label="Proposition">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-[#171717]">
            <dt className="text-[#7A7A7A]">Type</dt>
            <dd>{campaignTypeLabel(campaign.campaign_type)}</dd>
            <dt className="text-[#7A7A7A]">Période</dt>
            <dd>
              Du {fmtDate(campaign.start_date)} au {fmtDate(campaign.end_date)}
            </dd>
            <dt className="text-[#7A7A7A]">Catégories</dt>
            <dd>{categoriesLabel(campaign.categories)}</dd>
            <dt className="text-[#7A7A7A]">Zones</dt>
            <dd>{zonesLabel(campaign.zones)}</dd>
          </dl>
        </Section>

        <Section label="Vos établissements">
          <ul className="divide-y divide-[#F0F0F0] rounded-xl border border-[#EBEBEB]">
            {campaign.allocations.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-[#171717] truncate">{a.screenhost_name}</p>
                  <p className="text-xs text-[#7A7A7A]">
                    {a.ii_potentiel.toLocaleString('fr-FR')} impressions · {a.r_i} diff./h ·{' '}
                    {revenueLabel(a.revenu_previsionnel)}
                  </p>
                </div>
                <span className="text-xs font-medium text-[#5C5C5C] whitespace-nowrap">
                  {allocationStatutLabel(a.statut_acceptation)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-[#7A7A7A]">Total</span>
            <span className="font-semibold text-[#171717]">
              {campaign.totals.ii_potentiel.toLocaleString('fr-FR')} impressions ·{' '}
              <span className="text-[#2A7A47]">
                {revenueLabel(campaign.totals.revenu_previsionnel)}
              </span>
            </span>
          </div>
        </Section>

        <Section label="Spot">
          {campaign.creative && spotAllocation ? (
            <>
              <p className="text-sm text-[#5C5C5C]">
                {campaign.creative.kind === 'video' ? 'Vidéo' : 'Photo'}
                {campaign.creative.duration_seconds !== null
                  ? ` · ${campaign.creative.duration_seconds} s`
                  : ''}
              </p>
              <button
                type="button"
                onClick={() => setSpotOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-deep hover:underline"
              >
                <Play className="h-3.5 w-3.5" />
                {spotOpen ? 'Masquer le spot' : 'Voir le spot'}
              </button>
              {spotOpen && (
                <AllocationSpotViewer
                  allocation={{
                    id: spotAllocation.id,
                    campaign_name: campaign.name,
                    creative: campaign.creative,
                  }}
                />
              )}
            </>
          ) : (
            <div className="rounded-xl border border-[#EBEBEB] aspect-video flex items-center justify-center text-sm text-[#A3A3A3]">
              Aucun spot
            </div>
          )}
        </Section>
      </div>

      {footerSlot ? (
        <div className="flex-none p-4 border-t border-[#EBEBEB]">{footerSlot}</div>
      ) : null}
    </Drawer>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-[#EFEFEF] pb-3 last:border-b-0 space-y-2">
      <p className="text-xs uppercase text-[#A3A3A3]">{label}</p>
      {children}
    </div>
  );
}
