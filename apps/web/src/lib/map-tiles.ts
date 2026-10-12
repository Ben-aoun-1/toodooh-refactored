/**
 * The ONE basemap of the app (operator 2026-10-12, option B). CARTO's free basemaps started
 * answering every key-less request with an « API KEY REQUIRED » watermark (Sept 2026) and the
 * app never had a CARTO key, so every map now uses OpenStreetMap's standard tiles — free, no key,
 * attribution required (OSM tile usage policy). Swap the URL here to change provider everywhere.
 */
export const MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** The highest zoom the OSM standard tiles serve. */
export const MAP_TILE_MAX_ZOOM = 19;
