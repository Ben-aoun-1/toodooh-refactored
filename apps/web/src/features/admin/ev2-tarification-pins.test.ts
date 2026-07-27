import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// EV2 — the admin « Tarification » block, source-pinned (no render harness): the modal renders
// the wire shape read-only through the ONE money home, and the page mounts it from every row.

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the Tarification modal', () => {
  const source = read('./components/EventTarificationModal.tsx');

  it('prices through the ONE web TVA home (HT (TTC)) — never a local rate', () => {
    expect(source).toContain('htTtcOrDash');
    expect(source).not.toMatch(/1\.19|0\.19/); // no local TVA math
  });

  it('renders the four headline figures and the per-venue columns', () => {
    expect(source).toContain('C_max');
    expect(source).toContain('I_max');
    expect(source).toContain('établissement');
    expect(source).toContain('CPM événementiel');
    expect(source).toContain('A_max (pers/h)');
    expect(source).toContain('Blocs disponibles');
    expect(source).toContain('Impressions');
  });

  it('is READ-ONLY — no mutation hook enters the modal', () => {
    expect(source).not.toContain('useMutation');
    expect(source).toContain('useEventTarification');
  });
});

describe('the wiring', () => {
  it('the page opens the modal per row; the service reads the tarification endpoint', () => {
    const page = read('./pages/EventManagement.tsx');
    expect(page).toContain('EventTarificationModal');
    expect(page).toContain('setTarification(e)');
    const service = read('./services/admin-events.service.ts');
    expect(service).toContain('/tarification');
  });
});
