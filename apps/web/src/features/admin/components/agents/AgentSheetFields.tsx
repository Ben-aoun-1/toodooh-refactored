import type { AgentSheetForm } from '@/features/admin/lib/agent-sheet';
import { useGovernorates } from '@/features/auth/hooks/useGovernorates';

interface Props {
  value: AgentSheetForm;
  onChange: (next: AgentSheetForm) => void;
  role: 'screenhost_agent' | 'screencast_agent';
}

const INPUT =
  'w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent';

/** AGT-1 — the agent sheet fields of « Créer rôle » (agent specs v1.0 §2). */
export function AgentSheetFields({ value, onChange, role }: Props) {
  const governorates = useGovernorates();
  const set = (key: keyof AgentSheetForm) => (e: { target: { value: string } }) =>
    onChange({ ...value, [key]: e.target.value });

  const field = (
    key: keyof AgentSheetForm,
    label: string,
    props: { type?: string; placeholder?: string; required?: boolean } = {},
  ) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={`agent-${key}`}>
        {label}
        {props.required ? ' *' : ''}
      </label>
      <input
        id={`agent-${key}`}
        type={props.type ?? 'text'}
        value={value[key]}
        onChange={set(key)}
        placeholder={props.placeholder}
        className={INPUT}
      />
    </div>
  );

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 p-4">
      <p className="text-sm font-semibold text-gray-800">Fiche agent</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {field('phone', 'Téléphone', { placeholder: '+21612345678', required: true })}
        {field('tax_number', 'Matricule fiscal', {
          placeholder: '1234567ABC000',
          required: role === 'screencast_agent',
        })}
        {field('street_address', 'Adresse', { required: true })}
        {field('city', 'Ville', { required: true })}
        {field('postal_code', 'Code postal', { placeholder: '1000', required: true })}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="agent-gov">
            Gouvernorat *
          </label>
          <select
            id="agent-gov"
            value={value.governorate_id}
            onChange={set('governorate_id')}
            className={INPUT}
          >
            <option value="">— choisir —</option>
            {(governorates.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        {field('covered_zone', 'Zone couverte', { placeholder: 'Grand Tunis', required: true })}
        {field('certified_at', 'Date de certification', { type: 'date', required: true })}
        {field('commission_pct', 'Taux de commission (%)', {
          placeholder: 'Vide = taux par défaut du moteur',
        })}
      </div>
      <p className="text-xs text-gray-500">
        Le taux n’est jamais affiché à l’agent. Une révision ne touche que les commissions
        suivantes.
      </p>
    </div>
  );
}
