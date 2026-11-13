import { useState } from 'react';

import { ToursWeekGrid } from '@/features/admin/components/ToursWeekGrid';
import type { ToursFiche } from '@/features/admin/lib/eligible-hosts';
import {
  STATUT,
  calculHint,
  imp,
  journalLine,
  statutDetail,
  tnd,
  toursRecus,
} from '@/features/admin/lib/tours-fiche';

// DISP-TOURS — the admin fiche of a campaign on the tours engine (Mariem's spec §3.3), inside
// « Hosts éligibles »: bloc 1 the calculation (when, F, S, passages/h, T, maximum, allocated,
// exact price), bloc 2 one row per venue (order, potential, tours received, impressions, amount,
// status — click a row for its week, bloc 3), bloc 4 the engine journal's five phases.

const TONE: Record<string, string> = {
  green: 'bg-green-50 text-green-700',
  blue: 'bg-blue-50 text-blue-700',
  gray: 'bg-gray-100 text-gray-600',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
};

export function CampaignToursFiche({ fiche }: { fiche: ToursFiche }) {
  const firstRetained = fiche.venues.find((v) => v.impressions > 0)?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(firstRetained);
  const open = fiche.venues.find((v) => v.id === openId) ?? null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">{calculHint(fiche)}</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-gray-500">Budget visé</dt>
          <dd className="font-semibold text-gray-900">{tnd(fiche.budget_tnd)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">I_cible</dt>
          <dd className="font-semibold text-gray-900">{imp(fiche.i_cible)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Impressions allouées</dt>
          <dd className="font-semibold text-gray-900">{imp(fiche.i_alloue)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Prix exact</dt>
          <dd className="font-semibold text-brand-deep">{tnd(fiche.prix_tnd)}</dd>
        </div>
      </dl>

      {fiche.venues.length === 0 ? (
        <p className="text-sm text-gray-600">Aucun établissement dans le pool.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b text-gray-500">
              <tr>
                <th className="py-1 pr-2 font-medium">Ordre</th>
                <th className="py-1 pr-2 font-medium">Établissement</th>
                <th className="py-1 pr-2 font-medium">Potentiel plein</th>
                <th className="py-1 pr-2 font-medium">Tours reçus</th>
                <th className="py-1 pr-2 font-medium">Attribuées</th>
                <th className="py-1 pr-2 font-medium">Montant host</th>
                <th className="py-1 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {fiche.venues.map((v) => (
                <tr
                  key={v.id}
                  onClick={() => setOpenId((cur) => (cur === v.id ? null : v.id))}
                  className={`cursor-pointer hover:bg-orange-50 ${openId === v.id ? 'bg-orange-50' : ''}`}
                >
                  <td className="py-1 pr-2 tabular-nums">{v.ordre}</td>
                  <td className="py-1 pr-2">
                    <p className="font-medium text-gray-900">{v.name}</p>
                    <p className="text-[11px] text-gray-500">
                      {[v.sector, v.class].filter(Boolean).join(' · ') || '—'} · SPS{' '}
                      {Math.round(v.sps)}
                    </p>
                  </td>
                  <td className="py-1 pr-2 tabular-nums">
                    <p>{imp(v.plein_impressions)}</p>
                    <p className="text-gray-400">{tnd(v.plein_montant_tnd)}</p>
                  </td>
                  <td className="py-1 pr-2">{toursRecus(v.tours, fiche.params.r_plein)}</td>
                  <td className="py-1 pr-2 tabular-nums">{imp(v.impressions)}</td>
                  <td className="py-1 pr-2 tabular-nums">
                    {v.impressions > 0 ? tnd(v.montant_tnd) : '·'}
                  </td>
                  <td className="py-1">
                    <span
                      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[STATUT[v.statut].tone] ?? ''}`}
                    >
                      {STATUT[v.statut].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <>
          {statutDetail(open) && <p className="text-xs text-gray-600">{statutDetail(open)}</p>}
          <ToursWeekGrid venue={open} rPlein={fiche.params.r_plein} />
        </>
      )}

      <div className="rounded-lg border border-gray-200 p-3">
        <p className="mb-2 text-xs font-semibold text-gray-700">Journal du calcul</p>
        <ul className="space-y-1 text-xs text-gray-700">
          {fiche.journal.map((entry) => {
            const line = journalLine(entry);
            return (
              <li key={entry.phase} className="flex gap-2">
                <span className="w-28 shrink-0 font-semibold">{line.label}</span>
                <span className="flex-1">{line.text}</span>
                <span className="shrink-0 text-gray-400 tabular-nums">{entry.ms} ms</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
