import { useQuery } from '@tanstack/react-query';
import { Calendar, ChevronRight, Banknote, Download, Eye, Wallet } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import OwnerNotificationsBell from '@/features/screenhost/components/OwnerNotificationsBell';
import { screenhostKeys } from '@/features/screenhost/hooks/queryKeys';
import { factureMoney, formatDateFr, formatTnd } from '@/features/screenhost/lib/facture-view';
import {
  factureFilename,
  facturesService,
  type OwnerFactureRow,
} from '@/features/screenhost/services/factures.service';

// REV2 — « Mes factures », the finances section formerly titled « Relevés de reversement ». One line
// per settled month per venue: the designation the server rendered, the FS- reference beneath it,
// the montant TTC, the date d'émission, and the two actions.
//
// NO STATUS ON A LINE (US-REV §5). The lifecycle is real data, but a screenhost hears about it
// through the bell, never through a badge here. The wire does not even carry `status`, so there is
// nothing to render by accident — and a source pin keeps it that way.
//
// « Télécharger » DOES NOT NAVIGATE. It streams the stored PDF straight from the row, because the
// common case is an owner who wants the document to print, not a screen to read.
export default function OwnerFacturesPage() {
  const navigate = useNavigate();
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';
  const facturesQuery = useQuery({
    queryKey: screenhostKeys.factures(user?.id ?? ''),
    queryFn: () => facturesService.list(),
    enabled: !!user?.id,
  });
  const factures = facturesQuery.data ?? [];
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownload = useCallback(async (row: OwnerFactureRow) => {
    try {
      setDownloadingId(row.id);
      const blob = await facturesService.download(row.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = factureFilename(row.reference);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (_e) {
      toast.error('Impossible de télécharger la facture. Veuillez réessayer.');
    } finally {
      setDownloadingId(null);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  if (!user) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/80">
      <div className="flex min-h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/owner-revenue')}
                  className="inline-flex items-center gap-2 text-base font-semibold text-[#171717] hover:opacity-80 min-w-0"
                >
                  <Wallet className="w-5 h-5 text-[#5C5C5C] flex-shrink-0" />
                  <span className="hidden sm:inline">Mes revenus</span>
                  <ChevronRight className="w-5 h-5 text-[#9CA3AF] flex-shrink-0 hidden sm:inline" />
                  <span className="truncate">Mes factures</span>
                </button>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => navigate('/owner-calendar-devices')}
                    aria-label="Piloter mon calendrier de diffusion"
                    title="Piloter mon calendrier de diffusion"
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-primary hover:bg-brand-primary/90 text-gray-900 text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap"
                  >
                    <Calendar className="h-4 w-4 flex-shrink-0" />
                    <span className="hidden lg:inline">Piloter mon calendrier de diffusion</span>
                  </button>
                  <OwnerNotificationsBell userId={user?.id} />
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              <div className="mb-4">
                <PageHeader title="Toutes les factures" />
              </div>
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px]">
                    <thead>
                      <tr className="bg-gray-100/90 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                        <th className="px-5 py-3 pl-6">Désignation</th>
                        <th className="px-5 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            <Banknote className="w-3.5 h-3.5" />
                            Montant
                          </span>
                        </th>
                        <th className="px-5 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5" />
                            Date d’émission
                          </span>
                        </th>
                        <th className="px-5 py-3 pr-6 text-right w-[260px]">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {factures.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-gray-500 text-sm">
                            {facturesQuery.isLoading
                              ? 'Chargement...'
                              : 'Aucune facture pour le moment.'}
                          </td>
                        </tr>
                      ) : (
                        factures.map((row) => (
                          <tr key={row.id} className="hover:bg-gray-50/80 transition-colors">
                            <td className="px-5 py-4 pl-6">
                              <p className="text-sm font-medium text-gray-900">{row.designation}</p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {row.screenhost_name} ({row.reference})
                              </p>
                            </td>
                            <td className="px-5 py-4 text-sm font-medium text-gray-900 tabular-nums">
                              {formatTnd(factureMoney(row.total_sh_tnd).ttcTnd)}
                            </td>
                            <td className="px-5 py-4 text-sm text-gray-700 tabular-nums">
                              {formatDateFr(row.created_at)}
                            </td>
                            <td className="px-5 py-4 pr-6">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => navigate(`/owner-factures/${row.id}`)}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
                                  aria-label={`Voir la facture ${row.reference}`}
                                >
                                  <Eye className="w-4 h-4" />
                                  Voir
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDownload(row)}
                                  disabled={downloadingId === row.id}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
                                  aria-label={`Télécharger la facture ${row.reference}`}
                                >
                                  <Download className="w-4 h-4" />
                                  Télécharger
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
