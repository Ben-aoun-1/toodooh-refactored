import {
  Download,
  FileText,
  Loader2,
  Search,
  DollarSign,
  Calendar,
  Eye,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useEffect, useState, useMemo } from 'react';

import { logger } from '../../../lib/logger';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../auth/stores/auth.store';
import { generateInvoicePDF } from '../services/invoice-pdf.service';

const log = logger.child({ module: 'MyInvoices' });

export default function MyInvoices() {
  const user = useAuthStore((state) => state.user);
  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 8;

  useEffect(() => {
    async function fetchInvoices() {
      setLoading(true);
      if (!user) return;

      try {
        const { data, error } = await supabase.rpc('get_user_invoices_with_monthly', {
          p_user_id: user.id,
        });

        if (error) {
          log.error({ error }, 'Error fetching invoices');
          let fallbackData, fallbackError;
          const fallbackQuery = await supabase
            .from('factures_with_campaigns')
            .select('*')
            .eq('user_id', user.id)
            .order('date_emission', { ascending: false });

          if (fallbackQuery.error && fallbackQuery.error.code === 'PGRST116') {
            const directQuery = await supabase
              .from('factures')
              .select('*')
              .eq('user_id', user.id)
              .order('date_emission', { ascending: false });
            fallbackData = directQuery.data;
            fallbackError = directQuery.error;
          } else {
            fallbackData = fallbackQuery.data;
            fallbackError = fallbackQuery.error;
          }

          if (fallbackError) {
            log.error({ fallbackError }, 'Error in fallback query');
            setInvoices([]);
          } else {
            setInvoices(fallbackData || []);
          }
        } else {
          // TODO(phase-1): typed source [supabase] — see #15
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const formattedData = (data || []).map((invoice: any) => ({
            ...invoice,
            date_emission: invoice.date_emission
              ? new Date(invoice.date_emission).toISOString()
              : null,
            date_echeance: invoice.date_echeance
              ? new Date(invoice.date_echeance).toISOString()
              : null,
          }));
          setInvoices(formattedData);
        }
      } catch (err) {
        log.error({ err }, 'Error in fetchInvoices');
        setInvoices([]);
      }

      setLoading(false);
    }
    fetchInvoices();
  }, [user]);

  const filtered = useMemo(() => {
    if (!search) return invoices;
    const q = search.toLowerCase();
    return invoices.filter(
      (f) =>
        f.numero?.toLowerCase().includes(q) ||
        f.description?.toLowerCase().includes(q) ||
        f.campaign_name?.toLowerCase().includes(q),
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

  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDownloadPDF = async (facture: any) => {
    if (!user) return;
    try {
      await generateInvoicePDF(
        {
          id: facture.id,
          numero: facture.numero,
          montant: Number(facture.montant || 0),
          date_emission: facture.date_emission || new Date(),
          date_echeance: facture.date_echeance || null,
          description: facture.description,
          campaign_name: facture.campaign_name,
          client_name: facture.client_name,
          statut: facture.statut || 'payee',
        },
        user.id,
      );
    } catch (error) {
      log.error({ error }, 'Erreur lors de la génération du PDF');
      alert('Erreur lors de la génération du PDF. Veuillez réessayer.');
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

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      amount,
    ) + ' TND';

  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getDesignation = (f: any) => {
    if (f.description) return f.description;
    if (f.campaign_name) return f.campaign_name;
    const d = f.date_emission ? new Date(f.date_emission) : null;
    if (d) {
      const month = d.toLocaleDateString('fr-FR', { month: 'long' });
      const year = d.getFullYear();
      return `Facture ${month.charAt(0).toUpperCase() + month.slice(1)} ${year}`;
    }
    return 'Facture';
  };

  return (
    <div className="space-y-6">
      {/* Table card */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {/* Header with search */}
        <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Liste des factures</h2>
            <p className="text-xs text-gray-500">Consultez et téléchargez vos factures</p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Rechercher.."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#76E6AB]/40 focus:border-[#76E6AB] transition-all w-52"
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
            <p className="text-sm text-gray-500">Aucune facture trouvée</p>
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
                      <DollarSign className="h-3 w-3" /> Montant
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
                        {getDesignation(facture)}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{facture.numero}</p>
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold text-gray-900">
                      {formatCurrency(Number(facture.montant || 0))}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-500">
                      {formatDate(facture.date_emission)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2">
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
              {Math.min(currentPage * PAGE_SIZE, filtered.length)} sur {filtered.length} factures
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
