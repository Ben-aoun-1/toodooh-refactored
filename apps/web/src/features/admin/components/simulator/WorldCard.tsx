import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

import type { World } from '@/features/admin/services/admin-simulator.service';

const CLASS_LABEL: Record<string, string> = {
  populaire: 'Populaire',
  moyen: 'Moyen',
  premium: 'Premium',
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 text-center">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

export function WorldCard({ world }: { world: World }) {
  const c = world.counts;
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Le monde</h2>
        <span className="text-xs text-gray-500">
          graine <code className="rounded bg-gray-100 px-1 py-0.5 font-mono">{world.seed}</code> ·
          généré le {format(new Date(world.generated_at), 'dd/MM/yyyy HH:mm', { locale: fr })}
        </span>
      </header>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Établissements" value={c['venues'] ?? 0} />
        <Stat label="Écrans" value={c['screens'] ?? 0} />
        <Stat label="Propriétaires" value={c['owners'] ?? 0} />
        <Stat label="Annonceurs" value={c['advertisers'] ?? 0} />
        <Stat label="Agents" value={c['agents'] ?? 0} />
        <Stat label="Solde total" value={`${world.wallet_total_tnd.toLocaleString('fr-FR')} TND`} />
      </dl>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Par secteur
          </h3>
          <ul className="space-y-1 text-sm">
            {Object.entries(world.by_sector).map(([name, n]) => (
              <li key={name} className="flex justify-between">
                <span className="text-gray-600">{name}</span>
                <span className="font-medium">{n}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Par gamme
          </h3>
          <ul className="space-y-1 text-sm">
            {Object.entries(world.by_class).map(([name, n]) => (
              <li key={name} className="flex justify-between">
                <span className="text-gray-600">{CLASS_LABEL[name] ?? name}</span>
                <span className="font-medium">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Historique mesuré : {c['history_days'] ?? 0} jours (
        {(c['history_cells'] ?? 0).toLocaleString('fr-FR')} mesures).
      </p>
    </section>
  );
}
