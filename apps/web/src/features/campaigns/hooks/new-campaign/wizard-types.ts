import type { CampaignLocation } from '../../services/campaign-screens.service';

export interface GeographicZone {
  id: string;
  name: string;
  location: { lat: number; lng: number };
  radius: number;
  locations: CampaignLocation[];
  /** ID de la zone prédéfinie si la zone vient d'une carte prédéfinie. */
  predefinedZoneId?: string;
}

/** Parc-TV (network owner) entry in Step 2's parc_tv mode. Owner-scoped
 *  set of screens that diffuse together; selected by ownerId in the
 *  wizard's `selectedParcIds` slot. */
export interface ParcTV {
  ownerId: string;
  name: string;
  logo?: string;
  screenCount: number;
  screenIds: string[];
}

export interface WizardState {
  campaignType: 'standard' | 'event';
  campaignName: string;
  client: string;
  categories: string[];
  diffusionType: 'toodooh' | 'parc_tv';
  selectedParcIds: string[];
  /** ISO 'YYYY-MM-DD' (serializable). The consumer converts to/from Date. */
  startDate: string | null;
  endDate: string | null;
  geographicZones: GeographicZone[];
  adjustedBudget: number;
  calculatedImpressions: number;
  /** In-memory only — NOT persisted via saveDraft. */
  customMinBudget: number | null;
  /** In-memory only — NOT persisted via saveDraft. */
  customMaxBudget: number | null;
  uploadedVideoId: string;
  uploadedVideoUrl: string;
  existingVideoId: string | null;
  draftCampaignId: string;
}

export interface StepDescriptor {
  /** 1-indexed (matches the existing wizard UI convention). */
  index: number;
  /** Stable, route-style id ('name-type' / 'category' / ...). */
  id: string;
  label: string;
  validate: (state: WizardState) => boolean;
}

export type SaveDraftResult = { kind: 'success'; id: string } | { kind: 'error'; error: Error };

export type AddToCartResult =
  | { kind: 'success'; campaignId: string }
  | { kind: 'insufficient_balance' }
  | { kind: 'error'; error: Error };

export interface UseCampaignWizardOptions {
  initialState: WizardState;
  campaignType: 'standard' | 'event';
  /** True when the consumer's profile type requires the `client` field
   *  (advertising_agency / event_organizer). Threaded into validateCategoryOrParc. */
  clientRequired: boolean;
  /** From useAdvertiserGlobalConfig — drives serializeForDraft's view count. */
  cpmTnd: number;
  /** Set for event campaigns and edit-of-event campaigns; null otherwise. */
  eventId: string | null;
  /** Fallback for the cart-item name when state.campaignName is empty
   *  (event mode pre-fills from the SpecialEvent name). */
  eventName: string | null;
  /** Used by serializeForDraft when no zones are selected. */
  fallbackLocation: { lat: number; lng: number };
}

export interface UseCampaignWizardReturn {
  state: WizardState;
  setState: (updater: (prev: WizardState) => WizardState) => void;
  currentStep: number;
  totalSteps: number;
  stepList: StepDescriptor[];
  goToStep: (n: number) => boolean;
  nextStep: () => boolean;
  prevStep: () => boolean;
  canGoToStep: (n: number) => boolean;
  saveDraft: () => Promise<SaveDraftResult>;
  addToCart: () => Promise<AddToCartResult>;
}
