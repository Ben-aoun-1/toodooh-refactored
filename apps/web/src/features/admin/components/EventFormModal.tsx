import { X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import {
  useCreateEvent,
  useUpdateEvent,
  useUploadEventImage,
} from '@/features/admin/hooks/useAdminEvents';
import type { AdminEventView } from '@/features/admin/services/admin-events.service';
import { getErrorMessage } from '@/lib/errors';

const INPUT_CLASSES =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary';

/** ISO instant → the Tunis wall-clock value a datetime-local input expects (YYYY-MM-DDTHH:mm). */
const isoToLocalInput = (iso: string): string => {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(d);
  const time = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Africa/Tunis',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  return `${date}T${time.replace('h', ':')}`;
};

/** Tunis wall-clock input value → the wire instant (Tunis is UTC+1, no DST since 2008). */
const localInputToIso = (value: string): string => new Date(`${value}:00+01:00`).toISOString();

interface EventFormModalProps {
  /** null = create; an existing OFFICIAL event = edit. */
  event: AdminEventView | null;
  onClose: () => void;
}

/**
 * The §10 create/edit modal — ONLY the kept fields: Nom (requis), Description, Image (affiche),
 * Type verrouillé « Sport » (a static chip, no input), Catégorie, Date/heure début + fin.
 * The legacy fields §10 removed (attendance, priority, the actif/featured flags, the whole
 * location block) have no columns, no inputs, no code.
 */
export default function EventFormModal({ event, onClose }: EventFormModalProps) {
  const [name, setName] = useState(event?.name ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [category, setCategory] = useState(event?.category ?? '');
  const [kickoff, setKickoff] = useState(event ? isoToLocalInput(event.kickoff_at) : '');
  const [ends, setEnds] = useState(event ? isoToLocalInput(event.ends_at) : '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const uploadImage = useUploadEventImage();
  const busy = create.isPending || update.isPending || uploadImage.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() === '') return setError("Le nom de l'événement est obligatoire.");
    if (kickoff === '') return setError('La date et heure de début est obligatoire.');
    if (ends === '') return setError('La date et heure de fin est obligatoire.');
    if (localInputToIso(ends) <= localInputToIso(kickoff))
      return setError('La fin doit être postérieure au début.');
    setError(null);
    const payload = {
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      category: category.trim() === '' ? null : category.trim(),
      kickoff_at: localInputToIso(kickoff),
      ends_at: localInputToIso(ends),
    };
    try {
      const saved = event
        ? await update.mutateAsync({ id: event.id, patch: payload })
        : await create.mutateAsync(payload);
      if (imageFile) await uploadImage.mutateAsync({ id: saved.id, file: imageFile });
      toast.success(event ? 'Événement modifié.' : 'Événement créé.');
      onClose();
    } catch (err) {
      setError(getErrorMessage(err) || "L'enregistrement a échoué. Veuillez réessayer.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-[#171717]">
            {event ? "Modifier l'événement" : 'Créer un nouvel événement'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label htmlFor="event-name" className="block text-sm font-medium text-[#171717] mb-1">
              Nom <span className="text-red-500">*</span>
            </label>
            <input
              id="event-name"
              className={INPUT_CLASSES}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tunisie – Brésil"
            />
          </div>
          <div>
            <label
              htmlFor="event-description"
              className="block text-sm font-medium text-[#171717] mb-1"
            >
              Description
            </label>
            <textarea
              id="event-description"
              className={INPUT_CLASSES}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="block text-sm font-medium text-[#171717] mb-1">Type</span>
              {/* §10 — the type is LOCKED (server-enforced); a chip, never an input. */}
              <span className="inline-flex items-center px-3 py-2 rounded-lg bg-blue-100 text-blue-800 text-sm font-medium">
                Sport
              </span>
            </div>
            <div>
              <label
                htmlFor="event-category"
                className="block text-sm font-medium text-[#171717] mb-1"
              >
                Catégorie
              </label>
              <input
                id="event-category"
                className={INPUT_CLASSES}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Phase de groupes"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="event-kickoff"
                className="block text-sm font-medium text-[#171717] mb-1"
              >
                Date et heure de début <span className="text-red-500">*</span>
              </label>
              <input
                id="event-kickoff"
                type="datetime-local"
                className={INPUT_CLASSES}
                value={kickoff}
                onChange={(e) => setKickoff(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="event-ends" className="block text-sm font-medium text-[#171717] mb-1">
                Date et heure de fin <span className="text-red-500">*</span>
              </label>
              <input
                id="event-ends"
                type="datetime-local"
                className={INPUT_CLASSES}
                value={ends}
                onChange={(e) => setEnds(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label htmlFor="event-image" className="block text-sm font-medium text-[#171717] mb-1">
              Image (affiche)
            </label>
            {/* GREEN2 item 7c — French file control (the native « Choose File » hides). */}
            <input
              id="event-image"
              type="file"
              accept="image/jpeg,image/png"
              onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <label
              htmlFor="event-image"
              className="inline-block cursor-pointer rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-200"
            >
              Parcourir les fichiers
            </label>
            <p className="mt-1 text-xs text-gray-500">
              {imageFile ? imageFile.name : 'Aucun fichier sélectionné'}
            </p>
          </div>
          {error !== null && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-brand-primary text-brand-deep px-5 py-2 text-sm font-medium disabled:opacity-60"
            >
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
