import { CalendarPlus } from 'lucide-react';
import { useState } from 'react';

import { useReferent } from '../hooks/useAppointments';

import { AffiliateAppointmentModal } from './AffiliateAppointmentModal';

/**
 * AGT-5 (Agent Screenhost spec v1.0 §7) — « Prendre rendez-vous » in the Screenhost header,
 * shown while the owner has a referring agent (a venue pending activation or affiliated). Without
 * one nothing renders: the Toodooh team path stays as it is.
 */
export function OwnerAppointmentButton() {
  const referent = useReferent();
  const [open, setOpen] = useState(false);
  const data = referent.data;
  if (!data?.agent) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-[#E1E4EA] px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <CalendarPlus className="h-4 w-4" />
        <span className="hidden md:inline">Prendre rendez-vous</span>
      </button>
      {open && (
        <AffiliateAppointmentModal
          referent={{ ...data, agent: data.agent }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
