import { useAgentLogos, useUploadAgentLogo } from '@/features/agent/hooks/useAgentLogos';
import {
  LOGO_ACCEPT,
  LOGO_SENT_TOAST,
  logoButtonLabel,
  logoFileProblem,
  logoStatusLine,
} from '@/features/agent/lib/agent-logos';
import type { VfCategoryKey } from '@/features/agent/lib/agent-vf';
import { getErrorMessage } from '@/lib/errors';

import { VfFrame } from './VfFrame';
import { useVfOverlay } from './VfOverlay';

/**
 * AGENT-VF (specs VF « Logos ») — the logo block of a fiche: the frame, where the logo stands and
 * « Ajouter le logo » / « Changer le logo ». A logo the agent sends waits for Toodooh's validation.
 */
export function VfLogoEditor({
  subjectId,
  name,
  kind,
  attention = false,
}: {
  subjectId: string;
  name: string;
  kind: VfCategoryKey | 'adv';
  attention?: boolean;
}) {
  const { toast } = useVfOverlay();
  const logo = useAgentLogos().of(subjectId);
  const upload = useUploadAgentLogo(subjectId);
  const subject = kind === 'adv' ? 'screencaster' : 'screenhost';

  const send = async (file: File | undefined) => {
    if (!file) return;
    const problem = logoFileProblem(file);
    if (problem) return toast(problem);
    try {
      await upload.mutateAsync(file);
      toast(LOGO_SENT_TOAST);
    } catch (e) {
      toast(getErrorMessage(e) || 'Envoi impossible');
    }
  };

  return (
    <div className="logoedit">
      <VfFrame
        name={name}
        kind={kind}
        logoUrl={logo?.url}
        pending={logo?.status === 'en_attente'}
        attention={attention}
      />
      <div>
        <b className="vf-b13">
          {subject === 'screenhost' ? "Logo de l'établissement" : 'Logo du Screencaster'}
        </b>
        <div className="tiny vf-logo-note">{logoStatusLine(logo, subject)}</div>
        <label className="btn sm vf-logo-pick">
          {upload.isPending ? 'Envoi…' : logoButtonLabel(logo)}
          <input
            type="file"
            accept={LOGO_ACCEPT}
            hidden
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
