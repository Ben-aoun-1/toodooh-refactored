import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// SET-PW1 — a reset link is addressed to whoever holds the TOKEN, not to whoever happens to be
// signed in on the device. Both password routes used to sit inside <PublicRoute>, which redirects
// ANY authenticated visitor to resolveHomeRoute — so an admin clicking a new agent's « Définir mon
// mot de passe » link in their own browser landed on the admin dashboard instead of the form.
// apps/web has no render harness, so the route shape is pinned by reading App.tsx (comments
// stripped, so the comment explaining the rule cannot satisfy it).

const APP = join(__dirname, '..', '..', 'App.tsx');

const stripComments = (src: string): string =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** The single <Route …> element declaring `path`, as written in App.tsx. */
const routeElementFor = (src: string, path: string): string => {
  const chunks = src.split('<Route').slice(1);
  const chunk = chunks.find((c) => c.includes(`path="${path}"`));
  if (!chunk) throw new Error(`no <Route> declares path="${path}"`);
  return chunk;
};

const PASSWORD_ROUTES = ['/reset-password', '/update-password'];

describe('the password routes (SET-PW1)', () => {
  const src = stripComments(readFileSync(APP, 'utf8'));

  it('are both still registered', () => {
    for (const path of PASSWORD_ROUTES) {
      expect(() => routeElementFor(src, path)).not.toThrow();
    }
  });

  it('render for a session-bearing browser — never wrapped in PublicRoute', () => {
    for (const path of PASSWORD_ROUTES) {
      expect(routeElementFor(src, path)).not.toContain('PublicRoute');
    }
  });

  it('the standalone idiom they follow is intact — /verify-email is not guarded either', () => {
    expect(routeElementFor(src, '/verify-email')).not.toContain('PublicRoute');
  });

  it('PublicRoute still guards the routes that DO want an authed visitor bounced', () => {
    for (const path of ['/login', '/signup']) {
      expect(routeElementFor(src, path)).toContain('PublicRoute');
    }
  });
});
