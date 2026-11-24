import { useQuery } from '@tanstack/react-query';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import { adminChecklistsService } from '@/features/admin/services/admin-checklists.service';

// The fiche's answers, page by page, read-only (the Wi-Fi password stays masked).
export function ChecklistDetail({ id }: { id: string }) {
  const detail = useQuery({
    queryKey: [...adminKeys.all, 'checklist', id],
    queryFn: () => adminChecklistsService.detail(id),
  });
  if (!detail.data) {
    return (
      <p className="mt-3 text-sm text-gray-500">
        {detail.isError ? 'Fiche indisponible.' : 'Chargement…'}
      </p>
    );
  }
  const d = detail.data;
  return (
    <div className="mt-4 space-y-4">
      {d.manager_comment && (
        <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
          <span className="font-medium">Commentaire du manager :</span> {d.manager_comment}
        </p>
      )}
      {d.pages.map((p) => (
        <div key={p.title}>
          <h4 className="text-sm font-semibold text-gray-900">
            {p.title} <span className="font-normal text-gray-500">· {p.step}</span>
          </h4>
          <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {p.items.map((it) => (
              <div key={`${p.title}-${it.label}`} className="text-sm">
                <dt className="text-gray-500">{it.label}</dt>
                <dd className={it.eliminatory ? 'font-medium text-red-700' : 'text-gray-900'}>
                  {it.secret ? '••••••••' : it.value || '–'}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
