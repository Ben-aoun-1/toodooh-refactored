// REV1 — the two decisions the « Mes Revenus » consultation popup makes, extracted so they are
// assertable. apps/web has no page-render harness, so logic left inline in JSX is untestable by
// construction; a predicate and a class constant are not.

/**
 * A payout account counts as RECORDED only when BOTH coordinates are on file.
 *
 * Half-filled is treated as absent on purpose: a RIB without an IBAN (or the reverse) cannot
 * receive money, so showing it as a registered mode would tell the owner they are set up when
 * they are not. Whitespace-only values are absent too — the profile stores free text.
 */
export const payoutMethodIsRecorded = (
  rib: string | null | undefined,
  iban: string | null | undefined,
): boolean => Boolean(rib?.trim()) && Boolean(iban?.trim());

/**
 * The identity document is displayed LARGE and inline. The spec is explicit — it must be readable
 * « sans avoir à le télécharger (pas une simple vignette miniscule) » — so the preview is a
 * full-width, 420px-tall box, not a thumbnail. Exported as a constant so the size is pinned by a
 * test: shrinking it back to a thumbnail has to be a deliberate edit that fails a test.
 */
export const PAYOUT_DOC_PREVIEW_CLASS =
  'w-full h-[420px] rounded-xl border border-gray-200 bg-gray-50';

/** The minimum height, in px, that still counts as "readable without downloading". */
export const PAYOUT_DOC_PREVIEW_MIN_HEIGHT_PX = 320;
