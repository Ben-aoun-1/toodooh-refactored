import { useEffect, useState } from 'react';

import { logger } from '../../../lib/logger';
import { authService } from '../../auth/services/auth.service';

const log = logger.child({ module: 'useUserProfile' });

interface UseUserProfileResult {
  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any;
  loading: boolean;
  error: Error | null;
}

/**
 * Loads the user's `business_profiles` row. Reloads when `userId` changes or
 * when the optional `reloadKey` changes (used to force re-fetch on
 * navigation, mirroring the original Dashboard.tsx behavior of refetching
 * on `location.pathname` change).
 */
export function useUserProfile(userId: string | undefined, reloadKey?: string): UseUserProfileResult {
  // TODO(phase-1): typed source [supabase] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await authService.getBusinessProfile();
        if (!cancelled) setProfile(data);
      } catch (e) {
        if (cancelled) return;
        const err = e instanceof Error ? e : new Error(String(e));
        log.error({ error: err }, 'Error fetching profile');
        setError(err);
        setProfile(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [userId, reloadKey]);

  return { profile, loading, error };
}
