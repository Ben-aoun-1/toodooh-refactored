/**
 * Moteur de calcul DOOH (fonctions pures, testables).
 * Les montants CPM sont en TND ; les durées en secondes.
 */

export type DoohConfigNumbers = {
  video_min_duration_seconds: number;
  video_max_duration_seconds: number;
  video_default_duration_seconds: number;
  max_spots_per_hour: number;
  max_billable_spot_rate_per_hour: number;
  /** Référence RPH pour le taux d’occupation par localité (voir `dooh-location-affluence-engine`). */
  dooh_occupation_reference_rph: number;
  standard_campaign_cpm_tnd: number;
  event_campaign_cpm_tnd: number;
};

export const DEFAULT_DOOH_CONFIG_NUMBERS: DoohConfigNumbers = {
  video_min_duration_seconds: 1,
  video_max_duration_seconds: 30,
  video_default_duration_seconds: 15,
  max_spots_per_hour: 10,
  max_billable_spot_rate_per_hour: 0.3,
  dooh_occupation_reference_rph: 10,
  standard_campaign_cpm_tnd: 2.5,
  event_campaign_cpm_tnd: 2.5,
};

export type EffectiveDurationResult = { ok: true; seconds: number } | { ok: false; reason: string };

/** Durée effective = réelle si fournie, sinon défaut ; bloque si hors [min, max]. */
export function resolveEffectiveVideoDuration(
  actualDurationSeconds: number | null | undefined,
  config: DoohConfigNumbers,
): EffectiveDurationResult {
  const raw =
    actualDurationSeconds != null &&
    Number.isFinite(actualDurationSeconds) &&
    actualDurationSeconds > 0
      ? actualDurationSeconds
      : config.video_default_duration_seconds;
  const minV = config.video_min_duration_seconds;
  const maxV = config.video_max_duration_seconds;
  if (raw < minV) {
    return { ok: false, reason: `Durée ${raw}s inférieure au minimum (${minV}s).` };
  }
  if (raw > maxV) {
    return { ok: false, reason: `Durée ${raw}s supérieure au maximum (${maxV}s).` };
  }
  return { ok: true, seconds: raw };
}

/**
 * Durée utilisée pour le plafond d’impressions (wizard / estimation) : accepte un léger dépassement
 * du max en le plaquant à `video_max_duration_seconds` au lieu de retomber au défaut.
 */
export function effectiveVideoSecondsForDoohEstimate(
  actualDurationSeconds: number | null | undefined,
  config: DoohConfigNumbers,
): number {
  const resolved = resolveEffectiveVideoDuration(actualDurationSeconds, config);
  if (resolved.ok) return resolved.seconds;
  const raw =
    actualDurationSeconds != null &&
    Number.isFinite(actualDurationSeconds) &&
    actualDurationSeconds > 0
      ? actualDurationSeconds
      : config.video_default_duration_seconds;
  if (raw > config.video_max_duration_seconds) {
    return config.video_max_duration_seconds;
  }
  return config.video_default_duration_seconds;
}

/** floor(3600 / effective_video_duration_seconds) */
export function computeRepetitionsPerHourVideo(effectiveVideoDurationSeconds: number): number {
  if (!Number.isFinite(effectiveVideoDurationSeconds) || effectiveVideoDurationSeconds <= 0) {
    return 0;
  }
  return Math.floor(3600 / effectiveVideoDurationSeconds);
}

export type DoohSlotInput = {
  /** Affluence (poids audience) pour la tranche horaire. */
  affluence_horaire: number;
  /** Spots déjà occupés par d’autres campagnes sur la même tranche. */
  occupied_by_other_campaigns: number;
  unavailable: boolean;
  /** Chevauchement fenêtre événement [start - 1h ; end + 1h]. */
  event_overlap: boolean;
};

export type DoohSlotMetrics = {
  repetitions_per_hour_video: number;
  billable_spots_per_hour: number;
  remaining_spots_per_hour: number;
  allowed_repetitions_per_hour: number;
  impressions_tranche: number;
};

/**
 * Applique les règles 3–8 (une tranche / une heure logique).
 */
export function computeDoohSlotMetrics(
  config: DoohConfigNumbers,
  effectiveVideoDurationSeconds: number,
  slot: DoohSlotInput,
): DoohSlotMetrics {
  const repetitions_per_hour_video = computeRepetitionsPerHourVideo(effectiveVideoDurationSeconds);
  const billable_spots_per_hour =
    config.max_spots_per_hour * config.max_billable_spot_rate_per_hour;
  const remaining_spots_per_hour = Math.max(
    0,
    billable_spots_per_hour - slot.occupied_by_other_campaigns,
  );

  if (slot.event_overlap || slot.unavailable) {
    return {
      repetitions_per_hour_video,
      billable_spots_per_hour,
      remaining_spots_per_hour,
      allowed_repetitions_per_hour: 0,
      impressions_tranche: 0,
    };
  }

  const allowed_repetitions_per_hour = Math.min(
    repetitions_per_hour_video,
    remaining_spots_per_hour,
  );
  const impressions_tranche = allowed_repetitions_per_hour * Math.max(0, slot.affluence_horaire);

  return {
    repetitions_per_hour_video,
    billable_spots_per_hour,
    remaining_spots_per_hour,
    allowed_repetitions_per_hour,
    impressions_tranche,
  };
}

/** Somme des impressions sur toutes les tranches (règle 9). */
export function sumImpressionsTranches(metrics: readonly DoohSlotMetrics[]): number {
  return metrics.reduce((s, m) => s + m.impressions_tranche, 0);
}

/** Coût campagne à partir du total d’impressions (règle 10). */
export function computeCampaignCostTnd(
  totalImpressions: number,
  isEventCampaign: boolean,
  config: DoohConfigNumbers,
): number {
  const cpm = isEventCampaign ? config.event_campaign_cpm_tnd : config.standard_campaign_cpm_tnd;
  if (!Number.isFinite(totalImpressions) || totalImpressions <= 0) return 0;
  if (!Number.isFinite(cpm) || cpm <= 0) return 0;
  return (totalImpressions / 1000) * cpm;
}
