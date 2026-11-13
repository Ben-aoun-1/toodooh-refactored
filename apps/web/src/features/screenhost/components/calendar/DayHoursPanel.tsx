import { Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { declareConfirmCopy } from '@/features/screenhost/lib/diffusion-calendar';
import {
  ALL_DAY_LABEL,
  FREE_DAY_LABEL,
  HOURS_PANEL_HINT,
  hourLabel,
  hoursChange,
} from '@/features/screenhost/lib/hour-unavailability';

/**
 * HOUR-UNAV1 — the hours of ONE future opening day under the calendar: each window hour is a chip
 * (red = unavailable), « Toute la journée » / « Tout libérer » set them all, and « Enregistrer »
 * sends only the change. An hour that carries a planned diffusion is ringed; declaring one asks
 * first, inline, naming the campaigns (CAL-1 — their share of those hours is redistributed).
 */
export default function DayHoursPanel({
  dayLabel,
  window,
  unavailableHours,
  diffusionByHour,
  busy,
  onSave,
  onClose,
  hint = HOURS_PANEL_HINT,
}: {
  /** The line under the day (AGT-HOUR1: the agent calendar has its own words). */
  hint?: string;
  dayLabel: string;
  /** The opening day's clock hours, in window order. */
  window: readonly number[];
  /** The hours already declared unavailable. */
  unavailableHours: readonly number[];
  /** Hour → the campaigns airing then (accepted diffusion). */
  diffusionByHour: ReadonlyMap<number, string[]>;
  busy: boolean;
  onSave: (change: { add: number[]; remove: number[] }) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number[]>([...unavailableHours]);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    setSelected([...unavailableHours]);
    setConfirming(false);
  }, [unavailableHours, dayLabel]);

  const change = useMemo(
    () => hoursChange(unavailableHours, selected),
    [unavailableHours, selected],
  );
  const touched = [...new Set(change.add.flatMap((h) => diffusionByHour.get(h) ?? []))];
  const dirty = change.add.length > 0 || change.remove.length > 0;

  const flip = (h: number) => {
    setConfirming(false);
    setSelected((s) =>
      s.includes(h) ? s.filter((x) => x !== h) : window.filter((x) => x === h || s.includes(x)),
    );
  };
  const save = () => {
    if (touched.length > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    onSave(change);
  };

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 first-letter:uppercase">{dayLabel}</p>
          <p className="mt-0.5 text-xs text-gray-500">{hint}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {window.map((h) => {
          const off = selected.includes(h);
          const airing = diffusionByHour.has(h);
          return (
            <button
              key={h}
              type="button"
              disabled={busy}
              aria-pressed={off}
              aria-label={`${hourLabel(h)} — ${off ? 'indisponible' : 'disponible'}${airing ? ' — diffusion prévue' : ''}`}
              onClick={() => flip(h)}
              className={`h-9 min-w-[3.25rem] rounded-lg px-2 text-sm transition-colors ${
                off ? 'bg-[#FFC0C5] text-gray-900' : 'bg-[#E3F7EC] text-gray-900 hover:bg-[#d3f1e0]'
              } ${airing ? 'ring-2 ring-brand-deep/60' : ''}`}
            >
              {hourLabel(h)}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setConfirming(false);
            setSelected([...window]);
          }}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
        >
          {ALL_DAY_LABEL}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setConfirming(false);
            setSelected([]);
          }}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
        >
          {FREE_DAY_LABEL}
        </button>
      </div>
      {confirming && (
        <p role="alert" className="mt-3 rounded-lg bg-[#FFEBEC] p-3 text-sm text-gray-800">
          {declareConfirmCopy(touched)}
        </p>
      )}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={save}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
            confirming ? 'bg-red-600 text-white' : 'bg-brand-deep text-white'
          }`}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {confirming ? 'Confirmer' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
