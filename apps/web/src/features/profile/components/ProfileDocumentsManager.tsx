import { Check, Eye, FileText, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { authService } from '@/features/auth/services/auth.service';
import type { ProfileDocument } from '@/features/auth/types/auth';
import {
  useDeleteProfileDocument,
  useProfileDocuments,
  useUploadProfileDocument,
} from '@/features/profile/hooks/useProfileDocuments';
import {
  CIN_SLOT_LABELS,
  DOCUMENT_ACCEPT,
  DOCUMENT_CAPS,
  DOCUMENT_FORMATS_COPY,
  DOCUMENT_TOO_LARGE_ERROR,
  MAX_DOCUMENT_BYTES,
  type ProfileDocumentCategory,
} from '@/features/profile/lib/document-caps';
import { getErrorMessage } from '@/lib/errors';

/** One rendered category group; `bank` keeps its own slot (OwnerBankDetailsSlot) — not listed here. */
export interface DocumentCategoryConfig {
  category: Exclude<ProfileDocumentCategory, 'bank'>;
  title: string;
  description?: string;
}

interface ProfileDocumentsManagerProps {
  categories: DocumentCategoryConfig[];
  /** Wrapper-provided profile invalidation — uploads/deletes flip /api/me's documents booleans. */
  onChanged?: () => void;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * F-docs Commit 2 — the per-category multi-document settings surface (replaces
 * the single-slot "Documents légaux" tab body). cin renders two SEMANTIC slots
 * (1=recto, 2=verso — position is explicit on upload); rne/complementaire
 * render saved rows + an add zone until the cap. Caps/size/mime mirror the
 * server inline (C5/F1 pattern); the server stays the authority. Uploads fire
 * on pick (each slot is its own document — there is no multi-slot form to
 * batch); views presign by id on demand.
 */
export default function ProfileDocumentsManager({
  categories,
  onChanged,
}: ProfileDocumentsManagerProps) {
  const { data: documents, isLoading, isError } = useProfileDocuments();
  const upload = useUploadProfileDocument(onChanged);
  const remove = useDeleteProfileDocument(onChanged);
  // One in-flight op at a time, keyed so only the touched slot shows a spinner.
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const pickFile = async (
    category: DocumentCategoryConfig['category'],
    file: File,
    position?: number,
  ) => {
    if (file.size > MAX_DOCUMENT_BYTES) {
      toast.error(DOCUMENT_TOO_LARGE_ERROR);
      return;
    }
    const key = `${category}:${position ?? 'next'}`;
    setBusyKey(key);
    try {
      await upload.mutateAsync({ category, file, position });
      toast.success('Document enregistré');
    } catch (err) {
      toast.error(getErrorMessage(err) || "Erreur lors de l'upload");
    } finally {
      setBusyKey(null);
    }
  };

  const deleteDocument = async (doc: ProfileDocument) => {
    setBusyKey(`delete:${doc.id}`);
    try {
      await remove.mutateAsync(doc.id);
      toast.success('Document supprimé');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Erreur lors de la suppression');
    } finally {
      setBusyKey(null);
    }
  };

  const viewDocument = async (doc: ProfileDocument) => {
    try {
      const url = await authService.getProfileDocumentUrlById(doc.id);
      if (!url) throw new Error('Document introuvable');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(getErrorMessage(err) || "Impossible d'ouvrir le document");
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-primary border-t-transparent" />
      </div>
    );
  }
  if (isError || !documents) {
    return <div className="p-6 text-sm text-gray-600">Impossible de charger vos documents.</div>;
  }

  const browseLabel = (label: string, onPick: (file: File) => void, disabled: boolean) => (
    <label
      className={`px-4 py-2.5 rounded-xl text-sm font-medium text-gray-700 border border-gray-300 bg-white ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-100'
      }`}
    >
      {label}
      <input
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so re-picking the same filename re-fires onChange.
          e.target.value = '';
          if (file) onPick(file);
        }}
      />
    </label>
  );

  const savedCard = (doc: ProfileDocument, fallbackName: string, replaceSlot?: number) => {
    const category = doc.category as DocumentCategoryConfig['category'];
    return (
      <div
        key={doc.id}
        className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm"
      >
        <div className="flex-shrink-0 rounded-lg p-2 bg-gray-100">
          <FileText className="h-6 w-6 text-gray-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {doc.original_filename ?? fallbackName}
          </p>
          <p className="text-xs text-gray-500">
            {doc.size_bytes != null ? formatFileSize(doc.size_bytes) : 'Document enregistré'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Check className="h-5 w-5 text-green-600" />
          <span className="text-sm text-gray-600">Enregistré</span>
        </div>
        <button
          type="button"
          onClick={() => void viewDocument(doc)}
          className="p-2 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-50 flex-shrink-0"
          title="Voir le document"
        >
          <Eye className="h-5 w-5" />
        </button>
        {replaceSlot !== undefined &&
          browseLabel(
            busyKey === `${category}:${replaceSlot}` ? 'Envoi...' : 'Remplacer',
            (file) => void pickFile(category, file, replaceSlot),
            busyKey !== null,
          )}
        <button
          type="button"
          onClick={() => void deleteDocument(doc)}
          disabled={busyKey !== null}
          className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Supprimer"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-8">
      {categories.map(({ category, title, description }) => {
        const docs = [...documents[category]].sort((a, b) => a.position - b.position);
        const cap = DOCUMENT_CAPS[category];

        return (
          <section key={category} className="space-y-3">
            <div className="flex items-baseline justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{title}</h3>
                {description && <p className="text-sm text-gray-500">{description}</p>}
              </div>
              <span className="text-xs text-gray-500">
                {docs.length}/{cap}
              </span>
            </div>

            {category === 'cin' ? (
              // Two SEMANTIC slots — recto/verso are distinct documents, never a free list.
              [1, 2].map((position) => {
                const doc = docs.find((d) => d.position === position);
                const slotLabel = CIN_SLOT_LABELS[position] ?? `Face ${position}`;
                if (doc) return savedCard(doc, `CIN — ${slotLabel}`, position);
                return (
                  <div
                    key={position}
                    className="border-2 border-dashed border-gray-300 rounded-xl p-4 flex items-center justify-between gap-3 bg-gray-50/50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="rounded-full p-2" style={{ background: '#E6F7ED' }}>
                        <Upload className="h-5 w-5" style={{ color: '#22c55e' }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">CIN — {slotLabel}</p>
                        <p className="text-xs text-gray-500">{DOCUMENT_FORMATS_COPY}</p>
                      </div>
                    </div>
                    {browseLabel(
                      busyKey === `cin:${position}` ? 'Envoi...' : 'Parcourir les fichiers',
                      (file) => void pickFile('cin', file, position),
                      busyKey !== null,
                    )}
                  </div>
                );
              })
            ) : (
              <>
                {docs.map((doc) => savedCard(doc, title))}
                {docs.length < cap && (
                  <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center justify-center gap-3 bg-gray-50/50">
                    <div className="rounded-full p-3" style={{ background: '#E6F7ED' }}>
                      <Upload className="h-8 w-8" style={{ color: '#22c55e' }} />
                    </div>
                    <p className="text-sm font-medium text-gray-900">Ajouter un document</p>
                    <p className="text-xs text-gray-500">{DOCUMENT_FORMATS_COPY}</p>
                    {browseLabel(
                      busyKey === `${category}:next` ? 'Envoi...' : 'Parcourir les fichiers',
                      (file) => void pickFile(category, file),
                      busyKey !== null,
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
