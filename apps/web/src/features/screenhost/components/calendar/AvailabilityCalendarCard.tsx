import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

import { declareConfirmCopy } from '@/features/screenhost/lib/diffusion-calendar';
import {
  TILE_CLASSES,
  isTileToggleable,
  tileStateOf,
} from '@/features/screenhost/lib/owner-calendar';
import {
  type CalendarCell,
  MONTH_LABELS_FR,
  UNAVAILABILITY_CONSEQUENCE_COPY,
  WEEKDAY_LABELS_FR,
} from '@/features/screenhost/lib/unavailability-calendar';

// CAL-2 — card « DISPONIBILITÉS DE MES ÉCRANS » of the Figma frame « Mon calendrier et mes
// dispositifs de diffusion »: a grey month bar, the weekday row, ~40 px rounded day tiles (green
// = disponible, red = indisponible), a green dot under today, the legend at the bottom. A click on
// a future tile flips it. Two additions the frame does not show, both required by the rules:
// a ring on days that carry an accepted diffusion (declaring such a day redistributes its share,
// so the owner must see it before clicking), and the venue picker for owners with several
// établissements.

interface Props {
  venues: { id: string; name: string }[];
  selectedVenueId: string | null;
  onSelectVenue: (id: string) => void;
  month: { year: number; monthIndex: number };
  onShiftMonth: (delta: number) => void;
  cells: CalendarCell[];
  todayIso: string;
  declared: ReadonlySet<string>;
  /** Future days carrying an accepted diffusion on this venue → the campaigns' names. */
  diffusionDays: ReadonlyMap<string, string[]>;
  onToggle: (iso: string) => void;
  busy: boolean;
  loading: boolean;
  /** The pending declaration on a day that carries diffusion — confirmed inline, never by a browser dialog. */
  pending: { iso: string; label: string; campaigns: string[] } | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AvailabilityCalendarCard({
  venues,
  selectedVenueId,
  onSelectVenue,
  month,
  onShiftMonth,
  cells,
  todayIso,
  declared,
  diffusionDays,
  onToggle,
  busy,
  loading,
  pending,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)] ring-1 ring-gray-100">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E4F9EB]">
            <CalendarDays className="h-5 w-5 text-brand-deep" />
          </span>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">
              Disponibilités de mes écrans
            </h2>
            <p className="text-sm text-gray-500">
              Définissez les périodes de disponibilité de vos écrans
            </p>
          </div>
        </div>
        {venues.length > 1 && (
          <label className="text-sm">
            <span className="sr-only">Établissement</span>
            <select
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700"
              value={selectedVenueId ?? ''}
              onChange={(e) => onSelectVenue(e.target.value)}
            >
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <p className="mt-5 text-sm font-medium text-gray-700">
        Choisissez un créneau <span className="text-red-500">*</span>
      </p>

      <div className="mt-3 flex items-center justify-between rounded-xl bg-[#F7F7F7] px-3 py-2">
        <button
          type="button"
          onClick={() => onShiftMonth(-1)}
          aria-label="Mois précédent"
          className="rounded-lg p-1.5 text-gray-600 hover:bg-white"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          {MONTH_LABELS_FR[month.monthIndex]} {month.year}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
        </span>
        <button
          type="button"
          onClick={() => onShiftMonth(1)}
          aria-label="Mois suivant"
          className="rounded-lg p-1.5 text-gray-600 hover:bg-white"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-y-2 text-center">
        {WEEKDAY_LABELS_FR.map((w) => (
          <div key={w} className="py-1 text-xs font-medium text-gray-400">
            {w}
          </div>
        ))}
        {cells.map((cell) => {
          const state = tileStateOf(cell, todayIso, declared);
          const toggleable = isTileToggleable(state);
          const airing = diffusionDays.get(cell.iso);
          return (
            <div key={cell.iso} className="flex justify-center">
              <button
                type="button"
                disabled={!toggleable || busy}
                onClick={() => onToggle(cell.iso)}
                aria-label={`${cell.iso}${
                  state === 'unavailable'
                    ? ' — indisponible'
                    : state === 'available'
                      ? ' — disponible'
                      : ''
                }${airing ? ' — diffusion prévue' : ''}`}
                className={`relative flex h-10 w-10 flex-col items-center justify-center rounded-lg text-sm transition-shadow disabled:cursor-default ${
                  TILE_CLASSES[state]
                } ${airing && toggleable ? 'ring-2 ring-brand-deep/60' : ''}`}
              >
                {cell.dayOfMonth}
                {state === 'today' && (
                  <span className="absolute bottom-1 h-1.5 w-1.5 rounded-full bg-brand-primary" />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {pending && (
        <div
          role="alertdialog"
          aria-label="Confirmer l'indisponibilité"
          className="mt-4 rounded-xl border border-red-200 bg-[#FFEBEC] p-4 text-sm text-gray-800"
        >
          <p className="font-medium first-letter:uppercase">{pending.label}</p>
          <p className="mt-1 text-gray-700">{declareConfirmCopy(pending.campaigns)}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50"
            >
              Confirmer
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4 text-xs">
        <span className="rounded-full bg-[#FFC0C5] px-3 py-1 text-gray-800">Indisponibles</span>
        <span className="rounded-full bg-[#E3F7EC] px-3 py-1 text-gray-800">Disponibles</span>
        <span className="rounded-full px-3 py-1 text-gray-700 ring-2 ring-brand-deep/60">
          Diffusion prévue
        </span>
      </div>
      {/* The ruled consequence wording (CAL-1), kept as a caption under the Figma legend. */}
      <p className="mt-3 text-xs text-gray-400">{UNAVAILABILITY_CONSEQUENCE_COPY}</p>
    </section>
  );
}
