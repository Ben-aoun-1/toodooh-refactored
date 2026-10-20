/**
 * DUR-1 (Myriam 2026-10-20) — the « Durée totale de diffusion » tile: HH:MM:SS under a day, then
 * in days past 24 h (« 109 j 04 h 54 min ») — « 2620:54:30 » read as a clock nobody can parse.
 */
const two = (n: number): string => String(n).padStart(2, '0');

export function airtimeLabel(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (days === 0) return `${two(h)}:${two(m)}:${two(sec)}`;
  return `${days} j ${two(h)} h ${two(m)} min`;
}
