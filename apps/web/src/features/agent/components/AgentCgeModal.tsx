import { Download, FileText, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { useAcceptCge } from '@/features/agent/hooks/useAgentAccount';
import { agentAccountService } from '@/features/agent/services/agent-account.service';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { getErrorMessage } from '@/lib/errors';

/**
 * AGT-1b (agent specs v1.0 §2) — the blocking « Conditions Générales d'Engagement » modal: full
 * screen, cannot be closed; the text (readable and downloadable) and the button « J'accepte les CGE »
 * (spec VF §15 / §10: the button is the acceptance). The only other action is « Se
 * déconnecter ». The server refuses every agent data route meanwhile (403 CGE_REQUIRED).
 */
export function AgentCgeModal({ cgeId, version }: { cgeId: string; version: string }) {
  const accept = useAcceptCge();
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    agentAccountService
      .cgeUrl()
      .then((r) => setUrl(r.url))
      .catch(() => setUrl(null));
  }, [cgeId]);

  const submit = async () => {
    try {
      await accept.mutateAsync(cgeId);
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Acceptation impossible');
    }
  };

  const signOut = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white font-poppins">
      <header className="flex items-center gap-3 border-b border-[#E1E4EA] px-6 py-4">
        <FileText className="h-6 w-6 text-brand-primary" />
        <div>
          <h1 className="text-lg font-semibold text-[#171717]">
            Conditions Générales d’Engagement
          </h1>
          <p className="text-sm text-[#5C5C5C]">
            Version {version} — à lire et accepter avant d’accéder à votre espace.
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 bg-gray-50 p-4">
        {url ? (
          <iframe
            title="Conditions Générales d’Engagement"
            src={url}
            className="h-full w-full rounded-lg border bg-white"
          />
        ) : (
          <Loader2 className="mx-auto mt-20 h-6 w-6 animate-spin text-brand-primary" />
        )}
      </div>
      <footer className="flex flex-wrap items-center gap-4 border-t border-[#E1E4EA] px-6 py-4">
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-brand-primary"
          >
            <Download className="h-4 w-4" />
            Télécharger
          </a>
        )}
        <div className="ml-auto flex gap-3">
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            Se déconnecter
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={accept.isPending}
            className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
          >
            J’accepte les CGE
          </button>
        </div>
      </footer>
    </div>
  );
}
