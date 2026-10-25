import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'react-hot-toast';

import { useUpdateHostOwner } from '@/features/admin/hooks/useAdminHost';
import {
  type FieldErrors,
  OWNER_FIELDS,
  type OwnerField,
  buildOwnerPatch,
  mapServerFieldErrors,
  ownerFormFrom,
} from '@/features/admin/lib/host-fiche';
import type { HostOwner } from '@/features/admin/services/admin-host.service';
import { useGovernorates } from '@/features/auth/hooks/useGovernorates';
import { ApiError } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/errors';

import { HostField, HostSection, HostSelectField } from './HostField';

/**
 * HOST-EDIT1 (ruling Q2 B) — « Compte du propriétaire »: the owner's account, shared by every venue
 * of a fleet owner. Not editable here, on purpose: the email (the login), the bank coordinates
 * (their own audited route) and the status (the « Utilisateurs » moderation page).
 */
export default function HostOwnerAccountCard({
  screenhostId,
  owner,
}: {
  screenhostId: string;
  owner: HostOwner;
}) {
  const [form, setForm] = useState(() => ownerFormFrom(owner));
  const [errors, setErrors] = useState<FieldErrors<OwnerField>>({});
  const update = useUpdateHostOwner(screenhostId);
  const { data: governorates = [] } = useGovernorates();

  useEffect(() => {
    setForm(ownerFormFrom(owner));
  }, [owner]);

  const set = (key: OwnerField) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const field = (
    key: OwnerField,
    label: string,
    extra: { inputMode?: 'tel'; hint?: string } = {},
  ) => (
    <HostField
      id={`host-owner-${key}`}
      label={label}
      value={form[key]}
      onChange={set(key)}
      error={errors[key]}
      {...extra}
    />
  );

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const draft = buildOwnerPatch(owner, form);
    if ('errors' in draft) {
      setErrors(draft.errors);
      return;
    }
    setErrors({});
    if (Object.keys(draft.patch).length === 0) {
      toast.error('Aucune modification à enregistrer.');
      return;
    }
    try {
      await update.mutateAsync(draft.patch);
      toast.success('Compte du propriétaire enregistré.');
    } catch (err) {
      if (err instanceof ApiError) setErrors(mapServerFieldErrors(err.fields, OWNER_FIELDS));
      toast.error(getErrorMessage(err) || "Échec de l'enregistrement.");
    }
  };

  return (
    <HostSection
      title="Compte du propriétaire"
      description={
        owner.venues_count > 1
          ? `Ces informations sont communes aux ${owner.venues_count} établissements de ce propriétaire.`
          : 'Informations du compte propriétaire de cet établissement.'
      }
    >
      <p className="mb-4 text-sm text-gray-600">
        E-mail de connexion : <span className="font-medium text-gray-900">{owner.email}</span>
      </p>
      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {field('business_name', 'Raison sociale')}
          {field('tax_number', 'Matricule fiscal', {
            hint: 'Ex. 1234567/A/M/M/000 — vide pour retirer.',
          })}
          {field('contact_name', 'Responsable')}
          {field('fonction', 'Fonction')}
          {field('contact_phone', 'Téléphone', { inputMode: 'tel' })}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {field('street_address', 'Adresse du siège')}
          {field('city', 'Ville')}
          {field('postal_code', 'Code postal')}
          <HostSelectField
            id="host-owner-governorate"
            label="Gouvernorat"
            value={form.governorate_id}
            onChange={set('governorate_id')}
            error={errors.governorate_id}
          >
            <option value="">—</option>
            {governorates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </HostSelectField>
          {field('zone', 'Zone / quartier')}
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={update.isPending}
            className="rounded-xl bg-brand-deep px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </HostSection>
  );
}
