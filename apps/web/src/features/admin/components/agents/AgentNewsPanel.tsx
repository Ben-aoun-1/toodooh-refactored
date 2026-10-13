import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { useAgentNews, usePublishNews } from '@/features/admin/hooks/useAdminAgents';
import type { AgentNewsRow } from '@/features/admin/services/admin-agents.service';
import { getErrorMessage } from '@/lib/errors';

const AUDIENCE_FR: Record<AgentNewsRow['audience'], string> = {
  all: 'Tous les agents',
  screencast_agent: 'Agents Screencaster',
  screenhost_agent: 'Agents Screenhost',
};

/**
 * AGT-6 (agent specs v1.0 §8 « Actualité Toodooh ») — publish a news post to the agents who keep
 * « Actualités et mises à jour » on (in-app + email).
 */
export function AgentNewsPanel() {
  const news = useAgentNews();
  const publish = usePublishNews();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<AgentNewsRow['audience']>('all');

  const send = async () => {
    try {
      const r = await publish.mutateAsync({ title: title.trim(), body: body.trim(), audience });
      toast.success(`Actualité publiée — ${r.recipients} agent(s)`);
      setTitle('');
      setBody('');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Publication impossible');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 p-4 md:grid-cols-2">
      <section className="space-y-3">
        <p className="text-sm font-semibold">Publier une actualité</p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titre"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message"
          rows={4}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
        <select
          value={audience}
          onChange={(e) => setAudience(e.target.value as AgentNewsRow['audience'])}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        >
          {Object.entries(AUDIENCE_FR).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!title.trim() || !body.trim() || publish.isPending}
          onClick={() => void send()}
          className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
        >
          Publier
        </button>
      </section>
      <section>
        <p className="mb-2 text-sm font-semibold">Dernières actualités</p>
        {(news.data?.news ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">Aucune actualité publiée.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {(news.data?.news ?? []).map((n) => (
              <li key={n.id} className="px-3 py-2 text-sm">
                <p className="font-medium">{n.title}</p>
                <p className="text-gray-600">{n.body}</p>
                <p className="mt-1 text-xs text-gray-400">
                  {AUDIENCE_FR[n.audience]} — {new Date(n.published_at).toLocaleString('fr-FR')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
