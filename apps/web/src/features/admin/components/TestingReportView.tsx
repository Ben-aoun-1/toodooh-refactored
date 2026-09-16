import type { Stats, TestingReport } from '@/features/admin/services/admin-testing.service';

// ADM-OBS1 — the « Tests » report view, moved VERBATIM out of pages/TestingPage.tsx (SIM-5,
// 2026-09-16) so the Simulateur can render the very same view for a sandbox venue.

const SLOT_LABEL = (slot: number): string =>
  `${String(Math.floor(slot / 2)).padStart(2, '0')}h${slot % 2 ? '30' : '00'}`;
const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const STATE_LABEL: Record<string, string> = {
  libre: 'libre',
  partiel: 'partiel',
  plein: 'plein',
  indisponible: 'indisponible (choix du host)',
};
const STATE_CLASS: Record<string, string> = {
  libre: 'text-gray-500',
  partiel: 'text-amber-700',
  plein: 'text-red-700',
  indisponible: 'text-blue-700',
};
const statusCounts = (rows: TestingReport['status_hours']): string => {
  const n = (state: string) => rows.filter((h) => h.state === state).length;
  return `${rows.length} heures : ${n('libre')} libres, ${n('partiel')} partielles, ${n('plein')} pleines, ${n('indisponible')} indisponibles`;
};

const fmt = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(2);

function StatsRow({ label, s }: { label: string; s: Stats }) {
  return (
    <tr className="border-t">
      <td className="py-1 pr-4 font-medium">{label}</td>
      <td className="py-1 pr-4 tabular-nums">{s.n}</td>
      <td className="py-1 pr-4 tabular-nums">{fmt(s.min)}</td>
      <td className="py-1 pr-4 tabular-nums">{fmt(s.median)}</td>
      <td className="py-1 pr-4 tabular-nums">{fmt(s.mean)}</td>
      <td className="py-1 pr-4 tabular-nums">{fmt(s.max)}</td>
    </tr>
  );
}

function KeyValues({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">{title}</h2>
      <table className="text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-t">
              <td className="py-1 pr-6 text-gray-600">{k}</td>
              <td className="py-1 font-mono tabular-nums">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function TestingReportView({ r }: { r: TestingReport }) {
  const a = r.audience;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <KeyValues
          title="Période"
          rows={[
            ['du → au', `${r.periode.from} → ${r.periode.to}`],
            ["aujourd'hui (Tunis)", r.periode.today],
            ['plancher estimation (MEJ-7b)', r.periode.estimation_floor ?? '—'],
            [
              'heures d’ouverture',
              r.screenhost.opening_hour === null
                ? '—'
                : `${r.screenhost.opening_hour}h → ${r.screenhost.closing_hour}h (${r.pricing.broadcastable_hours.length} h)`,
            ],
            ['jours indisponibles (E2)', r.pricing.unavailable_days.join(', ') || '—'],
          ]}
        />
        <KeyValues
          title="Audience — les KPI de « Mes performances »"
          rows={[
            ['Audience globale (Σ cases, FLOW-1)', fmt(a.total)],
            ['Audience moyenne / jour', fmt(a.mean_per_day)],
            ['Audience moyenne / heure d’ouverture', fmt(a.mean_per_hour)],
            ['jours mesurés / estimés', `${a.measured_days} / ${a.estimated_days}`],
            ['dont estimés (valeur, %)', a.estimated_pct === null ? '—' : `${a.estimated_pct} %`],
          ]}
        />
      </div>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          Audience — min / médiane / moyenne / max
        </h2>
        <table className="text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="pr-4">série</th>
              <th className="pr-4">n</th>
              <th className="pr-4">min</th>
              <th className="pr-4">médiane</th>
              <th className="pr-4">moyenne</th>
              <th className="pr-4">max</th>
            </tr>
          </thead>
          <tbody>
            <StatsRow label="jours (Σ des cases du jour)" s={a.days} />
            <StatsRow label="cases (demi-heures), toutes" s={a.cells} />
            <StatsRow label="cases mesurées" s={a.measured_cells} />
            <StatsRow label="cases estimées (grille)" s={a.backup_cells} />
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <KeyValues
          title="SPS — score, variables, preuves, poids"
          rows={[
            ['score live (computeSps)', fmt(r.sps.live)],
            ['score stocké (screenhosts.sps)', fmt(r.sps.stored)],
            [
              'calculable ? (sinon neutre en dispatch)',
              r.sps.computable ? 'oui' : `non → ${r.sps.neutral}`,
            ],
            ...Object.entries(r.sps.variables).map(
              ([k, v]) =>
                [`variable ${k} (poids ${r.sps.weights[k] ?? '?'})`, fmt(v)] as [string, string],
            ),
            ...Object.entries(r.sps.observations).map(
              ([k, v]) => [`preuve ${k}`, fmt(v)] as [string, string],
            ),
            ...Object.entries(r.sps.windows_days).map(
              ([k, v]) => [`fenêtre ${k}`, `${v} j`] as [string, string],
            ),
          ]}
        />
        <KeyValues
          title="Pricing / dispatch — entrées en vigueur"
          rows={[
            ['A_max (heure la plus chargée, pers.)', fmt(r.pricing.a_max)],
            ['CPM standard (TND / 1000)', fmt(r.pricing.cpm_standard_tnd)],
            ['CPM événement', fmt(r.pricing.cpm_event_tnd)],
            [
              'T (10 s / 20 s / 30 s)',
              `${r.pricing.t.t10s} / ${r.pricing.t.t20s} / ${r.pricing.t.t30s}`,
            ],
            ['délai de lancement (jours ouvrés)', String(r.pricing.campaign_lead_working_days)],
            ['heures diffusables', r.pricing.broadcastable_hours.join(' ') || '—'],
          ]}
        />
      </div>

      {/* Slice B — the four-state status per open hour, and the campaigns on this venue. */}
      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          Statut par heure d’ouverture — libre / partiel (minutes libres) / plein / indisponible
        </h2>
        <p className="mb-2 text-xs text-gray-500">
          {statusCounts(r.status_hours)} — engagé = Σ (reps × durée du spot) des parts ACCEPTÉES ;
          libre = F − engagé.
        </p>
        <div className="max-h-72 overflow-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="pr-4">date</th>
                <th className="pr-4">heure</th>
                <th className="pr-4">état</th>
                <th className="pr-4">engagé (s)</th>
                <th className="pr-4">libre (min)</th>
                <th className="pr-4">campagnes</th>
              </tr>
            </thead>
            <tbody>
              {r.status_hours.map((h) => (
                <tr key={`${h.date}-${h.hour}`} className="border-t">
                  <td className="py-0.5 pr-4 font-mono">{h.date}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{String(h.hour).padStart(2, '0')}h</td>
                  <td className={`py-0.5 pr-4 ${STATE_CLASS[h.state]}`}>{STATE_LABEL[h.state]}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{h.engaged_seconds}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{fmt(h.minutes_free)}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{h.campaigns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          Campagnes sur cet établissement — diffusée en entier / perturbée / reçue en redispatch /
          argent perdu
        </h2>
        <p className="mb-2 text-xs text-gray-500">
          Argent perdu (règle du 12/09) = ce qui aurait été payé à cet établissement pour les
          créneaux non diffusés = impressions manquées facturables × CPM / 1000, redirigé vers les
          établissements du redispatch.
        </p>
        {r.campaigns.length === 0 ? (
          <p className="text-sm text-gray-400">Aucune campagne avec des créneaux sur la période.</p>
        ) : (
          <div className="overflow-auto">
            <table className="text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="pr-4">campagne</th>
                  <th className="pr-4">statut</th>
                  <th className="pr-4">acceptation</th>
                  <th className="pr-4">créneaux période</th>
                  <th className="pr-4">écoulés</th>
                  <th className="pr-4">diffusés</th>
                  <th className="pr-4">manqués</th>
                  <th className="pr-4">impr. manquées (phys / fact)</th>
                  <th className="pr-4">verdict</th>
                  <th className="pr-4">argent perdu (TND)</th>
                  <th className="pr-4">redirigé vers</th>
                </tr>
              </thead>
              <tbody>
                {r.campaigns.map((c) => (
                  <tr key={c.campaign_id} className="border-t">
                    <td className="py-0.5 pr-4">{c.campaign_name}</td>
                    <td className="py-0.5 pr-4">{c.campaign_status}</td>
                    <td className="py-0.5 pr-4">{c.statut_acceptation}</td>
                    <td className="py-0.5 pr-4 tabular-nums">{c.slots_in_period}</td>
                    <td className="py-0.5 pr-4 tabular-nums">{c.slots_elapsed}</td>
                    <td className="py-0.5 pr-4 tabular-nums">{c.slots_delivered}</td>
                    <td className="py-0.5 pr-4 tabular-nums">{c.slots_missed}</td>
                    <td className="py-0.5 pr-4 tabular-nums">
                      {c.impressions_missed_physical} / {c.impressions_missed_fact}
                    </td>
                    <td className="py-0.5 pr-4">
                      {c.ran_fully ? 'diffusée en entier' : c.disrupted ? 'perturbée' : 'à venir'}
                      {c.received_redispatch ? ' · reçue en redispatch' : ''}
                    </td>
                    <td className="py-0.5 pr-4 tabular-nums">{fmt(c.money_lost_tnd)}</td>
                    <td className="py-0.5 pr-4 font-mono text-xs">
                      {c.redirected_to.length === 0
                        ? '—'
                        : c.redirected_to
                            .map((t) => `${t.screenhost_id.slice(0, 8)} (+${t.added_fact})`)
                            .join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Jours de la période</h2>
        <div className="max-h-72 overflow-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="pr-4">date</th>
                <th className="pr-4">audience</th>
                <th className="pr-4">source</th>
                <th className="pr-4">≥ 1 case mesurée</th>
              </tr>
            </thead>
            <tbody>
              {a.day_rows.map((d) => (
                <tr key={d.date} className="border-t">
                  <td className="py-0.5 pr-4 font-mono">{d.date}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{d.audience}</td>
                  <td className="py-0.5 pr-4">{d.source}</td>
                  <td className="py-0.5 pr-4">{d.has_measured ? 'oui' : 'non'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          « Vos peak hours » — max par (jour, créneau) sur la période (PEAK-MAX1)
        </h2>
        <div className="overflow-auto">
          <table className="text-[11px]">
            <thead>
              <tr>
                <th className="pr-2" />
                {Array.from({ length: 48 }, (_, s) => (
                  <th key={s} className="px-0.5 font-normal text-gray-500">
                    {s % 2 === 0 ? SLOT_LABEL(s) : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.week.map((row, dow) => (
                <tr key={dow}>
                  <td className="pr-2 font-medium">{DOW[dow]}</td>
                  {row.map((c, s) => (
                    <td
                      key={s}
                      title={c.value === null ? 'aucune donnée' : `${c.value} (${c.source})`}
                      className={`px-0.5 text-center tabular-nums ${
                        c.value === null
                          ? 'text-gray-300'
                          : c.source === 'backup'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-emerald-50 text-emerald-900'
                      }`}
                    >
                      {c.value === null ? '·' : c.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          vert = mesuré · ambre = grille (estimation) · point = aucune donnée
        </p>
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          Cases brutes de la période ({a.cell_rows.length})
        </h2>
        <div className="max-h-80 overflow-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="pr-4">date</th>
                <th className="pr-4">créneau</th>
                <th className="pr-4">valeur</th>
                <th className="pr-4">source</th>
              </tr>
            </thead>
            <tbody>
              {a.cell_rows.map((c) => (
                <tr key={`${c.date}-${c.slot}`} className="border-t">
                  <td className="py-0.5 pr-4 font-mono">{c.date}</td>
                  <td className="py-0.5 pr-4 font-mono">{SLOT_LABEL(c.slot)}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{c.value}</td>
                  <td className="py-0.5 pr-4">{c.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <details className="rounded-xl border bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-gray-700">
          JSON brut (tout ce que l’API renvoie, config de dispatch incluse)
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto text-xs">{JSON.stringify(r, null, 2)}</pre>
      </details>
    </div>
  );
}
