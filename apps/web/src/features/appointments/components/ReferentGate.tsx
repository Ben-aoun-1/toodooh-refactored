import type { ReactNode } from 'react';

import { useReferent } from '../hooks/useAppointments';

import { AffiliateAppointmentModal } from './AffiliateAppointmentModal';

/**
 * AGT-5 — « Prendre rendez-vous » routes to the affiliate's referring agent when there is one;
 * otherwise (no agent, ended affiliation, any error) the current Toodooh-team form renders
 * unchanged (spec §7: « Un Screencaster sans agent affilié conserve le parcours actuel »).
 */
export function ReferentGate({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const referent = useReferent();
  if (referent.isLoading) return null;
  const data = referent.data;
  if (data?.agent)
    return (
      <AffiliateAppointmentModal referent={{ ...data, agent: data.agent }} onClose={onClose} />
    );
  return <>{children}</>;
}
