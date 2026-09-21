import { ExternalLink, FileText, Loader2, Paperclip } from 'lucide-react';

import {
  useRechargeBonUrl,
  useRechargeDocumentUrl,
  useRechargeSignedBonUrl,
  useWalletAdjustments,
} from '@/features/admin/hooks/useRecharges';
import { adminRechargeTypeLabel } from '@/features/admin/lib/recharge-filters';
import { signedAmountLabel } from '@/features/admin/lib/wallet-adjustment';
import {
  adminRechargesService,
  documentDisplayMode,
  type AdminRecharge,
} from '@/features/admin/services/admin-recharges.service';
import { statusChipClass, statusLabel } from '@/features/wallet/lib/recharge-methods';

interface RechargeDetailsModalProps {
  recharge: AdminRecharge;
  advertiserName: string;
  advertiserEmail: string;
  onClose: () => void;
}

/**
 * The « Détails de la recharge » review modal. CF-M2 put the justificatif de virement next to the
 * amount + reference: an image renders inline, a PDF opens in its own tab from the short-TTL
 * presigned URL (fetched per open, never cached). FCT1 adds the Type line (per-method status
 * labels from the shared wallet lib) and, for bon rows, the deposited SIGNED bon plus the
 * GENERATED bon to cross-check it against. Confirm/reject stay on the page — the files never gate
 * them (admin judgement covers doc-less confirms).
 */
export default function RechargeDetailsModal({
  recharge,
  advertiserName,
  advertiserEmail,
  onClose,
}: RechargeDetailsModalProps) {
  const isBon = recharge.method === 'bon_de_commande';
  const document = useRechargeDocumentUrl(recharge.id, recharge.has_document);
  const bon = useRechargeBonUrl(recharge.id, isBon && recharge.has_bon);
  const signedBon = useRechargeSignedBonUrl(recharge.id, isBon && recharge.has_signed_bon);
  // FCT2 (US-FCT-9) — this advertiser's solde-adjustment audit trail.
  const adjustments = useWalletAdjustments(recharge.advertiser_id);
  const mode = documentDisplayMode(recharge.document_mime);
  const signedBonMode = documentDisplayMode(recharge.signed_bon_mime);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-2xl font-bold text-[#00263A] mb-6">Détails de la recharge</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm font-medium text-gray-600">Référence</span>
                <p className="text-lg font-bold text-gray-900">{recharge.reference}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-600">Statut</span>
                <p>
                  <span
                    className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${statusChipClass(recharge.status)}`}
                  >
                    {statusLabel(recharge.method, recharge.status)}
                  </span>
                </p>
              </div>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-600">Type</span>
              <p className="text-sm font-semibold text-gray-900">
                {adminRechargeTypeLabel(recharge.method)}
              </p>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-600">Screencaster</span>
              <p className="text-lg font-semibold text-gray-900">{advertiserName}</p>
              <p className="text-sm text-gray-500">{advertiserEmail}</p>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-600">Montant</span>
              <p className="text-2xl font-bold text-brand-primary">
                {adminRechargesService.formatAmount(recharge.amount_tnd)}
              </p>
            </div>

            {/* CF-M2 — the justificatif, reviewed together with the amount + reference (virement
                and legacy rows only — a bon carries its signed copy instead). */}
            {!isBon && (
              <div>
                <span className="text-sm font-medium text-gray-600 inline-flex items-center gap-1.5">
                  <Paperclip className="h-4 w-4" />
                  Justificatif de virement
                </span>
                {!recharge.has_document ? (
                  <p className="text-sm text-gray-500 mt-1">Aucun justificatif fourni</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {recharge.document_uploaded_at && (
                      <p className="text-xs text-gray-500">
                        Déposé le {new Date(recharge.document_uploaded_at).toLocaleString('fr-FR')}
                      </p>
                    )}
                    {document.loading && (
                      <p className="text-sm text-gray-500 inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Chargement du justificatif...
                      </p>
                    )}
                    {document.isError && (
                      <p className="text-sm text-red-600">
                        Impossible de charger le justificatif. Fermez et rouvrez les détails pour
                        réessayer.
                      </p>
                    )}
                    {document.url !== undefined &&
                      (mode === 'image' ? (
                        <img
                          src={document.url}
                          alt="Justificatif de virement"
                          className="max-h-80 w-auto rounded-lg border border-gray-200"
                        />
                      ) : (
                        <button
                          onClick={() => window.open(document.url, '_blank', 'noopener')}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Ouvrir le justificatif (PDF)
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* FCT1 — the bon files: the deposited SIGNED copy + the GENERATED bon to cross-check. */}
            {isBon && (
              <div className="space-y-4">
                <div>
                  <span className="text-sm font-medium text-gray-600 inline-flex items-center gap-1.5">
                    <Paperclip className="h-4 w-4" />
                    Bon retourné signé
                  </span>
                  {!recharge.has_signed_bon ? (
                    <p className="text-sm text-gray-500 mt-1">Aucun bon signé déposé</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {recharge.signed_bon_deposited_at && (
                        <p className="text-xs text-gray-500">
                          Déposé le{' '}
                          {new Date(recharge.signed_bon_deposited_at).toLocaleString('fr-FR')}
                        </p>
                      )}
                      {signedBon.loading && (
                        <p className="text-sm text-gray-500 inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Chargement du bon signé...
                        </p>
                      )}
                      {signedBon.isError && (
                        <p className="text-sm text-red-600">
                          Impossible de charger le bon signé. Fermez et rouvrez les détails pour
                          réessayer.
                        </p>
                      )}
                      {signedBon.url !== undefined &&
                        (signedBonMode === 'image' ? (
                          <img
                            src={signedBon.url}
                            alt="Bon de commande signé"
                            className="max-h-80 w-auto rounded-lg border border-gray-200"
                          />
                        ) : (
                          <button
                            onClick={() => window.open(signedBon.url, '_blank', 'noopener')}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Ouvrir le bon signé (PDF)
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                {recharge.has_bon && (
                  <div>
                    <span className="text-sm font-medium text-gray-600 inline-flex items-center gap-1.5">
                      <FileText className="h-4 w-4" />
                      Bon de commande généré
                    </span>
                    <div className="mt-2">
                      {bon.url !== undefined ? (
                        <button
                          onClick={() => window.open(bon.url, '_blank', 'noopener')}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Ouvrir le bon généré (PDF)
                        </button>
                      ) : bon.isError ? (
                        <p className="text-sm text-red-600">Impossible de charger le bon généré.</p>
                      ) : (
                        <p className="text-sm text-gray-500 inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Chargement...
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm font-medium text-gray-600">Date de création</span>
                <p className="text-sm text-gray-900">
                  {new Date(recharge.created_at).toLocaleString('fr-FR')}
                </p>
              </div>
              {recharge.confirmed_at && (
                <div>
                  <span className="text-sm font-medium text-gray-600">Date de validation</span>
                  <p className="text-sm text-gray-900">
                    {new Date(recharge.confirmed_at).toLocaleString('fr-FR')}
                  </p>
                </div>
              )}
            </div>
            {recharge.reject_reason && (
              <div>
                <span className="text-sm font-medium text-gray-600">Raison du rejet</span>
                <p className="text-sm text-gray-900 bg-gray-50 p-3 rounded-lg">
                  {recharge.reject_reason}
                </p>
              </div>
            )}

            {/* FCT2 (US-FCT-9) — the adjustment AUDIT for this screencaster (signed + reason). */}
            {(adjustments.data?.length ?? 0) > 0 && (
              <div>
                <span className="text-sm font-medium text-gray-600">
                  Ajustements du solde (audit)
                </span>
                <ul className="mt-1 space-y-1">
                  {(adjustments.data ?? []).map((a) => (
                    <li key={a.id} className="text-sm text-gray-900 bg-gray-50 p-3 rounded-lg">
                      <span className={a.amount_tnd > 0 ? 'text-green-700' : 'text-red-700'}>
                        {signedAmountLabel(a.amount_tnd)}
                      </span>{' '}
                      — {a.reason}{' '}
                      <span className="text-xs text-gray-400">
                        ({new Date(a.created_at).toLocaleDateString('fr-FR')})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
