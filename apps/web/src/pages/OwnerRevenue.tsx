import {
  Wallet,
  FileText,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  DollarSign,
  Calendar,
  X,
  ArrowRight,
  Building2,
  UploadCloud,
} from 'lucide-react';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';

import OwnerNavigation from '../components/OwnerNavigation';
import OwnerNotificationsBell from '../components/OwnerNotificationsBell';
import { supabase } from '../lib/supabase';
import { authService } from '../services/auth.service';
import { revenueService, RevenueData, RevenueStats } from '../services/revenue.service';
import { useAuthStore } from '../stores/auth.store';

type TxFilter = 'all' | 'recharges' | 'depenses';

interface OwnerTransactionRow {
  id: string;
  label: string;
  amount: number;
  date: string;
  paymentMode: string;
}

export default function OwnerRevenue() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';
  const [loading, setLoading] = useState(true);

  const [revenueStats, setRevenueStats] = useState<RevenueStats | null>(null);
  const [periodRevenues, setPeriodRevenues] = useState<RevenueData[]>([]);

  const [txSearch, setTxSearch] = useState('');
  const [txFilter, setTxFilter] = useState<TxFilter>('all');

  const [showPaymentMethodModal, setShowPaymentMethodModal] = useState(false);
  const [showBankDetailsModal, setShowBankDetailsModal] = useState(false);
  const [registeredPaymentLabel, setRegisteredPaymentLabel] = useState('RIB Mohamed Ben Mohamed');

  const [bankFullName, setBankFullName] = useState('');
  const [bankRib, setBankRib] = useState('');
  const [bankIban, setBankIban] = useState('');
  const [bankDocFile, setBankDocFile] = useState<File | null>(null);
  const [existingBankDocPath, setExistingBankDocPath] = useState<string | null>(null);
  const [savingBankDetails, setSavingBankDetails] = useState(false);

  const bankFileInputRef = useRef<HTMLInputElement>(null);
  const hasLoadedData = useRef(false);

  const loadRevenueData = useCallback(async () => {
    try {
      setLoading(true);
      const [stats, periods] = await Promise.all([
        revenueService.getRevenueStats(),
        revenueService.getRevenueByPeriod('monthly'),
      ]);
      setRevenueStats(stats);
      setPeriodRevenues(periods);
      hasLoadedData.current = true;
    } catch (error) {
      console.error('Erreur chargement revenus:', error);
      toast.error('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  useEffect(() => {
    if (user && !hasLoadedData.current) {
      loadRevenueData();
    }
  }, [user, loadRevenueData]);

  useEffect(() => {
    if (!user || loading) return;
    let cancelled = false;
    (async () => {
      try {
        const profile = await authService.getBusinessProfile();
        const name = profile?.contact_name?.trim();
        const bankName = profile?.bank_account_holder?.trim();
        const bankRibValue = profile?.bank_rib?.trim() || '';
        const bankIbanValue = profile?.bank_iban?.trim() || '';
        const bankDocPath = profile?.bank_doc_path?.trim() || null;
        const effectiveName = bankName || name || '';
        if (!cancelled && effectiveName) {
          setRegisteredPaymentLabel(`RIB ${effectiveName}`);
          setBankFullName((prev) => prev || effectiveName);
          setBankRib(bankRibValue);
          setBankIban(bankIbanValue);
          setExistingBankDocPath(bankDocPath);
        }
      } catch {
        /* garde le libellé par défaut */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('open') === 'bank-details') {
      setShowBankDetailsModal(true);
    }
  }, [location.search]);

  const handleSaveBankDetails = async () => {
    const name = bankFullName.trim();
    const rib = bankRib.trim();
    const iban = bankIban.trim();
    if (!name) {
      toast.error('Indiquez le nom et prénom');
      return;
    }
    if (!rib) {
      toast.error('Indiquez le RIB');
      return;
    }
    if (!iban) {
      toast.error("Indiquez l'IBAN");
      return;
    }
    if (!bankDocFile && !existingBankDocPath) {
      toast.error("Ajoutez le relevé d'identité bancaire");
      return;
    }

    if (!user?.id) {
      toast.error('Session expirée. Veuillez vous reconnecter.');
      return;
    }

    setSavingBankDetails(true);
    try {
      let uploadedPath = existingBankDocPath;
      let signedUrl: string | undefined;

      if (bankDocFile) {
        const maxBytes = 5 * 1024 * 1024;
        if (bankDocFile.size > maxBytes) {
          toast.error('Le fichier ne doit pas dépasser 5 Mo');
          return;
        }

        const ext = bankDocFile.name.split('.').pop() || 'pdf';
        const path = `bank_${user.id}_${Date.now()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('registres')
          .upload(path, bankDocFile);
        if (uploadError) throw uploadError;

        const { data: signedData, error: signedError } = await supabase.storage
          .from('registres')
          .createSignedUrl(path, 604800);
        if (signedError || !signedData?.signedUrl)
          throw signedError || new Error('URL signée introuvable');

        uploadedPath = path;
        signedUrl = signedData.signedUrl;
      }

      const payload: Record<string, unknown> = {
        bank_account_holder: name,
        bank_rib: rib,
        bank_iban: iban,
        bank_details_updated_at: new Date().toISOString(),
      };
      if (uploadedPath) payload.bank_doc_path = uploadedPath;
      if (signedUrl) payload.bank_doc_url = signedUrl;

      const { error: updateError } = await supabase
        .from('business_profiles')
        .update(payload)
        .eq('user_id', user.id);
      if (updateError) throw updateError;

      setExistingBankDocPath(uploadedPath);
      setRegisteredPaymentLabel(`RIB ${name}`);
      setShowBankDetailsModal(false);
      setBankDocFile(null);
      if (bankFileInputRef.current) bankFileInputRef.current.value = '';
      toast.success('Coordonnées bancaires enregistrées');
    } catch (error: any) {
      toast.error(error?.message || 'Erreur lors de la sauvegarde des coordonnées bancaires');
    } finally {
      setSavingBankDetails(false);
    }
  };

  const transactions: OwnerTransactionRow[] = useMemo(() => {
    const sorted = [...periodRevenues].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    return sorted.map((r, index) => ({
      id: r.id,
      label: 'Versement mensuel',
      amount: r.amount,
      date: r.date,
      paymentMode: index === 0 ? 'Virement' : '',
    }));
  }, [periodRevenues]);

  const filteredTransactions = useMemo(() => {
    const q = txSearch.trim().toLowerCase();
    return transactions.filter((row) => {
      if (txFilter === 'recharges' && row.amount <= 0) return false;
      if (txFilter === 'depenses' && row.amount >= 0) return false;
      if (!q) return true;
      const dateFr = formatDateFr(row.date).toLowerCase();
      const amountStr = formatSignedAmount(row.amount).toLowerCase();
      return (
        row.label.toLowerCase().includes(q) ||
        dateFr.includes(q) ||
        amountStr.includes(q) ||
        row.paymentMode.toLowerCase().includes(q)
      );
    });
  }, [transactions, txSearch, txFilter]);

  const formatCurrencyBanner = (value: number) => {
    return new Intl.NumberFormat('fr-TN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatSignedAmount = (value: number) => {
    const abs = new Intl.NumberFormat('fr-TN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(value));
    const sign = value >= 0 ? '+' : '−';
    return `${sign}${abs} TND`;
  };

  const formatDateFr = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const currentBalance = revenueStats?.totalRevenue ?? 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4" />
          <p className="text-gray-600">Chargement…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/80">
      <div className="flex min-h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center gap-4 py-4 sm:py-5">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div
                    className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-full border border-gray-200 bg-white flex items-center justify-center"
                    aria-hidden
                  >
                    <Wallet className="w-6 h-6 sm:w-7 sm:h-7 text-gray-500" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Mes Revenus</h1>
                    <p className="text-sm text-gray-500 mt-1 leading-snug max-w-3xl">
                      Consultez les revenus générés par les campagnes diffusées au sein de votre
                      établissement
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => navigate('/owner-calendar-devices')}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-[#9AE2B0] hover:bg-[#85D99E] text-[#101010] text-sm font-semibold transition-colors"
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
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
              {/* Bandeau revenu actuel — maquette */}
              <div className="rounded-2xl overflow-hidden shadow-md bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-900 p-6 sm:p-8">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                  <div className="flex gap-4 items-start">
                    <div className="flex-shrink-0 w-12 h-12 rounded-full bg-emerald-400/25 flex items-center justify-center ring-2 ring-emerald-300/40">
                      <Wallet className="w-6 h-6 text-emerald-200" strokeWidth={1.75} />
                    </div>
                    <div>
                      <p className="text-white/90 text-sm font-medium mb-1">Revenu actuel</p>
                      <p className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
                        {formatCurrencyBanner(currentBalance)}{' '}
                        <span className="text-xl sm:text-2xl font-semibold text-white/85">TND</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 lg:justify-end">
                    <button
                      type="button"
                      onClick={() => setShowPaymentMethodModal(true)}
                      className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-emerald-200 hover:bg-emerald-100 text-emerald-950 text-sm font-semibold shadow-sm transition-colors whitespace-nowrap"
                    >
                      Modifier mode de paiement
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/owner-statements')}
                      className="inline-flex items-center justify-center gap-2 px-1 sm:px-2 py-2.5 rounded-xl text-white/95 hover:text-white hover:bg-white/10 text-sm font-semibold transition-colors whitespace-nowrap"
                    >
                      <FileText className="w-5 h-5 shrink-0 text-emerald-200" />
                      Mes relevés de versement
                    </button>
                  </div>
                </div>
              </div>

              {/* Dernières transactions */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-5 sm:p-6 border-b border-gray-100">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">Dernières transactions</h2>
                      <p className="text-sm text-gray-500 mt-1">
                        Historique de vos opérations récentes
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="search"
                          placeholder="Rechercher.."
                          value={txSearch}
                          onChange={(e) => setTxSearch(e.target.value)}
                          className="w-full sm:w-56 pl-9 pr-3 py-2 rounded-xl border border-gray-200 bg-gray-50/80 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
                        />
                      </div>
                      <div className="inline-flex rounded-xl bg-gray-100 p-1 gap-0.5">
                        {(
                          [
                            ['all', 'Tous'],
                            ['recharges', 'Recharges'],
                            ['depenses', 'Dépenses'],
                          ] as const
                        ).map(([key, label]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setTxFilter(key)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                              txFilter === key
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

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
                        <th className="px-5 py-3 pr-6">Modes de paiement</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredTransactions.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-gray-500 text-sm">
                            Aucune transaction à afficher.
                          </td>
                        </tr>
                      ) : (
                        filteredTransactions.map((row) => {
                          const incoming = row.amount >= 0;
                          return (
                            <tr key={row.id} className="hover:bg-gray-50/80 transition-colors">
                              <td className="px-5 py-4 pl-6">
                                <div className="flex items-center gap-3">
                                  <div
                                    className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
                                      incoming
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-gray-100 text-gray-500'
                                    }`}
                                  >
                                    {incoming ? (
                                      <ArrowDownLeft className="w-4 h-4" strokeWidth={2.25} />
                                    ) : (
                                      <ArrowUpRight className="w-4 h-4" strokeWidth={2.25} />
                                    )}
                                  </div>
                                  <span className="text-sm font-medium text-gray-900">
                                    {row.label}
                                  </span>
                                </div>
                              </td>
                              <td className="px-5 py-4">
                                <span
                                  className={`text-sm font-semibold tabular-nums ${
                                    incoming ? 'text-emerald-600' : 'text-gray-800'
                                  }`}
                                >
                                  {formatSignedAmount(row.amount)}
                                </span>
                              </td>
                              <td className="px-5 py-4 text-sm text-gray-700 tabular-nums">
                                {formatDateFr(row.date)}
                              </td>
                              <td className="px-5 py-4 pr-6 text-sm text-gray-600">
                                {row.paymentMode || '—'}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal — Gérer votre mode de paiement */}
      {showPaymentMethodModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-method-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPaymentMethodModal(false);
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-2">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 pr-2">
                  <h2
                    id="payment-method-modal-title"
                    className="text-lg font-bold text-gray-900 leading-snug"
                  >
                    Gérer votre mode de paiement
                  </h2>
                  <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                    Vous ne pouvez sélectionner qu&apos;un seul mode de paiement
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPaymentMethodModal(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 shrink-0 -mt-1 -mr-1"
                  aria-label="Fermer"
                >
                  <X className="w-5 h-5" strokeWidth={2} />
                </button>
              </div>
            </div>

            <div className="px-6 py-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Mode de paiement enregistré
              </label>
              <div className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-gray-900 text-sm font-medium">
                {registeredPaymentLabel}
              </div>
            </div>

            <div className="px-6 pb-6 pt-1 flex flex-row flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowPaymentMethodModal(false)}
                className="px-5 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors min-w-[120px]"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPaymentMethodModal(false);
                  setShowBankDetailsModal(true);
                }}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-200 hover:bg-emerald-100 text-emerald-950 text-sm font-semibold transition-colors min-w-[120px]"
              >
                Modifier
                <ArrowRight className="w-4 h-4" strokeWidth={2.25} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal — Détails bancaires */}
      {showBankDetailsModal && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bank-details-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowBankDetailsModal(false);
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8 overflow-hidden border border-gray-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-2">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 pr-2">
                  <h2
                    id="bank-details-modal-title"
                    className="text-lg font-bold text-gray-900 leading-snug"
                  >
                    Détails bancaires
                  </h2>
                  <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                    Veuillez compléter l&apos;ensemble des informations demandées
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBankDetailsModal(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 shrink-0 -mt-1 -mr-1"
                  aria-label="Fermer"
                >
                  <X className="w-5 h-5" strokeWidth={2} />
                </button>
              </div>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3 flex gap-3 items-start">
                <Building2 className="w-5 h-5 text-gray-500 shrink-0 mt-0.5" strokeWidth={1.75} />
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor="bank-full-name"
                    className="block text-xs font-medium text-gray-600 mb-1.5"
                  >
                    Nom Prénom
                  </label>
                  <input
                    id="bank-full-name"
                    type="text"
                    value={bankFullName}
                    onChange={(e) => setBankFullName(e.target.value)}
                    className="w-full bg-transparent border-0 p-0 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-0"
                    placeholder="Nom et prénom du titulaire"
                    autoComplete="name"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3 flex gap-3 items-start">
                <Building2 className="w-5 h-5 text-gray-500 shrink-0 mt-0.5" strokeWidth={1.75} />
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor="bank-rib"
                    className="block text-xs font-medium text-gray-600 mb-1.5"
                  >
                    RIB
                  </label>
                  <input
                    id="bank-rib"
                    type="text"
                    value={bankRib}
                    onChange={(e) => setBankRib(e.target.value)}
                    className="w-full bg-transparent border-0 p-0 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-0 font-mono tracking-wide"
                    placeholder="···· ···· ···· ···· ···· ····"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3 flex gap-3 items-start">
                <Building2 className="w-5 h-5 text-gray-500 shrink-0 mt-0.5" strokeWidth={1.75} />
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor="bank-iban"
                    className="block text-xs font-medium text-gray-600 mb-1.5"
                  >
                    IBAN
                  </label>
                  <input
                    id="bank-iban"
                    type="text"
                    value={bankIban}
                    onChange={(e) => setBankIban(e.target.value)}
                    className="w-full bg-transparent border-0 p-0 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-0 font-mono tracking-wide"
                    placeholder="···· ···· ···· ···· ···· ···· ····"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/40 px-5 py-6 text-center">
                <div className="flex justify-center mb-3">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <UploadCloud className="w-6 h-6" strokeWidth={1.75} />
                  </span>
                </div>
                <p className="text-sm font-medium text-gray-800 mb-1">
                  Ajouter le relevé d&apos;identité bancaire de votre établissement
                </p>
                <p className="text-xs text-gray-500 mb-4">
                  Formats acceptés : PDF, JPG, JPEG, PNG (Max 5 MB)
                </p>
                <input
                  ref={bankFileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setBankDocFile(f ?? null);
                  }}
                />
                <button
                  type="button"
                  onClick={() => bankFileInputRef.current?.click()}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Parcourir les fichiers
                </button>
                {bankDocFile && (
                  <p className="mt-3 text-xs text-gray-600 truncate max-w-full px-2">
                    {bankDocFile.name}
                  </p>
                )}
              </div>
            </div>

            <div className="px-6 pb-6 pt-2 flex flex-row flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowBankDetailsModal(false);
                  setShowPaymentMethodModal(true);
                }}
                className="px-5 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors min-w-[120px]"
              >
                Retour
              </button>
              <button
                type="button"
                onClick={() => void handleSaveBankDetails()}
                disabled={savingBankDetails}
                className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-emerald-200 hover:bg-emerald-100 text-emerald-950 text-sm font-semibold transition-colors min-w-[120px] sm:min-w-[200px]"
              >
                {savingBankDetails ? 'Enregistrement...' : 'Valider le mode de paiement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
