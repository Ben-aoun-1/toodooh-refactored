import {
  Wallet,
  Plus,
  Search,
  Banknote,
  ArrowUpRight,
  ArrowDownLeft,
  FileText,
  Calendar,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import BonReadyModal from '@/features/wallet/components/BonReadyModal';
import NewRechargeModal from '@/features/wallet/components/NewRechargeModal';
import PendingBonsSection from '@/features/wallet/components/PendingBonsSection';
import RechargeRequestsSection from '@/features/wallet/components/RechargeRequestsSection';
import {
  useCreateBon,
  useCreateVirement,
  useDepositSignedBon,
  useMyRecharges,
} from '@/features/wallet/hooks/useRechargeDemandes';
import { useWalletTransactions } from '@/features/wallet/hooks/useWalletTransactions';
import { isExpenseView } from '@/features/wallet/lib/wallet-ledger';
import type { RechargeRow } from '@/features/wallet/services/wallet.service';
import { htTtcLabel } from '@/lib/money';

const QUICK_AMOUNTS = [
  { value: 1000, label: '1 000 TND', tag: 'Populaire' },
  { value: 2500, label: '2 500 TND', tag: 'Populaire' },
  { value: 5000, label: '5 000 TND', tag: 'Populaire' },
  { value: 10000, label: '10 000 TND', tag: 'Recommandé' },
];

type TabFilter = 'all' | 'recharges' | 'expenses';

export default function MyRecharges() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const { spendableTnd, totalTnd, transactions, loading, isError } = useWalletTransactions(
    user?.id,
  );
  // FCT1 — the demandes read (same cache as the ledger) + the three v2 mutations.
  const myRecharges = useMyRecharges(user?.id);
  const createVirement = useCreateVirement(user?.id);
  const createBon = useCreateBon(user?.id);
  const depositSignedBon = useDepositSignedBon(user?.id);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [showNewRechargeModal, setShowNewRechargeModal] = useState(false);
  const [newAmount, setNewAmount] = useState('');
  // FCT1 — the freshly generated bon for the « Votre bon de commande est prêt » popup.
  const [bonReady, setBonReady] = useState<RechargeRow | null>(null);

  useEffect(() => {
    if (isError) toast.error('Erreur lors du chargement');
  }, [isError]);

  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 8;

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (activeTab === 'recharges' && t.type !== 'recharge') return false;
      if (activeTab === 'expenses' && !isExpenseView(t)) return false;
      if (searchQuery) {
        return t.designation.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    });
  }, [transactions, activeTab, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / PAGE_SIZE));
  const paginatedTransactions = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredTransactions.slice(start, start + PAGE_SIZE);
  }, [filteredTransactions, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery]);

  const handleQuickRecharge = (amount: number) => {
    setNewAmount(amount.toString());
    setShowNewRechargeModal(true);
  };

  // FCT1 (US-FCT-3/4) — one multipart call, the justificatif is MANDATORY (the modal enforces it).
  const handleSubmitVirement = async (amount: number, file: File) => {
    try {
      const created = await createVirement.mutateAsync({ amount, file });
      toast.success(`Demande ${created.reference} envoyée — en attente de réception du virement.`, {
        duration: 6000,
      });
      setNewAmount('');
      setShowNewRechargeModal(false);
    } catch (_error) {
      toast.error('Erreur lors de la création de la demande de recharge');
    }
  };

  // FCT1 (US-FCT-5/6) — the server generates + stores the bon PDF; the popup takes over.
  const handleSubmitBon = async (amount: number) => {
    try {
      const created = await createBon.mutateAsync({ amount });
      setNewAmount('');
      setShowNewRechargeModal(false);
      setBonReady(created);
    } catch (_error) {
      toast.error('Erreur lors de la génération du bon de commande');
    }
  };

  // FCT1 (US-FCT-7) — deposit the signed bon: « Bon émis » → « Bon retourné signé ».
  const handleDepositSigned = async (id: string, file: File) => {
    try {
      const updated = await depositSignedBon.mutateAsync({ id, file });
      toast.success(`Bon signé ${updated.reference} déposé — en cours de traitement.`, {
        duration: 6000,
      });
    } catch (_error) {
      toast.error('Erreur lors du dépôt du bon signé');
    }
  };

  const demandes = myRecharges.data ?? [];
  const pendingBons = demandes.filter((r) => r.status === 'bon_issued');

  const formatDate = (d: Date) =>
    d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <div className="space-y-6">
      {/* ── Balance Card ── */}
      <div
        className="rounded-2xl p-6 md:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative overflow-hidden"
        style={{ background: '#1A3C34' }}
      >
        <div
          className="absolute -bottom-16 -left-16 w-64 h-64 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #76E6AB 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-8 left-8 w-40 h-40 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #ffffff 0%, transparent 70%)' }}
        />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
              <Wallet className="h-4 w-4 text-white/80" />
            </div>
            <span className="text-sm text-white/70 font-medium">Solde disponible</span>
          </div>
          {/* CF-U1 (Mejri item 6) — the solde carries its TTC like every advertiser montant.
              FIX2 — the headline is SPENDABLE (what the funded gates enforce); the full balance
              rides beneath as « Solde total ». */}
          <p className="text-3xl md:text-4xl font-bold text-white tracking-tight tabular-nums">
            {loading ? '...' : htTtcLabel(spendableTnd)}
          </p>
          <p className="mt-1 text-sm text-white/70 tabular-nums">
            {loading ? '' : `Solde total : ${htTtcLabel(totalTnd)}`}
          </p>
        </div>
        <div className="flex items-center gap-4 relative z-10">
          <button
            onClick={() => setShowNewRechargeModal(true)}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors"
            style={{ background: '#76E6AB', color: '#1A3C34' }}
          >
            Recharger
          </button>
          <button
            onClick={() => navigate('/my-invoices')}
            className="flex items-center gap-2 text-white/80 hover:text-white text-sm font-medium transition-colors"
          >
            <FileText className="h-4 w-4" />
            Mes factures
          </button>
        </div>
      </div>

      {/* ── Quick Recharge ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex-shrink-0">
          <p className="text-sm font-semibold text-gray-900">Rechargement rapide</p>
          <p className="text-xs text-gray-500">Montants fréquemment utilisés</p>
        </div>
        <div className="flex flex-wrap gap-3 sm:ml-auto">
          {QUICK_AMOUNTS.map((q) => (
            <button
              key={q.value}
              onClick={() => handleQuickRecharge(q.value)}
              className="flex items-center gap-3 px-5 py-3 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors group"
            >
              <div>
                <p className="text-sm font-bold text-gray-900 text-left">{q.label}</p>
                <p className="text-[11px] text-gray-400">{q.tag}</p>
              </div>
              <Plus className="h-4 w-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
            </button>
          ))}
        </div>
      </div>

      {/* ── FCT1 — the signed-bon deposit sub-section (renders only with « Bon émis » rows) ── */}
      <PendingBonsSection
        bons={pendingBons}
        depositing={depositSignedBon.isPending}
        onDepositSigned={(id, file) => {
          void handleDepositSigned(id, file);
        }}
      />

      {/* ── FCT1 — the demandes list with the per-method status chips ── */}
      <RechargeRequestsSection recharges={demandes} loading={myRecharges.isLoading} />

      {/* ── Transactions ── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Dernières transactions</h2>
            <p className="text-xs text-gray-500">Historique de vos opérations récentes</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher.."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary transition-all w-44"
              />
            </div>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
              {(['all', 'recharges', 'expenses'] as TabFilter[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 font-medium transition-colors ${
                    activeTab === tab ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {tab === 'all' ? 'Tous' : tab === 'recharges' ? 'Recharges' : 'Dépenses'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="p-12 flex items-center justify-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#1A3C34]"></div>
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="p-12 text-center">
            <Wallet className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">Aucune transaction trouvée</p>
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
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">
                    Modes de paiement
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedTransactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        {/* FIX2 — four SERVED row types, sign from the wire: recharge credit
                            (green ↓), « Engagé » (amber ↑ — informational, balance unmoved),
                            « Réglé » NET settlement (gray ↑), SIGNED adjustment (green ↓/red ↑). */}
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            tx.tone === 'credit'
                              ? 'bg-green-50'
                              : tx.tone === 'engaged'
                                ? 'bg-amber-50'
                                : tx.type === 'adjustment'
                                  ? 'bg-red-50'
                                  : 'bg-gray-100'
                          }`}
                        >
                          {tx.tone === 'credit' ? (
                            <ArrowDownLeft className="h-4 w-4 text-green-600" />
                          ) : tx.tone === 'engaged' ? (
                            <ArrowUpRight className="h-4 w-4 text-amber-600" />
                          ) : tx.type === 'adjustment' ? (
                            <ArrowUpRight className="h-4 w-4 text-red-600" />
                          ) : (
                            <ArrowUpRight className="h-4 w-4 text-gray-500" />
                          )}
                        </div>
                        <span className="text-sm font-medium text-gray-900">{tx.designation}</span>
                        {tx.badge && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              tx.badge === 'Engagé'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {tx.badge}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`text-sm font-semibold ${
                          tx.tone === 'credit'
                            ? 'text-green-600'
                            : tx.tone === 'engaged'
                              ? 'text-amber-700'
                              : tx.type === 'adjustment'
                                ? 'text-red-600'
                                : 'text-gray-900'
                        }`}
                      >
                        {tx.amountTnd < 0 ? '-' : '+'}
                        {htTtcLabel(Math.abs(tx.amountTnd))}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-500">{formatDate(tx.date)}</td>
                    <td className="px-5 py-4 text-sm text-gray-500">{tx.method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && filteredTransactions.length > PAGE_SIZE && (
          <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {(currentPage - 1) * PAGE_SIZE + 1}–
              {Math.min(currentPage * PAGE_SIZE, filteredTransactions.length)} sur{' '}
              {filteredTransactions.length} transactions
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

      {/* ── FCT1 — the two-step montant → méthode modal (two methods, nothing else) ── */}
      {showNewRechargeModal && (
        <NewRechargeModal
          initialAmount={newAmount}
          submitting={createVirement.isPending || createBon.isPending}
          onClose={() => {
            setShowNewRechargeModal(false);
            setNewAmount('');
          }}
          onSubmitVirement={(amount, file) => {
            void handleSubmitVirement(amount, file);
          }}
          onSubmitBon={(amount) => {
            void handleSubmitBon(amount);
          }}
        />
      )}

      {/* ── FCT1 — « Votre bon de commande est prêt » ── */}
      {bonReady && <BonReadyModal recharge={bonReady} onClose={() => setBonReady(null)} />}
    </div>
  );
}
