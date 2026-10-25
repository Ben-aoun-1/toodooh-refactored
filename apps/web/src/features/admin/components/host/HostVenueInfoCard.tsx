import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'react-hot-toast';

import { useUpdateHostVenue } from '@/features/admin/hooks/useAdminHost';
import {
  type FieldErrors,
  VENUE_FIELDS,
  type VenueField,
  buildVenuePatch,
  mapServerFieldErrors,
  venueFormFrom,
} from '@/features/admin/lib/host-fiche';
import type { HostVenue } from '@/features/admin/services/admin-host.service';
import { useGovernorates } from '@/features/auth/hooks/useGovernorates';
import { ApiError } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/errors';

import { HostField, HostSection, HostSelectField } from './HostField';

/**
 * HOST-EDIT1 — « Informations générales »: the venue's name, address and GPS position. Saves the
 * dirty fields only; the server re-sends the venue to the hub when the owner is approved.
 */
export default function HostVenueInfoCard({ venue }: { venue: HostVenue }) {
  const [form, setForm] = useState(() => venueFormFrom(venue));
  const [errors, setErrors] = useState<FieldErrors<VenueField>>({});
  const update = useUpdateHostVenue(venue.id);
  const { data: governorates = [] } = useGovernorates();

  useEffect(() => {
    setForm(venueFormFrom(venue));
  }, [venue]);

  const set = (key: VenueField) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const draft = buildVenuePatch(venue, form);
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
      toast.success('Informations du Host enregistrées.');
    } catch (err) {
      if (err instanceof ApiError) setErrors(mapServerFieldErrors(err.fields, VENUE_FIELDS));
      toast.error(getErrorMessage(err) || "Échec de l'enregistrement.");
    }
  };

  const mapUrl =
    venue.latitude !== null && venue.longitude !== null
      ? `https://www.openstreetmap.org/?mlat=${venue.latitude}&mlon=${venue.longitude}#map=17/${venue.latitude}/${venue.longitude}`
      : null;

  return (
    <HostSection
      title="Informations générales"
      description="Nom, adresse et position GPS de l'établissement."
    >
      <form onSubmit={handleSave} className="space-y-4">
        <HostField
          id="host-name"
          label="Nom de l'établissement"
          value={form.name}
          onChange={set('name')}
          error={errors.name}
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <HostField
            id="host-address"
            label="Adresse"
            value={form.address}
            onChange={set('address')}
            error={errors.address}
          />
          <HostField
            id="host-city"
            label="Ville"
            value={form.city}
            onChange={set('city')}
            error={errors.city}
          />
          <HostField
            id="host-postal"
            label="Code postal"
            value={form.postal_code}
            onChange={set('postal_code')}
            error={errors.postal_code}
            inputMode="numeric"
          />
          <HostSelectField
            id="host-governorate"
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
          <HostField
            id="host-zone"
            label="Zone / quartier"
            value={form.zone}
            onChange={set('zone')}
            error={errors.zone}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <HostField
            id="host-lat"
            label="Latitude"
            value={form.latitude}
            onChange={set('latitude')}
            error={errors.latitude}
            inputMode="decimal"
            placeholder="36.8065"
          />
          <HostField
            id="host-lng"
            label="Longitude"
            value={form.longitude}
            onChange={set('longitude')}
            error={errors.longitude}
            inputMode="decimal"
            placeholder="10.1815"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {mapUrl ? (
            <a
              href={mapUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-brand-deep underline"
            >
              Voir la position enregistrée sur la carte
            </a>
          ) : (
            <span className="text-sm text-gray-500">Aucune position GPS enregistrée.</span>
          )}
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
