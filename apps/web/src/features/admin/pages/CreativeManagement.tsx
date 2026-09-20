import { Image as ImageIcon, Film, Eye, Check, X, Clock, Filter } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';

import AdminLayout from '@/features/admin/components/AdminLayout';
import {
  useAdminCreatives,
  useAdminCreativeMutations,
} from '@/features/admin/hooks/useAdminCreatives';
import { adminCreativesService } from '@/features/admin/services/admin-creatives.service';
import type { AdminCreativeView, CreativeStatusFilter } from '@/features/admin/types/creative';
import { getErrorMessage } from '@/lib/errors';

// Admin creative-review surface for the NEW pipeline (issue ⑥). The advertiser's de-Supabase'd
// upload (creatives.api -> POST /api/creatives) lands in the Postgres `creatives` table, which the
// LEGACY Supabase "Vidéos" page never reads — so the admin could not see/validate it. This page
// consumes the existing admin REST surface (GET /api/admin/creatives, the ADMIN-scoped presign
// /admin/creatives/:id/url, approve/reject) and DISPLAYS both image/* and video/* by mime_type. It
// is parallel to VideoManagement (kept as-is for legacy data) — the two datastores are not mixed.

export default function CreativeManagement() {
  const [statusFilter, setStatusFilter] = useState<CreativeStatusFilter>('pending');
  const { creatives, loading, isError } = useAdminCreatives(statusFilter);
  const { approve, reject } = useAdminCreativeMutations();

  const [selected, setSelected] = useState<AdminCreativeView | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isError) toast.error('Erreur lors du chargement des créatives');
  }, [isError]);

  const openReview = async (creative: AdminCreativeView) => {
    setSelected(creative);
    setNotes('');
    setMediaUrl(null);
    setMediaLoading(true);
    try {
      const url = await adminCreativesService.presignedUrl(creative.id);
      setMediaUrl(url);
    } catch (error) {
      toast.error(`Impossible de charger le média: ${getErrorMessage(error)}`);
    } finally {
      setMediaLoading(false);
    }
  };

  const closeReview = () => {
    setSelected(null);
    setMediaUrl(null);
    setNotes('');
  };

  const handleApprove = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      await approve.mutateAsync({ id: selected.id, notes: notes.trim() || undefined });
      toast.success('Créative approuvée avec succès');
      closeReview();
    } catch (error) {
      toast.error(`Erreur: ${getErrorMessage(error) || "Impossible d'approuver la créative"}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!selected) return;
    // The server requires a non-empty reason (rejectBodySchema min 1) — block the call otherwise.
    if (!notes.trim()) {
      toast.error('Un motif de rejet est obligatoire');
      return;
    }
    setSubmitting(true);
    try {
      await reject.mutateAsync({ id: selected.id, notes: notes.trim() });
      toast.success('Créative rejetée');
      closeReview();
    } catch (error) {
      toast.error(`Erreur: ${getErrorMessage(error) || 'Impossible de rejeter la créative'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { color: 'bg-yellow-100 text-yellow-800', icon: Clock, text: 'En attente' },
      approved: { color: 'bg-green-100 text-green-800', icon: Check, text: 'Approuvée' },
      rejected: { color: 'bg-red-100 text-red-800', icon: X, text: 'Rejetée' },
    };
    const config = statusConfig[status as keyof typeof statusConfig] ?? statusConfig.pending;
    const Icon = config.icon;
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color}`}
      >
        <Icon className="mr-1 h-3 w-3" />
        {config.text}
      </span>
    );
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '—';
    return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '—';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <AdminLayout
      title="Gestion des Créatives"
      subtitle="Validez les créatives (vidéos et images) des annonceurs"
    >
      {/* Filtre statut */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="max-w-xs">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <select
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CreativeStatusFilter)}
            >
              <option value="pending">En attente</option>
              <option value="approved">Approuvées</option>
              <option value="rejected">Rejetées</option>
            </select>
          </div>
        </div>
      </div>

      {/* Liste des créatives */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mx-auto mb-4"></div>
              <p className="text-gray-600">Chargement des créatives...</p>
            </div>
          </div>
        ) : creatives.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            Aucune créative pour ce statut.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Créative
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Annonceur
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Statut
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Créée le
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {creatives.map((creative) => (
                  <tr key={creative.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="h-10 w-10 bg-brand-primary rounded flex items-center justify-center">
                          {creative.creative_type === 'video' ? (
                            <Film className="h-5 w-5 text-white" />
                          ) : (
                            <ImageIcon className="h-5 w-5 text-white" />
                          )}
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {creative.title || creative.original_filename || 'Sans titre'}
                          </div>
                          <div className="text-xs text-gray-500">
                            {creative.creative_type === 'video' ? 'Vidéo' : 'Image'} •{' '}
                            {formatFileSize(creative.size_bytes)} •{' '}
                            {formatDuration(creative.duration_seconds)}
                          </div>
                        </div>
                      </div>
                    </td>
                    {/* ADM-FIX1 — the NAME is the primary text; the uuid stays as the muted
                        support line (the column used to be the raw uuid alone). */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{creative.advertiser_label}</div>
                      <div className="text-xs font-mono text-gray-400">
                        {creative.advertiser_id}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(creative.validation_status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(creative.created_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => void openReview(creative)}
                        className="text-indigo-600 hover:text-indigo-900 p-2 rounded-md hover:bg-gray-100"
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
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                  Examen de la créative
                </h3>

                {/* Aperçu du média — vidéo ou image selon le mime_type */}
                <div className="mb-6 bg-black rounded-lg overflow-hidden flex items-center justify-center min-h-[12rem]">
                  {mediaLoading ? (
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white my-12"></div>
                  ) : mediaUrl ? (
                    /* FCT1 rider — mime_type is NULLABLE (backfilled rows): guard the startsWith. */
                    selected.mime_type?.startsWith('video/') ? (
                      <video controls className="w-full max-h-96">
                        {/* Empty caption track — satisfies jsx-a11y/media-has-caption for
                            advertiser-uploaded media that has no caption file. */}
                        <track kind="captions" />
                        <source src={mediaUrl} type={selected.mime_type ?? undefined} />
                        Votre navigateur ne supporte pas la lecture de vidéos.
                      </video>
                    ) : (
                      <img
                        src={mediaUrl}
                        alt={selected.title || selected.original_filename || 'Créative'}
                        className="w-full max-h-96 object-contain"
                      />
                    )
                  ) : (
                    <p className="text-sm text-gray-300 py-12">Média indisponible</p>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Fichier:</p>
                    <p className="text-sm text-gray-900">
                      {selected.original_filename || selected.title || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">Type / MIME:</p>
                    <p className="text-sm text-gray-900">
                      {selected.creative_type === 'video' ? 'Vidéo' : 'Image'} •{' '}
                      {selected.mime_type ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">Annonceur:</p>
                    <p className="text-sm text-gray-900">{selected.advertiser_label}</p>
                    <p className="text-xs font-mono text-gray-400">{selected.advertiser_id}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">Statut:</p>
                    {getStatusBadge(selected.validation_status)}
                  </div>
                  {selected.validated_at && (
                    <div>
                      <p className="text-sm font-medium text-gray-700">Validée le:</p>
                      <p className="text-sm text-gray-900">{formatDate(selected.validated_at)}</p>
                    </div>
                  )}
                  {selected.validation_notes && (
                    <div>
                      <p className="text-sm font-medium text-gray-700">Note de validation:</p>
                      <p className="text-sm text-gray-900 whitespace-pre-wrap">
                        {selected.validation_notes}
                      </p>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="review-notes"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      Notes (optionnel pour approuver, obligatoire pour rejeter)
                    </label>
                    <textarea
                      id="review-notes"
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Motif du rejet ou note de validation…"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                    />
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-2">
                {selected.validation_status !== 'approved' && (
                  <button
                    onClick={() => void handleApprove()}
                    disabled={submitting}
                    className="w-full inline-flex justify-center items-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-green-600 text-base font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto sm:text-sm"
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Approuver
                  </button>
                )}
                {selected.validation_status !== 'rejected' && (
                  <button
                    onClick={() => void handleReject()}
                    disabled={submitting}
                    className="w-full inline-flex justify-center items-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto sm:text-sm"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Rejeter
                  </button>
                )}
                <button
                  onClick={closeReview}
                  disabled={submitting}
                  className="w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary disabled:opacity-50 sm:w-auto sm:text-sm"
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
