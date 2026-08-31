import { FileText, Upload, X } from 'lucide-react';
import { toast } from 'react-hot-toast';

import type { OwnerVoletFiles } from '@/features/auth/utils/owner-signup-volets';
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_FORMATS_COPY,
  DOCUMENT_TOO_LARGE_ERROR,
  MAX_DOCUMENT_BYTES,
} from '@/features/profile/lib/document-caps';

// R7/N4 — the OWNER signup document volets (reverses F5 for owners). SIGN-2 (2026-08-31): the CIN
// faces are GONE from signup — individual_owner shows the RIB only, fleet_owner shows RNE + RIB.
// CIN becomes provide-later (admin request / post-signin upload), not abolished. Each slot is one file;
// caps/MIME/size mirror the server via document-caps. Picks live in SignUpForm state and are sent as
// multipart by authService.signUp. Complementaire stays an OPTIONAL post-signin add (not a volet here).
interface SingleFileSlotProps {
  label: string;
  file: File | null;
  onPick: (file: File) => void;
  onClear: () => void;
}

function SingleFileSlot({ label, file, onPick, onClear }: SingleFileSlotProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-gray-900">{label}</h4>
      {file ? (
        <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <FileText className="h-5 w-5 flex-shrink-0 text-green-600" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-green-900">{file.name}</p>
              <p className="text-xs text-green-700">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="flex flex-shrink-0 items-center rounded-lg bg-red-100 px-3 py-1.5 text-sm text-red-700 hover:bg-red-200"
          >
            <X className="mr-1 h-4 w-4" />
            Retirer
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <Upload className="mx-auto mb-3 h-8 w-8 text-gray-400" />
          <p className="mb-4 text-xs text-gray-500">{DOCUMENT_FORMATS_COPY}</p>
          <label className="inline-block cursor-pointer rounded-xl border border-gray-300 bg-white px-6 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
            Parcourir les fichiers
            <input
              type="file"
              accept={DOCUMENT_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                e.target.value = '';
                if (!picked) return;
                if (picked.size > MAX_DOCUMENT_BYTES) {
                  toast.error(DOCUMENT_TOO_LARGE_ERROR);
                  return;
                }
                onPick(picked);
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

interface SignupOwnerDocumentsProps {
  profileType: string;
  files: OwnerVoletFiles;
  onChange: (patch: Partial<OwnerVoletFiles>) => void;
}

export default function SignupOwnerDocuments({
  profileType,
  files,
  onChange,
}: SignupOwnerDocumentsProps) {
  return (
    <div className="space-y-6">
      {profileType !== 'individual_owner' && (
        <SingleFileSlot
          label="Registre de commerce (RNE)"
          file={files.rne}
          onPick={(f) => onChange({ rne: f })}
          onClear={() => onChange({ rne: null })}
        />
      )}
      <SingleFileSlot
        label="Relevé d'identité bancaire (RIB)"
        file={files.bank}
        onPick={(f) => onChange({ bank: f })}
        onClear={() => onChange({ bank: null })}
      />
    </div>
  );
}
