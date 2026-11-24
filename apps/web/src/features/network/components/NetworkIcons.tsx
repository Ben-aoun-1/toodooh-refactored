import type { NetworkTone } from '@/features/network/lib/network-entries';

// RESEAU-1 — the prototype's own line icons, path for path (the sidebar pair, the category
// pictograms and the small glyphs of the list). `A` (another category) has no prototype icon: it
// gets a plain storefront in the same stroke.

interface SvgProps {
  size: number;
  strokeWidth: number;
  className?: string;
}

function Svg({ size, strokeWidth, className, children }: SvgProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

/** Sidebar entry « Réseau Screenhosts ». */
export function ReseauNavIcon({ className }: { className?: string }) {
  return (
    <Svg size={18} strokeWidth={1.8} className={className}>
      <circle cx="12" cy="5" r="2.2" />
      <circle cx="5" cy="18" r="2.2" />
      <circle cx="19" cy="18" r="2.2" />
      <path d="M12 7.2v4.3M12 11.5L6.3 16M12 11.5l5.7 4.5" />
    </Svg>
  );
}

/** Sidebar entry « Parcs TV ». */
export function ParcsNavIcon({ className }: { className?: string }) {
  return (
    <Svg size={18} strokeWidth={1.8} className={className}>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </Svg>
  );
}

const CATEGORY_PATHS: Record<NetworkTone, React.ReactNode> = {
  C: (
    <>
      <path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z" />
      <path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17" />
    </>
  ),
  R: (
    <>
      <path d="M6 3v8M4 3v4a2 2 0 0 0 4 0V3M6 11v10" />
      <path d="M17 3c-2 2-3 4-3 7h3v11" />
    </>
  ),
  S: <path d="M3 9v6M6 6v12M18 6v12M21 9v6M6 12h12" />,
  M: (
    <>
      <path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L20.5 8H6" />
      <circle cx="9.5" cy="20" r="1.3" />
      <circle cx="17" cy="20" r="1.3" />
    </>
  ),
  P: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  A: (
    <>
      <path d="M4 10v10h16V10" />
      <path d="M3 10l2-6h14l2 6" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
};

/** 16 px / stroke 2 on a card band; 26 px / stroke 1.7 in the portrait, as in the prototype. */
export function CategoryIcon({ tone, large = false }: { tone: NetworkTone; large?: boolean }) {
  return (
    <Svg size={large ? 26 : 16} strokeWidth={large ? 1.7 : 2}>
      {CATEGORY_PATHS[tone]}
    </Svg>
  );
}

export function SearchIcon() {
  return (
    <Svg size={16} strokeWidth={2}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </Svg>
  );
}

export function PinIcon() {
  return (
    <Svg size={14} strokeWidth={2}>
      <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </Svg>
  );
}

/** The tick of a card's checkbox (the prototype draws it in the deep green, not currentColor). */
export function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#0D2B1F"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
