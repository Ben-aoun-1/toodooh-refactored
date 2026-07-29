import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SPS_VARIABLE_LABELS } from './components/ScreenhostSpsBreakdown';

// E4 — the admin SPS breakdown, source-pinned (no render harness): the four RULED French labels,
// the read-only wire, and the eligibility-card mount.

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the ruled variable labels (Mejri 2026-07-27)', () => {
  it('spells the four criteria exactly once, in French', () => {
    expect(SPS_VARIABLE_LABELS['acceptation']).toBe("Taux d'acceptation des campagnes");
    expect(SPS_VARIABLE_LABELS['respect_evenements']).toBe('Respect des événements acceptés');
    expect(SPS_VARIABLE_LABELS['activite']).toBe("Activité de l'écran");
    expect(SPS_VARIABLE_LABELS['remplissage']).toBe('Taux de remplissage');
  });
});

describe('the breakdown component', () => {
  const source = read('./components/ScreenhostSpsBreakdown.tsx');

  it('is READ-ONLY (no mutation) and idle until opened (enabled-gated query)', () => {
    expect(source).not.toContain('useMutation');
    expect(source).toContain('enabled: open');
  });

  it('renders the weighted total and the stored-vs-live note', () => {
    expect(source).toContain('Score pondéré');
    expect(source).toContain('stored_sps');
  });
});

describe('the wiring', () => {
  it('the eligibility card mounts the breakdown beside the readiness badge', () => {
    const card = read('./components/ScreenhostEligibilityCard.tsx');
    expect(card).toContain('ScreenhostSpsBreakdown');
  });

  it('the service reads the admin sps endpoint', () => {
    const service = read('./services/admin-screenhost.service.ts');
    expect(service).toContain('/sps');
  });
});
