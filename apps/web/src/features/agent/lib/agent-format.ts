// AGENT-VF (spec VF §0 « Rédaction et affichage ») — how the agent interfaces write numbers, pure.
// Twin of the prototype's num / tnd / pct helpers: thin spaces between thousands, an amount in TND
// with three decimals ONLY when it has decimals (« 12 TND », « 2,480 TND »), an empty value « – ».

const NNBSP = ' ';

/** 11808 → « 11 808 ». */
export const vfNum = (n: number): string =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);

/** 12 → « 12 TND », 2.48 → « 2,480 TND », null → « – ». */
export function vfTnd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const milli = Math.round(v * 1000);
  if (milli % 1000 === 0) return `${vfNum(milli / 1000)} TND`;
  const sign = milli < 0 ? '-' : '';
  const abs = Math.abs(milli);
  return `${sign}${vfNum(Math.floor(abs / 1000))},${String(abs % 1000).padStart(3, '0')} TND`;
}

/** 80 → « 80 % », null → « – ». */
export const vfPct = (v: number | null | undefined): string =>
  v === null || v === undefined ? '–' : `${v} %`;

/** A counter climbs only when its text is a plain positive integer (prototype rule). */
export const vfCountTarget = (text: string): number | null => {
  if (!/^[\d \u202f\u00a0]+$/.test(text)) return null;
  const to = parseInt(text.replace(/\D/g, ''), 10);
  return to > 0 ? to : null;
};

/** The eased value of a counter at progress k ∈ [0, 1] (ease-out cubic, as in the prototype). */
export const vfCountAt = (to: number, k: number): string => {
  const c = Math.min(1, Math.max(0, k));
  return vfNum(to * (1 - Math.pow(1 - c, 3)));
};
