// EVT-CAT2 — the multi-match parcours' URL: the N positioning drafts « Je me positionne sur ces
// N événements » created ride the query string (`?ids=a,b,c`), so the page survives a reload.

export const GROUP_POSITIONING_ROUTE = '/evenements/positionnement-groupe';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const groupPositioningPath = (campaignIds: readonly string[]): string =>
  `${GROUP_POSITIONING_ROUTE}?ids=${campaignIds.join(',')}`;

/** The draft ids of the URL: uuids only, deduplicated, order kept. */
export function parseGroupIds(search: string): string[] {
  const raw = new URLSearchParams(search).get('ids') ?? '';
  return [
    ...new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => UUID.test(s)),
    ),
  ];
}
