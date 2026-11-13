// RELEASE-1 (2026-10-26) — the build's identity, shown at the bottom of every sidebar so a tester
// can name the exact version she validated on staging (« Version 1a2b3c4 · 26/10/2026 ») and prod
// can deploy that same commit. Both values are baked in at build time by deploy.yml
// (VITE_APP_VERSION = the commit sha, VITE_APP_BUILT_AT = the build instant); a local dev build
// has neither and shows no label.

/** « Version 1a2b3c4 · 26/10/2026 », or null when the build carries no version. */
export function appVersionLabel(
  sha: string | undefined,
  builtAt: string | undefined,
): string | null {
  const short = (sha ?? '').trim().slice(0, 7);
  if (short === '') return null;
  const date = builtAt ? new Date(builtAt) : null;
  const day =
    date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis' })
      : null;
  return day ? `Version ${short} · ${day}` : `Version ${short}`;
}

export const APP_VERSION_LABEL = appVersionLabel(
  import.meta.env.VITE_APP_VERSION,
  import.meta.env.VITE_APP_BUILT_AT,
);
