import { describe, expect, it } from 'vitest';

import { creativeStatusLabel } from './creative-status';

describe('creativeStatusLabel', () => {
  it('says the three validation statuses in French', () => {
    expect(creativeStatusLabel('pending')).toBe('En attente de validation');
    expect(creativeStatusLabel('approved')).toBe('Validée');
    expect(creativeStatusLabel('rejected')).toBe('Refusée');
  });

  it('keeps a status the web does not know yet as is', () => {
    expect(creativeStatusLabel('archived')).toBe('archived');
  });
});
