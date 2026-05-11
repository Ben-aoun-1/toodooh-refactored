import { supabase } from '../lib/supabase';

import { type DoohConfigNumbers, DEFAULT_DOOH_CONFIG_NUMBERS } from './dooh-calculation.service';

export type GlobalConfigurationValueType = 'integer' | 'numeric' | 'boolean' | 'json' | 'text';

export type GlobalConfigurationRow = {
  key: string;
  value_text: string;
  value_type: GlobalConfigurationValueType;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
};

/** Clés seedées (alignées sur la migration `global_configuration`). */
export const GLOBAL_CONFIGURATION_KEYS = {
  video_max_duration_seconds: 'video_max_duration_seconds',
  video_min_duration_seconds: 'video_min_duration_seconds',
  video_default_duration_seconds: 'video_default_duration_seconds',
  max_billable_spot_rate_per_hour: 'max_billable_spot_rate_per_hour',
  standard_campaign_cpm_tnd: 'standard_campaign_cpm_tnd',
  event_campaign_cpm_tnd: 'event_campaign_cpm_tnd',
  max_spots_per_hour: 'max_spots_per_hour',
  dooh_occupation_reference_rph: 'dooh_occupation_reference_rph',
} as const;

export type GlobalConfigurationKey =
  (typeof GLOBAL_CONFIGURATION_KEYS)[keyof typeof GLOBAL_CONFIGURATION_KEYS];

const KNOWN_KEYS = new Set<string>(Object.values(GLOBAL_CONFIGURATION_KEYS));

let parsedMapCache: {
  map: Record<string, string | number | boolean | unknown>;
  at: number;
} | null = null;
const CACHE_MS = 60_000;

export function invalidateGlobalConfigurationCache(): void {
  parsedMapCache = null;
}

function parseGlobalConfigurationValue(
  row: GlobalConfigurationRow,
): string | number | boolean | unknown {
  switch (row.value_type) {
    case 'integer': {
      const n = Number.parseInt(row.value_text, 10);
      return Number.isFinite(n) ? n : 0;
    }
    case 'numeric': {
      const n = Number(row.value_text);
      return Number.isFinite(n) ? n : 0;
    }
    case 'boolean':
      return row.value_text === 'true' || row.value_text === '1';
    case 'json':
      try {
        return JSON.parse(row.value_text) as unknown;
      } catch {
        return null;
      }
    default:
      return row.value_text;
  }
}

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toPositiveNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(String(v));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function toRate01(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(String(v));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(1, n);
}

/** Agrège la map parsée vers les nombres utilisés par le moteur DOOH (fallbacks seed). */
export function mapParsedToDoohNumbers(
  map: Record<string, string | number | boolean | unknown>,
): DoohConfigNumbers {
  const d = DEFAULT_DOOH_CONFIG_NUMBERS;
  return {
    video_min_duration_seconds: Math.max(
      1,
      toInt(map.video_min_duration_seconds, d.video_min_duration_seconds),
    ),
    video_max_duration_seconds: Math.max(
      1,
      toInt(map.video_max_duration_seconds, d.video_max_duration_seconds),
    ),
    video_default_duration_seconds: Math.max(
      1,
      toInt(map.video_default_duration_seconds, d.video_default_duration_seconds),
    ),
    max_spots_per_hour: Math.max(1, toInt(map.max_spots_per_hour, d.max_spots_per_hour)),
    max_billable_spot_rate_per_hour: toRate01(
      map.max_billable_spot_rate_per_hour,
      d.max_billable_spot_rate_per_hour,
    ),
    dooh_occupation_reference_rph: toPositiveNumber(
      map.dooh_occupation_reference_rph,
      d.dooh_occupation_reference_rph,
    ),
    standard_campaign_cpm_tnd: toPositiveNumber(
      map.standard_campaign_cpm_tnd,
      d.standard_campaign_cpm_tnd,
    ),
    event_campaign_cpm_tnd: toPositiveNumber(map.event_campaign_cpm_tnd, d.event_campaign_cpm_tnd),
  };
}

function normalizeBounds(config: DoohConfigNumbers): DoohConfigNumbers {
  let minS = config.video_min_duration_seconds;
  let maxS = config.video_max_duration_seconds;
  let defS = config.video_default_duration_seconds;
  if (minS > maxS) [minS, maxS] = [maxS, minS];
  defS = Math.min(maxS, Math.max(minS, defS));
  return {
    ...config,
    video_min_duration_seconds: minS,
    video_max_duration_seconds: maxS,
    video_default_duration_seconds: defS,
  };
}

/**
 * Lecture avec cache court (évite de spammer Supabase sur NewCampaign / liste campagnes).
 */
export async function getDoohConfigNumbers(): Promise<DoohConfigNumbers> {
  const now = Date.now();
  if (parsedMapCache && now - parsedMapCache.at < CACHE_MS) {
    return normalizeBounds(mapParsedToDoohNumbers(parsedMapCache.map));
  }
  const map = await globalConfigurationService.getParsedMap();
  parsedMapCache = { map, at: now };
  return normalizeBounds(mapParsedToDoohNumbers(map));
}

export type ValidateValueResult = { ok: true; valueText: string } | { ok: false; message: string };

/** Valide une saisie avant persistance (clés métier connues). */
export function validateValueForKey(
  key: string,
  valueText: string,
  valueType: GlobalConfigurationValueType,
): ValidateValueResult {
  const trimmed = valueText.trim();
  if (trimmed === '') {
    return { ok: false, message: 'Valeur vide.' };
  }

  if (valueType === 'integer') {
    if (!/^-?\d+$/.test(trimmed)) {
      return { ok: false, message: 'Entier attendu.' };
    }
    const n = Number.parseInt(trimmed, 10);
    if (key === GLOBAL_CONFIGURATION_KEYS.max_spots_per_hour && n < 1) {
      return { ok: false, message: 'Au moins 1 spot par heure.' };
    }
    if (
      (key === GLOBAL_CONFIGURATION_KEYS.video_min_duration_seconds ||
        key === GLOBAL_CONFIGURATION_KEYS.video_max_duration_seconds ||
        key === GLOBAL_CONFIGURATION_KEYS.video_default_duration_seconds) &&
      n < 1
    ) {
      return { ok: false, message: 'Durée minimale 1 seconde.' };
    }
    return { ok: true, valueText: trimmed };
  }

  if (valueType === 'numeric') {
    const n = Number(trimmed.replace(',', '.'));
    if (!Number.isFinite(n)) {
      return { ok: false, message: 'Nombre décimal attendu.' };
    }
    if (key === GLOBAL_CONFIGURATION_KEYS.max_billable_spot_rate_per_hour) {
      if (n < 0 || n > 1) {
        return { ok: false, message: 'Le taux doit être entre 0 et 1.' };
      }
    }
    if (
      key === GLOBAL_CONFIGURATION_KEYS.standard_campaign_cpm_tnd ||
      key === GLOBAL_CONFIGURATION_KEYS.event_campaign_cpm_tnd
    ) {
      if (n <= 0) {
        return { ok: false, message: 'Le CPM doit être strictement positif.' };
      }
    }
    if (key === GLOBAL_CONFIGURATION_KEYS.dooh_occupation_reference_rph && n <= 0) {
      return { ok: false, message: 'La référence RPH doit être strictement positive.' };
    }
    return { ok: true, valueText: String(n) };
  }

  return { ok: true, valueText: trimmed };
}

export const globalConfigurationService = {
  async list(): Promise<GlobalConfigurationRow[]> {
    const { data, error } = await supabase.from('global_configuration').select('*').order('key');
    if (error) throw new Error(error.message);
    return (data ?? []) as GlobalConfigurationRow[];
  },

  async getByKey(key: string): Promise<GlobalConfigurationRow | null> {
    const { data, error } = await supabase
      .from('global_configuration')
      .select('*')
      .eq('key', key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as GlobalConfigurationRow | null;
  },

  async getParsedMap(): Promise<Record<string, string | number | boolean | unknown>> {
    const rows = await globalConfigurationService.list();
    const map: Record<string, string | number | boolean | unknown> = {};
    for (const row of rows) {
      map[row.key] = parseGlobalConfigurationValue(row);
    }
    return map;
  },

  parseValue(row: GlobalConfigurationRow): string | number | boolean | unknown {
    return parseGlobalConfigurationValue(row);
  },

  async updateValue(key: string, valueText: string): Promise<GlobalConfigurationRow> {
    const row = await globalConfigurationService.getByKey(key);
    if (!row) {
      throw new Error('Clé inconnue. Utilisez upsert pour créer une nouvelle entrée.');
    }
    const v = validateValueForKey(key, valueText, row.value_type);
    if (!v.ok) throw new Error(v.message);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('global_configuration')
      .update({
        value_text: v.valueText,
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('key', key)
      .select()
      .single();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Configuration introuvable.');
    invalidateGlobalConfigurationCache();
    return data as GlobalConfigurationRow;
  },

  /**
   * Met à jour si la clé existe ; insère si nouvelle clé (policy INSERT admin requise).
   */
  async upsertByKey(params: {
    key: string;
    valueText: string;
    valueType: GlobalConfigurationValueType;
    description?: string | null;
  }): Promise<GlobalConfigurationRow> {
    const { key, valueType } = params;
    const v = validateValueForKey(key, params.valueText, valueType);
    if (!v.ok) throw new Error(v.message);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const existing = await globalConfigurationService.getByKey(key);
    if (existing) {
      if (existing.value_type !== valueType) {
        throw new Error('Type incohérent avec la ligne existante.');
      }
      const { data, error } = await supabase
        .from('global_configuration')
        .update({
          value_text: v.valueText,
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('key', key)
        .select()
        .single();
      if (error) throw new Error(error.message);
      invalidateGlobalConfigurationCache();
      return data as GlobalConfigurationRow;
    }

    if (!KNOWN_KEYS.has(key)) {
      throw new Error('Seules les clés métier référencées peuvent être créées depuis l’admin.');
    }

    const { data: inserted, error: insertError } = await supabase
      .from('global_configuration')
      .insert({
        key,
        value_text: v.valueText,
        value_type: valueType,
        description: params.description ?? null,
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) throw new Error(insertError.message);
    invalidateGlobalConfigurationCache();
    return inserted as GlobalConfigurationRow;
  },
};
