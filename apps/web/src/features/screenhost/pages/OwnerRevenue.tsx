import {
  Wallet,
  FileText,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Calendar,
  X,
  ArrowRight,
  Building2,
  UploadCloud,
} from 'lucide-react';
import { useState, useEffect, useRef, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';

import PageHeader from '@/components/PageHeader';
import { useBusinessProfile } from '@/features/auth/hooks/useBusinessProfile';
import { authService } from '@/features/auth/services/auth.service';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import OwnerNotificationsBell from '@/features/screenhost/components/OwnerNotificationsBell';
import { useRevenueByPeriod, useRevenueStats } from '@/features/wallet/hooks/useRevenue';
import { useSaveBankDetails } from '@/features/wallet/hooks/useSaveBankDetails';
import {
  IBAN_ERROR,
  RIB_ERROR,
  isValidIban,
  isValidRib,
  normalizeBankInput,
} from '@/features/wallet/lib/bank-validation';
import {
  PAYOUT_DOC_PREVIEW_CLASS,
  payoutMethodIsRecorded,
} from '@/features/wallet/lib/payout-method';
import { getErrorMessage } from '@/lib/errors';

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

  const [txSearch, setTxSearch] = useState('');
  const [txFilter, setTxFilter] = useState<TxFilter>('all');

  const [showPaymentMethodModal, setShowPaymentMethodModal] = useState(false);
  const [showBankDetailsModal, setShowBankDetailsModal] = useState(false);
  // REV1 — empty by default. This used to seed a hardcoded 'RIB Mohamed Ben Mohamed', so an owner
  // with no payout account on file was shown a stranger's name as their registered mode.
  const [registeredPaymentLabel, setRegisteredPaymentLabel] = useState('');
  // The presigned URL for the bank identity document, fetched when the consultation popup opens.
  const [bankDocUrl, setBankDocUrl] = useState<string | null>(null);

  const [bankFullName, setBankFullName] = useState('');
  const [bankRib, setBankRib] = useState('');
  const [bankIban, setBankIban] = useState('');
  const [bankDocFile, setBankDocFile] = useState<File | null>(null);
  const [existingBankDocPath, setExistingBankDocPath] = useState<string | null>(null);
  // C5-style inline format errors (TN formats, commit-1 ruling) — blur + submit, the
  // same messages as OwnerBankDetailsSlot, mirroring PATCH /api/profile/bank's zod.
  const [bankRibError, setBankRibError] = useState<string | null>(null);
  const [bankIbanError, setBankIbanError] = useState<string | null>(null);

  const bankFileInputRef = useRef<HTMLInputElement>(null);

  const { stats, loading: statsLoading, isError: statsError } = useRevenueStats(user?.id);
  const {
    revenues,
    loading: periodLoading,
    isError: periodError,
  } = useRevenueByPeriod(user?.id, 'monthly');
  const { profile } = useBusinessProfile(user?.id);
  const saveBankDetailsMutation = useSaveBankDetails();

  const loading = statsLoading || periodLoading;

  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  useEffect(() => {
    if (statsError || periodError) {
      toast.error('Erreur lors du chargement des données');
    }
  }, [statsError, periodError]);

  // Pré-remplit le formulaire bancaire à partir du profil chargé.
  useEffect(() => {
    if (!profile) return;
    const name = profile.contact_name?.trim();
    const bankName = profile.bank_account_holder?.trim();
    const bankRibValue = profile.bank_rib?.trim() || '';
    const bankIbanValue = profile.bank_iban?.trim() || '';
    const bankDocPath = profile.bank_doc_path?.trim() || null;
    const effectiveName = bankName || name || '';
    // REV1 — the COORDINATES seed unconditionally. They used to be gated on a non-empty name, so
    // an owner with a RIB but no holder recorded read as having no payout method at all, and the
    // consultation popup would have shown the empty state over real coordinates.
    setBankRib(bankRibValue);
    setBankIban(bankIbanValue);
    setExistingBankDocPath(bankDocPath);
    if (effectiveName) {
      setRegisteredPaymentLabel(effectiveName);
      setBankFullName((prev) => prev || effectiveName);
    }
  }, [profile]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('open') === 'bank-details') {
      setShowBankDetailsModal(true);
    }
  }, [location.search]);

  // REV1 — a payout account is "recorded" only when BOTH coordinates are on file; a half-filled
  // profile must show the empty state rather than a partial mode that cannot receive money.
  const hasRecordedPayoutMethod = payoutMethodIsRecorded(bankRib, bankIban);

  // Resolve the identity document's presigned URL when the consultation popup opens. Presigns are
  // short-lived, so this is fetched per-open rather than cached with the profile.
  useEffect(() => {
    if (!showPaymentMethodModal || !existingBankDocPath) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const url = await authService.getProfileDocumentUrlByCategory('bank');
        if (!cancelled) setBankDocUrl(url);
      } catch {
        // A missing/expired presign must not break the consultation — the coordinates still show
        // and the preview degrades to its "document indisponible" note.
        if (!cancelled) setBankDocUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showPaymentMethodModal, existingBankDocPath]);

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
    const ribInvalid = !isValidRib(rib);
    const ibanInvalid = !isValidIban(iban);
    setBankRibError(ribInvalid ? RIB_ERROR : null);
    setBankIbanError(ibanInvalid ? IBAN_ERROR : null);
    if (ribInvalid || ibanInvalid) return;
    if (!bankDocFile && !existingBankDocPath) {
      toast.error("Ajoutez le relevé d'identité bancaire");
      return;
    }

    if (!user?.id) {
      toast.error('Session expirée. Veuillez vous reconnecter.');
      return;
    }

    if (bankDocFile) {
      const maxBytes = 5 * 1024 * 1024;
      if (bankDocFile.size > maxBytes) {
        toast.error('Le fichier ne doit pas dépasser 5 Mo');
        return;
      }
    }

    try {
      const { bankDocPath } = await saveBankDetailsMutation.mutateAsync({
        userId: user.id,
        name,
        rib,
        iban,
        bankDocFile,
        existingBankDocPath,
      });

      setExistingBankDocPath(bankDocPath);
      setRegisteredPaymentLabel(`RIB ${name}`);
      setShowBankDetailsModal(false);
      setBankDocFile(null);
      if (bankFileInputRef.current) bankFileInputRef.current.value = '';
      toast.success('Coordonnées bancaires enregistrées');
    } catch (error) {
      toast.error(
        getErrorMessage(error) || 'Erreur lors de la sauvegarde des coordonnées bancaires',
      );
    }
  };

  const transactions: OwnerTransactionRow[] = useMemo(() => {
    const sorted = [...revenues].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    return sorted.map((r, index) => ({
      id: r.id,
      // r.screen_name porte désormais le nom de la campagne (revenue.service) — un revenu = la part
      // de cette campagne diffusée dans l'établissement, plus parlant que l'ancien libellé figé.
      label: r.screen_name || 'Versement',
      amount: r.amount,
      date: r.date,
      paymentMode: index === 0 ? 'Virement' : '',
    }));
  }, [revenues]);

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

  const currentBalance = stats?.totalRevenue ?? 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary mx-auto mb-4" />
          <p className="text-gray-600">Chargement…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/80">
      <div className="flex min-h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center gap-4 py-4 sm:py-5">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="min-w-0">
                    <PageHeader
                      title="Mes Revenus"
                      subtitle="Consultez les revenus générés par les campagnes diffusées au sein de votre établissement"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => navigate('/owner-calendar-devices')}
                    aria-label="Piloter mon calendrier de diffusion"
                    title="Piloter mon calendrier de diffusion"
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-brand-primary hover:bg-brand-primary/90 text-[#101010] text-sm font-semibold transition-colors flex-shrink-0 whitespace-nowrap"
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
                            <Banknote className="w-3.5 h-3.5" />
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
        /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- TBD-T: dialog with backdrop-dismiss; proper fix moves the dismiss handler off the dialog element */
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-method-modal-title"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- TBD-T: dialog needs tabIndex for the keyboard backdrop-dismiss handler
          tabIndex={0}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPaymentMethodModal(false);
          }}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
              e.preventDefault();
              setShowPaymentMethodModal(false);
            }
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100"
            role="button"
            tabIndex={0}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
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

            <div className="px-6 py-5 space-y-4">
              {!hasRecordedPayoutMethod ? (
                <p
                  data-testid="payout-method-empty"
                  className="w-full rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600"
                >
                  Aucun mode de versement enregistré
                </p>
              ) : (
                <>
                  <div>
                    <span className="block text-sm font-medium text-gray-700 mb-2">
                      Nom du titulaire
                    </span>
                    <p
                      data-testid="payout-holder"
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-gray-900 text-sm font-medium"
                    >
                      {registeredPaymentLabel}
                    </p>
                  </div>
                  <div>
                    <span className="block text-sm font-medium text-gray-700 mb-2">RIB</span>
                    <p
                      data-testid="payout-rib"
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-gray-900 text-sm font-mono tracking-wide break-all"
                    >
                      {bankRib}
                    </p>
                  </div>
                  <div>
                    <span className="block text-sm font-medium text-gray-700 mb-2">IBAN</span>
                    <p
                      data-testid="payout-iban"
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-gray-900 text-sm font-mono tracking-wide break-all"
                    >
                      {bankIban}
                    </p>
                  </div>
                  <div>
                    <span className="block text-sm font-medium text-gray-700 mb-2">
                      Relevé d&apos;identité bancaire
                    </span>
                    {/* Displayed LARGE and inline: the spec requires it be readable without
                        downloading — « pas une simple vignette miniscule ». <object> renders both
                        an image and a PDF from the Content-Type the storage serves, so one element
                        covers both without sniffing a key that carries no file extension. */}
                    {bankDocUrl ? (
                      <object
                        data-testid="payout-doc-preview"
                        data={bankDocUrl}
                        aria-label="Aperçu du relevé d'identité bancaire"
                        className={PAYOUT_DOC_PREVIEW_CLASS}
                      >
                        <a
                          href={bankDocUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block px-4 py-3.5 text-sm text-brand-primary underline"
                        >
                          Ouvrir le document
                        </a>
                      </object>
                    ) : (
                      <p
                        data-testid="payout-doc-missing"
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-sm text-gray-600"
                      >
                        Document indisponible pour le moment.
                      </p>
                    )}
                  </div>
                </>
              )}
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
        /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- TBD-T: dialog with backdrop-dismiss; proper fix moves the dismiss handler off the dialog element */
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bank-details-modal-title"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- TBD-T: dialog needs tabIndex for the keyboard backdrop-dismiss handler
          tabIndex={0}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowBankDetailsModal(false);
          }}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
              e.preventDefault();
              setShowBankDetailsModal(false);
            }
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8 overflow-hidden border border-gray-100"
            role="button"
            tabIndex={0}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
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
                    onChange={(e) => {
                      setBankRibError(null);
                      setBankRib(normalizeBankInput(e.target.value));
                    }}
                    onBlur={() => {
                      const v = bankRib.trim();
                      if (v) setBankRibError(isValidRib(v) ? null : RIB_ERROR);
                    }}
                    className="w-full bg-transparent border-0 p-0 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-0 font-mono tracking-wide"
                    placeholder="···· ···· ···· ···· ···· ····"
                    autoComplete="off"
                  />
                  {bankRibError && <p className="text-xs text-red-600 mt-1">{bankRibError}</p>}
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
                    onChange={(e) => {
                      setBankIbanError(null);
                      setBankIban(normalizeBankInput(e.target.value));
                    }}
                    onBlur={() => {
                      const v = bankIban.trim();
                      if (v) setBankIbanError(isValidIban(v) ? null : IBAN_ERROR);
                    }}
                    className="w-full bg-transparent border-0 p-0 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-0 font-mono tracking-wide"
                    placeholder="···· ···· ···· ···· ···· ···· ····"
                    autoComplete="off"
                  />
                  {bankIbanError && <p className="text-xs text-red-600 mt-1">{bankIbanError}</p>}
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
                disabled={saveBankDetailsMutation.isPending}
                className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-emerald-200 hover:bg-emerald-100 text-emerald-950 text-sm font-semibold transition-colors min-w-[120px] sm:min-w-[200px]"
              >
                {saveBankDetailsMutation.isPending
                  ? 'Enregistrement...'
                  : 'Valider le mode de paiement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
