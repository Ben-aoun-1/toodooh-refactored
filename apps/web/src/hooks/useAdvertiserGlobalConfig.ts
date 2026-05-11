import { useCallback, useEffect, useState } from 'react';

import {
  type DoohConfigNumbers,
  DEFAULT_DOOH_CONFIG_NUMBERS,
} from '../services/dooh-calculation.service';
import {
  getDoohConfigNumbers,
  invalidateGlobalConfigurationCache,
} from '../services/global-configuration.service';

export type AdvertiserGlobalConfigState = {
  dooh: DoohConfigNumbers;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/**
 * Paramètres globaux pour parcours annonceur (CPM, durées vidéo affichées, etc.).
 */
export function useAdvertiserGlobalConfig(): AdvertiserGlobalConfigState {
  const [dooh, setDooh] = useState<DoohConfigNumbers>(DEFAULT_DOOH_CONFIG_NUMBERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    invalidateGlobalConfigurationCache();
    setLoading(true);
    setError(null);
    try {
      const n = await getDoohConfigNumbers();
      setDooh(n);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement de la configuration');
      setDooh(DEFAULT_DOOH_CONFIG_NUMBERS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const n = await getDoohConfigNumbers();
        if (!cancelled) setDooh(n);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Erreur de chargement de la configuration');
          setDooh(DEFAULT_DOOH_CONFIG_NUMBERS);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { dooh, loading, error, refresh };
}
