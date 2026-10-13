import { Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import {
  useDeleteAgentPhoto,
  usePatchAgentProfile,
  useUploadAgentPhoto,
} from '@/features/agent/hooks/useAgentAccount';
import type { AgentAccount, AgentProfile } from '@/features/agent/services/agent-account.service';
import { useGovernorates } from '@/features/auth/hooks/useGovernorates';
import { getErrorMessage } from '@/lib/errors';

import { BankPanel } from './BankPanel';
import { Field, FormActions, INPUT, ReadOnly } from './fields';

/**
 * AGT-1b — « Informations légales » (spec §9): photo (Supprimer, Changer — PNG/JPEG ≥ 400 px),
 * address, city, postal code and governorate editable; tax number and covered zone read-only; then
 * « Mes coordonnées bancaires ». Remounted (key) when the saved profile changes.
 */
export function LegalTab({ profile, account }: { profile: AgentProfile; account: AgentAccount }) {
  const governorates = useGovernorates();
  const patch = usePatchAgentProfile();
  const upload = useUploadAgentPhoto();
  const remove = useDeleteAgentPhoto();
  const initial = {
    street_address: profile.street_address ?? '',
    city: profile.city ?? '',
    postal_code: profile.postal_code ?? '',
    governorate_id: profile.governorate_id ?? '',
  };
  const [form, setForm] = useState(initial);
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== initial[k]);
  const valid =
    Object.values(form).every((v) => v.trim() !== '') && /^\d{4}$/.test(form.postal_code.trim());

  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      toast.success(ok);
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Action impossible');
    }
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-4">
        {profile.photo_url ? (
          <img src={profile.photo_url} alt="" className="h-20 w-20 rounded-full object-cover" />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-primary text-2xl font-semibold text-white">
            {(profile.first_name ?? 'A').charAt(0).toUpperCase()}
          </span>
        )}
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
          <Upload className="h-4 w-4" />
          Changer
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void run(upload.mutateAsync(f), 'Photo enregistrée');
              e.target.value = '';
            }}
          />
        </label>
        {profile.photo_url && (
          <button
            type="button"
            onClick={() => void run(remove.mutateAsync(undefined), 'Photo supprimée')}
            className="rounded-lg border px-3 py-2 text-sm text-red-700"
          >
            Supprimer
          </button>
        )}
        <p className="text-xs text-[#5C5C5C]">PNG ou JPEG, 400 × 400 px minimum.</p>
      </section>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            patch.mutateAsync({
              street_address: form.street_address.trim(),
              city: form.city.trim(),
              postal_code: form.postal_code.trim(),
              governorate_id: form.governorate_id,
            }),
            'Informations enregistrées',
          );
        }}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Adresse *">
            <input
              className={INPUT}
              value={form.street_address}
              onChange={(e) => setForm({ ...form, street_address: e.target.value })}
            />
          </Field>
          <Field label="Ville *">
            <input
              className={INPUT}
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </Field>
          <Field label="Code postal *">
            <input
              className={INPUT}
              value={form.postal_code}
              onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
            />
          </Field>
          <Field label="Gouvernorat *">
            <select
              className={INPUT}
              value={form.governorate_id}
              onChange={(e) => setForm({ ...form, governorate_id: e.target.value })}
            >
              <option value="">— choisir —</option>
              {(governorates.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          <ReadOnly label="Matricule fiscal" value={profile.tax_number} />
          <ReadOnly label="Zone couverte" value={profile.covered_zone} />
        </div>
        <FormActions
          dirty={dirty}
          valid={valid}
          saving={patch.isPending}
          onCancel={() => setForm(initial)}
        />
      </form>

      <BankPanel rib={account.rib} />
    </div>
  );
}
