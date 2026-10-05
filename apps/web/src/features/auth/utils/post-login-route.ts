import { resolveHomeRoute } from '@/features/auth/utils/home-route';

// LAND-FB1 — the landing's « Lancer une campagne » buttons link to /login?next=/new-campaign so a
// screencaster lands in the campaign wizard right after signing in, not on their dashboard.
//
// `next` comes from the URL, so it is an ALLOWLIST, never a free path: anything else (another
// origin, `//evil`, an admin page) falls back to the normal home. And it only applies to an account
// whose home is the advertiser dashboard — an owner, agent, admin or rejected account clicking the
// same button still lands where resolveHomeRoute sends them.
export const POST_LOGIN_NEXT_ALLOWLIST: readonly string[] = ['/new-campaign'];

export function resolvePostLoginRoute(
  next: string | null,
  profileType: string | null,
  role?: string | null,
  status?: string | null,
): string {
  const home = resolveHomeRoute(profileType, role, status);
  if (home !== '/dashboard' || next === null) return home;
  return POST_LOGIN_NEXT_ALLOWLIST.includes(next) ? next : home;
}
