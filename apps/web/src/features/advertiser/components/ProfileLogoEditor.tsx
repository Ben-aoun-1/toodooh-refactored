import { Building2 } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { useProfileLogo, useUploadProfileLogo } from '@/features/advertiser/hooks/useProfileLogo';
import {
  OWN_LOGO_ERROR_TOAST,
  OWN_LOGO_HINT,
  OWN_LOGO_SAVED_TOAST,
  OWN_LOGO_TITLE,
  ownLogoButtonLabel,
  ownLogoStatusLine,
} from '@/features/advertiser/lib/own-logo';
import { LOGO_ACCEPT, logoFileProblem } from '@/features/agent/lib/agent-logos';
import { getErrorMessage } from '@/lib/errors';

/**
 * The « Logo » block of the Screencaster's profile (Mariem 23/11 — the Agent's logo editor, for
 * his own account): the current logo in its white frame, « Ajouter le logo » / « Changer le
 * logo », the agent editor's file checks. His own upload is validated at once.
 */
export default function ProfileLogoEditor() {
  const { data: logo } = useProfileLogo();
  const upload = useUploadProfileLogo();
  const hasLogo = Boolean(logo?.url);

  const send = async (file: File | undefined) => {
    if (!file) return;
    const problem = logoFileProblem(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    try {
      await upload.mutateAsync(file);
      toast.success(OWN_LOGO_SAVED_TOAST);
    } catch (e) {
      toast.error(getErrorMessage(e) || OWN_LOGO_ERROR_TOAST);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl bg-gray-50 p-3">
      <span className="grid aspect-[4/3] w-32 flex-shrink-0 place-items-center overflow-hidden rounded-[14px] border border-gray-200 bg-white">
        {logo?.url ? (
          <img
            src={logo.url}
            alt="Logo de votre entreprise"
            className="max-h-[72%] max-w-[78%] object-contain"
          />
        ) : (
          <Building2 className="h-8 w-8 text-gray-300" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">{OWN_LOGO_TITLE}</p>
        <p className="mt-0.5 text-xs text-gray-600">{ownLogoStatusLine(hasLogo)}</p>
        <p className="text-xs text-gray-500">{OWN_LOGO_HINT}</p>
        <label
          className={`mt-2 inline-flex cursor-pointer items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-within:ring-2 focus-within:ring-brand-primary ${
            upload.isPending ? 'cursor-wait opacity-60' : ''
          }`}
        >
          {upload.isPending ? 'Envoi…' : ownLogoButtonLabel(hasLogo)}
          <input
            type="file"
            accept={LOGO_ACCEPT}
            className="sr-only"
            disabled={upload.isPending}
            onChange={(e) => {
              void send(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
    </div>
  );
}
