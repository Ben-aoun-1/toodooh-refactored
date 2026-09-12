import { Crosshair, Monitor, X } from 'lucide-react';
import { type ReactNode } from 'react';

import Drawer from '@/components/Drawer';
import { rejectReasonToShow } from '@/features/campaigns/lib/campaign-actions';
import {
  PREVUES_LABEL,
  formatImpressions,
  type ImpressionsDisplay,
} from '@/features/campaigns/lib/campaign-impressions';
import CreativePreviewTile from '@/features/campaigns/pages/new-campaign/CreativePreviewTile';
import type { CreativeType } from '@/features/campaigns/services/creatives.api';

/**
 * Structural shape of the campaign a drawer renders. Loose by design: the
 * advertiser side passes an untyped Supabase row (later-slice repoint) and the
 * owner side passes an `OwnerCampaignCard`; both structurally satisfy this.
 */
export interface CampaignDrawerCampaign {
  name: string;
  status: string;
  startDate?: Date | null;
  endDate?: Date | null;
  // advertiser-only
  selected_categories?: string[];
  category?: string;
  selected_zones?: string[];
  /** CF-Q1 — the admin's mandatory rejection reason (advertiser, « Non validé » campaigns). */
  reject_reason?: string | null;
  // owner-only
  ownerLocationsCount?: number;
}

/** CF-HF3 — the advertiser spot preview (BOTH types, by creative_type — the wizard tile). */
export interface CampaignDrawerCreative {
  creativeType?: CreativeType;
  title?: string | null;
  durationSeconds?: number | null;
  url?: string;
  isLoading?: boolean;
}

interface CampaignDrawerProps {
  open: boolean;
  onClose: () => void;
  campaign: CampaignDrawerCampaign | null;
  video?: { url?: string | null } | null;
  /** CF-HF3 (advertiser) — when present, the Spot section renders the type-aware tile. */
  creative?: CampaignDrawerCreative | null;
  /** CF-HF3 (advertiser) — the per-status impressions rule, computed by the page. */
  impressions?: ImpressionsDisplay | null;
  /** EV4 — the positioning's placement block (a consumer slot, like statusBadge). */
  eventPlacementSlot?: ReactNode;
  /** Named `variant` (not `role`) to avoid the jsx-a11y/aria-role lint on `role=`. */
  variant: 'advertiser' | 'owner';
  /**
   * Status badge node. A consumer slot (like `footerSlot`) because the two
   * roles derive status UI from page-local helpers — advertiser's inline-style
   * map, owner's `getStatusUi` (shared with its list cards). Keeping it a slot
   * avoids duplicating/relocating those helpers.
   */
  statusBadge?: ReactNode;
  /** Footer action buttons. Owner footer is extended by B-approvals (B3). */
  footerSlot?: ReactNode;
}

const VARIANT_WIDTH: Record<CampaignDrawerProps['variant'], number> = {
  advertiser: 480,
  owner: 420,
};

/**
 * Shared campaign-detail side-drawer for the advertiser (`MyCampaigns`) and
 * screenhost (`OwnerCampaigns`) campaign lists, composing the generic
 * `Drawer` primitive.
 *
 * Role-branched cosmetics (padding p-5 vs p-4, header typography, the Type
 * block sizing, video treatment) are preserved faithfully per the slice-2
 * ruling; normalization is deferred to the slice-2-close polish phase. The
 * status badge and footer are consumer slots; the body sections branch on
 * `role`.
 */
export default function CampaignDrawer({
  open,
  onClose,
  campaign,
  video,
  creative,
  impressions,
  variant,
  statusBadge,
  footerSlot,
  eventPlacementSlot,
}: CampaignDrawerProps) {
  const isAdvertiser = variant === 'advertiser';

  // Date display + duration — formatting differs by role (faithful).
  const startStr = campaign?.startDate
    ? isAdvertiser
      ? campaign.startDate.toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })
      : campaign.startDate.toLocaleDateString('fr-FR')
    : '—';
  const endStr = campaign?.endDate
    ? isAdvertiser
      ? campaign.endDate.toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })
      : campaign.endDate.toLocaleDateString('fr-FR')
    : '—';
  const durationDays =
    campaign?.startDate && campaign?.endDate
      ? (isAdvertiser ? (n: number) => n : (n: number) => Math.max(0, n))(
          Math.ceil(
            (campaign.endDate.getTime() - campaign.startDate.getTime()) / (1000 * 60 * 60 * 24),
          ),
        )
      : 0;

  const categories =
    campaign?.selected_categories || (campaign?.category ? [campaign.category] : []);
  const zones = campaign?.selected_zones || [];

  if (!campaign)
    return <Drawer open={open} onClose={onClose} width={VARIANT_WIDTH[variant]} children={null} />;

  return (
    <Drawer open={open} onClose={onClose} width={VARIANT_WIDTH[variant]}>
      {/* Header */}
      <div
        className={`flex-none flex flex-row items-start ${
          isAdvertiser ? 'p-5 gap-4' : 'p-4 gap-3'
        } border-b border-[#EBEBEB]`}
      >
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <h3
            className={
              isAdvertiser
                ? 'text-lg font-medium text-[#171717] leading-6 truncate'
                : 'text-[20px] leading-6 font-semibold text-[#171717] truncate'
            }
            style={isAdvertiser ? { letterSpacing: '-0.015em' } : undefined}
          >
            {campaign.name}
          </h3>
          {statusBadge}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 text-[#5C5C5C] hover:bg-gray-100 rounded-lg transition-colors shrink-0"
          aria-label="Fermer"
        >
          <X className={isAdvertiser ? 'h-6 w-6' : 'h-5 w-5'} strokeWidth={1.5} />
        </button>
      </div>

      {/* Body */}
      {isAdvertiser ? (
        <div className="flex-1 overflow-y-auto flex flex-col p-5 gap-4">
          {/* CF-Q1 — a Non validé campaign leads with WHY (the admin reject stores the reason). */}
          {rejectReasonToShow(campaign.status, campaign.reject_reason) && (
            <Section label="Motif du refus">
              <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                {campaign.reject_reason}
              </p>
            </Section>
          )}
          <Section label="Type de la campagne">
            <div className="flex gap-2">
              <div
                className="flex-1 flex items-center gap-2 p-1.5 rounded-lg bg-white border border-brand-primary"
                style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
              >
                <div className="w-8 h-8 rounded-lg bg-[#DCF0E9] flex items-center justify-center shrink-0">
                  <Crosshair className="h-5 w-5 text-[#142522]" />
                </div>
                <span className="text-xs text-[#171717]">Réseau Toodooh</span>
              </div>
              <div
                className="flex-1 flex items-center gap-2 p-1.5 rounded-lg bg-[#F7F7F7] border border-[#EBEBEB]"
                style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
              >
                <div className="w-8 h-8 rounded-lg border border-[#EBEBEB] flex items-center justify-center shrink-0">
                  <Monitor className="h-5 w-5 text-[#D1D1D1]" />
                </div>
                <span className="text-xs text-[#D1D1D1]">Parc TV</span>
              </div>
            </div>
          </Section>

          <Section label="Catégorie(s)">
            <div className="flex flex-wrap gap-2">
              {categories.map((cat: string, i: number) => (
                <span
                  key={i}
                  className="inline-flex items-center px-2 py-1 rounded bg-white border border-brand-primary text-xs text-[#171717]"
                  style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
                >
                  {cat}
                </span>
              ))}
            </div>
          </Section>

          <Section label="Période">
            <div
              className="flex flex-wrap gap-4 text-xs font-medium text-[#171717]"
              style={{ letterSpacing: '-0.006em', lineHeight: '16px' }}
            >
              <span>Début: {startStr}</span>
              <span>Fin: {endStr}</span>
              <span>Durée: {durationDays} jours</span>
            </div>
          </Section>

          {/* CF-HF4 (Kais) — the advertiser side is PRÉVUES-ONLY ('—' for a not-yet value,
              never a fake 0); the delivered numbers stay a host-side read. */}
          <Section label={PREVUES_LABEL}>
            <div className="text-sm font-semibold text-[#171717]">
              {formatImpressions(impressions?.prevues ?? null)}
            </div>
          </Section>

          {/* EV4 — the positioning's placement (N établissements + per-venue lines). */}
          {eventPlacementSlot && <Section label="Placement">{eventPlacementSlot}</Section>}

          <Section label="Zones géographiques">
            <div
              className="flex flex-wrap gap-2 text-xs font-medium text-[#171717]"
              style={{ letterSpacing: '-0.006em', lineHeight: '16px' }}
            >
              {/* CF-HF3 (Mejri item 2) — an empty selection IS a targeting: whole network. */}
              {(zones.length > 0 ? zones : ['Tout le réseau']).map((zone: string) => (
                <span
                  key={zone}
                  className="inline-flex items-center px-2 py-1 rounded bg-white border border-brand-primary"
                >
                  {zone}
                </span>
              ))}
            </div>
          </Section>

          <Section label="Spot">
            {/* CF-HF3 (Mejri item 2) — the wizard's type-aware tile: image AND video render
                (the old unconditional <video> painted a black box for a photo creative). */}
            {creative ? (
              <CreativePreviewTile
                creativeType={creative.creativeType}
                title={creative.title ?? null}
                durationSeconds={creative.durationSeconds ?? null}
                url={creative.url}
                isLoading={creative.isLoading ?? false}
              />
            ) : (
              <div className="rounded-xl border border-[#EBEBEB] overflow-hidden bg-black/5 relative">
                {video?.url ? (
                  <div className="relative">
                    <video
                      src={video.url}
                      controls
                      className="w-full aspect-video object-contain rounded-xl"
                      muted
                      playsInline
                    >
                      <track kind="captions" />
                    </video>
                    <div
                      className="absolute inset-x-0 bottom-0 h-24 pointer-events-none"
                      style={{
                        background:
                          'linear-gradient(180deg, rgba(13, 15, 20, 0) 0%, rgba(13, 15, 20, 0.9) 80.37%)',
                        backdropFilter: 'blur(1px)',
                      }}
                    />
                  </div>
                ) : (
                  <div className="aspect-video flex items-center justify-center text-[#A3A3A3] text-sm">
                    Aucun spot
                  </div>
                )}
              </div>
            )}
          </Section>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="border-b border-[#EFEFEF] pb-3">
            <p className="text-xs uppercase text-[#A3A3A3] mb-2">Type de la campagne</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 rounded-lg p-2 border border-brand-primary bg-white">
                <div className="w-8 h-8 rounded-lg bg-[#E8F8EE] border border-brand-primary flex items-center justify-center">
                  <Crosshair className="h-4 w-4 text-[#142522]" />
                </div>
                <span className="text-sm text-[#171717]">Réseau Toodooh</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg p-2 border border-[#EBEBEB] bg-[#F7F7F7]">
                <div className="w-8 h-8 rounded-lg bg-white border border-[#EBEBEB] flex items-center justify-center">
                  <Monitor className="h-4 w-4 text-[#D1D1D1]" />
                </div>
                <span className="text-sm text-[#9D9D9D]">Parc TV</span>
              </div>
            </div>
          </div>

          <div className="border-b border-[#EFEFEF] pb-3">
            <p className="text-xs uppercase text-[#A3A3A3] mb-2">Établissements</p>
            <div className="inline-flex items-center justify-center h-7 min-w-7 px-2 rounded border border-brand-primary bg-[#E8F8EE] text-[#1FC16B] text-sm font-semibold">
              {campaign.ownerLocationsCount}
            </div>
          </div>

          <div className="border-b border-[#EFEFEF] pb-3">
            <p className="text-xs uppercase text-[#A3A3A3] mb-2">Période</p>
            <div className="flex justify-between text-sm text-[#171717]">
              <span>
                <strong>Début:</strong> {startStr}
              </span>
              <span>
                <strong>Fin:</strong> {endStr}
              </span>
              <span>
                <strong>Durée:</strong> {durationDays} jours
              </span>
            </div>
          </div>

          <div className="border-b border-[#EFEFEF] pb-3">
            <p className="text-xs uppercase text-[#A3A3A3] mb-2">Zones géographiques</p>
            <div className="flex justify-between text-sm text-[#171717]">
              <span>
                <strong>Nombre de zones:</strong> {Math.max(1, campaign.ownerLocationsCount ?? 0)}
              </span>
              <span>
                <strong>Zone couverte:</strong> —
              </span>
            </div>
          </div>

          <div>
            <p className="text-xs uppercase text-[#A3A3A3] mb-2">Spot</p>
            <div className="rounded-xl border border-[#EBEBEB] overflow-hidden bg-black/5">
              {video?.url ? (
                <video
                  src={video.url || undefined}
                  controls
                  className="w-full aspect-video object-contain bg-black"
                >
                  {/* Empty caption track — satisfies jsx-a11y/media-has-caption
                      for advertiser-uploaded media that has no caption file. */}
                  <track kind="captions" />
                </video>
              ) : (
                <div className="aspect-video flex items-center justify-center text-sm text-[#A3A3A3]">
                  Aucun spot
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer (consumer-owned actions) */}
      {footerSlot ? (
        <div className={`flex-none ${isAdvertiser ? 'p-5' : 'p-4'} border-t border-[#EBEBEB]`}>
          {footerSlot}
        </div>
      ) : null}
    </Drawer>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span
        className="text-xs font-medium uppercase text-[#A3A3A3] tracking-tight"
        style={{ letterSpacing: '-0.006em', lineHeight: '16px' }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
