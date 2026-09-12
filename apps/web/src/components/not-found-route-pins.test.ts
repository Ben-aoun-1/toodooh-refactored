import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// MINOR-1/29 — the catch-all route renders a French « Page introuvable » instead of bouncing to
// /login. apps/web has no render harness, so the route shape and the page's copy are pinned by
// reading the sources (comments stripped, so the comment explaining the rule cannot satisfy it).

const APP = join(__dirname, '..', 'App.tsx');
const PAGE = join(__dirname, 'NotFoundPage.tsx');

const stripComments = (src: string): string =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const routeElementFor = (src: string, path: string): string => {
  const chunks = src.split('<Route').slice(1);
  const chunk = chunks.find((c) => c.includes(`path="${path}"`));
  if (!chunk) throw new Error(`no <Route> declares path="${path}"`);
  return chunk;
};

describe('the catch-all route (MINOR-1/29)', () => {
  const app = stripComments(readFileSync(APP, 'utf8'));
  const page = stripComments(readFileSync(PAGE, 'utf8'));

  it('renders the 404 page, never a redirect to /login', () => {
    const catchAll = routeElementFor(app, '*');
    expect(catchAll).toContain('<NotFoundPage />');
    expect(catchAll).not.toContain('Navigate');
  });

  it('says « Page introuvable » in French and offers « Retour à l’accueil » toward the resolved home', () => {
    expect(page).toContain('Page introuvable');
    expect(page).toContain('Retour à l&apos;accueil');
    expect(page).toContain('resolveHomeRoute(profileType, role, validationStatus)');
    expect(page).toContain("'/login'");
  });
});
