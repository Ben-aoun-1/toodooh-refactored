import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { Building2, MapPin, Plus } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

import AgentLayout from '@/features/agent/components/AgentLayout';
import {
  useCreateEstablishment,
  useEstablishments,
} from '@/features/agent/hooks/useEstablishments';
import { authService } from '@/features/auth/services/auth.service';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { getErrorMessage } from '@/lib/errors';

const inputClass =
  'w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent text-sm';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1.5';

interface FormState {
  name: string;
  screen_count: string;
  latitude: string;
  longitude: string;
  address: string;
  city: string;
  zone: string;
  governorate_id: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  screen_count: '',
  latitude: '',
  longitude: '',
  address: '',
  city: '',
  zone: '',
  governorate_id: '',
};

// Slice-2 E — the screenhost-agent establishment workspace: a create form + the agent's own
// establishments list, in a TOODOOH dashboard shell (Figma node 941:46383 as visual reference).
// Map pin-drop is intentionally deferred (numeric lat/lng inputs for now) — flagged as follow-up.
export default function AgentWorkspace() {
  const contactName = useAuthStore((s) => s.contactName);
  const { establishments, loading, isError } = useEstablishments();
  const createEstablishment = useCreateEstablishment();
  const { data: governorates = [] } = useQuery({
    queryKey: ['governorates'],
    queryFn: () => authService.getGovernorates(),
  });

  const govName = useMemo(() => {
    const byId = new Map(governorates.map((g) => [g.id, g.name]));
    return (id: string | null): string => (id ? (byId.get(id) ?? '—') : '—');
  }, [governorates]);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const set = (key: keyof FormState) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const screenCount = Number(form.screen_count);
    const latitude = Number(form.latitude);
    const longitude = Number(form.longitude);

    if (!name) return toast.error('Le nom est obligatoire.');
    if (!Number.isInteger(screenCount) || screenCount < 1)
      return toast.error("Le nombre d'écrans doit être un entier supérieur ou égal à 1.");
    if (!form.latitude.trim() || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)
      return toast.error('Latitude invalide (entre -90 et 90).');
    if (
      !form.longitude.trim() ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    )
      return toast.error('Longitude invalide (entre -180 et 180).');

    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    try {
      await createEstablishment.mutateAsync({
        name,
        screen_count: screenCount,
        latitude,
        longitude,
        ...(opt(form.address) ? { address: opt(form.address) } : {}),
        ...(opt(form.city) ? { city: opt(form.city) } : {}),
        ...(opt(form.zone) ? { zone: opt(form.zone) } : {}),
        ...(form.governorate_id ? { governorate_id: form.governorate_id } : {}),
      });
      toast.success('Établissement créé.');
      setForm(EMPTY_FORM);
    } catch (error) {
      toast.error(getErrorMessage(error) || "Erreur lors de la création de l'établissement.");
    }
  };

  return (
    <AgentLayout
      title={`Bonjour, ${contactName ?? 'Agent'}`}
      subtitle="Enregistrez les établissements de votre réseau"
    >
      <div className="space-y-6">
        {/* Create form */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Plus className="h-5 w-5 text-brand-primary" />
            <h2 className="text-lg font-semibold text-gray-900">Nouvel établissement</h2>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass} htmlFor="est-name">
                  Nom <span className="text-red-500">*</span>
                </label>
                <input
                  id="est-name"
                  className={inputClass}
                  value={form.name}
                  onChange={set('name')}
                  placeholder="Nom de l'établissement"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="est-screens">
                  Nombre d&apos;écrans <span className="text-red-500">*</span>
                </label>
                <input
                  id="est-screens"
                  type="number"
                  min={1}
                  step={1}
                  className={inputClass}
                  value={form.screen_count}
                  onChange={set('screen_count')}
                  placeholder="1"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="est-lat">
                  Latitude <span className="text-red-500">*</span>
                </label>
                <input
                  id="est-lat"
                  type="number"
                  step="any"
                  className={inputClass}
                  value={form.latitude}
                  onChange={set('latitude')}
                  placeholder="36.8065"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="est-lng">
                  Longitude <span className="text-red-500">*</span>
                </label>
                <input
                  id="est-lng"
                  type="number"
                  step="any"
                  className={inputClass}
                  value={form.longitude}
                  onChange={set('longitude')}
                  placeholder="10.1815"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="est-address">
                  Adresse
                </label>
                <input
                  id="est-address"
                  className={inputClass}
                  value={form.address}
                  onChange={set('address')}
                  placeholder="Adresse"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="est-city">
                  Ville
                </label>
                <input
                  id="est-city"
                  className={inputClass}
                  value={form.city}
                  onChange={set('city')}
                  placeholder="Ville"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="est-zone">
                  Zone
                </label>
                <input
                  id="est-zone"
                  className={inputClass}
                  value={form.zone}
                  onChange={set('zone')}
                  placeholder="Zone / secteur"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="est-gov">
                  Gouvernorat
                </label>
                <select
                  id="est-gov"
                  className={inputClass}
                  value={form.governorate_id}
                  onChange={set('governorate_id')}
                >
                  <option value="">— Sélectionner —</option>
                  {governorates.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              La position est saisie en coordonnées (latitude / longitude). La sélection par carte
              sera ajoutée ultérieurement.
            </p>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={createEstablishment.isPending}
                className="px-6 py-2.5 bg-brand-primary text-brand-deep rounded-lg font-semibold text-sm hover:bg-brand-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {createEstablishment.isPending ? (
                  'Création…'
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Créer l&apos;établissement
                  </>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* Own establishments list */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-brand-primary" />
            <h2 className="text-lg font-semibold text-gray-900">Mes établissements</h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-primary"></div>
            </div>
          ) : isError ? (
            <p className="px-6 py-12 text-center text-sm text-red-600">
              Erreur lors du chargement des établissements.
            </p>
          ) : establishments.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <MapPin className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">
                Aucun établissement enregistré pour le moment.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-6 py-3">Nom</th>
                    <th className="px-6 py-3">Coordonnées</th>
                    <th className="px-6 py-3 text-center">Écrans</th>
                    <th className="px-6 py-3">Ville / Gouvernorat</th>
                    <th className="px-6 py-3">Statut</th>
                    <th className="px-6 py-3">Créé le</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {establishments.map((est) => (
                    <tr key={est.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium text-gray-900">{est.name}</td>
                      <td className="px-6 py-4 tabular-nums text-gray-700">
                        {est.latitude.toFixed(5)}, {est.longitude.toFixed(5)}
                      </td>
                      <td className="px-6 py-4 text-center tabular-nums text-gray-800">
                        {est.screen_count}
                      </td>
                      <td className="px-6 py-4 text-gray-700">
                        {est.city ?? '—'} / {govName(est.governorate_id)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            est.is_active
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {est.is_active ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-700">
                        {format(parseISO(est.created_at), 'dd/MM/yyyy')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AgentLayout>
  );
}
