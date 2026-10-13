import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { useCreateDemoScreenhost } from '@/features/admin/hooks/useAdminDemo';
import { type DemoScreenhostForm, demoScreenhostBody } from '@/features/admin/lib/demo';
import type { DemoSector } from '@/features/admin/services/admin-demo.service';
import { getErrorMessage } from '@/lib/errors';

const EMPTY: DemoScreenhostForm = {
  name: '',
  latitude: '',
  longitude: '',
  city: '',
  sectorId: '',
  openingHour: '8',
  closingHour: '23',
  audienceMin: '20',
  audienceMax: '80',
};

type TextKey = Exclude<keyof DemoScreenhostForm, 'sectorId'>;

const FIELDS: { key: TextKey; label: string; placeholder: string }[] = [
  { key: 'name', label: 'Nom', placeholder: 'Café Démo Lac' },
  { key: 'latitude', label: 'Latitude', placeholder: '36,8065' },
  { key: 'longitude', label: 'Longitude', placeholder: '10,1815' },
  { key: 'city', label: 'Ville (facultatif)', placeholder: 'Tunis' },
  { key: 'openingHour', label: 'Ouverture (h)', placeholder: '8' },
  { key: 'closingHour', label: 'Fermeture (h)', placeholder: '23' },
  { key: 'audienceMin', label: 'Audience min / demi-heure', placeholder: '20' },
  { key: 'audienceMax', label: 'Audience max / demi-heure', placeholder: '80' },
];

/** DEMO-2 — a map point with a random audience (drawn in [min, max] for every open half-hour). */
export function CreateDemoScreenhostForm({ sectors }: { sectors: DemoSector[] }) {
  const [form, setForm] = useState<DemoScreenhostForm>(EMPTY);
  const create = useCreateDemoScreenhost();

  const submit = async () => {
    const body = demoScreenhostBody(form);
    if (!body.ok) {
      toast.error(body.error);
      return;
    }
    try {
      await create.mutateAsync(body.value);
      toast.success('Screenhost démo créé');
      setForm(EMPTY);
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Création impossible');
    }
  };

  return (
    <form
      className="grid grid-cols-1 gap-3 rounded-lg border bg-gray-50 p-4 md:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {FIELDS.map((f) => (
        <label key={f.key} className="text-sm">
          <span className="block text-gray-600">{f.label}</span>
          <input
            type="text"
            value={form[f.key]}
            placeholder={f.placeholder}
            autoComplete="off"
            onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
            className="mt-1 w-full rounded-lg border bg-white px-3 py-2"
          />
        </label>
      ))}
      <label className="text-sm">
        <span className="block text-gray-600">Catégorie</span>
        <select
          value={form.sectorId}
          onChange={(e) => setForm((prev) => ({ ...prev, sectorId: e.target.value }))}
          className="mt-1 w-full rounded-lg border bg-white px-3 py-2"
        >
          <option value="">Aucune</option>
          {sectors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end md:col-span-3 md:justify-end">
        <button
          type="submit"
          disabled={create.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-60 md:w-auto"
        >
          {create.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Créer le screenhost démo
        </button>
      </div>
    </form>
  );
}
