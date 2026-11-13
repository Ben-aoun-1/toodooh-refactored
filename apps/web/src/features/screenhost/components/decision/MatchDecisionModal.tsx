import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import CenteredOverlay from '@/features/screenhost/components/decision/CenteredOverlay';
import DecisionOutcomeCard from '@/features/screenhost/components/decision/DecisionOutcomeCard';
import DecisionRevenue from '@/features/screenhost/components/decision/DecisionRevenue';
import MatchDecisionHeader from '@/features/screenhost/components/decision/MatchDecisionHeader';
import MatchSpotList from '@/features/screenhost/components/decision/MatchSpotList';
import RefuseConfirmDialog from '@/features/screenhost/components/decision/RefuseConfirmDialog';
import { useScreenhostEventMatches } from '@/features/screenhost/hooks/useScreenhostEventMatches';
import type { DecisionOutcome } from '@/features/screenhost/lib/decision-notifications';
import {
  MATCH_FOOTNOTE,
  matchAmountLabel,
  matchSpotsBadge,
} from '@/features/screenhost/lib/match-decision';

type Stage = 'details' | 'confirm-refuse' | DecisionOutcome;

/**
 * Mariem 05/11/2026 — the « Soir de match » popup (mockup Toodooh_Notif_Match_Host), opened from
 * the match's notice: what the owner earns for the match, every spot positioned at this venue, and
 * ONE answer — « Refuser le match » / « Accepter le match » — for all of them. The per-campaign
 * popup (DecisionModal) stays for daily campaigns and late single shares.
 */
export default function MatchDecisionModal({
  eventId,
  screenhostId,
  onClose,
}: {
  eventId: string;
  screenhostId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const { matches, loading, decide, deciding } = useScreenhostEventMatches(userId);
  const [stage, setStage] = useState<Stage>('details');
  const match = matches.find((m) => m.event_id === eventId && m.screenhost_id === screenhostId);

  const answer = async (kind: 'accept' | 'refuse') => {
    try {
      await decide(eventId, screenhostId, kind);
      setStage(kind === 'accept' ? 'accepted' : 'refused');
    } catch {
      toast.error(kind === 'accept' ? 'Impossible d’accepter le match' : 'Impossible de refuser');
      setStage('details');
    }
  };

  if (stage === 'accepted' || stage === 'refused') {
    return (
      <CenteredOverlay onDismiss={onClose} labelledBy="decision-outcome-title">
        <DecisionOutcomeCard
          outcome={stage}
          target="match"
          onDashboard={() => {
            onClose();
            navigate('/owner-dashboard');
          }}
        />
      </CenteredOverlay>
    );
  }

  return (
    <>
      <CenteredOverlay onDismiss={onClose} labelledBy="match-decision-title">
        <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
          <MatchDecisionHeader match={match} onClose={onClose} />

          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {loading ? (
              <div className="py-10 text-center text-sm text-[#A3A3A3]">Chargement…</div>
            ) : match ? (
              <>
                <DecisionRevenue
                  amountTnd={match.total_tnd}
                  label="Ce que vous gagnez pour ce match"
                  amountLabel={matchAmountLabel(match.total_tnd)}
                  badge={matchSpotsBadge(match.spots.length)}
                />
                <MatchSpotList spots={match.spots} />
              </>
            ) : (
              <p className="py-10 text-center text-sm text-[#5C5C5C]">
                Ce match a déjà été traité.
              </p>
            )}
          </div>

          <footer className="grid grid-cols-2 gap-3 border-t border-[#EBEBEB] px-5 py-4">
            {match && !loading ? (
              <>
                <button
                  type="button"
                  disabled={deciding}
                  onClick={() => setStage('confirm-refuse')}
                  className="h-10 rounded-lg border border-[#FFC0C5] bg-[#FFEBEC] text-sm font-medium text-[#FB3748] hover:bg-[#FFE0E3] disabled:opacity-60"
                >
                  Refuser le match
                </button>
                <button
                  type="button"
                  disabled={deciding}
                  onClick={() => void answer('accept')}
                  className="h-10 rounded-lg border border-brand-primary bg-[#E8F8EE] text-sm font-medium text-[#1FC16B] hover:bg-[#DCF5E6] disabled:opacity-60"
                >
                  Accepter le match
                </button>
                <p className="col-span-2 -mt-1 text-center text-[11px] text-[#A3A3A3]">
                  {MATCH_FOOTNOTE}
                </p>
              </>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="col-span-2 h-10 rounded-lg border border-[#EBEBEB] bg-white text-sm text-[#5C5C5C] hover:bg-gray-50"
              >
                Fermer
              </button>
            )}
          </footer>
        </div>
      </CenteredOverlay>

      {stage === 'confirm-refuse' && (
        <RefuseConfirmDialog
          target="match"
          busy={deciding}
          onCancel={() => setStage('details')}
          onConfirm={() => void answer('refuse')}
        />
      )}
    </>
  );
}
