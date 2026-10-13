import type { AgentAccountStatus } from '@/features/admin/lib/agent-sheet';
import { apiClient } from '@/lib/api-client';

// AGT-1 (agent specs v1.0 §2, ruling Q1 A: the « hub » functions live in this admin panel) — the
// agent sheet, lifecycle, access link, RIB queue and CGE publication (/api/admin/agents*,
// /api/admin/agent-ribs*, /api/admin/agent-cge; admin + superadmin).

export type AgentRoleKey = 'screenhost_agent' | 'screencast_agent';

export interface OnboardingView {
  steps: {
    key: 'cge' | 'photo' | 'info' | 'rib';
    done: boolean;
    mandatory: boolean;
    pending?: boolean;
  }[];
  done: number;
  complete: boolean;
}

export interface AgentListRow {
  id: string;
  email: string;
  contact_name: string;
  role: AgentRoleKey;
  code: string;
  account_status: AgentAccountStatus;
  onboarding: OnboardingView | null;
  created_at: string;
}

export interface AgentSheetView {
  id: string;
  role: AgentRoleKey;
  email: string;
  code: string;
  first_name: string | null;
  last_name: string | null;
  contact_name: string;
  phone: string | null;
  tax_number: string | null;
  street_address: string | null;
  city: string | null;
  postal_code: string | null;
  governorate_id: string | null;
  covered_zone: string | null;
  commission_pct: number | null;
  effective_commission_pct: number;
  account_status: AgentAccountStatus;
  certified_at: string | null;
  created_at: string;
  onboarding: OnboardingView;
  rib_status: 'non_fourni' | 'en_attente' | 'valide' | 'refuse';
  rib_validated: boolean;
  cge_acceptances: { version: string; accepted_at: string; ip: string | null }[];
  wallet: AgentWalletView;
}

/** AGT-3 — the agent wallet (spec §10): cumulés, actuel, prévisionnel. */
export interface AgentWalletView {
  cumulative_tnd: number;
  paid_tnd: number;
  balance_tnd: number;
  forecast_tnd: number;
  unprepared_tnd: number;
}

export interface AgentPayoutRow {
  id: string;
  month: string;
  amount_tnd: number;
  status: 'en_preparation' | 'effectue';
  transfer_date: string | null;
  invoice_file_name: string | null;
  invoice_uploaded_at: string | null;
  prepared_at: string;
  paid_at: string | null;
  agent_id: string;
  agent_name: string;
  agent_code: string;
  role: AgentRoleKey;
  rib_validated: boolean;
  invoice_required: boolean;
}

export interface PayoutPreparation {
  prepared: { agent_user_id: string; amount_tnd: number }[];
  waiting_rib: string[];
  already_prepared: string[];
}

export interface AgentRibRow {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_code: string;
  role: AgentRoleKey;
  file_name: string;
  status: 'en_attente' | 'valide' | 'refuse';
  refusal_reason: string | null;
  submitted_at: string;
  reviewed_at: string | null;
}

export interface AgentCgeRow {
  id: string;
  role: AgentRoleKey;
  version: string;
  file_name: string;
  published_at: string;
  acceptances: number;
}

export type AffiliationStatus = 'en_attente_activation' | 'en_cours' | 'terminee' | 'exclue';

export interface AgentAffiliationRow {
  id: string;
  name: string;
  kind: 'screenhost' | 'screencaster';
  status: AffiliationStatus;
  attached_at: string;
  start_date: string | null;
  end_date: string | null;
  exploited_by_agent: boolean;
  convention_ref: string | null;
  exclusion_reason: string | null;
}

/** AGT-2 — the hub actions on one affiliation (spec §6). */
export type AffiliationAction =
  | { kind: 'exclude'; reason: 'key_account' | 'secteur_reserve' | 'exclu' }
  | { kind: 'reassign'; agent_user_id: string }
  | { kind: 'exploited'; exploited: boolean; convention_ref?: string | null }
  | { kind: 'avenant'; end_date: string };

export interface AppointmentObjectiveRow {
  id: string;
  agent_role: AgentRoleKey;
  label: string;
  position: number;
  active: boolean;
}

export interface AgentNewsRow {
  id: string;
  title: string;
  body: string;
  audience: 'all' | AgentRoleKey;
  published_at: string;
}

export interface AttentionThresholds {
  refus_pct: number;
  sans_reponse_count: number;
  activite_pct: number;
  evenement_count: number;
  inactivite_days: number;
  baisse_score_points: number;
}

export interface AttentionEventRow {
  id: string;
  signal: string;
  label: string;
  appeared_at: string;
  cleared_at: string | null;
}

export type AgentSheetPatch = Partial<{
  first_name: string;
  last_name: string;
  phone: string;
  tax_number: string | null;
  street_address: string;
  city: string;
  postal_code: string;
  governorate_id: string;
  covered_zone: string;
  commission_pct: number | null;
  certified_at: string;
}>;

export const adminAgentsService = {
  list(): Promise<{ agents: AgentListRow[] }> {
    return apiClient.get('/admin/agents');
  },
  get(id: string): Promise<AgentSheetView> {
    return apiClient.get(`/admin/agents/${id}`);
  },
  patch(id: string, body: AgentSheetPatch): Promise<AgentSheetView> {
    return apiClient.patch(`/admin/agents/${id}`, body);
  },
  setStatus(id: string, status: 'actif' | 'suspendu' | 'cloture'): Promise<AgentSheetView> {
    return apiClient.post(`/admin/agents/${id}/status`, { status });
  },
  resendAccess(id: string): Promise<void> {
    return apiClient.post(`/admin/agents/${id}/resend-access`);
  },
  affiliations(id: string): Promise<{ affiliations: AgentAffiliationRow[] }> {
    return apiClient.get(`/admin/agents/${id}/affiliations`);
  },
  affiliationAction(id: string, action: AffiliationAction): Promise<{ ok: true }> {
    return apiClient.post(`/admin/agent-affiliations/${id}/action`, action);
  },
  payouts(month: string): Promise<{ payouts: AgentPayoutRow[] }> {
    return apiClient.get(`/admin/agent-payouts?month=${month}`);
  },
  preparePayouts(month: string): Promise<PayoutPreparation> {
    return apiClient.post('/admin/agent-payouts/prepare', { month });
  },
  markPayoutPaid(id: string, transferDate: string): Promise<{ ok: true }> {
    return apiClient.post(`/admin/agent-payouts/${id}/paid`, { transfer_date: transferDate });
  },
  payoutInvoiceUrl(id: string): Promise<{ url: string }> {
    return apiClient.get(`/admin/agent-payouts/${id}/invoice-url`);
  },
  objectives(): Promise<{ objectives: AppointmentObjectiveRow[] }> {
    return apiClient.get('/admin/agent-appointment-objectives');
  },
  addObjective(agentRole: AgentRoleKey, label: string): Promise<{ id: string }> {
    return apiClient.post('/admin/agent-appointment-objectives', { agent_role: agentRole, label });
  },
  patchObjective(
    id: string,
    body: Partial<{ label: string; position: number; active: boolean }>,
  ): Promise<{ ok: true }> {
    return apiClient.patch(`/admin/agent-appointment-objectives/${id}`, body);
  },
  news(): Promise<{ news: AgentNewsRow[] }> {
    return apiClient.get('/admin/agent-news');
  },
  publishNews(body: {
    title: string;
    body: string;
    audience: AgentNewsRow['audience'];
  }): Promise<{ id: string; recipients: number }> {
    return apiClient.post('/admin/agent-news', body);
  },
  thresholds(): Promise<AttentionThresholds> {
    return apiClient.get('/admin/agent-attention-thresholds');
  },
  saveThresholds(body: Partial<AttentionThresholds>): Promise<{ ok: true }> {
    return apiClient.put('/admin/agent-attention-thresholds', body);
  },
  attentionEvents(affiliationId: string): Promise<{ events: AttentionEventRow[] }> {
    return apiClient.get(`/admin/agent-affiliations/${affiliationId}/attention`);
  },
  ribs(status: 'en_attente' | 'valide' | 'refuse'): Promise<{ ribs: AgentRibRow[] }> {
    return apiClient.get(`/admin/agent-ribs?status=${status}`);
  },
  ribUrl(id: string): Promise<{ url: string }> {
    return apiClient.get(`/admin/agent-ribs/${id}/url`);
  },
  validateRib(id: string): Promise<unknown> {
    return apiClient.post(`/admin/agent-ribs/${id}/validate`);
  },
  refuseRib(id: string, reason: string): Promise<unknown> {
    return apiClient.post(`/admin/agent-ribs/${id}/refuse`, { reason });
  },
  cge(): Promise<{ versions: AgentCgeRow[] }> {
    return apiClient.get('/admin/agent-cge');
  },
  publishCge(role: AgentRoleKey, version: string, file: File): Promise<unknown> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm(
      `/admin/agent-cge?role=${role}&version=${encodeURIComponent(version)}`,
      form,
    );
  },
};
