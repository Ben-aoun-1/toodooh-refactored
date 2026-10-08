import { ImageIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ImagePickerPreviewProps {
  inputId: string;
  accept: string;
  /** The file chosen in this form, not uploaded yet. */
  file: File | null;
  onFile: (file: File | null) => void;
  /** The image already stored (presigned), shown until another file is chosen. */
  currentUrl: string | null;
  /** Shown under the button when nothing is chosen. */
  hint: string;
  /** contain = a logo or flag; cover = an affiche. */
  fit?: 'contain' | 'cover';
}

/**
 * EVT-PLAY1 — the admin's image fields (event affiche, team logo) showed only a file NAME: the
 * picked image, and on edit the stored one, were never visible, so an upload looked lost. This
 * field shows the image itself — the chosen file (a local object URL, revoked on change), else
 * the stored one.
 */
export default function ImagePickerPreview({
  inputId,
  accept,
  file,
  onFile,
  currentUrl,
  hint,
  fit = 'cover',
}: ImagePickerPreviewProps) {
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setLocalUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const shown = localUrl ?? currentUrl;

  return (
    <div className="flex items-center gap-3">
      <span className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
        {shown ? (
          <img
            src={shown}
            alt="Aperçu de l’image"
            className={`h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
          />
        ) : (
          <ImageIcon className="h-6 w-6 text-gray-300" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0">
        {/* GREEN2 item 7c — French file control (the native « Choose File » hides). */}
        <input
          id={inputId}
          type="file"
          accept={accept}
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
        <label
          htmlFor={inputId}
          className="inline-block cursor-pointer rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-200"
        >
          {shown ? 'Changer l’image' : 'Parcourir les fichiers'}
        </label>
        <p className="mt-1 truncate text-xs text-gray-500">
          {file ? file.name : currentUrl ? 'Image actuelle' : hint}
        </p>
      </div>
    </div>
  );
}
