import type { CampaignLocation } from '@/features/campaigns/services/campaign-screens.service';
import type {
  CampaignView,
  CreateCampaignInput,
  UpdateCampaignInput,
} from '@/features/campaigns/services/campaigns.api';

// GeographicZone + ParcTV are RETAINED (not part of the new model): they are shared types consumed
// outside the wizard — features/screens (useAvailableParcs / usePredefinedZones), the admin
// GeographicZonesManagement page, and the legacy wizard modules still slated for C7 removal. The new
// campaigns-engine wizard does not use them.
export interface GeographicZone {
  id: string;
  name: string;
  location: { lat: number; lng: number };
  radius: number;
  locations: CampaignLocation[];
  /** ID de la zone prédéfinie si la zone vient d'une carte prédéfinie. */
  predefinedZoneId?: string;
}

/** Parc-TV (network owner) entry — owner-scoped set of screens that diffuse together. */
export interface ParcTV {
  ownerId: string;
  name: string;
  logo?: string;
  screenCount: number;
  screenIds: string[];
}

/**
 * The de-Supabase campaign wizard runs on the campaigns REST engine (POST/GET /api/campaigns +
 * /:id/submit). Four advertiser-entered fields drive a CREATE-EARLY draft (POST on leaving Basics →
 * draftCampaignId); targeting (category × class), the linked creative (L-spot), and the interim
 * indicative budget all attach to that draft id by REST. requestedBudget is the advertiser-facing
 * INDICATIVE budget (TND) — PATCHed onto requested_budget before submit; L-price replaces it later.
 */
export interface WizardState {
  campaignName: string;
  /** ISO 'YYYY-MM-DD' (serialisable). The consumer converts to/from Date. */
  startDate: string | null;
  endDate: string | null;
  /** The linked creative — set in the Creative step via PATCH /api/campaigns/:id { creative_id }. */
  creativeId: string | null;
  /** Interim manual cart: advertiser-facing INDICATIVE budget (TND). PATCHed onto requested_budget. */
  requestedBudget: number | null;
  /** The created-early draft's campaigns-table id (`''` until POST /api/campaigns returns). */
  draftCampaignId: string;
}

export interface StepDescriptor {
  /** 1-indexed (matches the wizard UI convention). */
  index: number;
  /** Stable, route-style id ('basics' / 'targeting' / 'creative' / 'cart'). */
  id: string;
  label: string;
  validate: (state: WizardState) => boolean;
}

export type CreateDraftResult = { kind: 'success'; id: string } | { kind: 'error'; error: Error };

export type SubmitResult =
  | { kind: 'success'; campaign: CampaignView }
  | { kind: 'error'; error: Error };

export type SaveDraftResult =
  | { kind: 'success'; campaign: CampaignView }
  | { kind: 'error'; error: Error };

export interface UseCampaignWizardOptions {
  initialState: WizardState;
  /** Create-early DI: POST /api/campaigns on leaving Basics → the draft id. */
  createDraft: (input: CreateCampaignInput) => Promise<CampaignView>;
  /** PATCH /api/campaigns/:id — used to write requested_budget (and to link the creative). */
  updateCampaign: (id: string, input: UpdateCampaignInput) => Promise<CampaignView>;
  /** POST /api/campaigns/:id/submit — the single draft → pending transition. */
  submitCampaign: (id: string) => Promise<CampaignView>;
}

export interface UseCampaignWizardReturn {
  state: WizardState;
  setState: (updater: (prev: WizardState) => WizardState) => void;
  currentStep: number;
  totalSteps: number;
  stepList: StepDescriptor[];
  /** Async: a forward move past Basics ensures the create-early draft exists first. */
  goToStep: (n: number) => Promise<boolean>;
  nextStep: () => Promise<boolean>;
  prevStep: () => boolean;
  /** Pure breadcrumb enabled-state (validators only). Draft creation is enforced on navigation. */
  canGoToStep: (n: number) => boolean;
  /** Idempotent create-early: POSTs the draft once, threads the id into state. */
  ensureDraft: () => Promise<CreateDraftResult>;
  /** PATCH requested_budget, then POST /:id/submit. */
  submit: () => Promise<SubmitResult>;
  /** Enregistrer: PATCH requested_budget only — the campaign stays a draft (no submit). */
  saveDraft: () => Promise<SaveDraftResult>;
  creatingDraft: boolean;
  submitting: boolean;
  savingDraft: boolean;
}
