import { Repeat } from 'lucide-react';

import { eventRepeatsLabel } from '../lib/event-minutes';

interface EventRepeatsNoteProps {
  creativeType: string;
  durationSeconds: number | null;
  /** The minutes bought so far (null until chosen on the récapitulatif). */
  minutes: number | null;
}

/**
 * EVT-PLAY1 (operator ruling Q5) — on the event media step, how many times the chosen ad airs IN
 * TOTAL (minutes × plays per minute, across every screen); the per-minute rate until the minutes
 * are chosen. Renders nothing for a spot that cannot air in a pod.
 */
export default function EventRepeatsNote({
  creativeType,
  durationSeconds,
  minutes,
}: EventRepeatsNoteProps) {
  const line = eventRepeatsLabel(creativeType, durationSeconds, minutes);
  if (line === null) return null;
  return (
    <p className="flex items-start gap-2 rounded-xl border border-brand-primary/30 bg-brand-primary/5 px-4 py-3 text-sm font-medium text-gray-900">
      <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-brand-deep" aria-hidden="true" />
      {line}
    </p>
  );
}
