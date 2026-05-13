import type { HourlyPlanSlotOutput } from '../lib/dooh/hourly-plan';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';

const log = logger.child({ module: 'campaign-hourly-location-plan.service' });

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function replaceCampaignHourlyLocationPlan(
  campaignId: string,
  rows: readonly HourlyPlanSlotOutput[],
  options?: {
    /** Si fourni, ne supprime/réinsère que ces localités (mode owner-partiel). */
    scopeLocationIds?: readonly string[];
  },
): Promise<void> {
  const scope = [...new Set((options?.scopeLocationIds ?? []).filter(Boolean))];
  const isScoped = scope.length > 0;

  const scopedRows = isScoped ? rows.filter((r) => scope.includes(r.locationId)) : [...rows];
  const rowsToPersist = scopedRows.filter(
    (r) => r.plannedRepetitionsPerHour > 0 && r.plannedImpressions > 0,
  );

  let delQuery = supabase
    .from('campaign_hourly_location_plan')
    .delete()
    .eq('campaign_id', campaignId);
  if (isScoped) {
    delQuery = delQuery.in('location_id', scope);
  }
  const { error: delErr } = await delQuery;
  if (delErr) throw delErr;

  if (rowsToPersist.length === 0) return;

  const payload = rowsToPersist.map((r) => ({
    campaign_id: campaignId,
    location_id: r.locationId,
    diffusion_date: r.diffusionDate,
    diffusion_hour: r.diffusionHour,
    planned_repetitions_per_hour: r.plannedRepetitionsPerHour,
    planned_impressions: r.plannedImpressions,
  }));

  const chunkSize = 1000;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { error } = await supabase.from('campaign_hourly_location_plan').upsert(chunk, {
      onConflict: 'campaign_id,location_id,diffusion_date,diffusion_hour',
    });
    if (error) throw error;
  }
}

export async function getOccupiedRepetitionsByLocationFromHourlyPlan(input: {
  locationIds: readonly string[];
  startDate: Date;
  endDate: Date;
  excludeCampaignId?: string | null;
}): Promise<Map<string, number>> {
  const locationIds = [...new Set(input.locationIds.filter(Boolean))];
  if (locationIds.length === 0) return new Map<string, number>();

  const start = toDateStr(input.startDate);
  const end = toDateStr(input.endDate);

  const { data: rows, error } = await supabase
    .from('campaign_hourly_location_plan')
    .select(
      'campaign_id, location_id, diffusion_date, diffusion_hour, planned_repetitions_per_hour',
    )
    .in('location_id', locationIds)
    .gte('diffusion_date', start)
    .lte('diffusion_date', end);

  if (error) {
    log.warn(
      { error },
      'getOccupiedRepetitionsByLocationFromHourlyPlan: lecture indisponible, occupation concurrente à 0.',
    );
    return new Map<string, number>();
  }
  const all = (rows ?? []) as Array<{
    campaign_id: string;
    location_id: string;
    diffusion_date: string;
    diffusion_hour: number;
    planned_repetitions_per_hour: number | null;
  }>;

  const campaignIds = [
    ...new Set(all.map((r) => r.campaign_id).filter((id) => id && id !== input.excludeCampaignId)),
  ];
  if (campaignIds.length === 0) return new Map<string, number>();

  const { data: campaigns, error: cErr } = await supabase
    .from('campaigns')
    .select('id, status')
    .in('id', campaignIds)
    .in('status', ['active', 'pending']);
  if (cErr) {
    log.warn(
      { cErr },
      'getOccupiedRepetitionsByLocationFromHourlyPlan: lecture statuts campagnes indisponible, occupation concurrente à 0.',
    );
    return new Map<string, number>();
  }
  const allowed = new Set((campaigns ?? []).map((c: { id: string }) => c.id));

  const sumByLocSlot = new Map<string, number>();
  for (const r of all) {
    if (!allowed.has(r.campaign_id)) continue;
    if (input.excludeCampaignId && r.campaign_id === input.excludeCampaignId) continue;
    const rep = Math.max(0, Number(r.planned_repetitions_per_hour) || 0);
    const key = `${r.location_id}|${r.diffusion_date}|${r.diffusion_hour}`;
    sumByLocSlot.set(key, (sumByLocSlot.get(key) ?? 0) + rep);
  }

  const maxByLoc = new Map<string, number>();
  for (const [key, val] of sumByLocSlot) {
    const locId = key.split('|')[0];
    maxByLoc.set(locId, Math.max(maxByLoc.get(locId) ?? 0, val));
  }
  return maxByLoc;
}
