/** RESEAU-1 — the two Screencaster pages of the network feature. */
export const NETWORK_PATHS = {
  reseau: '/reseau',
  parcs: '/parcs-tv',
} as const;

/** The title the advertiser top bar prints on each page (the prototype's top-bar `h1`). */
export const NETWORK_TITLES: Readonly<Record<string, string>> = {
  [NETWORK_PATHS.reseau]: 'Réseau Screenhosts',
  [NETWORK_PATHS.parcs]: 'Parcs TV',
};
