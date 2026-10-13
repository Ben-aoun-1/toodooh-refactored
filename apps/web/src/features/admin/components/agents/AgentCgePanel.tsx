import { Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { useAgentCge, usePublishCge } from '@/features/admin/hooks/useAdminAgents';
import type { AgentRoleKey } from '@/features/admin/services/admin-agents.service';
import { getErrorMessage } from '@/lib/errors';

const ROLE_FR: Record<AgentRoleKey, string> = {
  screencast_agent: 'Agent Screencaster',
  screenhost_agent: 'Agent Screenhost',
};

/**
 * AGT-1 — the CGE versions per agent type. Publishing one makes the blocking acceptance modal
 * appear for every agent of that type at their next visit (agent specs v1.0 §2).
 */
export function AgentCgePanel() {
  const cge = useAgentCge();
  const publish = usePublishCge();
  const [role, setRole] = useState<AgentRoleKey>('screencast_agent');
  const [version, setVersion] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const submit = async () => {
    if (!version.trim() || !file) {
      toast.error('Indiquez la version et choisissez le PDF.');
      return;
    }
    try {
      await publish.mutateAsync({ role, version: version.trim(), file });
      await cge.refetch();
      setVersion('');
      setFile(null);
      toast.success('CGE publiées — les agents devront les accepter.');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Publication impossible');
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-gray-50 p-4 text-sm">
        <label>
          <span className="block text-gray-600">Type d’agent</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AgentRoleKey)}
            className="mt-1 rounded-lg border px-3 py-2"
          >
            <option value="screencast_agent">{ROLE_FR.screencast_agent}</option>
            <option value="screenhost_agent">{ROLE_FR.screenhost_agent}</option>
          </select>
        </label>
        <label>
          <span className="block text-gray-600">Version</span>
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="v2"
            className="mt-1 w-28 rounded-lg border px-3 py-2"
          />
        </label>
        <label>
          <span className="block text-gray-600">Document (PDF)</span>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1"
          />
        </label>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={publish.isPending}
          className="flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 font-medium text-brand-deep disabled:opacity-60"
        >
          <Upload className="h-4 w-4" />
          Publier
        </button>
      </div>
      {(cge.data?.versions ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">
          Aucune CGE publiée : aucune acceptation n’est demandée aux agents pour le moment.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {(cge.data?.versions ?? []).map((v) => (
            <li key={v.id} className="flex flex-wrap gap-3 p-3">
              <span className="font-medium">{ROLE_FR[v.role]}</span>
              <span>Version {v.version}</span>
              <span className="text-gray-500">{v.file_name}</span>
              <span className="text-gray-500">
                {new Date(v.published_at).toLocaleDateString('fr-FR')}
              </span>
              <span className="ml-auto">{v.acceptances} acceptation(s)</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
