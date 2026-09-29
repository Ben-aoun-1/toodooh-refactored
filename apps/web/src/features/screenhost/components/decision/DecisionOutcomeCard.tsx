import { Megaphone, PartyPopper } from 'lucide-react';

import {
  type DecisionOutcome,
  outcomeCopy,
} from '@/features/screenhost/lib/decision-notifications';

/** Figma frames 589 (Félicitations) / 591 (Refus enregistré) — centered, one CTA to the dashboard. */
export default function DecisionOutcomeCard({
  outcome,
  target,
  onDashboard,
}: {
  outcome: DecisionOutcome;
  target: 'campaign' | 'event';
  onDashboard: () => void;
}) {
  const copy = outcomeCopy(outcome, target);
  const accepted = outcome === 'accepted';

  return (
    <div className="flex w-full max-w-[600px] flex-col items-center gap-5 rounded-2xl bg-white p-8 shadow-xl">
      <div
        className={`flex h-[72px] w-[72px] items-center justify-center rounded-full ${
          accepted ? 'bg-[#E8F8EE]' : 'bg-[#FFD1D6]'
        }`}
      >
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-full ${
            accepted ? 'border border-[#D1D1D1] bg-white' : 'bg-[#FFE4E7]'
          }`}
        >
          {accepted ? (
            <PartyPopper className="h-5 w-5 text-[#171717]" />
          ) : (
            <Megaphone className="h-4 w-4 text-[#171717]" />
          )}
        </div>
      </div>
      <h2 id="decision-outcome-title" className="text-xl font-medium text-[#171717]">
        {copy.title}
      </h2>
      <div className="w-full space-y-4 rounded-xl border border-[#EBEBEB] p-4 text-sm text-[#2B3A36]">
        <p>{copy.lines[0]}</p>
        <p>{copy.lines[1]}</p>
      </div>
      <button
        type="button"
        onClick={onDashboard}
        className="h-11 w-full rounded-xl bg-brand-primary text-sm font-medium text-[#171717] hover:bg-brand-primary/90"
      >
        Dashboard
      </button>
    </div>
  );
}
