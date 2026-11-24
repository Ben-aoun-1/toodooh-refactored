import { describe, expect, it } from 'vitest';

import { logoButtonLabel, logoFileProblem, logoStatusLine } from './agent-logos';

describe('agent logo editor (specs VF « Logos »)', () => {
  it('says where the logo stands', () => {
    expect(logoStatusLine(undefined, 'screenhost')).toContain(
      'Aucun logo. Ajoutez-le lors de votre visite',
    );
    expect(logoStatusLine({ url: 'u', status: 'en_attente' }, 'screenhost')).toBe(
      'En attente de validation par Toodooh.',
    );
    expect(logoStatusLine({ url: 'u', status: 'valide' }, 'screencaster')).toBe(
      'Validé par Toodooh.',
    );
    expect(logoButtonLabel(undefined)).toBe('Ajouter le logo');
    expect(logoButtonLabel({ url: 'u', status: 'valide' })).toBe('Changer le logo');
  });

  it('takes PNG and JPEG up to 5 MB', () => {
    expect(logoFileProblem({ type: 'image/png', size: 10 })).toBeNull();
    expect(logoFileProblem({ type: 'image/webp', size: 10 })).toBe('Formats acceptés : PNG, JPEG.');
    expect(logoFileProblem({ type: 'image/jpeg', size: 6 * 1024 * 1024 })).toContain('5 Mo');
  });
});
