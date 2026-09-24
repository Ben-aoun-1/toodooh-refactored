import type {
  LaunchCampaignInput,
  LaunchEventInput,
  SandboxPricing,
} from '@/features/admin/services/admin-simulator.service';

// SIM-6 phase 3 — the simulator's scenario controls: the pure rules behind the launch form and the
// sandbox pricing editor (no render harness in apps/web: the rules live here, the TSX lays out).

export type BudgetMode = 'share' | 'tnd';
export type ClassChoice = '' | 'populaire' | 'moyen' | 'premium';

export interface LaunchForm {
  advertiserId: string; // '' = the world picks the best-funded advertiser
  startInDays: number;
  durationDays: number;
  spotSeconds: number;
  budgetMode: BudgetMode;
  budget: number; // % of C_max, or TND
  sectorId: string; // '' = every sector
  cls: ClassChoice; // '' = every class
}

export interface EventForm {
  inDays: number;
  durationHours: number;
  kickoffHour: number;
  spotSeconds: number;
  budgetMode: BudgetMode;
  budget: number;
}

const budgetFields = (mode: BudgetMode, budget: number) =>
  mode === 'tnd' ? { budget_tnd: budget } : { budget_share: budget / 100 };

/** The launch body: a targeting line only when a sector or a class was chosen. */
export const launchBody = (f: LaunchForm): LaunchCampaignInput => ({
  start_in_days: f.startInDays,
  duration_days: f.durationDays,
  spot_seconds: f.spotSeconds,
  ...budgetFields(f.budgetMode, f.budget),
  ...(f.advertiserId ? { advertiser_id: f.advertiserId } : {}),
  ...(f.sectorId || f.cls
    ? { targeting: [{ category_id: f.sectorId || null, class: f.cls || null }] }
    : {}),
});

export const eventBody = (f: EventForm): LaunchEventInput => ({
  in_days: f.inDays,
  duration_hours: f.durationHours,
  kickoff_hour: f.kickoffHour,
  spot_seconds: f.spotSeconds,
  ...budgetFields(f.budgetMode, f.budget),
});

/** Why the pricing cannot be saved (null = it can): the api's own rules, said before the call. */
export const pricingError = (p: SandboxPricing): string | null => {
  if (!(p.standard_cpm_tnd > 0) || !(p.event_cpm_tnd > 0)) return 'Les CPM doivent être positifs.';
  if ([p.t_10s, p.t_20s, p.t_30s].some((t) => !(t > 0 && t <= 1))) {
    return 'Les indices T doivent être compris entre 0 et 1.';
  }
  if (!(p.t_10s <= p.t_20s && p.t_20s <= p.t_30s)) return 'Il faut T10 ≤ T20 ≤ T30.';
  if (!Number.isInteger(p.f_max_seconds) || p.f_max_seconds < 10 || p.f_max_seconds > 3600) {
    return 'F doit être un entier entre 10 et 3600 s.';
  }
  return null;
};

/** Only the fields that changed are sent — an untouched field keeps the sandbox's value. */
export const pricingPatch = (
  before: SandboxPricing,
  after: SandboxPricing,
): Partial<SandboxPricing> => {
  const patch: Partial<SandboxPricing> = {};
  for (const key of Object.keys(after) as (keyof SandboxPricing)[]) {
    if (after[key] !== before[key]) patch[key] = after[key];
  }
  return patch;
};
