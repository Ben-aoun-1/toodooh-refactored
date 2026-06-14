import ScreenhostWifiEditorCard from '@/features/screenhost/components/ScreenhostWifiEditorCard';
import type { ScreenhostWifi } from '@/features/screenhost/services/screenhost.service';

import { useAdminUpdateScreenhostWifi } from '../hooks/useAdminScreenhostWifi';

/**
 * Admin "WiFi du lieu" editor inside the UserManagement details modal — one editor per the
 * reviewed owner's screenhosts, reusing the shared `ScreenhostWifiEditorCard` so the write-only
 * password UX is identical to the owner's. The write routes through the toodooh admin API
 * (PATCH /api/admin/screenhosts/:id/wifi), NOT the legacy Supabase admin-screens surface.
 */
export default function AdminUserWifiSlot({ screenhosts }: { screenhosts: ScreenhostWifi[] }) {
  const updateWifi = useAdminUpdateScreenhostWifi();

  if (screenhosts.length === 0) {
    return <p className="text-sm text-gray-500">Aucun lieu enregistré.</p>;
  }

  return (
    <div className="space-y-4">
      {screenhosts.map((sh) => (
        <ScreenhostWifiEditorCard
          key={sh.id}
          screenhost={sh}
          onSave={(patch) =>
            updateWifi.mutateAsync({ screenhostId: sh.id, wifi: patch }).then(() => undefined)
          }
        />
      ))}
    </div>
  );
}
