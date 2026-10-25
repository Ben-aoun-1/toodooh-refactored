import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

import { useHostUnavailability, useToggleHostDay } from '@/features/admin/hooks/useAdminHost';
import { AvailabilityCalendarCard } from '@/features/screenhost/components/calendar/AvailabilityCalendarCard';
import { declareResultCopy, fmtLongDate } from '@/features/screenhost/lib/diffusion-calendar';
import {
  isDayToggleable,
  isoOf,
  monthGrid,
} from '@/features/screenhost/lib/unavailability-calendar';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'HostCalendarSection' });

/**
 * HOST-EDIT1 — « Indisponibilités »: the owner's calendar card on the admin twin route. Same rules
 * (E2 + CAL-1): today and the past are locked, and declaring a day that carries a live campaign
 * share redistributes it — so that case asks first, inline, naming the campaigns.
 */
export default function HostCalendarSection({ venue }: { venue: { id: string; name: string } }) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), monthIndex: now.getMonth() };
  });
  const [pending, setPending] = useState<{
    iso: string;
    label: string;
    campaigns: string[];
  } | null>(null);
  const cells = useMemo(() => monthGrid(month.year, month.monthIndex), [month]);
  const from = cells[0]?.iso ?? '';
  const to = cells[cells.length - 1]?.iso ?? '';
  const todayIso = isoOf(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const read = useHostUnavailability(venue.id, from, to);
  const toggle = useToggleHostDay(venue.id, from, to);
  const declared = useMemo(() => new Set(read.data?.days ?? []), [read.data]);
  const diffusionDays = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const [iso, names] of Object.entries(read.data?.diffusion_days ?? {})) {
      if (iso > todayIso && names.length > 0) out.set(iso, names);
    }
    return out;
  }, [read.data, todayIso]);

  const shiftMonth = (delta: number) => {
    setPending(null);
    setMonth((m) => {
      const d = new Date(m.year, m.monthIndex + delta, 1);
      return { year: d.getFullYear(), monthIndex: d.getMonth() };
    });
  };

  const write = (iso: string, unavailable: boolean) => {
    toggle.mutate(
      { day: iso, unavailable },
      {
        onSuccess: (result) => {
          setPending(null);
          if (unavailable) toast.success(declareResultCopy(result.redispatched));
        },
        onError: (error) => {
          toast.error(getErrorMessage(error) || "Échec de l'enregistrement de la disponibilité");
          log.error({ err: error }, 'admin unavailability toggle failed');
        },
      },
    );
  };

  const handleToggle = (iso: string) => {
    if (!isDayToggleable(iso, todayIso) || toggle.isPending) return;
    const declaring = !declared.has(iso);
    const campaigns = diffusionDays.get(iso) ?? [];
    if (declaring && campaigns.length > 0) {
      setPending({ iso, label: fmtLongDate(iso), campaigns });
      return;
    }
    setPending(null);
    write(iso, declaring);
  };

  return (
    <AvailabilityCalendarCard
      title="Indisponibilités"
      subtitle="Les jours où l'établissement ne diffuse pas — un clic sur un jour futur le bascule."
      venues={[venue]}
      selectedVenueId={venue.id}
      onSelectVenue={() => undefined}
      month={month}
      onShiftMonth={shiftMonth}
      cells={cells}
      todayIso={todayIso}
      declared={declared}
      diffusionDays={diffusionDays}
      onToggle={handleToggle}
      busy={toggle.isPending}
      loading={read.isLoading}
      pending={pending}
      onConfirm={() => pending && write(pending.iso, true)}
      onCancel={() => setPending(null)}
    />
  );
}
