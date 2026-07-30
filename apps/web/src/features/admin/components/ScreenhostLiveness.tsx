import { useQuery } from '@tanstack/react-query';
import { MonitorSmartphone } from 'lucide-react';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import {
  DEVICE_STATUS_LABELS,
  type DeviceStatus,
  deviceStatusOf,
} from '@/features/screenhost/lib/device-liveness';
import { apiClient } from '@/lib/api-client';

interface AdminDeviceRow {
  id: string;
  name: string;
  last_seen_at: string | null;
  connected: boolean;
  paired_at: string | null;
}

const CHIP_CLASSES: Record<DeviceStatus, string> = {
  connected: 'bg-green-100 text-green-800',
  offline: 'bg-amber-50 text-amber-700',
  never: 'bg-gray-100 text-gray-500',
};

/** The venue's aggregate state: connected if ANY screen is live; never if none ever paired. */
const venueStatus = (rows: AdminDeviceRow[]): DeviceStatus => {
  if (rows.some((r) => r.connected)) return 'connected';
  if (rows.some((r) => r.last_seen_at !== null)) return 'offline';
  return 'never';
};

/**
 * CF-HF4 — the admin venue liveness: « N écran(s) » + a state chip on the eligibility card,
 * fed by the LIVE devices wire (GET /api/admin/screenhosts/:id/devices — the same E6 heartbeat
 * truth as the owner calendar; the legacy ScreenManagement « En ligne » reads the Supabase-era
 * hub and stays as-found). Read-only, reusing the owner-calendar status vocabulary.
 */
export default function ScreenhostLiveness({ screenhostId }: { screenhostId: string }) {
  const { data } = useQuery({
    queryKey: adminKeys.screenhostDevices(screenhostId),
    queryFn: () => apiClient.get<AdminDeviceRow[]>(`/admin/screenhosts/${screenhostId}/devices`),
  });

  if (!data) return null;
  const status = venueStatus(data);
  return (
    <div className="flex items-center gap-2 text-xs text-gray-600">
      <MonitorSmartphone className="h-4 w-4 text-gray-400" />
      <span>
        {data.length} écran{data.length > 1 ? 's' : ''}
      </span>
      <span className={`rounded-full px-2 py-0.5 font-medium ${CHIP_CLASSES[status]}`}>
        {DEVICE_STATUS_LABELS[status]}
      </span>
    </div>
  );
}

/** Derive the shared status per row (exported for the aggregate + tests). */
export const rowStatus = (row: AdminDeviceRow): DeviceStatus =>
  deviceStatusOf({ connected: row.connected, last_seen_at: row.last_seen_at });
