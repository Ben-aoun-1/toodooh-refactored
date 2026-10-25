import { Lock } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { useUnlockHostField } from '@/features/admin/hooks/useAdminHost';
import { LOCKS_EXPLAINER, LOCK_LABELS } from '@/features/admin/lib/host-fiche';
import type { HostLockKey } from '@/features/admin/services/admin-host.service';
import { getErrorMessage } from '@/lib/errors';

/**
 * HOST-EDIT1 (ruling Q5 B) — the eligibility fields an admin set by hand, which the hub no longer
 * overwrites, each with its « Rendre au hub ». Renders nothing when no field is locked.
 */
export default function HostLocksNotice({
  screenhostId,
  locked,
}: {
  screenhostId: string;
  locked: HostLockKey[];
}) {
  const unlock = useUnlockHostField(screenhostId);
  if (locked.length === 0) return null;

  const handleUnlock = (field: HostLockKey) => {
    unlock.mutate(field, {
      onSuccess: () => toast.success(`${LOCK_LABELS[field]} : rendu au hub.`),
      onError: (err) => toast.error(getErrorMessage(err) || 'Échec du déverrouillage.'),
    });
  };

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
        <Lock className="h-4 w-4" />
        Verrouillés contre le hub
      </p>
      <p className="mt-1 text-xs text-amber-800">{LOCKS_EXPLAINER}</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {locked.map((field) => (
          <li
            key={field}
            className="flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm text-gray-800 ring-1 ring-amber-200"
          >
            {LOCK_LABELS[field]}
            <button
              type="button"
              disabled={unlock.isPending}
              onClick={() => handleUnlock(field)}
              className="text-xs font-semibold text-brand-deep underline disabled:opacity-60"
            >
              Rendre au hub
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
