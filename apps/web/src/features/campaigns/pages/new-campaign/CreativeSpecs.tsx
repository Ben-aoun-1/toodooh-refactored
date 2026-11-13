import { Info } from 'lucide-react';

import { VIDEO_SPEC_LABEL } from '@/features/campaigns/lib/spot-duration';

/** The « Spécifications » box under the creative picker (the Foot parcours has its own). */
export default function CreativeSpecs() {
  return (
    <div className="flex gap-3 p-4 rounded-xl bg-slate-50/80 border border-slate-100">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center">
        <Info className="w-3.5 h-3.5 text-slate-600" />
      </div>
      <div>
        <p className="text-sm font-bold text-gray-900 mb-2">Spécifications</p>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>{VIDEO_SPEC_LABEL}</li>
          <li>Photo : durée de diffusion 10, 20 ou 30 secondes (JPEG / PNG / WebP)</li>
          <li>Votre création sera validée par notre équipe avant diffusion</li>
        </ul>
      </div>
    </div>
  );
}
