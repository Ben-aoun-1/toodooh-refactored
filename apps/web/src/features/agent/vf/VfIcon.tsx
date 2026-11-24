// AGENT-VF — the prototype's own stroke icons (24 × 24, 1.7 stroke), by key.
const PATHS = {
  dash: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  camp: (
    <>
      <path d="M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1z" />
      <path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" />
    </>
  ),
  rev: (
    <>
      <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
      <path d="M2.5 10h19" />
      <circle cx="16.5" cy="14.5" r="1.3" />
      <path d="M6 6V5a2 2 0 012-2h10" />
    </>
  ),
  cal: (
    <>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </>
  ),
  sh: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0113 0" />
      <path d="M16 4.5a3.5 3.5 0 010 7M18 14a6 6 0 013.5 6" />
    </>
  ),
  set: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z" />
      <path d="M17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3" />
    </>
  ),
  bell: <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />,
  alert: (
    <>
      <path d="M12 3l9.5 17h-19z" />
      <path d="M12 10v4M12 17.5v.01" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.5 12.5L20 3M16 7l3 3M14 9l2 2" />
    </>
  ),
  cafe: (
    <>
      <path d="M4 9h13v5a5 5 0 01-5 5H9a5 5 0 01-5-5V9z" />
      <path d="M17 10h1.5a2.5 2.5 0 010 5H17M8 3v3M12 3v3" />
    </>
  ),
  resto: <path d="M7 3v8M5 3v5a2 2 0 004 0V3M7 11v10M16 3c-2 1-3 3.5-3 6.5V13h3v8" />,
  sport: <path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12" />,
  loisir: (
    <>
      <rect x="3" y="7" width="18" height="11" rx="4" />
      <path d="M8 11v3M6.5 12.5h3M15 12h.01M17 13.5h.01" />
    </>
  ),
  shop: <path d="M4 9l1.5-5h13L20 9M4 9h16v11H4zM9 20v-6h6v6" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </>
  ),
  doc: (
    <>
      <path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M9.5 9a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 3.5M12 17v.01" />
    </>
  ),
  chk: (
    <>
      <rect x="5" y="3.5" width="14" height="18" rx="2" />
      <path d="M9 3.5h6v3H9zM8.5 11l1.5 1.5 3-3M8.5 16.5l1.5 1.5 3-3M15 11.5h1.5M15 17h1.5" />
    </>
  ),
  aff: (
    <>
      <path d="M3 17l5-6 4 3 4-6 5 5" />
      <path d="M3 21h18" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </>
  ),
  headset: (
    <>
      <path d="M4 14v-2a8 8 0 0116 0v2" />
      <rect x="3" y="13" width="4" height="6" rx="1.5" />
      <rect x="17" y="13" width="4" height="6" rx="1.5" />
      <path d="M19 19a3 3 0 01-3 3h-3" />
    </>
  ),
  bellFull: (
    <>
      <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.9 1.9 0 003.4 0" />
    </>
  ),
} as const;

export type VfIconKey = keyof typeof PATHS;

/** Twin of the prototype's `ic(key, size)`. `plain` drops the round caps (the sidebar's two low icons). */
export function VfIcon({
  k,
  size = 18,
  plain = false,
  strokeWidth = 1.7,
}: {
  k: VfIconKey;
  size?: number;
  plain?: boolean;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      {...(plain ? {} : { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const })}
      aria-hidden="true"
    >
      {PATHS[k]}
    </svg>
  );
}
