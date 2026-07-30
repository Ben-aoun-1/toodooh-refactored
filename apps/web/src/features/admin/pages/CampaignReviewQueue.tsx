import { useQuery } from '@tanstack/react-query';
import { Check, Clock, Eye, Filter, Megaphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { adminKeys } from '@/features/admin/hooks/queryKeys';
import {
  useAdminCampaigns,
  useAdminCampaignMutations,
  useCampaignEngineJournal,
  useCampaignReversements,
} from '@/features/admin/hooks/useAdminCampaigns';
import {
  ENGINE_JOURNAL_EMPTY_STATE,
  PHASE_LABELS,
  eventDetail,
  eventLabel,
  formatTunis,
  outcomeChip,
  type EnginePhaseFilter,
} from '@/features/admin/lib/engine-journal';
import { REVERSEMENT_ROW_LABELS, reversementDisplayRows } from '@/features/admin/lib/reversements';
import { adminCreativesService } from '@/features/admin/services/admin-creatives.service';
import type {
  AdminCampaignRow,
  CampaignStatusFilter,
} from '@/features/admin/types/campaign-review';
import type { AdminCreativeView } from '@/features/admin/types/creative';
import { apiClient } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/errors';

// Admin campaign-REVIEW queue — the ACTIVATION keystone's operator surface. Replaces the broken
// legacy Supabase CampaignMonitoring page: it reads the Postgres review queue (GET /api/admin/campaigns),
// shows the DERIVED i_cible the operator approves (server-derived from requested_budget @ the config
// CPM), previews the linked creative, and exposes Approve (= activate: derive → dispatch → active) and
// Reject (reason required). The engine inputs are NOT entered here — Approve sends no body; the server
// derives cpm/i_cible/s/t. We DISPLAY the gate signals (content approved? funded? budget set?) so the
// operator can see why a campaign can't activate yet, but the server is the authority and surfaces a
// precise reason on a blocked activate.

const TND = (n: number | null): string =>
  n === null ? '—' : `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} TND`;

const formatDate = (dateString: string | null): string => {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const contentBadge = (status: string | null) => {
  const map: Record<string, { color: string; text: string }> = {
    approved: { color: 'bg-green-100 text-green-800', text: 'Créative approuvée' },
    pending: { color: 'bg-yellow-100 text-yellow-800', text: 'Créative en attente' },
    rejected: { color: 'bg-red-100 text-red-800', text: 'Créative rejetée' },
  };
  const cfg = status ? (map[status] ?? null) : null;
  if (!cfg)
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
        Aucune créative
      </span>
    );
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.color}`}
    >
      {cfg.text}
    </span>
  );
};

const statusBadge = (status: string) => {
  const map: Record<string, { color: string; icon: typeof Clock; text: string }> = {
    draft: { color: 'bg-gray-100 text-gray-700', icon: Clock, text: 'Brouillon' },
    pending: { color: 'bg-yellow-100 text-yellow-800', icon: Clock, text: 'En attente' },
    active: { color: 'bg-green-100 text-green-800', icon: Check, text: 'Active' },
    rejected: { color: 'bg-red-100 text-red-800', icon: X, text: 'Rejetée' },
  };
  const cfg = map[status] ?? map.pending;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.color}`}
    >
      <Icon className="mr-1 h-3 w-3" />
      {cfg.text}
    </span>
  );
};

export default function CampaignReviewQueue() {
  const [statusFilter, setStatusFilter] = useState<CampaignStatusFilter>('pending');
  const { campaigns, loading, isError } = useAdminCampaigns(statusFilter);
  const { activate, reject } = useAdminCampaignMutations();

  // Linked-creative metadata (mime/type/title) for the preview — reuses the existing admin creatives
  // list (all statuses), cached; the campaign row only carries creative_id.
  const { data: creatives } = useQuery({
    queryKey: adminKeys.creatives('__all__'),
    queryFn: () => adminCreativesService.list(),
  });
  const creativeById = new Map<string, AdminCreativeView>((creatives ?? []).map((c) => [c.id, c]));

  const [selected, setSelected] = useState<AdminCampaignRow | null>(null);
  // EV4 — the positioning's allocations table (venues, blocs, montants, statuts); idle for
  // classic rows, empty until the validation dispatches.
  const { data: eventAllocations } = useQuery({
    queryKey: [...adminKeys.all, 'eventAllocations', selected?.id ?? ''] as const,
    queryFn: () =>
      apiClient.get<
        {
          id: string;
          screenhost_name: string;
          blocs_count: number;
          impressions_total: number;
          montant_tnd: number;
          statut: string;
        }[]
      >(`/admin/campaigns/${selected?.id}/event-allocations`),
    enabled: Boolean(selected?.id && selected?.event_id),
  });
  // E7 — the settlement breakdown for the examen modal (empty lines until reconciled).
  const { data: reversements } = useCampaignReversements(selected?.id ?? null);
  // LOG1 — the engine journal + its phase filter.
  const [journalPhase, setJournalPhase] = useState<EnginePhaseFilter>('all');
  const { data: journal } = useCampaignEngineJournal(selected?.id ?? null, journalPhase);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isError) toast.error('Erreur lors du chargement des campagnes');
  }, [isError]);

  const selectedCreative = selected?.creative_id
    ? (creativeById.get(selected.creative_id) ?? null)
    : null;

  const openReview = async (campaign: AdminCampaignRow) => {
    setSelected(campaign);
    setReason('');
    setJournalPhase('all');
    setMediaUrl(null);
    if (!campaign.creative_id) return;
    setMediaLoading(true);
    try {
      setMediaUrl(await adminCreativesService.presignedUrl(campaign.creative_id));
    } catch (error) {
      toast.error(`Impossible de charger la créative: ${getErrorMessage(error)}`);
    } finally {
      setMediaLoading(false);
    }
  };

  const closeReview = () => {
    setSelected(null);
    setMediaUrl(null);
    setReason('');
  };

  const handleApprove = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const result = await activate.mutateAsync(selected.id);
      toast.success(
        `Campagne activée — I_cible ${result.plan.i_cible.toLocaleString('fr-FR')} sur ${result.plan.n_retenus} écran(s)`,
      );
      closeReview();
    } catch (error) {
      toast.error(getErrorMessage(error) || "Impossible d'activer la campagne");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!selected) return;
    // The server requires a non-empty reason (rejectBodySchema min 1) — block the call otherwise.
    if (!reason.trim()) {
      toast.error('Un motif de rejet est obligatoire');
      return;
    }
    setSubmitting(true);
    try {
      await reject.mutateAsync({ id: selected.id, reason: reason.trim() });
      toast.success('Campagne rejetée');
      closeReview();
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Impossible de rejeter la campagne');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminLayout
      title="Validation des Campagnes"
      subtitle="Approuvez (activez) ou rejetez les campagnes des annonceurs"
    >
      {/* Filtre statut */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="max-w-xs">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 transform text-gray-400" />
            <select
              className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 focus:border-transparent focus:ring-2 focus:ring-brand-primary"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CampaignStatusFilter)}
            >
              <option value="pending">En attente</option>
              <option value="active">Actives</option>
              <option value="rejected">Rejetées</option>
              <option value="draft">Brouillons</option>
            </select>
          </div>
        </div>
      </div>

      {/* Liste des campagnes */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-brand-primary"></div>
              <p className="text-gray-600">Chargement des campagnes...</p>
            </div>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            Aucune campagne pour ce statut.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Campagne
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Créative
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Budget / CPM
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    I_cible dérivé
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Solde
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Statut
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className="flex h-10 w-10 items-center justify-center rounded bg-brand-primary">
                          <Megaphone className="h-5 w-5 text-white" />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{c.name}</div>
                          <div className="text-xs text-gray-500">
                            {c.campaign_type} • annonceur{' '}
                            <span className="font-mono">{c.advertiser_id.slice(0, 8)}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">{contentBadge(c.content_validation_status)}</td>
                    <td className="px-6 py-4 text-right text-sm text-gray-900">
                      <div>{TND(c.requested_budget)}</div>
                      <div className="text-xs text-gray-500">CPM {TND(c.cpm_tnd)}</div>
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-medium text-gray-900">
                      {c.derived_i_cible === null ? '—' : c.derived_i_cible.toLocaleString('fr-FR')}
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-gray-900">
                      {TND(c.wallet_balance_tnd)}
                    </td>
                    <td className="px-6 py-4">{statusBadge(c.status)}</td>
                    <td className="px-6 py-4 text-right text-sm font-medium">
                      <button
                        onClick={() => void openReview(c)}
                        className="rounded-md p-2 text-indigo-600 hover:bg-gray-100 hover:text-indigo-900"
                        title="Examiner"
                      >
                        <Eye className="h-5 w-5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal d'examen */}
      {selected && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center px-4 pb-20 pt-4 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>

            <div className="inline-block transform overflow-hidden rounded-lg bg-white text-left align-bottom shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl sm:align-middle">
              <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
                <h3 className="mb-4 text-lg font-medium leading-6 text-gray-900">
                  Examen de la campagne — {selected.name}
                </h3>

                {/* Aperçu de la créative liée */}
                <div className="mb-6 flex min-h-[10rem] items-center justify-center overflow-hidden rounded-lg bg-black">
                  {!selected.creative_id ? (
                    <p className="py-10 text-sm text-gray-300">Aucune créative liée</p>
                  ) : mediaLoading ? (
                    <div className="my-12 h-10 w-10 animate-spin rounded-full border-b-2 border-white"></div>
                  ) : mediaUrl && selectedCreative ? (
                    /* FCT1 rider — mime_type is NULLABLE (backfilled rows): the optional chain is
                       the white-screen guard; a mime-less creative falls through to the <img>. */
                    selectedCreative.mime_type?.startsWith('video/') ? (
                      <video controls className="max-h-96 w-full">
                        {/* Empty caption track — satisfies jsx-a11y/media-has-caption. */}
                        <track kind="captions" />
                        <source src={mediaUrl} type={selectedCreative.mime_type ?? undefined} />
                      </video>
                    ) : (
                      <img
                        src={mediaUrl}
                        alt={selectedCreative.title || 'Créative'}
                        className="max-h-96 w-full object-contain"
                      />
                    )
                  ) : (
                    <p className="py-10 text-sm text-gray-300">Média indisponible</p>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-700">Budget indicatif:</p>
                      <p className="text-sm text-gray-900">{TND(selected.requested_budget)}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">CPM appliqué:</p>
                      <p className="text-sm text-gray-900">{TND(selected.cpm_tnd)}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">I_cible dérivé:</p>
                      <p className="text-sm text-gray-900">
                        {selected.derived_i_cible === null
                          ? 'Non dérivable (budget manquant)'
                          : selected.derived_i_cible.toLocaleString('fr-FR')}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">Solde annonceur:</p>
                      <p className="text-sm text-gray-900">{TND(selected.wallet_balance_tnd)}</p>
                    </div>
                  </div>

                  {/* EV4 — the positioning's placement (event_allocations). */}
                  {selected.event_id && (eventAllocations?.length ?? 0) > 0 && (
                    <div>
                      <p className="mb-1 text-sm font-medium text-gray-700">
                        Allocations événement:
                      </p>
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="py-1 pr-2 font-medium">Établissement</th>
                            <th className="py-1 pr-2 font-medium">Blocs</th>
                            <th className="py-1 pr-2 font-medium">Impressions</th>
                            <th className="py-1 pr-2 font-medium">Montant</th>
                            <th className="py-1 font-medium">Statut</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(eventAllocations ?? []).map((a) => (
                            <tr key={a.id} className="border-t border-gray-100 text-gray-900">
                              <td className="py-1 pr-2">{a.screenhost_name}</td>
                              <td className="py-1 pr-2">{a.blocs_count}</td>
                              <td className="py-1 pr-2">
                                {a.impressions_total.toLocaleString('fr-FR')}
                              </td>
                              <td className="py-1 pr-2">{TND(a.montant_tnd)}</td>
                              <td className="py-1">{a.statut}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-gray-700">Créative:</p>
                    <div className="mt-1 flex items-center gap-2">
                      {contentBadge(selected.content_validation_status)}
                      {selectedCreative && (
                        <span className="text-xs text-gray-500">
                          {selectedCreative.title || selectedCreative.original_filename || ''}
                          {selectedCreative.duration_seconds
                            ? ` • ${selectedCreative.duration_seconds}s`
                            : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">Période:</p>
                    <p className="text-sm text-gray-900">
                      {formatDate(selected.start_date)} → {formatDate(selected.end_date)}
                    </p>
                  </div>
                  {selected.reject_reason && (
                    <div>
                      <p className="text-sm font-medium text-gray-700">Motif de rejet:</p>
                      <p className="whitespace-pre-wrap text-sm text-gray-900">
                        {selected.reject_reason}
                      </p>
                    </div>
                  )}

                  {/* E7 — Reversements (rendu uniquement une fois la campagne réconciliée) */}
                  {reversements && reversements.lines.length > 0 && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <p className="mb-2 text-sm font-medium text-gray-700">
                        Reversements (règlement)
                      </p>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs uppercase text-gray-500">
                              <th className="py-1 pr-3">Établissement</th>
                              <th className="py-1 pr-3">Base</th>
                              <th className="py-1 pr-3">{REVERSEMENT_ROW_LABELS.sh}</th>
                              <th className="py-1 pr-3">{REVERSEMENT_ROW_LABELS.toodooh}</th>
                              <th className="py-1 pr-3">{REVERSEMENT_ROW_LABELS.agentSh}</th>
                              <th className="py-1 pr-3">{REVERSEMENT_ROW_LABELS.agentSc}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {reversements.lines.map((line) => (
                              <tr key={line.screenhost_id}>
                                <td className="py-1 pr-3 text-gray-900">{line.screenhost_name}</td>
                                <td className="py-1 pr-3 tabular-nums">
                                  {TND(line.base_value_tnd)}
                                </td>
                                <td className="py-1 pr-3 tabular-nums">
                                  {TND(line.sh_amount_tnd)}
                                </td>
                                <td className="py-1 pr-3 tabular-nums">
                                  {TND(line.toodooh_amount_tnd)}
                                </td>
                                <td className="py-1 pr-3 tabular-nums">
                                  {TND(line.agent_sh_amount_tnd)}
                                </td>
                                <td className="py-1 pr-3 tabular-nums">
                                  {TND(line.agent_sc_amount_tnd)}
                                </td>
                              </tr>
                            ))}
                            <tr className="font-medium text-gray-900">
                              <td className="py-1 pr-3">Totaux</td>
                              <td className="py-1 pr-3 tabular-nums">
                                {TND(reversements.totals.base_value_tnd)}
                              </td>
                              {reversementDisplayRows(reversements.totals).map((row) => (
                                <td key={row.key} className="py-1 pr-3 tabular-nums">
                                  {TND(row.amountTnd)}
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* LOG1 — Journal du moteur: pourquoi le moteur a fait ce qu'il a fait */}
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-gray-700">Journal du moteur</p>
                      <select
                        value={journalPhase}
                        onChange={(e) => setJournalPhase(e.target.value as EnginePhaseFilter)}
                        className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:border-transparent focus:ring-2 focus:ring-brand-primary"
                        aria-label="Filtrer par phase"
                      >
                        <option value="all">Toutes les phases</option>
                        {(Object.keys(PHASE_LABELS) as (keyof typeof PHASE_LABELS)[]).map((p) => (
                          <option key={p} value={p}>
                            {PHASE_LABELS[p]}
                          </option>
                        ))}
                      </select>
                    </div>
                    {!journal || journal.runs.length === 0 ? (
                      <p className="text-sm text-gray-500">{ENGINE_JOURNAL_EMPTY_STATE}</p>
                    ) : (
                      <div className="space-y-2">
                        {journal.runs.map((run) => (
                          <details
                            key={run.run_id}
                            className="rounded-lg border border-gray-200 bg-white p-2"
                          >
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                              <span className="flex items-center gap-2 min-w-0">
                                <span className="rounded-full bg-brand-primary/10 px-2 py-0.5 text-xs font-medium text-brand-deep">
                                  {PHASE_LABELS[run.phase]}
                                </span>
                                <span className="truncate text-xs text-gray-500">
                                  {formatTunis(run.started_at)}
                                </span>
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  run.outcome === 'committed'
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-red-100 text-red-700'
                                }`}
                              >
                                {outcomeChip(run)}
                              </span>
                            </summary>
                            <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2">
                              {run.events.map((ev, i) => (
                                <li key={i} className="text-xs text-gray-700">
                                  <span className="font-medium">{eventLabel(ev)}</span>
                                  {ev.screenhost_name && (
                                    <span className="text-gray-500"> — {ev.screenhost_name}</span>
                                  )}
                                  {eventDetail(ev) && (
                                    <span className="text-gray-500"> · {eventDetail(ev)}</span>
                                  )}
                                </li>
                              ))}
                              {run.events.length === 0 && (
                                <li className="text-xs text-gray-400">Aucun événement détaillé.</li>
                              )}
                            </ul>
                          </details>
                        ))}
                        {journal.total_runs > journal.runs.length && (
                          <p className="text-xs text-gray-400">
                            {journal.runs.length} exécutions affichées sur {journal.total_runs}.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {selected.status === 'pending' && (
                    <div>
                      <label
                        htmlFor="reject-reason"
                        className="mb-1 block text-sm font-medium text-gray-700"
                      >
                        Motif de rejet (obligatoire pour rejeter)
                      </label>
                      <textarea
                        id="reject-reason"
                        rows={3}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Motif du rejet…"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-brand-primary"
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="gap-2 bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
                {selected.status === 'pending' && (
                  <button
                    onClick={() => void handleApprove()}
                    disabled={submitting}
                    className="inline-flex w-full items-center justify-center rounded-md border border-transparent bg-green-600 px-4 py-2 text-base font-medium text-white shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:text-sm"
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Approuver (activer)
                  </button>
                )}
                {selected.status === 'pending' && (
                  <button
                    onClick={() => void handleReject()}
                    disabled={submitting}
                    className="inline-flex w-full items-center justify-center rounded-md border border-transparent bg-red-600 px-4 py-2 text-base font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:text-sm"
                  >
                    <X className="mr-2 h-4 w-4" />
                    Rejeter
                  </button>
                )}
                <button
                  onClick={closeReview}
                  disabled={submitting}
                  className="inline-flex w-full justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 disabled:opacity-50 sm:w-auto sm:text-sm"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
