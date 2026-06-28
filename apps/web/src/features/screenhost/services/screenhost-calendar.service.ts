import { apiClient } from '@/lib/api-client';

/**
 * Owner-scoped diffusion calendar, served by `apps/api`:
 *   GET /api/screenhosts/calendar — the owner's ACCEPTE allocations + their créneaux
 *
 * This is the read side of the per-allocation acceptance model: once a screenhost owner accepts an
 * allocation (→ ACCEPTE), the campaign airs on that venue, and this endpoint surfaces those accepted
 * campaigns with their frozen créneaux (date/hour) + campaign window so the owner can see an
 * agenda/month calendar of what is scheduled to air across their screenhosts. Session-cookie scoped
 * (no ownerId argument); EN_ATTENTE/REFUSE allocations are excluded server-side. Wire shape is
 * snake_case.
 */
export interface CalendarCreneau {
  date: string; // ISO calendar date YYYY-MM-DD
  hour: number; // 0–23
  impressions: number; // potential impressions for the slot
}

export interface AcceptedAllocation {
  id: string;
  campaign_id: string;
  campaign_name: string;
  start_date: string | null;
  end_date: string | null;
  screenhost_id: string;
  screenhost_name: string;
  creneaux: CalendarCreneau[];
}

export const screenhostCalendarService = {
  /** The signed-in owner's accepted campaigns + their créneaux, for the diffusion calendar. */
  list(): Promise<AcceptedAllocation[]> {
    return apiClient.get<AcceptedAllocation[]>('/screenhosts/calendar');
  },
};
