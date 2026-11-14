import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAgentAccount } from '@/features/agent/hooks/useAgentAccount';
import {
  useAgentTransactions,
  useAgentWallet,
  useUploadPayoutInvoice,
} from '@/features/agent/hooks/useAgentPortfolio';
import { vfTnd } from '@/features/agent/lib/agent-format';
import { AGENT_PATHS, type AgentKind } from '@/features/agent/lib/agent-shell';
import { vfDate } from '@/features/agent/lib/agent-vf';
import { getErrorMessage } from '@/lib/errors';

import { VfIcon } from './VfIcon';
import { useVfOverlay } from './VfOverlay';

const PAYOUT_FR = { en_preparation: 'En préparation', effectue: 'Effectué' } as const;
const monthFr = (month: string) =>
  new Date(`${month}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

/**
 * AGENT-VF (spec VF « Page Mes revenus ») — Revenu actuel (the balance) and Revenus cumulés, the
 * RIB banner while the RIB is not validated, and « Transactions »: one row per campaign whose
 * amount is acquired. What is still to earn is NOT here (it lives in « Mes campagnes »). The
 * monthly payouts, and the invoice a Screencaster agent must deposit to be paid, follow when
 * there is one.
 */
export function VfRevenues({ kind }: { kind: AgentKind }) {
  const navigate = useNavigate();
  const { toast } = useVfOverlay();
  const account = useAgentAccount();
  const wallet = useAgentWallet();
  const transactions = useAgentTransactions();
  const upload = useUploadPayoutInvoice();
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  const rows = transactions.data?.transactions ?? [];
  const payouts = wallet.data?.payouts ?? [];
  const ribValidated = account.data?.rib.validated ?? true;

  const onFile = async (file: File | undefined) => {
    if (!file || !target.current) return;
    try {
      await upload.mutateAsync({ payoutId: target.current, file });
      toast('Facture déposée');
    } catch (e) {
      toast(getErrorMessage(e) || 'Dépôt impossible');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  return (
    <>
      <div className="hero2">
        <div className="rev vf-static">
          <small>
            <VfIcon k="rev" size={16} />
            Revenu actuel
          </small>
          <b>
            {vfTnd(wallet.data?.balance_tnd ?? 0).replace(' TND', '')} <em>TND</em>
          </b>
          <span className="vf-rev-note">Solde disponible, versé chaque mois sur votre RIB</span>
        </div>
        <div className="code vf-cumul">
          <small>
            <VfIcon k="rev" size={16} />
            Revenus cumulés
          </small>
          <b>{vfTnd(wallet.data?.cumulative_tnd ?? 0)}</b>
          <p>Total de vos revenus depuis l&apos;ouverture de votre compte.</p>
        </div>
      </div>
      {!ribValidated && (
        <div className="banner mb">
          <VfIcon k="alert" size={16} />
          <span>
            Téléversez votre RIB pour recevoir vos versements. Vos revenus s&apos;accumulent en
            attendant.
          </span>
          <button
            type="button"
            className="btn sm vf-push"
            onClick={() => navigate(`${AGENT_PATHS.settings}?tab=legal`)}
          >
            Téléverser mon RIB
          </button>
        </div>
      )}
      <div className={`card${payouts.length > 0 ? ' mb' : ''}`}>
        <div className="ch">
          <div>
            <h3>Transactions</h3>
            <p>Une ligne par campagne clôturée, avec le montant final après redispatching.</p>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty">
            <div className="ei">
              <VfIcon k="rev" size={24} />
            </div>
            Aucune transaction pour le moment.
            <br />
            <span className="tiny">
              {kind === 'screenhost'
                ? 'Les montants à gagner de vos campagnes en cours sont dans « Mes campagnes ».'
                : 'Les montants à gagner sont dans « Mes campagnes ». À la fin de chaque campagne, votre revenu s’ajoute ici.'}
            </span>
          </div>
        ) : (
          <div className="vf-scroll">
            <table>
              <tbody>
                <tr>
                  <th>Campagne</th>
                  <th>{kind === 'screenhost' ? 'Annonceur' : 'Screencaster'}</th>
                  <th>Date</th>
                  <th>Montant</th>
                </tr>
                {rows.map((t) => (
                  <tr key={t.campaign_id}>
                    <td>
                      <b>{t.campaign_name}</b>
                    </td>
                    <td>{t.party_name}</td>
                    <td>{vfDate(t.credited_at)}</td>
                    <td className="vf-gain">{vfTnd(t.amount_tnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {payouts.length > 0 && (
        <div className="card">
          <div className="ch">
            <div>
              <h3>Versements</h3>
              <p>Les virements mensuels de votre solde sur votre RIB.</p>
            </div>
          </div>
          <input
            ref={input}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <div className="vf-scroll">
            <table>
              <tbody>
                <tr>
                  <th>Mois</th>
                  <th>Montant</th>
                  <th>Statut</th>
                  <th>Virement</th>
                  {wallet.data?.invoice_required && <th>Facture</th>}
                </tr>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b className="vf-cap">{monthFr(p.month)}</b>
                    </td>
                    <td>{vfTnd(p.amount_tnd)}</td>
                    <td>
                      <span className={`badge ${p.status === 'effectue' ? 'b-act' : 'b-av'}`}>
                        {PAYOUT_FR[p.status]}
                      </span>
                    </td>
                    <td>{vfDate(p.transfer_date)}</td>
                    {wallet.data?.invoice_required && (
                      <td>
                        {p.invoice_file_name ? (
                          <span className="tiny">{p.invoice_file_name} </span>
                        ) : null}
                        {p.status === 'en_preparation' && (
                          <button
                            type="button"
                            className="btn sm"
                            disabled={upload.isPending}
                            onClick={() => {
                              target.current = p.id;
                              input.current?.click();
                            }}
                          >
                            {p.invoice_file_name ? 'Remplacer la facture' : 'Déposer ma facture'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
