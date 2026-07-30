import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// EV1 — source pins (no render harness): the disabled positioning CTA, the suggestion surface,
// the §10 admin field set, and the death of the Supabase-era events tree.

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the match card (EventCard)', () => {
  const source = read('./components/EventCard.tsx');

  // EV3 — the disabled-CTA pin FLIPS: the parcours is live. « Je me positionne » creates the
  // positioning draft and opens the 3 steps; only a Terminé match keeps a disabled CTA.
  it('the positioning CTA is LIVE (EV3): creates the draft and opens the parcours', () => {
    expect(source).toContain('POSITIONNE_CTA');
    expect(source).toContain('usePositionner');
    expect(source).toContain('/evenements/positionnement/');
    expect(source).not.toContain('POSITIONNE_SOON'); // « Bientôt disponible » retired with the pin
    expect(source).toContain("event.statut !== 'termine'"); // a finished match is not positionable
  });

  it('badges suggested cards and shows the window line on every card', () => {
    expect(source).toContain('SUGGESTED_BADGE');
    expect(source).toContain('WINDOW_LINE');
  });
});

describe('the Événements page', () => {
  const source = read('./pages/Events.tsx');

  it('unfolds « Ce que les screencasters suggèrent » behind « Voir plus », with the suggest form', () => {
    expect(source).toContain('Voir plus');
    expect(source).toContain('Ce que les screencasters suggèrent');
    expect(source).toContain('SuggestMatchForm');
  });

  it('searches équipe/phase through the ONE lib home', () => {
    expect(source).toContain('searchEvents');
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
      './components/EventCard.tsx',
      './components/SuggestMatchForm.tsx',
      './services/events.api.ts',
      './hooks/useEvents.ts',
      '../admin/pages/EventManagement.tsx',
      '../admin/components/EventFormModal.tsx',
      '../admin/services/admin-events.service.ts',
      '../admin/hooks/useAdminEvents.ts',
      '../campaigns/hooks/useCampaignMutations.ts',
    ]) {
      expect(read(rel), `${rel} still touches supabase`).not.toMatch(
        /supabase\.rpc|special_events/,
      );
    }
  });

  it('the linkToEvent RPC mutation died with the tree', () => {
    expect(read('../campaigns/hooks/useCampaignMutations.ts')).not.toContain(
      'link_campaign_to_event',
    );
  });
});
