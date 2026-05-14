import { ChevronLeft, Download, Printer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate, useParams } from 'react-router-dom';

import logoImage from '../assets/logo.png';
import OwnerNavigation from '../components/OwnerNavigation';
import { TOODOOH_STATEMENT_EMITTER, OWNER_STATEMENT_FOOTER } from '../constants/ownerStatement';
import { getOwnerStatementDetail } from '../data/ownerStatementDetails';
import { authService } from '../services/auth.service';
import { exportService } from '../services/export.service';
import { useAuthStore } from '../stores/auth.store';
import type { OwnerStatementDetail, StatementRecipientDisplay } from '../types/ownerStatement';
import { buildStatementRecipient } from '../utils/statementRecipient';

export default function OwnerStatementDetailPage() {
  const { statementId } = useParams<{ statementId: string }>();
  const navigate = useNavigate();
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';

  const [detail, setDetail] = useState<OwnerStatementDetail | null>(null);
  const [recipient, setRecipient] = useState<StatementRecipientDisplay | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (!statementId) {
      navigate('/owner-statements');
      return;
    }
    const d = getOwnerStatementDetail(statementId);
    if (!d) {
      navigate('/owner-statements');
      return;
    }
    setDetail(d);
    setRecipient(buildStatementRecipient(null, user.email));
    let cancelled = false;
    (async () => {
      try {
        const profile = await authService.getBusinessProfile();
        if (!cancelled) {
          setRecipient(buildStatementRecipient(profile, user.email));
        }
      } catch {
        /* garde le destinataire par défaut */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, statementId, navigate]);

  const formatMoney = useCallback((n: number) => {
    return new Intl.NumberFormat('fr-TN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  }, []);

  const issuedLong = detail
    ? new Date(detail.issueDate).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = async () => {
    if (!detail || !recipient) return;
    try {
      setDownloading(true);
      const name = await exportService.exportOwnerStatementPdf({ detail, recipient });
      toast.success(`PDF enregistré : ${name}`);
    } catch (_e) {
      toast.error('Impossible de générer le PDF');
    } finally {
      setDownloading(false);
    }
  };

  if (!user || !detail || !recipient) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#00B3A6]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/80 print:bg-white">
      <div className="flex min-h-screen">
        <div className="no-print">
          <OwnerNavigation isDisabled={isDisabled} />
        </div>

        <div className="flex-1 flex flex-col overflow-hidden print:w-full min-w-0">
          {/* Barre actions — masquée à l’impression */}
          <header className="no-print bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => navigate('/owner-statements')}
                  className="inline-flex items-start gap-2 text-left group"
                >
                  <ChevronLeft className="w-5 h-5 text-gray-500 shrink-0 mt-0.5 group-hover:text-gray-800" />
                  <span>
                    <span className="block text-lg font-bold text-gray-900">
                      Relevé {detail.reference}
                    </span>
                    <span className="block text-sm text-gray-500 mt-0.5">Émis le {issuedLong}</span>
                  </span>
                </button>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-800 text-sm font-medium hover:bg-gray-50 shadow-sm"
                  >
                    <Printer className="w-4 h-4 text-gray-600" />
                    Imprimer
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    disabled={downloading}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-200 hover:bg-emerald-100 text-emerald-950 text-sm font-semibold disabled:opacity-50 shadow-sm"
                  >
                    <Download className="w-4 h-4" />
                    Télécharger PDF
                  </button>
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto print:overflow-visible">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 print:py-4 print:max-w-none">
              <div
                id="releve-document"
                className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden print:shadow-none print:border print:rounded-lg"
              >
                <div className="p-8 sm:p-10 print:p-6">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-6 border-b border-gray-100 pb-8 mb-8">
                    <div>
                      <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Relevé</h1>
                      <p className="text-sm text-gray-500 mt-2">{detail.reference}</p>
                      <p className="text-sm text-gray-500 mt-1">Émis le {issuedLong}</p>
                    </div>
                    <div className="flex items-center shrink-0">
                      <img
                        src={logoImage}
                        alt="Toodooh"
                        className="h-10 w-auto max-w-[178px] object-contain"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-10">
                    <div>
                      <h2 className="text-sm font-bold text-gray-900 mb-3">Émetteur</h2>
                      <div className="text-sm text-gray-600 space-y-1">
                        <p className="font-bold text-gray-800">
                          {TOODOOH_STATEMENT_EMITTER.legalName}
                        </p>
                        <p>{TOODOOH_STATEMENT_EMITTER.addressLine1}</p>
                        <p>{TOODOOH_STATEMENT_EMITTER.cityPostal}</p>
                        <p>TVA: {TOODOOH_STATEMENT_EMITTER.tva}</p>
                        <p>{TOODOOH_STATEMENT_EMITTER.email}</p>
                      </div>
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-gray-900 mb-3">
                        {recipient.contactName}
                      </h2>
                      <div className="text-sm text-gray-600 space-y-1">
                        <p className="font-normal">{recipient.companyName}</p>
                        <p>{recipient.addressLine1}</p>
                        <p>{recipient.cityPostal}</p>
                        <p>{recipient.email}</p>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto border border-gray-100 rounded-xl">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                          <th className="px-4 py-3 pl-5">Description</th>
                          <th className="px-4 py-3 text-center w-24">Quantité</th>
                          <th className="px-4 py-3 text-right whitespace-nowrap">Prix unitaire</th>
                          <th className="px-4 py-3 pr-5 text-right whitespace-nowrap">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {detail.lineItems.map((row, idx) => (
                          <tr key={`${row.description}-${idx}`}>
                            <td className="px-4 py-3.5 pl-5 text-gray-900">{row.description}</td>
                            <td className="px-4 py-3.5 text-center text-gray-700 tabular-nums">
                              {row.quantity}
                            </td>
                            <td className="px-4 py-3.5 text-right text-gray-700 tabular-nums whitespace-nowrap">
                              {formatMoney(row.unitPrice)} TND
                            </td>
                            <td className="px-4 py-3.5 pr-5 text-right font-medium text-gray-900 tabular-nums whitespace-nowrap">
                              {formatMoney(row.total)} TND
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-8 flex flex-col items-end gap-2 text-sm">
                    <p className="text-gray-700">
                      Sous-total HT :{' '}
                      <span className="tabular-nums font-medium">
                        {formatMoney(detail.subtotalHT)} TND
                      </span>
                    </p>
                    <div className="w-56 border-t border-gray-200 pt-2 mt-1">
                      <p className="text-base font-bold text-gray-900">
                        Total TTC :{' '}
                        <span className="tabular-nums">{formatMoney(detail.totalTTC)} TND</span>
                      </p>
                    </div>
                  </div>

                  <p className="mt-12 text-center text-xs text-gray-500 leading-relaxed max-w-xl mx-auto">
                    {OWNER_STATEMENT_FOOTER}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
