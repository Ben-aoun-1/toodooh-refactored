import { Monitor, MonitorOff, Radio, Search, Users } from 'lucide-react';

import { usePokeActor } from '@/features/admin/hooks/useAdminSimulator';
import type { BoardState, BoardVenue } from '@/features/admin/services/admin-simulator.service';

const CLASS_DOT: Record<string, string> = {
  populaire: 'bg-sky-400',
  moyen: 'bg-violet-400',
  premium: 'bg-amber-400',
};

function VenueCard({
  venue,
  onToggleScreen,
  onInspect,
}: {
  venue: BoardVenue;
  onToggleScreen: (screenId: string, online: boolean) => void;
  onInspect: () => void;
}) {
  const airing = venue.airing.length > 0;
  return (
    <article
      className={`rounded-xl border p-3 transition-colors ${
        airing ? 'border-brand-primary bg-brand-primary/5' : 'bg-white'
      } ${venue.open ? '' : 'opacity-60'}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold leading-tight">{venue.name}</h3>
          <p className="text-xs text-gray-500">
            <span
              className={`mr-1 inline-block h-2 w-2 rounded-full ${
                venue.class ? (CLASS_DOT[venue.class] ?? 'bg-gray-300') : 'bg-gray-300'
              }`}
            />
            {venue.sector ?? '—'} · SPS {venue.sps.toFixed(0)}
          </p>
        </div>
        <span className={`text-xs ${venue.open ? 'text-emerald-600' : 'text-gray-400'}`}>
          {venue.open ? 'ouvert' : 'fermé'}
        </span>
      </header>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {venue.screens.map((screen) => (
          <button
            key={screen.id}
            type="button"
            title={screen.online ? 'Éteindre cet écran' : 'Rallumer cet écran'}
            onClick={() => onToggleScreen(screen.id, screen.online)}
            className={`rounded p-1 ${
              screen.online ? 'text-brand-deep' : 'text-gray-300 hover:text-gray-500'
            }`}
          >
            {screen.online ? <Monitor className="h-5 w-5" /> : <MonitorOff className="h-5 w-5" />}
          </button>
        ))}
      </div>

      <dl className="mt-2 grid grid-cols-3 gap-1 text-xs">
        <div>
          <dt className="flex items-center gap-1 text-gray-500">
            <Users className="h-3 w-3" /> Affluence h-1
          </dt>
          <dd className="font-semibold">{venue.audience_now ?? '—'}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-gray-500">
            <Radio className="h-3 w-3" /> Diffusions
          </dt>
          <dd className="font-semibold">{venue.proofs_today}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Propositions</dt>
          <dd className="font-semibold">
            <span className="text-amber-600">{venue.pending}</span> ·{' '}
            <span className="text-emerald-600">{venue.accepted}</span> ·{' '}
            <span className="text-red-600">{venue.refused}</span>
          </dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={onInspect}
        className="mt-2 flex items-center gap-1 text-xs text-brand-deep underline"
      >
        <Search className="h-3 w-3" /> Inspecter les variables
      </button>

      {airing && (
        <p className="mt-2 truncate rounded bg-brand-primary/20 px-2 py-1 text-xs">
          ▶ {venue.airing.map((a) => `${a.name} ×${a.reps}`).join(' · ')}
        </p>
      )}
    </article>
  );
}

export function SimulatorBoard({
  simulationId,
  board,
  onInspect,
}: {
  simulationId: string;
  board: BoardState;
  onInspect: (venue: { id: string; name: string }) => void;
}) {
  const poke = usePokeActor(simulationId);
  const toggle = (screenId: string, online: boolean) =>
    poke.mutate({ entityId: screenId, params: { offline_probability: online ? 1 : 0 } });

  return (
    <section className="space-y-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Écrans allumés', `${board.totals.screens_online}/${board.totals.screens_total}`],
          ['Établissements', board.totals.venues],
          ['En diffusion', board.totals.airing_now],
          ['Affluence (heure écoulée)', board.totals.audience_now],
          ['Diffusions (j)', board.totals.proofs_today],
          ['Propositions en attente', board.totals.pending_proposals],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border bg-white p-3 text-center">
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {board.venues.map((venue) => (
          <VenueCard
            key={venue.id}
            venue={venue}
            onToggleScreen={toggle}
            onInspect={() => onInspect({ id: venue.id, name: venue.name })}
          />
        ))}
      </div>
    </section>
  );
}
