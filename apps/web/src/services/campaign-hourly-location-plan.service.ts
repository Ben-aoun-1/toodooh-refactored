import { supabase } from '../lib/supabase';

export type HourlyPlanSlotInput = {
  locationId: string;
  diffusionDate: string; // YYYY-MM-DD (local)
  diffusionHour: number; // 0..23
  maxImpressions: number; // capacité maximale du slot (après règles métier)
  maxRepetitionsPerHour: number; // plafond logique de répétitions sur ce slot
};

export type HourlyPlanSlotOutput = HourlyPlanSlotInput & {
  plannedRepetitionsPerHour: number;
  plannedImpressions: number;
};

function stableSlotKey(s: {
  locationId: string;
  diffusionDate: string;
  diffusionHour: number;
}): string {
  return `${s.locationId}|${s.diffusionDate}|${String(s.diffusionHour).padStart(2, '0')}`;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sortSlots(a: HourlyPlanSlotInput, b: HourlyPlanSlotInput): number {
  const ka = stableSlotKey(a);
  const kb = stableSlotKey(b);
  return ka.localeCompare(kb);
}

/**
 * Ajustement hybride post-curseur:
 * 1) réduction des répétitions en priorité
 * 2) si nécessaire, réduction de couverture de créneaux
 * 3) dernier recours: localités peuvent tomber à 0 si la cible est très basse
 */
export function buildHybridAdjustedHourlyPlan(input: {
  slots: readonly HourlyPlanSlotInput[];
  targetImpressions: number;
  keepLocationsFirst?: boolean;
}): HourlyPlanSlotOutput[] {
  const keepLocationsFirst = input.keepLocationsFirst ?? true;
  const slots = [...input.slots]
    .map((s) => ({
      ...s,
      maxImpressions: Math.max(0, Number(s.maxImpressions) || 0),
      maxRepetitionsPerHour: Math.max(0, Math.trunc(Number(s.maxRepetitionsPerHour) || 0)),
    }))
    .sort(sortSlots);

  const withMeta = slots.map((s) => {
    const maxRep = s.maxRepetitionsPerHour;
    const perRep =
      maxRep > 0 ? s.maxImpressions / maxRep : s.maxImpressions > 0 ? s.maxImpressions : 0;
    return {
      ...s,
      perRep,
      reps: maxRep,
    };
  });

  const totalMax = withMeta.reduce((sum, s) => sum + s.maxImpressions, 0);
  const target = Math.max(0, Number(input.targetImpressions) || 0);
  if (target >= totalMax) {
    return withMeta.map((s) => ({
      locationId: s.locationId,
      diffusionDate: s.diffusionDate,
      diffusionHour: s.diffusionHour,
      maxImpressions: s.maxImpressions,
      maxRepetitionsPerHour: s.maxRepetitionsPerHour,
      plannedRepetitionsPerHour: s.maxRepetitionsPerHour,
      plannedImpressions: Math.round(s.maxImpressions),
    }));
  }

  // Phase 1: réduction proportionnelle des répétitions.
  const ratio = totalMax > 0 ? target / totalMax : 0;
  for (const s of withMeta) {
    s.reps = Math.min(
      s.maxRepetitionsPerHour,
      Math.max(0, Math.floor(s.maxRepetitionsPerHour * ratio)),
    );
  }

  // Localités protégées (au moins 1 répétition quelque part si possible).
  const protectedLocations = new Set<string>();
  if (keepLocationsFirst && target > 0) {
    const byLoc = new Map<string, typeof withMeta>();
    for (const s of withMeta) {
      const list = byLoc.get(s.locationId) ?? [];
      list.push(s);
      byLoc.set(s.locationId, list);
    }
    for (const [locId, locSlots] of byLoc) {
      const hasCapacity = locSlots.some((s) => s.maxRepetitionsPerHour > 0);
      if (!hasCapacity) continue;
      const repsNow = locSlots.reduce((sum, s) => sum + s.reps, 0);
      if (repsNow > 0) {
        protectedLocations.add(locId);
        continue;
      }
      const best = [...locSlots]
        .filter((s) => s.maxRepetitionsPerHour > 0)
        .sort((a, b) => b.perRep - a.perRep || sortSlots(a, b))[0];
      if (best) {
        best.reps = 1;
        protectedLocations.add(locId);
      }
    }
  }

  const totalFromReps = () => withMeta.reduce((sum, s) => sum + s.reps * s.perRep, 0);

  let total = totalFromReps();

  // Garde-fou: si la cible est > 0 mais qu'aucune répétition n'a été allouée
  // (arrondis/planchers), forcer un minimum de répétitions sur les meilleurs créneaux.
  if (target > 0 && total <= 0) {
    const bootstrapCandidates = withMeta
      .filter((s) => s.maxRepetitionsPerHour > 0 && s.perRep > 0)
      .sort((a, b) => b.perRep - a.perRep || sortSlots(a, b));
    for (const s of bootstrapCandidates) {
      if (s.reps >= s.maxRepetitionsPerHour) continue;
      s.reps = Math.max(1, s.reps);
      total = totalFromReps();
      if (total > 0) break;
    }
  }

  // Ajustement fin: si au-dessus cible, retirer des répétitions.
  let protectEnabled = keepLocationsFirst;
  let guard = 0;
  while (total > target && guard < 200_000) {
    guard += 1;
    const repsByLoc = new Map<string, number>();
    for (const s of withMeta) {
      repsByLoc.set(s.locationId, (repsByLoc.get(s.locationId) ?? 0) + s.reps);
    }

    const candidates = withMeta
      .filter((s) => s.reps > 0)
      .filter((s) => {
        if (!protectEnabled) return true;
        if (!protectedLocations.has(s.locationId)) return true;
        return (repsByLoc.get(s.locationId) ?? 0) > 1;
      })
      .sort((a, b) => a.perRep - b.perRep || sortSlots(a, b));

    if (candidates.length === 0) {
      if (protectEnabled) {
        protectEnabled = false; // dernier recours: localités peuvent tomber à 0
        continue;
      }
      break;
    }
    const chosen = candidates[0];
    chosen.reps -= 1;
    total -= chosen.perRep;
  }

  // Ajustement fin: si en dessous, ajouter des répétitions sans dépasser le max du slot.
  guard = 0;
  while (total < target && guard < 200_000) {
    guard += 1;
    const candidates = withMeta
      .filter((s) => s.reps < s.maxRepetitionsPerHour)
      .sort((a, b) => b.perRep - a.perRep || sortSlots(a, b));
    if (candidates.length === 0) break;
    const chosen = candidates[0];
    chosen.reps += 1;
    total += chosen.perRep;
  }

  return withMeta.map((s) => ({
    locationId: s.locationId,
    diffusionDate: s.diffusionDate,
    diffusionHour: s.diffusionHour,
    maxImpressions: s.maxImpressions,
    maxRepetitionsPerHour: s.maxRepetitionsPerHour,
    plannedRepetitionsPerHour: s.reps,
    plannedImpressions: Math.max(0, Math.round(s.reps * s.perRep)),
  }));
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
    console.warn(
      'getOccupiedRepetitionsByLocationFromHourlyPlan: lecture indisponible, occupation concurrente à 0.',
      error,
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
    console.warn(
      'getOccupiedRepetitionsByLocationFromHourlyPlan: lecture statuts campagnes indisponible, occupation concurrente à 0.',
      cErr,
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
