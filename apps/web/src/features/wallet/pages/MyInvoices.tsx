import { useQueryClient } from '@tanstack/react-query';
import {
  Download,
  FileText,
  Loader2,
  Paperclip,
  Search,
  Banknote,
  Calendar,
  Eye,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useEffect, useRef, useState, useMemo } from 'react';
import { toast } from 'react-hot-toast';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import MonthlyInvoicesSection from '@/features/wallet/components/MonthlyInvoicesSection';
import { walletKeys } from '@/features/wallet/hooks/queryKeys';
import { useInvoices, useMonthlyInvoices } from '@/features/wallet/hooks/useInvoices';
import {
  JUSTIFICATIF_ACCEPT,
  isJustificatifTooLarge,
  justificatifAffordances,
} from '@/features/wallet/lib/recharge-document';
import { type InvoiceRow, recapitulatifDesignation } from '@/features/wallet/lib/wallet-ledger';
import { recapitulatifFilename, walletService } from '@/features/wallet/services/wallet.service';
import { logger } from '@/lib/logger';
import { htTtcLabel } from '@/lib/money';

const log = logger.child({ module: 'MyInvoices' });

// FCT2 (US-FCT-11..12) — the page hosts BOTH document families: the MONTHLY consolidated
// factures (the real invoices, on proof-verified consumption) and the per-recharge
// « Récapitulatifs de commande » (the relabeled ex-factures — recharges never invoice).
export default function MyInvoices() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const { invoices, loading } = useInvoices(user?.id);
  const monthlyInvoices = useMonthlyInvoices(user?.id);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  // CF-M2 — one hidden file input serves every row; the clicked row's id is held here.
  const attachTargetRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const PAGE_SIZE = 8;

  const filtered = useMemo(() => {
    if (!search) return invoices;
    const q = search.toLowerCase();
    return invoices.filter(
      (f) =>
        f.numero.toLowerCase().includes(q) ||
        recapitulatifDesignation(f.date_emission).toLowerCase().includes(q),
    );
  }, [invoices, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  // The récapitulatif is the SERVER's pdfkit render (bank-details block included), streamed
  // owner-scoped from GET /api/recharges/:id/facture (path kept for wire compat — FCT2 relabel).
  const handleDownloadPDF = async (facture: InvoiceRow) => {
    try {
      const blob = await walletService.downloadFacture(facture.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = recapitulatifFilename(facture.numero);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      log.error({ error }, 'Erreur lors du téléchargement du récapitulatif');
      toast.error('Erreur lors du téléchargement du récapitulatif. Veuillez réessayer.');
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return 'N/A';
    return new Date(d).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  // CF-M2 — attach/replace the justificatif on a PENDING recharge (POST :id/document). The row
  // to attach to is remembered, the shared hidden input opens, and the picked file uploads.
  const handleAttachClick = (facture: InvoiceRow) => {
    attachTargetRef.current = facture.id;
    fileInputRef.current?.click();
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    const targetId = attachTargetRef.current;
    attachTargetRef.current = null;
    if (!file || !targetId) return;
    if (isJustificatifTooLarge(file)) {
      toast.error('Le justificatif ne doit pas dépasser 10 Mo');
      return;
    }
    try {
      setUploadingId(targetId);
      await walletService.uploadJustificatif(targetId, file);
      toast.success('Justificatif envoyé');
      void queryClient.invalidateQueries({ queryKey: walletKeys.recharges(user?.id ?? '') });
    } catch (error) {
      log.error({ error }, 'Erreur lors de l’envoi du justificatif');
      toast.error('Erreur lors de l’envoi du justificatif. Veuillez réessayer.');
    } finally {
      setUploadingId(null);
    }
  };

  // CF-M2 — presigned short-TTL view: fetched on click, consumed immediately in a new tab.
  const handleViewJustificatif = async (facture: InvoiceRow) => {
    try {
      const { url } = await walletService.getJustificatifUrl(facture.id);
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      log.error({ error }, 'Erreur lors de l’ouverture du justificatif');
      toast.error('Erreur lors de l’ouverture du justificatif. Veuillez réessayer.');
    }
  };

  return (
    <div className="space-y-6">
      {/* CF-M2 — the shared hidden input the attach/replace buttons open. */}
      <input
        ref={fileInputRef}
        type="file"
        accept={JUSTIFICATIF_ACCEPT}
        onChange={(e) => void handleFilePicked(e)}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
      {/* FCT2 — the REAL invoices: one consolidated facture per month of consumption. */}
      <MonthlyInvoicesSection
        invoices={monthlyInvoices.data ?? []}
        loading={monthlyInvoices.isLoading}
      />

      {/* The per-recharge « Récapitulatifs de commande » (FCT2 relabel — recharges never invoice). */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {/* Header with search */}
        <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Récapitulatifs de commande</h2>
            <p className="text-xs text-gray-500">
              Un récapitulatif par demande de recharge (ce ne sont pas des factures)
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Rechercher.."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary transition-all w-52"
            />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="p-12 flex items-center justify-center">
            <Loader2 className="animate-spin h-10 w-10 text-[#1A3C34]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">Aucun récapitulatif trouvé</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">
                    Désignation
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">
                    <span className="inline-flex items-center gap-1">
                      <Banknote className="h-3 w-3" /> Montant
                    </span>
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> Date
                    </span>
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-gray-500"></th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((facture) => (
                  <tr
                    key={facture.id}
                    className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
                  >
                    <td className="px-5 py-4">
                      <p className="text-sm font-semibold text-gray-900">
                        {recapitulatifDesignation(facture.date_emission)}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{facture.numero}</p>
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold text-gray-900">
                      {htTtcLabel(facture.montant)}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-500">
                      {formatDate(facture.date_emission)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {/* CF-M2 — justificatif affordances per state: attach/replace while
                            PENDING, view whenever a document exists. */}
                        {(() => {
                          const aff = justificatifAffordances(facture);
                          return (
                            <>
                              {aff.canView && (
                                <button
                                  onClick={() => void handleViewJustificatif(facture)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                                >
                                  <Paperclip className="h-3.5 w-3.5" />
                                  Voir le justificatif
                                </button>
                              )}
                              {aff.canAttach && (
                                <button
                                  onClick={() => handleAttachClick(facture)}
                                  disabled={uploadingId === facture.id}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {uploadingId === facture.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Paperclip className="h-3.5 w-3.5" />
                                  )}
                                  {aff.attachLabel}
                                </button>
                              )}
                            </>
                          );
                        })()}
                        <button
                          onClick={() => handleDownloadPDF(facture)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Voir
                        </button>
                        <button
                          onClick={() => handleDownloadPDF(facture)}
                          className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
                          title="Télécharger"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && filtered.length > PAGE_SIZE && (
          <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {(currentPage - 1) * PAGE_SIZE + 1}–
              {Math.min(currentPage * PAGE_SIZE, filtered.length)} sur {filtered.length}{' '}
              récapitulatifs
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`min-w-[32px] h-8 rounded-lg text-sm font-medium transition-colors ${
                    page === currentPage
                      ? 'bg-[#1A3C34] text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
