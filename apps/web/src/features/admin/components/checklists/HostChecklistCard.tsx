import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import { decisionLabel } from '@/features/admin/lib/checklist-links';
import { adminChecklistsService } from '@/features/admin/services/admin-checklists.service';
import { RESULT_FR } from '@/features/agent/lib/checklist-model';
import { formatDateFr } from '@/features/screenhost/lib/facture-view';

// Fiche Host — the recap of the qualification fiche the Admin linked to this Screenhost.
export function HostChecklistCard({ screenhostId }: { screenhostId: string }) {
  const q = useQuery({
    queryKey: adminKeys.checklistOfHost(screenhostId),
    queryFn: () => adminChecklistsService.ofScreenhost(screenhostId),
  });
  if (q.isPending) return <p className="text-sm text-gray-500">Chargement…</p>;
  const c = q.data;
  if (!c) {
    return (
      <p className="text-sm text-gray-500">
        Aucune fiche reliée.{' '}
        <Link to="/admin-checklists" className="font-medium text-brand-deep underline">
          Relier une fiche
        </Link>
      </p>
    );
  }
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium text-gray-900">{c.name}</p>
      <p className="text-gray-600">
        Résultat proposé : {RESULT_FR[c.result]} · avis de l’agent :{' '}
        {c.agent_opinion === 'oui' ? 'Oui' : c.agent_opinion === 'non' ? 'Non' : '–'}
      </p>
      <p className="text-gray-600">
        {decisionLabel(c.status)}
        {c.decided_by_name ? ` (${c.decided_by_name})` : ''}
        {c.decided_at ? ` le ${formatDateFr(c.decided_at)}` : ''}
      </p>
      {c.manager_comment && <p className="text-gray-600">« {c.manager_comment} »</p>}
      <p className="text-xs text-gray-500">
        Agent {c.agent_name} · envoyée le {formatDateFr(c.sent_at)}
      </p>
    </div>
  );
}
