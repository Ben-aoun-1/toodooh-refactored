import { useQueries } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';

import { eventsKeys } from '../../hooks/queryKeys';
import {
  SELECTION_IMPRESSIONS_LABEL,
  cardTitle,
  dateLine,
  eventsCountLabel,
  hourLabel,
  roundLine,
  selectionCta,
  swatch,
} from '../../lib/event-catalogue';
import { type EventItemView, eventsApi } from '../../services/events.api';

const impressionsFmt = new Intl.NumberFormat('fr-FR');

interface SelectionPanelProps {
  selected: EventItemView[];
  onRemove: (eventId: string) => void;
  onClear: () => void;
  onGo: () => void;
  going: boolean;
}

/**
 * EVT-CAT2 — « Ma sélection » (Youssef's validated design): the chosen matches with their colour
 * swatch, the selection's total maximum impressions (the sum of each match's I_max — the same
 * cached reads the cards make), and « Je me positionne sur ces N événements ».
 */
export default function SelectionPanel({
  selected,
  onRemove,
  onClear,
  onGo,
  going,
}: SelectionPanelProps) {
  const cmaxes = useQueries({
    queries: selected.map((e) => ({
      queryKey: eventsKeys.cmax(e.id),
      queryFn: () => eventsApi.cmax(e.id),
    })),
  });
  const loaded = cmaxes.every((q) => q.data !== undefined);
  const total = cmaxes.reduce((sum, q) => sum + (q.data?.i_max ?? 0), 0);
  const n = selected.length;

  return (
    <aside
      id="ma-selection"
      aria-label="Ma sélection"
      className="flex flex-col overflow-hidden rounded-[18px] border border-[#E1EAE5] bg-white shadow-[0_1px_2px_rgba(13,43,31,.04),0_12px_32px_-18px_rgba(13,43,31,.25)] xl:sticky xl:top-6 xl:max-h-[calc(100vh-48px)]"
    >
      <div className="flex items-baseline justify-between gap-2.5 border-b border-[#E1EAE5] px-5 pb-3.5 pt-5">
        <h2 className="text-[21px] font-bold text-[#0D2B1F]">Ma sélection</h2>
        <span className="font-mono text-[13px] text-[#4F6B60]">{eventsCountLabel(n)}</span>
      </div>
      <ul className="min-h-[120px] flex-1 overflow-y-auto px-3 py-2">
        {n === 0 ? (
          <li className="px-2.5 py-6 text-center text-sm leading-relaxed text-[#4F6B60]">
            <b className="mb-1 block text-[15px] text-[#0D2B1F]">Aucun match sélectionné</b>
            Cliquez sur « Ajouter à ma sélection » sous chaque affiche pour vous positionner sur
            plusieurs matchs en une seule fois.
          </li>
        ) : (
          selected.map((e) => {
            const [c1, c2] = swatch(e);
            const title = cardTitle(e);
            return (
              <li
                key={e.id}
                className="grid grid-cols-[6px_minmax(0,1fr)_auto] items-start gap-3 border-b border-[#E1EAE5] px-2 py-3 last:border-b-0"
              >
                <span
                  className="w-1.5 self-stretch rounded-sm"
                  style={{ background: `linear-gradient(${c1} 50%, ${c2} 50%)` }}
                  aria-hidden="true"
                />
                <div>
                  <div className="text-sm font-bold leading-snug text-[#0D2B1F]">{title}</div>
                  <div className="mt-0.5 text-[12.5px] leading-snug text-[#4F6B60]">
                    {dateLine(e)}
                    {e.time_tbc || e.date_tbc ? '' : `, ${hourLabel(e.kickoff_at)}`}
                    {roundLine(e) && (
                      <>
                        <br />
                        {roundLine(e)}
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(e.id)}
                  aria-label={`Retirer ${title}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E1EAE5] text-[#4F6B60] hover:border-[#E9C4BA] hover:text-[#B5341C]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })
        )}
      </ul>
      <div className="flex flex-col gap-3 border-t border-[#E1EAE5] bg-[#FBFDFC] px-5 pb-5 pt-4">
        <div className="flex flex-col items-start gap-1 rounded-xl border border-[#D7ECE0] bg-[#F2F9F5] px-3.5 py-3">
          <span className="text-[12.5px] leading-snug text-[#4F6B60]">
            {SELECTION_IMPRESSIONS_LABEL}
          </span>
          <span className="font-mono text-xl text-[#0D2B1F]">
            {n === 0 ? '—' : loaded ? impressionsFmt.format(total) : '…'}
          </span>
        </div>
        <button
          type="button"
          onClick={onGo}
          disabled={n === 0 || going}
          className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 text-center text-[15px] font-bold text-[#0D2B1F] transition-colors hover:bg-[#A9F2CB] disabled:cursor-not-allowed disabled:bg-[#E3EAE6] disabled:text-[#8AA197]"
        >
          {going && <Loader2 className="h-4 w-4 animate-spin" />}
          {selectionCta(n)}
        </button>
        {n > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="self-center text-[13px] font-medium text-[#4F6B60] underline underline-offset-[3px]"
          >
            Vider la sélection
          </button>
        )}
      </div>
    </aside>
  );
}
