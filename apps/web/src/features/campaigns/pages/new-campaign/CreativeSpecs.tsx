import { Info } from 'lucide-react';

import { VIDEO_SPEC_LABEL } from '@/features/campaigns/lib/spot-duration';
import { EVENT_VIDEO_MIN_SECONDS, eventSlotLabel } from '@/features/events/lib/event-minutes';
import { EVENT_SPOT_MAX_SECONDS } from '@/features/events/lib/event-positioning';

/** The « Spécifications » box under the creative picker (classic or event rules). */
export default function CreativeSpecs({ eventMode }: { eventMode: boolean }) {
  return (
    <div className="flex gap-3 p-4 rounded-xl bg-slate-50/80 border border-slate-100">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center">
        <Info className="w-3.5 h-3.5 text-slate-600" />
      </div>
      <div>
        <p className="text-sm font-bold text-gray-900 mb-2">Spécifications</p>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>
            {eventMode
              ? `Vidéo : ${EVENT_VIDEO_MIN_SECONDS} à ${EVENT_SPOT_MAX_SECONDS} secondes — chaque annonceur dispose d’une minute dans la page publicitaire du bloc ; votre vidéo occupe un créneau de 10, 12, 15, 20 ou 30 s (ex. ${eventSlotLabel('video', 23) ?? ''})`
              : VIDEO_SPEC_LABEL}
          </li>
          <li>Photo : durée de diffusion 10, 20 ou 30 secondes (JPEG / PNG / WebP)</li>
          <li>Votre création sera validée par notre équipe avant diffusion</li>
        </ul>
      </div>
    </div>
  );
}
