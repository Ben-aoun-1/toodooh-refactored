/**
 * Plan horaire par localité — fonction pure de répartition budget→répétitions.
 *
 * No imports, no side effects. Lives in `lib/dooh/` (Supabase-free) so the algorithm — and its
 * test — can run without constructing the Supabase client. The persistence wrappers that
 * read/write `campaign_hourly_location_plan` stay in `../../services/campaign-hourly-location-plan.service.ts`.
 */

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
