import { CalendarClock, Plus } from 'lucide-react';
import { useState } from 'react';

import {
  useLaunchCampaign,
  useLaunchEvent,
  useSimulationLaunchOptions,
} from '@/features/admin/hooks/useAdminSimulator';
import {
  type BudgetMode,
  type ClassChoice,
  eventBody,
  launchBody,
} from '@/features/admin/lib/sim-controls';

// SIM-6 phase 3 — the launch controls of the simulator: WHO pays, WHEN it starts, HOW LONG, the
// budget (in TND or as a share of C_max) and the targeting of a campaign; the day, hour and length
// of a match. The bodies are built by lib/sim-controls (pure, tested); this only lays them out.

const inputClass = 'mt-1 rounded-lg border px-2 py-1';

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  width = 'w-20',
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  width?: string;
}) {
  return (
    <label className="text-sm">
      <span className="block text-xs text-gray-600">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        className={`${inputClass} ${width}`}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function BudgetField({
  mode,
  value,
  onMode,
  onValue,
}: {
  mode: BudgetMode;
  value: number;
  onMode: (m: BudgetMode) => void;
  onValue: (n: number) => void;
}) {
  return (
    <label className="text-sm">
      <span className="block text-xs text-gray-600">Budget</span>
      <span className="mt-1 flex gap-1">
        <input
          type="number"
          min={1}
          max={mode === 'tnd' ? 100000 : 100}
          className="w-24 rounded-lg border px-2 py-1"
          value={value}
          onChange={(e) => onValue(Number(e.target.value))}
        />
        <select
          className="rounded-lg border px-1 py-1"
          value={mode}
          onChange={(e) => onMode(e.target.value === 'tnd' ? 'tnd' : 'share')}
        >
          <option value="share">% du C_max</option>
          <option value="tnd">TND</option>
        </select>
      </span>
    </label>
  );
}

const CLASSES: ClassChoice[] = ['', 'populaire', 'moyen', 'premium'];

export function SimulationLaunchForm({ simulationId }: { simulationId: string }) {
  const options = useSimulationLaunchOptions(simulationId);
  const launch = useLaunchCampaign(simulationId);
  const bookEvent = useLaunchEvent(simulationId);

  const [advertiserId, setAdvertiserId] = useState('');
  const [startInDays, setStartInDays] = useState(2);
  const [days, setDays] = useState(7);
  const [spot, setSpot] = useState(10);
  const [budgetMode, setBudgetMode] = useState<BudgetMode>('share');
  const [budget, setBudget] = useState(40);
  const [sectorId, setSectorId] = useState('');
  const [cls, setCls] = useState<ClassChoice>('');

  const [inDays, setInDays] = useState(2);
  const [kickoffHour, setKickoffHour] = useState(20);
  const [durationHours, setDurationHours] = useState(2);
  const [eventBudgetMode, setEventBudgetMode] = useState<BudgetMode>('share');
  const [eventBudget, setEventBudget] = useState(40);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3 rounded-lg bg-gray-50 p-3">
        <label className="text-sm">
          <span className="block text-xs text-gray-600">Annonceur</span>
          <select
            className={inputClass}
            value={advertiserId}
            onChange={(e) => setAdvertiserId(e.target.value)}
          >
            <option value="">Le mieux doté</option>
            {(options.data?.advertisers ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label="Début dans (j)"
          value={startInDays}
          onChange={setStartInDays}
          min={2}
          max={60}
        />
        <NumberField label="Durée (jours)" value={days} onChange={setDays} min={1} max={90} />
        <NumberField label="Spot (s)" value={spot} onChange={setSpot} min={5} max={30} />
        <BudgetField mode={budgetMode} value={budget} onMode={setBudgetMode} onValue={setBudget} />
        <label className="text-sm">
          <span className="block text-xs text-gray-600">Secteur</span>
          <select
            className={inputClass}
            value={sectorId}
            onChange={(e) => setSectorId(e.target.value)}
          >
            <option value="">Tous</option>
            {(options.data?.sectors ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-600">Gamme</span>
          <select
            className={inputClass}
            value={cls}
            onChange={(e) => setCls(CLASSES.find((c) => c === e.target.value) ?? '')}
          >
            {CLASSES.map((c) => (
              <option key={c || 'all'} value={c}>
                {c || 'Toutes'}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={launch.isPending}
          onClick={() =>
            launch.mutate(
              launchBody({
                advertiserId,
                startInDays,
                durationDays: days,
                spotSeconds: spot,
                budgetMode,
                budget,
                sectorId,
                cls,
              }),
            )
          }
          className="flex items-center gap-1 rounded-lg bg-brand-primary px-3 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {launch.isPending ? 'Lancement…' : 'Lancer une campagne'}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg bg-gray-50 p-3">
        <NumberField label="Match dans (j)" value={inDays} onChange={setInDays} min={1} max={60} />
        <NumberField
          label="Coup d'envoi (h)"
          value={kickoffHour}
          onChange={setKickoffHour}
          min={0}
          max={23}
        />
        <NumberField
          label="Durée (h)"
          value={durationHours}
          onChange={setDurationHours}
          min={1}
          max={6}
        />
        <BudgetField
          mode={eventBudgetMode}
          value={eventBudget}
          onMode={setEventBudgetMode}
          onValue={setEventBudget}
        />
        <button
          type="button"
          disabled={bookEvent.isPending}
          onClick={() =>
            bookEvent.mutate(
              eventBody({
                inDays,
                durationHours,
                kickoffHour,
                spotSeconds: spot,
                budgetMode: eventBudgetMode,
                budget: eventBudget,
              }),
            )
          }
          className="flex items-center gap-1 rounded-lg border border-brand-deep px-3 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
        >
          <CalendarClock className="h-4 w-4" />
          {bookEvent.isPending ? 'Réservation…' : 'Réserver un match'}
        </button>
      </div>

      {launch.isError && (
        <p className="text-sm text-red-600">
          {launch.error instanceof Error ? launch.error.message : 'Lancement impossible.'}
        </p>
      )}
      {bookEvent.isError && (
        <p className="text-sm text-red-600">
          {bookEvent.error instanceof Error ? bookEvent.error.message : 'Réservation impossible.'}
        </p>
      )}
      {bookEvent.data && (
        <p className="text-sm text-gray-600">
          « {bookEvent.data.name} » — {bookEvent.data.allocations} établissements réservés, budget{' '}
          {bookEvent.data.budget_tnd} TND sur un plafond événement de {bookEvent.data.c_max_tnd}{' '}
          TND.
        </p>
      )}
      {launch.data && (
        <p className="text-sm text-gray-600">
          « {launch.data.name} » — {launch.data.allocations} établissements retenus, budget{' '}
          {launch.data.budget_tnd} TND sur un plafond de {launch.data.c_max_tnd} TND.
        </p>
      )}
    </div>
  );
}
