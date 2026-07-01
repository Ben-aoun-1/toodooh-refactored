import { Calendar, ChevronRight, DollarSign, Download, Eye, Wallet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { authService } from '@/features/auth/services/auth.service';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import OwnerNotificationsBell from '@/features/screenhost/components/OwnerNotificationsBell';
import {
  listOwnerStatementSummaries,
  getOwnerStatementDetail,
} from '@/features/screenhost/data/ownerStatementDetails';
import { exportService } from '@/features/screenhost/services/export.service';
import { buildStatementRecipient } from '@/features/screenhost/utils/statementRecipient';

export interface PaymentStatement {
  id: string;
  reference: string;
  title: string;
  amount: number;
  date: string;
}

export default function OwnerStatementsPage() {
  const navigate = useNavigate();
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';
  const statements = useMemo<PaymentStatement[]>(() => listOwnerStatementSummaries(), []);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const formatAmount = useCallback((value: number) => {
    return new Intl.NumberFormat('fr-TN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }, []);

  const formatDateFr = useCallback((iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }, []);

  const handleDownload = useCallback(
    async (s: PaymentStatement) => {
      const detail = getOwnerStatementDetail(s.id);
      if (!detail) {
        toast.error('Relevé introuvable');
        return;
      }
      try {
        setDownloadingId(s.id);
        const profile = await authService.getBusinessProfile();
        const recipient = buildStatementRecipient(profile, user?.email ?? null);
        const name = await exportService.exportOwnerStatementPdf({ detail, recipient });
        toast.success(`Téléchargement : ${name}`);
      } catch (_e) {
        toast.error('Impossible de générer le PDF');
      } finally {
        setDownloadingId(null);
      }
    },
    [user?.email],
  );

  const sortedStatements = useMemo(
    () => [...statements].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [statements],
  );

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
                  className="inline-flex items-center gap-2 text-base font-semibold text-[#171717] hover:opacity-80"
                >
                  <Wallet className="w-5 h-5 text-[#5C5C5C]" />
                  <span>Mes revenus</span>
                  <ChevronRight className="w-5 h-5 text-[#9CA3AF]" />
                  <span>Mes relevés</span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigate('/owner-calendar-devices')}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-primary hover:bg-brand-primary/90 text-gray-900 text-sm font-medium transition-colors"
                  >
                    <Calendar className="h-4 w-4" />
                    Piloter mon calendrier de diffusion
                  </button>
                  <OwnerNotificationsBell userId={user?.id} />
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              <h1 className="text-xl font-semibold text-gray-900 mb-4">Tous les relevés</h1>
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px]">
                    <thead>
                      <tr className="bg-gray-100/90 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                        <th className="px-5 py-3 pl-6">Désignation</th>
                        <th className="px-5 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            <DollarSign className="w-3.5 h-3.5" />
                            Montant
                          </span>
                        </th>
                        <th className="px-5 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5" />
                            Date
                          </span>
                        </th>
                        <th className="px-5 py-3 pr-6 text-right w-[200px]">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortedStatements.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-gray-500 text-sm">
                            Aucun relevé pour le moment.
                          </td>
                        </tr>
                      ) : (
                        sortedStatements.map((row) => (
                          <tr key={row.id} className="hover:bg-gray-50/80 transition-colors">
                            <td className="px-5 py-4 pl-6">
                              <p className="text-sm font-medium text-gray-900">{row.title}</p>
                              <p className="text-xs text-gray-500 mt-0.5">({row.reference})</p>
                            </td>
                            <td className="px-5 py-4 text-sm font-medium text-gray-900 tabular-nums">
                              {formatAmount(row.amount)} TND
                            </td>
                            <td className="px-5 py-4 text-sm text-gray-700 tabular-nums">
                              {formatDateFr(row.date)}
                            </td>
                            <td className="px-5 py-4 pr-6">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => navigate(`/owner-statements/${row.id}`)}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-800 text-sm font-normal hover:bg-gray-50 transition-colors shadow-sm"
                                >
                                  <Eye className="w-4 h-4 text-gray-500" />
                                  Voir
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDownload(row)}
                                  disabled={downloadingId === row.id}
                                  className="inline-flex items-center justify-center p-2 rounded-lg border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
                                  aria-label={`Télécharger le relevé ${row.reference}`}
                                >
                                  <Download className="w-4 h-4" />
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
