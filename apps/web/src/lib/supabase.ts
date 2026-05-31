import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// lib/supabase.ts is intentionally retained (frontend-repoint-survey §2.3/§2.4): 54 later-slice
// files still `import { supabase }` until their own backend slices ship. The problem this file
// solves: constructing the client eagerly — `createClient(import.meta.env.VITE_SUPABASE_URL, …)` at
// module load — throws "supabaseUrl is required" when the env var is absent. In prod the var is
// deliberately unset, so the eager construct crashed every React route before mount (dev masked it:
// .env.local supplied the value). So the client is now LAZY: module load never calls createClient.
// The real client is built on first property access, and only if the env vars exist. Where they
// don't (prod, deferred surfaces), access throws a descriptive error naming the namespace hit,
// instead of a cascade of TypeErrors.

const notConfiguredMessage = (property: string | symbol): string =>
  `Supabase client not configured — this surface (${String(property)}) is deferred to its ` +
  `backend slice and not yet wired in production. ` +
  `See docs/handoff/frontend-repoint-survey.md §2.3.`;

let cachedClient: SupabaseClient | null = null;

const resolveClient = (property: string | symbol): SupabaseClient => {
  if (cachedClient) return cachedClient;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(notConfiguredMessage(property));
  }
  cachedClient = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cachedClient;
};

// A faithful forwarder typed as the real client, so all 54 callers' `supabase.from(...)` /
// `supabase.auth.*` / `supabase.storage.*` typecheck and behave unchanged. Functions are bound to
// the resolved client so `this` (and supabase-js's private fields) stay correct; non-function
// members (e.g. the `auth` sub-client) forward as-is.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = resolveClient(property);
    const value = Reflect.get(client, property);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
