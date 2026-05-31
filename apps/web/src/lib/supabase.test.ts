import { afterEach, describe, expect, it, vi } from 'vitest';

// Each case re-imports the module under reset modules so the lazy `cachedClient` starts null and
// env stubs take effect at first access (resolveClient reads import.meta.env on access, not load).
describe('supabase lazy client', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('does not construct the client at module load (no throw when env vars are absent)', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    // Pre-fix this import threw "supabaseUrl is required"; the lazy proxy must load cleanly.
    await expect(import('./supabase')).resolves.toBeDefined();
  });

  it('throws a descriptive error naming the accessed property when env is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const { supabase } = await import('./supabase');
    expect(() => supabase.from).toThrow(/this surface \(from\)/);
    expect(() => supabase.from).toThrow(/deferred to its backend slice/);
    expect(() => supabase.from).toThrow(/§2\.3/);
    // the namespace name is interpolated, so a different access reports a different property
    expect(() => supabase.auth).toThrow(/this surface \(auth\)/);
  });

  // Note: the env-present construct path isn't asserted here — supabase-js's createClient eagerly
  // builds a RealtimeClient that needs native WebSocket, which Node 20 lacks (without the `ws`
  // package). It succeeds in the browser (dev/prod); the browser runtime is its verification.
});
