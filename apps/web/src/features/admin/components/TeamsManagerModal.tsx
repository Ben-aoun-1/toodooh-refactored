import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import {
  useAdminTeams,
  useDeleteTeam,
  useSaveTeam,
  useUploadTeamLogo,
} from '@/features/admin/hooks/useAdminTeams';
import type { TeamView } from '@/features/events/services/events.api';
import { getErrorMessage } from '@/lib/errors';

const INPUT_CLASSES =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary';

interface Draft {
  id: string | null;
  name: string;
  isNational: boolean;
  colorMain: string;
  colorSecond: string;
  colorCrowd: string;
  useCrowd: boolean;
  logo: File | null;
  removeLogo: boolean;
}

const fromTeam = (t: TeamView | null): Draft => ({
  id: t?.id ?? null,
  name: t?.name ?? '',
  isNational: t?.is_national ?? false,
  colorMain: t?.color_main ?? '#5A6B64',
  colorSecond: t?.color_second ?? '#FFFFFF',
  colorCrowd: t?.color_crowd ?? '#7E8F88',
  useCrowd: t?.color_crowd != null,
  logo: null,
  removeLogo: false,
});

/**
 * EVT-CAT2 — « Équipes »: the teams the catalogue cards show. A team is a name, national team
 * or club, a main and a second colour (the poster's sides and stripe), an optional crowd tint
 * (when the main colour reads badly on the dark stadium), and an OPTIONAL logo/flag — a card
 * without one shows the name on its colours. A team used by a match cannot be deleted.
 */
export default function TeamsManagerModal({ onClose }: { onClose: () => void }) {
  const { data: teams = [], isLoading } = useAdminTeams();
  const save = useSaveTeam();
  const remove = useDeleteTeam();
  const uploadLogo = useUploadTeamLogo();
  const [draft, setDraft] = useState<Draft | null>(null);
  const busy = save.isPending || uploadLogo.isPending || remove.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    if (draft.name.trim() === '') return toast.error("Le nom de l'équipe est obligatoire.");
    try {
      const saved = await save.mutateAsync({
        id: draft.id,
        input: {
          name: draft.name.trim(),
          is_national: draft.isNational,
          color_main: draft.colorMain,
          color_second: draft.colorSecond,
          color_crowd: draft.useCrowd ? draft.colorCrowd : null,
          ...(draft.id && draft.removeLogo ? { logo: null } : {}),
        },
      });
      if (draft.logo) await uploadLogo.mutateAsync({ id: saved.id, file: draft.logo });
      toast.success(draft.id ? 'Équipe modifiée.' : 'Équipe créée.');
      setDraft(null);
    } catch (err) {
      toast.error(getErrorMessage(err) || "L'enregistrement a échoué.");
    }
  };

  const del = async (t: TeamView) => {
    try {
      await remove.mutateAsync(t.id);
      toast.success(`« ${t.name} » supprimée.`);
    } catch (err) {
      toast.error(getErrorMessage(err) || 'La suppression a échoué.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-[#171717]">Équipes</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {draft ? (
          <form onSubmit={submit} className="space-y-4 p-5">
            <div>
              <label htmlFor="team-name" className="mb-1 block text-sm font-medium text-[#171717]">
                Nom <span className="text-red-500">*</span>
              </label>
              <input
                id="team-name"
                className={INPUT_CLASSES}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Espérance de Tunis"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-[#171717]">
              <input
                type="checkbox"
                checked={draft.isNational}
                onChange={(e) => setDraft({ ...draft, isNational: e.target.checked })}
              />
              Sélection nationale (le logo est alors son drapeau)
            </label>
            <div className="grid grid-cols-3 gap-4">
              {(
                [
                  ['colorMain', 'Couleur principale'],
                  ['colorSecond', 'Couleur secondaire'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="text-sm text-[#171717]">
                  <span className="mb-1 block font-medium">{label}</span>
                  <input
                    type="color"
                    value={draft[key]}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value.toUpperCase() })}
                    className="h-10 w-full cursor-pointer rounded-lg border border-gray-300"
                  />
                </label>
              ))}
              <label className="text-sm text-[#171717]">
                <span className="mb-1 flex items-center gap-1.5 font-medium">
                  <input
                    type="checkbox"
                    checked={draft.useCrowd}
                    onChange={(e) => setDraft({ ...draft, useCrowd: e.target.checked })}
                  />
                  Teinte du public
                </span>
                <input
                  type="color"
                  value={draft.colorCrowd}
                  disabled={!draft.useCrowd}
                  onChange={(e) => setDraft({ ...draft, colorCrowd: e.target.value.toUpperCase() })}
                  className="h-10 w-full cursor-pointer rounded-lg border border-gray-300 disabled:opacity-40"
                />
              </label>
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium text-[#171717]">
                Logo ou drapeau (facultatif)
              </span>
              <input
                id="team-logo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => setDraft({ ...draft, logo: e.target.files?.[0] ?? null })}
              />
              <label
                htmlFor="team-logo"
                className="inline-block cursor-pointer rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200"
              >
                Parcourir les fichiers
              </label>
              <span className="ml-2 text-xs text-gray-500">
                {draft.logo ? draft.logo.name : 'JPEG, PNG ou WebP, 2 Mo maximum'}
              </span>
              {draft.id && !draft.logo && (
                <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={draft.removeLogo}
                    onChange={(e) => setDraft({ ...draft, removeLogo: e.target.checked })}
                  />
                  Retirer le logo actuel
                </label>
              )}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Retour
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-brand-primary px-5 py-2 text-sm font-medium text-brand-deep disabled:opacity-60"
              >
                {busy ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3 p-5">
            <button
              type="button"
              onClick={() => setDraft(fromTeam(null))}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-primary px-3 py-2 text-sm font-medium text-brand-deep"
            >
              <Plus className="h-4 w-4" /> Nouvelle équipe
            </button>
            {isLoading ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : teams.length === 0 ? (
              <p className="text-sm text-gray-500">Aucune équipe pour le moment.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {teams.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-100">
                      {t.logo_url ? (
                        <img src={t.logo_url} alt="" className="h-full w-full object-contain" />
                      ) : (
                        <span
                          className="h-4 w-4 rounded-full"
                          style={{ background: t.color_main }}
                        />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#171717]">{t.name}</p>
                      <p className="text-xs text-gray-500">
                        {t.is_national ? 'Sélection nationale' : 'Club'}
                      </p>
                    </div>
                    <span className="flex gap-1" aria-hidden="true">
                      {[t.color_main, t.color_second, t.color_crowd].map((c, i) =>
                        c ? (
                          <span
                            key={i}
                            className="h-4 w-4 rounded border border-gray-200"
                            style={{ background: c }}
                          />
                        ) : null,
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDraft(fromTeam(t))}
                      aria-label={`Modifier ${t.name}`}
                      className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void del(t)}
                      aria-label={`Supprimer ${t.name}`}
                      className="rounded-md p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
