import { Plus, Trash2 } from 'lucide-react';

import { useAdminTeams } from '@/features/admin/hooks/useAdminTeams';
import type { UpsertEventInput } from '@/features/admin/services/admin-events.service';
import type { EventItemView } from '@/features/events/services/events.api';

const INPUT_CLASSES =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary';

export interface CatalogueDraft {
  competition: string;
  round: string;
  stadium: string;
  featured: '' | 'hero' | 'pinned';
  dateTbc: boolean;
  timeTbc: boolean;
  qualificationPending: boolean;
  dateLabel: string;
  matches: { home: string; away: string }[];
}

export const catalogueDraftOf = (e: EventItemView | null): CatalogueDraft => ({
  competition: e?.competition ?? '',
  round: e?.round ?? '',
  stadium: e?.stadium ?? '',
  featured: e?.featured ?? '',
  dateTbc: e?.date_tbc ?? false,
  timeTbc: e?.time_tbc ?? false,
  qualificationPending: e?.qualification_pending ?? false,
  dateLabel: e?.date_label ?? '',
  matches: (e?.matches ?? []).map((m) => ({ home: m.home.id, away: m.away?.id ?? '' })),
});

const text = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** The draft → the create/PATCH payload's catalogue part (matches without a home are dropped). */
export const catalogueInput = (d: CatalogueDraft): UpsertEventInput => ({
  competition: text(d.competition),
  round: text(d.round),
  stadium: text(d.stadium),
  featured: d.featured === '' ? null : d.featured,
  date_tbc: d.dateTbc,
  time_tbc: d.timeTbc,
  qualification_pending: d.qualificationPending,
  date_label: text(d.dateLabel),
  matches: d.matches
    .filter((m) => m.home !== '')
    .map((m) => ({ home_team_id: m.home, away_team_id: m.away === '' ? null : m.away })),
});

interface EventCatalogueFieldsProps {
  value: CatalogueDraft;
  onChange: (next: CatalogueDraft) => void;
  onManageTeams: () => void;
}

/**
 * EVT-CAT2 — what the new « Événements » card shows: the competition and round, the stadium,
 * « À la une » (big card or pinned), what is still « à confirmer » (B1: such a match is listed but
 * cannot be bought until confirmed — the date/time above then hold a provisional instant), and
 * the MATCHES — one, or several for an evening (« Soirée Ligue des champions »). An opponent left
 * empty shows « Adversaire après tirage ».
 */
export default function EventCatalogueFields({
  value,
  onChange,
  onManageTeams,
}: EventCatalogueFieldsProps) {
  const { data: teams = [] } = useAdminTeams();
  const set = (patch: Partial<CatalogueDraft>) => onChange({ ...value, ...patch });
  const setMatch = (i: number, patch: Partial<CatalogueDraft['matches'][number]>) =>
    set({ matches: value.matches.map((m, j) => (j === i ? { ...m, ...patch } : m)) });

  const field = (id: keyof CatalogueDraft & string, label: string, placeholder: string) => (
    <div>
      <label htmlFor={`event-${id}`} className="mb-1 block text-sm font-medium text-[#171717]">
        {label}
      </label>
      <input
        id={`event-${id}`}
        className={INPUT_CLASSES}
        value={value[id] as string}
        onChange={(e) => set({ [id]: e.target.value } as Partial<CatalogueDraft>)}
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <fieldset className="space-y-4 rounded-xl border border-gray-200 p-4">
      <legend className="px-1 text-sm font-semibold text-[#171717]">
        Fiche du match (catalogue)
      </legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {field('competition', 'Compétition', 'Ligue des champions')}
        {field('round', 'Journée / phase', 'Ligue des champions, 4ème journée')}
        {field('stadium', 'Stade', 'Stade Hamadi-Agrebi, Radès')}
        <div>
          <label htmlFor="event-featured" className="mb-1 block text-sm font-medium text-[#171717]">
            À la une
          </label>
          <select
            id="event-featured"
            className={INPUT_CLASSES}
            value={value.featured}
            onChange={(e) => set({ featured: e.target.value as CatalogueDraft['featured'] })}
          >
            <option value="">Non — rangé par mois</option>
            <option value="hero">Oui — grande carte</option>
            <option value="pinned">Oui — carte épinglée</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#171717]">
        {(
          [
            ['dateTbc', 'Jour à confirmer'],
            ['timeTbc', 'Horaire à confirmer'],
            ['qualificationPending', 'Sous réserve de qualification'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value[key]}
              onChange={(e) => set({ [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      {(value.dateTbc || value.timeTbc) && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Tant que le jour ou l’horaire est à confirmer, le match est affiché mais ne peut pas être
          acheté. Les dates saisies plus haut servent de date provisoire.
        </p>
      )}
      {field(
        'dateLabel',
        'Libellé de date (facultatif)',
        'Week-end du 30 octobre au 1er novembre 2026',
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-[#171717]">Matchs</span>
          <button
            type="button"
            onClick={onManageTeams}
            className="text-xs font-medium text-brand-deep underline"
          >
            Gérer les équipes
          </button>
        </div>
        <ul className="space-y-2">
          {value.matches.map((m, i) => (
            <li key={i} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
              <select
                aria-label={`Match ${i + 1} — équipe à domicile`}
                className={INPUT_CLASSES}
                value={m.home}
                onChange={(e) => setMatch(i, { home: e.target.value })}
              >
                <option value="">Équipe à domicile…</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <span className="text-xs font-semibold text-gray-400">VS</span>
              <select
                aria-label={`Match ${i + 1} — équipe à l’extérieur`}
                className={INPUT_CLASSES}
                value={m.away}
                onChange={(e) => setMatch(i, { away: e.target.value })}
              >
                <option value="">Adversaire après tirage</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => set({ matches: value.matches.filter((_m, j) => j !== i) })}
                aria-label={`Retirer le match ${i + 1}`}
                className="rounded-md p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        {value.matches.length < 6 && (
          <button
            type="button"
            onClick={() => set({ matches: [...value.matches, { home: '', away: '' }] })}
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-deep"
          >
            <Plus className="h-4 w-4" />
            {value.matches.length === 0 ? 'Ajouter le match' : 'Ajouter une affiche (soirée)'}
          </button>
        )}
      </div>
    </fieldset>
  );
}
