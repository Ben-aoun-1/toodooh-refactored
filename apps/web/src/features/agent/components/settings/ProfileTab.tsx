import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { usePatchAgentProfile } from '@/features/agent/hooks/useAgentAccount';
import type { AgentProfile } from '@/features/agent/services/agent-account.service';
import { getErrorMessage } from '@/lib/errors';

import { Field, FormActions, INPUT, ReadOnly } from './fields';

/**
 * AGT-1b — « Profil »: first and last name, phone; email and code read-only (spec §9). The page
 * remounts it (key) when the saved profile changes, so the form starts from the saved values.
 */
export function ProfileTab({ profile }: { profile: AgentProfile }) {
  const initial = {
    first_name: profile.first_name ?? '',
    last_name: profile.last_name ?? '',
    phone: profile.phone ?? '',
  };
  const [form, setForm] = useState(initial);
  const patch = usePatchAgentProfile();

  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== initial[k]);
  const valid = Object.values(form).every((v) => v.trim() !== '');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await patch.mutateAsync({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.replace(/\s/g, ''),
      });
      toast.success('Profil enregistré');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Enregistrement impossible');
    }
  };

  const confirm = async () => {
    try {
      await patch.mutateAsync({});
      toast.success('Informations confirmées');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Confirmation impossible');
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Nom *">
          <input
            className={INPUT}
            value={form.last_name}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
          />
        </Field>
        <Field label="Prénom *">
          <input
            className={INPUT}
            value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
          />
        </Field>
        <Field label="Téléphone *">
          <input
            className={INPUT}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </Field>
        <ReadOnly label="Email professionnel" value={profile.email} />
        <ReadOnly label="Code Agent" value={profile.code} />
      </div>
      {!profile.info_verified_at && !dirty && (
        <p className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Vérifiez ces informations saisies par Toodooh, puis confirmez-les.
          <button
            type="button"
            onClick={() => void confirm()}
            className="rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-medium"
          >
            Je confirme mes informations
          </button>
        </p>
      )}
      <FormActions
        dirty={dirty}
        valid={valid}
        saving={patch.isPending}
        onCancel={() => setForm(initial)}
      />
    </form>
  );
}
