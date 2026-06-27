import { motion } from 'framer-motion';

import { type TargetingClass } from '../lib/targeting-lines';

interface ClassSegmentedControlProps {
  value: TargetingClass | null;
  onChange: (next: TargetingClass | null) => void;
  /** Stable id so each row's sliding pill animates independently (framer layoutId). */
  groupId: string;
  disabled?: boolean;
}

const SEGMENTS: { value: TargetingClass | null; label: string }[] = [
  { value: 'populaire', label: 'Populaire' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'premium', label: 'Premium' },
  { value: null, label: 'Toutes' },
];

// A 3-tier class chooser + "Toutes" — a segmented control (smoother than a dropdown). The active
// segment's pill slides between options. Keyboard: it's a radiogroup of buttons (Tab + Enter/Space).
export function ClassSegmentedControl({
  value,
  onChange,
  groupId,
  disabled = false,
}: ClassSegmentedControlProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Standing de l'audience"
      className="inline-flex w-full items-center gap-1 rounded-xl bg-gray-100 p-1 sm:w-auto"
    >
      {SEGMENTS.map((seg) => {
        const active = seg.value === value;
        const segKey = seg.value ?? 'all';
        return (
          <button
            key={segKey}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(seg.value)}
            className={`relative flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:opacity-50 sm:flex-none ${
              active ? 'text-brand-deep' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {active && (
              <motion.span
                layoutId={`class-pill-${groupId}`}
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                className="absolute inset-0 rounded-lg bg-white shadow-sm"
              />
            )}
            <span className="relative z-10">{seg.label}</span>
          </button>
        );
      })}
    </div>
  );
}
