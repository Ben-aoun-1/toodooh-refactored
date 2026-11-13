import { QrCode } from 'lucide-react';

import { CTA_POSITIONS, CTA_POSITION_FR } from '@/features/campaigns/lib/spot-cta';
import type { CtaPosition } from '@/features/campaigns/services/campaigns.api';

/**
 * Mariem 04/11 (Foot point 1, ruling 2A) — where the spot's QR card sits: a small screen with its
 * four corners, the chosen one marked. Shared by the spot step (the advertiser) and the review
 * queue (the admin, at the spot's validation).
 */
export default function CtaCornerPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: CtaPosition;
  onChange: (position: CtaPosition) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="text-sm text-gray-600">Position du QR code sur le spot</p>
      <div
        role="radiogroup"
        aria-label="Position du QR code sur le spot"
        className="mt-1 grid aspect-video w-56 grid-cols-2 grid-rows-2 gap-1 rounded-lg border border-slate-300 bg-slate-800 p-1"
      >
        {CTA_POSITIONS.map((position) => {
          const chosen = position === value;
          return (
            <button
              key={position}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-label={CTA_POSITION_FR[position]}
              title={CTA_POSITION_FR[position]}
              disabled={disabled}
              onClick={() => onChange(position)}
              className={`flex rounded-md p-1 transition-colors disabled:cursor-not-allowed ${
                position.startsWith('top_') ? 'items-start' : 'items-end'
              } ${position.endsWith('_right') ? 'justify-end' : 'justify-start'} ${
                chosen ? 'bg-brand-primary/30' : 'hover:bg-white/10'
              }`}
            >
              <QrCode
                className={`h-5 w-5 ${chosen ? 'text-brand-primary' : 'text-slate-500'}`}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-gray-500">{CTA_POSITION_FR[value]}</p>
    </div>
  );
}
