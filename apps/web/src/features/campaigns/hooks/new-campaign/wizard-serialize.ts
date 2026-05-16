import { zonesLabel } from '@/features/campaigns/lib/wizard-zones';
import type { CreateCampaignData } from '@/features/campaigns/services/campaign.service';

import type {
  AddToCartResult,
  SaveDraftResult,
  UseCampaignWizardOptions,
  WizardState,
} from './wizard-types';

/** FR display name → enum value used by the campaigns table. Mirror of
 *  NewCampaign.tsx categoryMapping (L548). */
const CATEGORY_MAPPING: Record<string, string> = {
  'Publicité commerciale': 'commercial',
  'Événement culturel': 'cultural',
  Promotion: 'promotional',
  'Promotion spéciale': 'promotional',
  Institutionnel: 'institutional',
  'Annonce institutionnelle': 'institutional',
};

interface CartItemPayload {
  id: string;
  name: string;
  amount: number;
  periodLabel?: string;
  zonesLabel?: string;
}

export interface SaveDraftDeps {
  saveCampaignDraft: (
    data: CreateCampaignData,
    campaignId?: string,
  ) => Promise<{ id: string } | null | undefined>;
}

export interface AddToCartDeps extends SaveDraftDeps {
  checkCampaignBalance: (campaignId: string) => Promise<{ has_sufficient_balance: boolean } | null>;
  revertToDraft: (campaignId: string) => Promise<{ error: unknown }>;
  addCartItem: (item: CartItemPayload) => void;
}

type SerializeOpts = Pick<
  UseCampaignWizardOptions,
  'campaignType' | 'cpmTnd' | 'eventId' | 'fallbackLocation'
>;

function formatFR(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Pure serializer: builds the saveCampaignDraft payload from WizardState.
 * Mirrors the body of NewCampaign.tsx saveCampaignDraft (L622–684) but
 * omits customMinBudget/customMaxBudget — those are in-memory only.
 */
export function serializeForDraft(state: WizardState, opts: SerializeOpts): CreateCampaignData {
  const mappedCategories =
    state.diffusionType === 'parc_tv'
      ? ['parc']
      : state.categories.map((c) => CATEGORY_MAPPING[c] || c);
  const primaryCategory = mappedCategories[0] || 'parc';

  const selectedLocationIds = state.geographicZones.flatMap((zone) =>
    (zone.locations || []).map((loc) => loc.id),
  );

  const avgLat =
    state.geographicZones.length > 0
      ? state.geographicZones.reduce((sum, z) => sum + z.location.lat, 0) /
        state.geographicZones.length
      : opts.fallbackLocation.lat;
  const avgLng =
    state.geographicZones.length > 0
      ? state.geographicZones.reduce((sum, z) => sum + z.location.lng, 0) /
        state.geographicZones.length
      : opts.fallbackLocation.lng;
  const maxRadius =
    state.geographicZones.length > 0 ? Math.max(...state.geographicZones.map((z) => z.radius)) : 0;

  const linkedImpSave =
    state.calculatedImpressions > 0 && state.adjustedBudget > 0
      ? Math.min(
          Math.round((state.adjustedBudget / opts.cpmTnd) * 1000),
          state.calculatedImpressions,
        )
      : 0;

  const videoId = state.uploadedVideoId || state.existingVideoId || undefined;

  const payload: CreateCampaignData = {
    name: state.campaignName,
    category: primaryCategory,
    categories: mappedCategories,
    start_date: state.startDate ?? '',
    end_date: state.endDate ?? '',
    budget: Number(state.adjustedBudget) || 0,
    views: Math.max(0, linkedImpSave),
    status: 'draft',
    location_lat: avgLat,
    location_lng: avgLng,
    location_radius: maxRadius,
  };
  if (videoId) payload.video_id = videoId;
  if (opts.eventId != null) payload.event_id = opts.eventId;
  if (selectedLocationIds.length > 0) payload.location_ids = selectedLocationIds;

  return payload;
}

export async function performSaveDraft(args: {
  state: WizardState;
  options: SerializeOpts;
  deps: SaveDraftDeps;
}): Promise<SaveDraftResult> {
  try {
    if (!args.state.campaignName.trim()) {
      return { kind: 'error', error: new Error('Le nom de la campagne est obligatoire') };
    }
    if (args.state.diffusionType !== 'parc_tv' && args.state.categories.length === 0) {
      return { kind: 'error', error: new Error('Sélectionnez au moins une catégorie') };
    }
    if (!args.state.startDate || !args.state.endDate) {
      return {
        kind: 'error',
        error: new Error('Les dates de début et fin sont obligatoires'),
      };
    }
    const payload = serializeForDraft(args.state, args.options);
    const result = await args.deps.saveCampaignDraft(
      payload,
      args.state.draftCampaignId || undefined,
    );
    if (!result || typeof result.id !== 'string') {
      return {
        kind: 'error',
        error: new Error('Le service de sauvegarde n’a pas renvoyé d’identifiant'),
      };
    }
    return { kind: 'success', id: result.id };
  } catch (e) {
    return { kind: 'error', error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export interface AddToCartOptions extends SerializeOpts {
  eventName: string | null;
}

export async function performAddToCart(args: {
  state: WizardState;
  options: AddToCartOptions;
  deps: AddToCartDeps;
}): Promise<AddToCartResult> {
  try {
    let campaignId = args.state.draftCampaignId;
    if (!campaignId) {
      const saved = await performSaveDraft({
        state: args.state,
        options: args.options,
        deps: { saveCampaignDraft: args.deps.saveCampaignDraft },
      });
      if (saved.kind === 'error') return { kind: 'error', error: saved.error };
      campaignId = saved.id;
    }

    const balanceCheck = await args.deps.checkCampaignBalance(campaignId);
    if (balanceCheck && !balanceCheck.has_sufficient_balance) {
      const revert = await args.deps.revertToDraft(campaignId);
      if (revert.error) {
        const err = revert.error instanceof Error ? revert.error : new Error(String(revert.error));
        return { kind: 'error', error: err };
      }
      return { kind: 'insufficient_balance' };
    }

    const amount = args.state.adjustedBudget;
    const name = args.state.campaignName || args.options.eventName || 'Nom de la campagne';
    const periodLabel =
      args.state.startDate && args.state.endDate
        ? `${formatFR(args.state.startDate)} – ${formatFR(args.state.endDate)}`
        : undefined;
    const cartZonesLabel = zonesLabel(args.state.geographicZones);

    args.deps.addCartItem({
      id: campaignId,
      name,
      amount,
      periodLabel,
      zonesLabel: cartZonesLabel,
    });
    return { kind: 'success', campaignId };
  } catch (e) {
    return { kind: 'error', error: e instanceof Error ? e : new Error(String(e)) };
  }
}
