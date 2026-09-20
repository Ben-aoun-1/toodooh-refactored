import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CAMPAIGN_QUEUE_OPTIONS } from '@/features/admin/lib/campaign-queue';

import {
  RESPECT_DEFAULT_HINT,
  RESPECT_NO_LABEL,
  RESPECT_PANEL_TITLE,
  RESPECT_UNATTESTED_LABEL,
  RESPECT_YES_LABEL,
} from './EventAttestationsPanel';
import { REPORTER_NOTICE, REPORTER_TITLE } from './EventReporterModal';

// EV5 — the attestation + R4 surfaces: the pinned copies and the render matrix as source pins
// (the ev1-pins idiom — these pages have no render harness).

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the attestation copies (ONE home)', () => {
  it('spells the DEFAULT RULE on screen: absent attestation = respecté', () => {
    expect(RESPECT_PANEL_TITLE).toBe('Respect de l’événement');
    expect(RESPECT_DEFAULT_HINT).toBe(
      'Sans attestation, l’établissement est considéré comme ayant respecté l’événement.',
    );
    expect(RESPECT_UNATTESTED_LABEL).toBe('Non attesté (respecté par défaut)');
    expect(RESPECT_YES_LABEL).toBe('Respecté');
    expect(RESPECT_NO_LABEL).toBe('Non respecté');
  });

  it('the panel offers both verdicts per venue with an optional note', () => {
    const panel = read('./EventAttestationsPanel.tsx');
    expect(panel).toContain('adminEventsService.attest');
    expect(panel).toContain('respecte: true');
    expect(panel).toContain('respecte: false');
    expect(panel).toContain('Note d’inspection (optionnelle)');
    // The recorded state is visible: a stored verdict highlights its button.
    expect(panel).toContain('row.respecte === true');
    expect(panel).toContain('row.respecte === false');
  });
});

describe('R4 — the reporter + annuler copies', () => {
  it('reporter announces the recalculation before confirming', () => {
    expect(REPORTER_TITLE).toBe('Reporter cet événement');
    expect(REPORTER_NOTICE).toBe('Les positionnements et créneaux seront recalculés.');
    const modal = read('./EventReporterModal.tsx');
    expect(modal).toContain('adminEventsService.reporter');
    expect(modal).toContain('kickoff_at');
    expect(modal).toContain('ends_at');
  });

  it('annuler warns about the FULL refund and the released créneaux', () => {
    const page = read('../pages/EventManagement.tsx');
    expect(page).toContain('remboursement intégral');
    expect(page).toContain('créneaux réservés libérés');
    expect(page).toContain('EventReporterModal');
    expect(page).toContain('EventAttestationsPanel');
  });
});

describe('the settlement summary + the queue-filter rider', () => {
  it('the placement block renders livré/manqué + the refund once settled', () => {
    const summary = read('../../events/components/EventPlacementSummary.tsx');
    expect(summary).toContain('Diffusion terminée');
    expect(summary).toContain('Remboursé');
    expect(summary).toContain('blocs_delivered');
    expect(summary).toContain('non respecté');
  });

  it('THE RIDER: the admin queue filter reaches À venir and Terminées', () => {
    // ADM-FIX1 — the options moved out of the JSX into the tested lib (admin/lib/campaign-queue),
    // so the RIDER is asserted on the options themselves instead of on the page's source text.
    const options = new Map(CAMPAIGN_QUEUE_OPTIONS.map((o) => [o.value, o.label]));
    expect(options.get('upcoming')).toBe('À venir');
    expect(options.get('completed')).toBe('Terminées');
    // …and the examen shows the settlement columns.
    const queue = read('../pages/CampaignReviewQueue.tsx');
    expect(queue).toContain('Diffusé');
    expect(queue).toContain('Règlement :');
  });
});
