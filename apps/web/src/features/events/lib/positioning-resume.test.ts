import { describe, expect, it } from 'vitest';

import { POSITIONING_RESUME_STATE, resumeStepFor } from './positioning-resume';

describe('resumeStepFor — « Modifier » opens the récap', () => {
  it('opens step 3 when the positioning already has its spot', () => {
    expect(resumeStepFor(POSITIONING_RESUME_STATE, 'creative-1')).toBe(3);
  });

  it('opens the Vidéo step when no spot is chosen yet (the récap prices from it)', () => {
    expect(resumeStepFor(POSITIONING_RESUME_STATE, null)).toBe(2);
  });

  it('a fresh positioning (no state, or a plain resume) still starts at Zones', () => {
    expect(resumeStepFor(undefined, 'creative-1')).toBe(1);
    expect(resumeStepFor({ resumed: true }, 'creative-1')).toBe(1);
  });
});
