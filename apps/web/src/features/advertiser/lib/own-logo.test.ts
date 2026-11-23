import { describe, expect, it } from 'vitest';

import { logoFileProblem } from '@/features/agent/lib/agent-logos';

import { ownLogoButtonLabel, ownLogoStatusLine } from './own-logo';

describe('the Screencaster logo block', () => {
  it('invites to add a logo while there is none', () => {
    expect(ownLogoButtonLabel(false)).toBe('Ajouter le logo');
    expect(ownLogoStatusLine(false)).toContain('Aucun logo');
  });

  it('offers to change it once set', () => {
    expect(ownLogoButtonLabel(true)).toBe('Changer le logo');
    expect(ownLogoStatusLine(true)).toBe('Votre logo est affiché sur vos campagnes.');
  });

  it('applies the agent editor’s file checks', () => {
    expect(logoFileProblem({ type: 'image/png', size: 1024 })).toBeNull();
    expect(logoFileProblem({ type: 'image/webp', size: 1024 })).toBe(
      'Formats acceptés : PNG, JPEG.',
    );
    expect(logoFileProblem({ type: 'image/jpeg', size: 6 * 1024 * 1024 })).toBe(
      'Logo trop lourd (5 Mo maximum).',
    );
  });
});
