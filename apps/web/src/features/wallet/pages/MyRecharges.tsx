import {
  Wallet,
  Plus,
  Clock,
  Search,
  DollarSign,
  X,
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
import { useCreateRecharge } from '@/features/wallet/hooks/useCreateRecharge';
import { useWalletTransactions } from '@/features/wallet/hooks/useWalletTransactions';

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
  const { balance, transactions, loading, isError } = useWalletTransactions(user?.id);
  const createRecharge = useCreateRecharge(user?.id);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [showNewRechargeModal, setShowNewRechargeModal] = useState(false);
  const [newRecharge, setNewRecharge] = useState({
    amount: '',
    payment_method: 'card',
    description: '',
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isError) toast.error('Erreur lors du chargement');
  }, [isError]);

  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 8;

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (activeTab === 'recharges' && t.type !== 'recharge') return false;
      if (activeTab === 'expenses' && t.type !== 'expense') return false;
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

  const getMethodLabel = (method: string) => {
    switch (method) {
      case 'card':
        return 'Carte bancaire';
      case 'bank':
        return 'Virement bancaire';
      case 'cash':
        return 'Espèces';
      default:
        return 'Autre';
    }
  };

  const handleQuickRecharge = (amount: number) => {
    setNewRecharge({ amount: amount.toString(), payment_method: 'card', description: '' });
    setShowNewRechargeModal(true);
  };

  const handleSubmitRecharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) {
      toast.error('Vous devez être connecté');
      return;
    }
    if (!newRecharge.amount || parseFloat(newRecharge.amount) < 10) {
      toast.error('Le montant minimum est de 10 TND');
      return;
    }

    try {
      setSubmitting(true);
      await createRecharge.mutateAsync({
        amount: parseFloat(newRecharge.amount),
        payment_method: newRecharge.payment_method,
        description:
          newRecharge.description || `Recharge ${getMethodLabel(newRecharge.payment_method)}`,
      });
      toast.success('Recharge créée avec succès ! En attente de validation.');
      setNewRecharge({ amount: '', payment_method: 'card', description: '' });
      setShowNewRechargeModal(false);
    } catch (_error) {
      toast.error('Erreur lors de la création de la recharge');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (d: Date) =>
    d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      amount,
    ) + ' TND';

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
          <p className="text-3xl md:text-4xl font-bold text-white tracking-tight tabular-nums">
            {loading ? '...' : formatCurrency(balance)}
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
                className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#76E6AB]/40 focus:border-[#76E6AB] transition-all w-44"
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
                      <DollarSign className="h-3 w-3" /> Montant
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
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            tx.type === 'recharge' ? 'bg-green-50' : 'bg-gray-100'
                          }`}
                        >
                          {tx.type === 'recharge' ? (
                            <ArrowDownLeft className="h-4 w-4 text-green-600" />
                          ) : (
                            <ArrowUpRight className="h-4 w-4 text-gray-500" />
                          )}
                        </div>
                        <span className="text-sm font-medium text-gray-900">{tx.designation}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`text-sm font-semibold ${tx.type === 'recharge' ? 'text-green-600' : 'text-gray-900'}`}
                      >
                        {tx.type === 'recharge' ? '+' : '-'}
                        {formatCurrency(tx.amount)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-500">{formatDate(tx.date)}</td>
                    <td className="px-5 py-4 text-sm text-gray-500">{tx.paymentMethod || ''}</td>
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

      {/* ── New Recharge Modal ── */}
      {showNewRechargeModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl border border-gray-100">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Nouvelle Recharge</h3>
                <p className="text-sm text-gray-500">Rechargez votre compte</p>
              </div>
              <button
                onClick={() => setShowNewRechargeModal(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleSubmitRecharge} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="amount">
                  Montant (TND) *
                </label>
                <input
                  type="number"
                  value={newRecharge.amount}
                  onChange={(e) => setNewRecharge({ ...newRecharge, amount: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#76E6AB]/40 focus:border-[#76E6AB] transition-all"
                  placeholder="Entrez le montant"
                  min="10"
                  step="0.01"
                  required
                  id="amount"
                />
                <p className="text-xs text-gray-400 mt-1">Montant minimum : 10 TND</p>
              </div>

              <div>
                <label
                  className="block text-sm font-medium text-gray-700 mb-2"
                  htmlFor="payment-method"
                >
                  Méthode de paiement *
                </label>
                <select
                  value={newRecharge.payment_method}
                  onChange={(e) =>
                    setNewRecharge({ ...newRecharge, payment_method: e.target.value })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#76E6AB]/40 focus:border-[#76E6AB] transition-all"
                  required
                  id="payment-method"
                >
                  <option value="card">Carte bancaire</option>
                  <option value="bank">Virement bancaire</option>
                  <option value="cash">Espèces</option>
                </select>
              </div>

              <div>
                <label
                  className="block text-sm font-medium text-gray-700 mb-2"
                  htmlFor="description"
                >
                  Description (optionnel)
                </label>
                <textarea
                  value={newRecharge.description}
                  onChange={(e) => setNewRecharge({ ...newRecharge, description: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#76E6AB]/40 focus:border-[#76E6AB] transition-all resize-none"
                  placeholder="Description de la recharge"
                  id="description"
                ></textarea>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <Clock className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-yellow-800 font-medium">En attente de validation</p>
                    <p className="text-xs text-yellow-700 mt-1">
                      Votre recharge sera validée par un administrateur avant d&apos;être créditée
                      sur votre compte.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewRechargeModal(false);
                    setNewRecharge({ amount: '', payment_method: 'card', description: '' });
                  }}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-all font-medium"
                  disabled={submitting}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-3 px-6 rounded-xl font-semibold text-white transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: '#76E6AB' }}
                >
                  {submitting ? 'Envoi en cours...' : 'Confirmer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
