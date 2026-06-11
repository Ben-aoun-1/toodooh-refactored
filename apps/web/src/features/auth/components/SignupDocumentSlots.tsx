import { FileText, Upload, X } from 'lucide-react';
import { toast } from 'react-hot-toast';

import {
  DOCUMENT_ACCEPT,
  DOCUMENT_CAPS,
  DOCUMENT_FORMATS_COPY,
  DOCUMENT_TOO_LARGE_ERROR,
  MAX_DOCUMENT_BYTES,
} from '@/features/profile/lib/document-caps';

interface SignupDocumentSlotsProps {
  /** Registre de commerce picks, ≤ DOCUMENT_CAPS.rne. */
  rneFiles: File[];
  onRneChange: (files: File[]) => void;
  /** Documents complémentaires picks, ≤ DOCUMENT_CAPS.complementaire. */
  complementaireFiles: File[];
  onComplementaireChange: (files: File[]) => void;
}

/**
 * Signup step 4's per-category document picker (F-docs Commit 2 — replaces the
 * single `documentFile` zone). LOCAL state only: signup is sessionless, so the
 * picks are never uploaded here (the F5 flow-position ruling — documents
 * upload post-signin from settings); the picker mirrors the server's caps and
 * size/mime rules inline (C5/F1 pattern) so the categories users see at signup
 * match what settings will accept.
 */
export default function SignupDocumentSlots({
  rneFiles,
  onRneChange,
  complementaireFiles,
  onComplementaireChange,
}: SignupDocumentSlotsProps) {
  const groups = [
    {
      key: 'rne' as const,
      title: 'Registre de commerce (RNE)',
      cap: DOCUMENT_CAPS.rne,
      files: rneFiles,
      onChange: onRneChange,
    },
    {
      key: 'complementaire' as const,
      title: 'Documents complémentaires',
      cap: DOCUMENT_CAPS.complementaire,
      files: complementaireFiles,
      onChange: onComplementaireChange,
    },
  ];

  return (
    <div className="space-y-6">
      {groups.map(({ key, title, cap, files, onChange }) => (
        <div key={key} className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
            <span className="text-xs text-gray-500">
              {files.length}/{cap}
            </span>
          </div>

          {files.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="h-5 w-5 text-green-600 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-green-900 text-sm truncate">{file.name}</p>
                  <p className="text-xs text-green-700">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                className="flex items-center px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 text-sm flex-shrink-0"
              >
                <X className="h-4 w-4 mr-1" />
                Retirer
              </button>
            </div>
          ))}

          {files.length < cap && (
            <div
              className="border-2 border-dashed border-gray-300 rounded-2xl p-6 text-center"
              style={{ background: '#FAFAFA' }}
            >
              <Upload className="h-8 w-8 text-gray-400 mx-auto mb-3" />
              <p className="text-xs text-gray-500 mb-4">{DOCUMENT_FORMATS_COPY}</p>
              <label className="inline-block cursor-pointer px-6 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors">
                Parcourir les fichiers
                <input
                  type="file"
                  accept={DOCUMENT_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    if (file.size > MAX_DOCUMENT_BYTES) {
                      toast.error(DOCUMENT_TOO_LARGE_ERROR);
                      return;
                    }
                    onChange([...files, file]);
                  }}
                />
              </label>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
