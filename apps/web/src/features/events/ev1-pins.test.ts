import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// EV1 — source pins (no render harness): the disabled positioning CTA, the suggestion surface,
// the §10 admin field set, and the death of the Supabase-era events tree.

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// EVT-PLAY1 (operator ruling 2026-10-08, 2 A) — the old EventCard is gone: the suggestions render
// through the EVT-CAT2 card too, so ONE card carries the live CTA and the suggested badge.
describe('the match card (CatalogueEventCard)', () => {
  const source = read('./components/catalogue/CatalogueEventCard.tsx');

  it('the positioning CTA is LIVE (EV3): creates the draft and opens the parcours', () => {
    expect(source).toContain('Je me positionne');
    expect(source).toContain('usePositionner');
    expect(source).toContain('/evenements/positionnement/');
  });

  it('the badge and the diffusion window come from the ONE lib home', () => {
    expect(source).toContain('cardBadge(event)');
    expect(source).toContain('kickoffLine(event)');
  });
});

describe('the Événements page', () => {
  const source = read('./pages/Events.tsx');

  it('unfolds « Ce que les screencasters suggèrent » behind « Voir plus », with the suggest form', () => {
    expect(source).toContain('Voir plus');
    expect(source).toContain('Ce que les screencasters suggèrent');
    expect(source).toContain('SuggestMatchForm');
    expect(source).not.toContain('components/EventCard'); // the suggestions use the catalogue card
  });

  // EVT-CAT2 (operator ruling 2026-10-06) — Youssef's validated page: « À la une » + months
  // through the ONE lib home, « Ma sélection », and « Mes Événements » + the suggestions kept
  // under it. 2026-10-08 (ruling 1 A) the search bar is BACK, through the ONE lib search, on the
  // catalogue AND the suggestions.
  it('lays the catalogue out through the ONE lib home, with « Ma sélection » and « Mes Événements »', () => {
    expect(source).toContain('layoutCatalogue(searchEvents(catalogue');
    expect(source).toContain('searchEvents(suggested');
    expect(source).toContain('<SelectionPanel');
    expect(source).toContain('<MesEvenementsStrip />');
  });
});

describe('the §10 admin surface (EventManagement + EventFormModal)', () => {
  const page = read('../admin/pages/EventManagement.tsx');
  const modal = read('../admin/components/EventFormModal.tsx');

  it('the removed legacy fields have NO inputs (audience, priorité, featured, ville/lieu/adresse)', () => {
    for (const gone of [
      'expected_attendance',
      'target_audience',
      'priority_level',
      'pricing_multiplier',
      'is_featured',
      'is_active',
      'Mettre en avant',
      'Audience attendue',
      'Priorité',
      'Ville',
      'Adresse',
    ]) {
      expect(page).not.toContain(gone);
      expect(modal).not.toContain(gone);
    }
  });

  it('the type is a LOCKED « Sport » chip, never an input', () => {
    expect(modal).toContain('Sport');
    expect(modal).not.toMatch(/select[^>]*type|input[^>]*name="type"/);
  });

  it('annuler asks for confirmation before firing', () => {
    expect(page).toContain('Annuler cet événement ?');
    expect(page).toContain('Confirmer l’annulation');
  });
});

describe('the Supabase-era events tree is DEAD', () => {
  it('no events-feature or admin-events file touches supabase anymore', () => {
    for (const rel of [
      './pages/Events.tsx',
      './components/catalogue/CatalogueEventCard.tsx',
      './components/SuggestMatchForm.tsx',
      './services/events.api.ts',
      './hooks/useEvents.ts',
      '../admin/pages/EventManagement.tsx',
      '../admin/components/EventFormModal.tsx',
      '../admin/services/admin-events.service.ts',
      '../admin/hooks/useAdminEvents.ts',
    ]) {
      expect(read(rel), `${rel} still touches supabase`).not.toMatch(
        /supabase\.rpc|special_events/,
      );
    }
  });
});
