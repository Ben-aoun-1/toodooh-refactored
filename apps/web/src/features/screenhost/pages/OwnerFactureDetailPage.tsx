import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { useBusinessProfile } from '@/features/auth/hooks/useBusinessProfile';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import { screenhostKeys } from '@/features/screenhost/hooks/queryKeys';
import {
  CONSIGNE_LINE,
  TOODOOH_CLIENT_NAME,
  TOODOOH_CLIENT_SUBTITLE,
  TVA_LABEL,
  factureLines,
  factureMoney,
  formatDateFr,
  formatTnd,
} from '@/features/screenhost/lib/facture-view';
import { factureFilename, facturesService } from '@/features/screenhost/services/factures.service';

// REV2 — « Voir » : the facture rendered on screen, in the SAME DIRECTION as the PDF the owner will
// sign. Émetteur = their établissement, Client = Toodooh. That reversal is the whole point of the
// lane, so it is stated in two labelled blocks rather than implied by layout.
//
// « IMPRIMER » is window.print() over this same markup: the chrome carries `print:hidden`, so what
// reaches the paper is the document and nothing else. No second template to keep in sync.
//
// THAT IS WHY THIS READS THE DETAIL ENDPOINT (REV2 commit 3). Printing this screen produces a
// signable artifact, so it must show the SAME lines as the downloadable PDF — and it does, because
// the endpoint's breakdown and the PDF's both come from the api's single computation home. Reading
// the list cache instead would have meant one document with a neutral single line and another with
// the per-source split: two print paths, two different invoices.
export default function OwnerFactureDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const { user, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';
  const { profile } = useBusinessProfile(user?.id);

  const factureQuery = useQuery({
    queryKey: screenhostKeys.facture(id ?? ''),
    queryFn: () => facturesService.detail(id ?? ''),
    enabled: !!user?.id && !!id,
    retry: false,
  });
  const facture = factureQuery.data ?? null;
  const [downloading, setDownloading] = useState(false);

  // Position preserved: a POP back to the list restores the browser's own scroll offset. A deep
  // link has no history entry of ours to return to (location.key === 'default'), so it navigates.
  const backToList = useCallback(() => {
    if (location.key === 'default') navigate('/owner-factures');
    else navigate(-1);
  }, [location.key, navigate]);

  const handleDownload = useCallback(async () => {
    if (!facture) return;
    try {
      setDownloading(true);
      const blob = await facturesService.download(facture.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = factureFilename(facture.reference);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (_e) {
      toast.error('Impossible de télécharger la facture. Veuillez réessayer.');
    } finally {
      setDownloading(false);
    }
  }, [facture]);

  if (!facture) {
    return (
      <div className="min-h-screen bg-gray-50/80">
        <div className="flex min-h-screen">
          <OwnerNavigation isDisabled={isDisabled} />
          <div className="flex-1 flex items-center justify-center p-8">
            {factureQuery.isLoading ? (
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary" />
            ) : (
              <div className="text-center">
                <p className="text-gray-600 mb-4">Cette facture est introuvable.</p>
                <button
                  type="button"
                  onClick={() => navigate('/owner-factures')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-primary hover:bg-brand-primary/90 text-gray-900 text-sm font-medium transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Retour à mes factures
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const money = factureMoney(facture.total_sh_tnd);
  const lines = factureLines(facture);
  const emitterOwner = profile?.business_name || profile?.contact_name || '';

  return (
    <div className="min-h-screen bg-gray-50/80 print:bg-white">
      <div className="flex min-h-screen print:block print:min-h-0">
        <div className="print:hidden">
          <OwnerNavigation isDisabled={isDisabled} />
        </div>

        <div className="flex-1 flex flex-col overflow-hidden min-w-0 print:overflow-visible">
          <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm print:hidden">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={backToList}
                  className="inline-flex items-center gap-2 text-base font-semibold text-[#171717] hover:opacity-80 min-w-0"
                  aria-label="Retour à mes factures"
                >
                  <ArrowLeft className="w-5 h-5 text-[#5C5C5C] flex-shrink-0" />
                  <span className="hidden sm:inline">Mes factures</span>
                  <span className="truncate sm:hidden">Retour</span>
                </button>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    Imprimer
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownload()}
                    disabled={downloading}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-primary hover:bg-brand-primary/90 text-gray-900 text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    Télécharger PDF
                  </button>
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto print:overflow-visible">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 print:p-0 print:max-w-none">
              <article className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 sm:p-10 print:border-0 print:shadow-none print:rounded-none print:p-0">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div>
                    <p className="text-2xl font-bold tracking-tight text-brand-primary">toodooh</p>
                  </div>
                  <div className="sm:text-right">
                    <h1 className="text-2xl font-bold text-gray-900 tracking-tight">FACTURE</h1>
                    <p className="text-sm text-gray-500 mt-1">Référence : {facture.reference}</p>
                    <p className="text-sm text-gray-500">
                      Période : {facture.designation.replace(/^Facture\s+/, '')}
                    </p>
                    <p className="text-sm text-gray-500">
                      Date d’émission : {formatDateFr(facture.created_at)}
                    </p>
                  </div>
                </div>

                {/* The reversed direction, stated plainly — the venue bills, Toodooh is billed. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-10">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Émetteur</p>
                    <p className="text-base font-semibold text-gray-900 mt-1">
                      {facture.screenhost_name}
                    </p>
                    {emitterOwner ? <p className="text-sm text-gray-600">{emitterOwner}</p> : null}
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Client</p>
                    <p className="text-base font-semibold text-gray-900 mt-1">
                      {TOODOOH_CLIENT_NAME}
                    </p>
                    <p className="text-sm text-gray-600">{TOODOOH_CLIENT_SUBTITLE}</p>
                  </div>
                </div>

                <div className="mt-10">
                  <table className="w-full">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                        <th className="text-left font-normal pb-2">Désignation</th>
                        <th className="text-right font-normal pb-2">Montant HT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {lines.map((line) => (
                        <tr key={line.label}>
                          <td className="py-3 text-sm text-gray-900">{line.label}</td>
                          <td className="py-3 text-sm text-gray-900 text-right tabular-nums">
                            {formatTnd(line.amountHtTnd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6 border-t border-gray-200 pt-4 space-y-2">
                  <div className="flex items-center justify-between text-sm text-gray-600">
                    <span>Sous-total HT</span>
                    <span className="tabular-nums text-gray-900">{formatTnd(money.htTnd)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-gray-600">
                    <span>{TVA_LABEL}</span>
                    <span className="tabular-nums text-gray-900">{formatTnd(money.tvaTnd)}</span>
                  </div>
                  <div className="flex items-center justify-between text-base font-bold text-gray-900 pt-2">
                    <span>Total TTC</span>
                    <span className="tabular-nums">{formatTnd(money.ttcTnd)}</span>
                  </div>
                </div>

                <p className="mt-10 text-xs text-gray-500 leading-relaxed">{CONSIGNE_LINE}</p>

                <p className="mt-8 text-[11px] text-gray-400 text-center">
                  toodooh — réseau d’affichage DOOH en Tunisie
                </p>
              </article>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
