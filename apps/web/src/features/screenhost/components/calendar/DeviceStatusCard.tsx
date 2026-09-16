import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { MonitorSmartphone, Radar } from 'lucide-react';

import { deviceStatusOf } from '@/features/screenhost/lib/device-liveness';
import {
  DEVICE_BADGE_CLASSES,
  DEVICE_BADGE_LABEL,
  type DeviceBadge,
  screenBadge,
  sensorBadge,
} from '@/features/screenhost/lib/owner-calendar';
import type { OwnerDeviceRow } from '@/features/screenhost/services/owner-devices.service';
import type { OwnerSensorRow } from '@/features/screenhost/services/owner-sensors.service';

// CAL-2 — card « ÉTAT DE MON DISPOSITIF »: the sensor on the first row, the screens on the
// second, each a card with its name and a dotted badge (Active / En panne / Inactif), then
// « Contacter le support ». One sensor card per venue: the platform receives the venue's measured
// half-hours, not each sensor separately.

function Badge({ badge }: { badge: DeviceBadge }) {
  const cls = DEVICE_BADGE_CLASSES[badge];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cls.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cls.dot}`} />
      {DEVICE_BADGE_LABEL[badge]}
    </span>
  );
}

function DeviceTile({
  name,
  badge,
  detail,
}: {
  name: string;
  badge: DeviceBadge;
  detail: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-gray-900">{name}</p>
        {detail && <p className="text-xs text-gray-400">{detail}</p>}
      </div>
      <Badge badge={badge} />
    </div>
  );
}

const ago = (iso: string | null): string | null =>
  iso
    ? `Dernière mesure ${formatDistanceToNow(new Date(iso), { locale: fr, addSuffix: true })}`
    : null;

export function DeviceStatusCard({
  sensor,
  screens,
  onContactSupport,
}: {
  sensor: OwnerSensorRow | undefined;
  screens: OwnerDeviceRow[];
  onContactSupport: () => void;
}) {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)] ring-1 ring-gray-100">
      <header className="flex items-center gap-3 border-b border-gray-100 pb-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E4F9EB]">
          <MonitorSmartphone className="h-5 w-5 text-brand-deep" />
        </span>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">
            État de mon dispositif
          </h2>
          <p className="text-sm text-gray-500">
            Consultez en temps réel l&apos;état de vos dispositifs de diffusion
          </p>
        </div>
      </header>

      <div className="mt-5 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 sm:col-span-2">
            <Radar className="h-4 w-4 text-gray-400" />
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Capteur
            </span>
          </div>
          <DeviceTile
            name="Capteur d'affluence"
            badge={sensorBadge(sensor?.status ?? 'never')}
            detail={ago(sensor?.last_measured_at ?? null)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
            <MonitorSmartphone className="h-4 w-4 text-gray-400" />
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Écrans
            </span>
          </div>
          {screens.length === 0 ? (
            <p className="text-sm text-gray-400 sm:col-span-2 lg:col-span-3">
              Aucun écran appairé sur cet établissement.
            </p>
          ) : (
            screens.map((screen) => (
              <DeviceTile
                key={screen.id}
                name={screen.name}
                badge={screenBadge(deviceStatusOf(screen))}
                detail={
                  screen.last_seen_at && !screen.connected
                    ? `Vu ${formatDistanceToNow(new Date(screen.last_seen_at), { locale: fr, addSuffix: true })}`
                    : null
                }
              />
            ))
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onContactSupport}
          className="rounded-xl bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep hover:opacity-90"
        >
          Contacter le support
        </button>
      </div>
    </section>
  );
}
